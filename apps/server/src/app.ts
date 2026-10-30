import { spawn } from 'node:child_process';
import { createReadStream, existsSync, promises as fsPromises } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import {
  AsmrOneError,
  AsmrOneProvider,
  authenticatePassword,
  buildClearedSessionCookie,
  buildSessionCookie,
  cleanupAuthSessions,
  countWorks,
  createAuthSession,
  createExportJob,
  createJob,
  decryptSecret,
  deleteExportJob,
  deleteOnlineAccount,
  deleteWork,
  detectLibraryKind,
  DlsiteProvider,
  encryptSecret,
  ExportQueue,
  failInterruptedJobs,
  findActiveExportJobForCode,
  findAuthSession,
  getAssetById,
  getExportJob,
  getJob,
  getOnlineAccount,
  getOnlinePlayback,
  getPlayback,
  getRandomWork,
  getTrackFile,
  getWorkByCode,
  getWorkRootLocation,
  hasPassword,
  isPathInside,
  listExportJobs,
  listJobs,
  listLibraryRoots,
  listLocalWorkStates,
  listRecentPlayback,
  listWorkTotal,
  listWorkFiles,
  listWorks,
  listWorksForScrape,
  loadOrCreateSecretKey,
  MAX_LIBRARY_ROOTS,
  normalizeLibraryPaths,
  openDatabase,
  OperationLogger,
  parseExportResult,
  parseExportState,
  parseSessionCookie,
  probeWorkDurations,
  readSettings,
  resolveAssetFile,
  resolveLibraryFile,
  revokeAllAuthSessions,
  revokeAuthSession,
  saveOnlineAccount,
  saveOnlinePlayback,
  savePlayback,
  scanLibrary,
  scrapeWork,
  scrapeWorkFromAsmrOne,
  scrapeWorks,
  SESSION_TTL_MS,
  setPassword,
  setWorkFavorite,
  updateJob,
  updateWorkManualMetadata,
  updateWorkOnlineMetadata,
  validatePassword,
  writeSettings,
  type AsmrOneListOrder,
  type AsmrOnePlaylist,
  type AsmrOnePlaylistFilter,
  type AsmrOneReviewOrder,
  type AsmrOneReviewProgress,
  type AsmrOneTrackNode,
  type AsmrOneWork,
  type ExportJobRecord,
  type ExportJobStatus,
  type ExportSource,
  type JobRecord,
  type LibraryKind,
  type OperationLogInput,
  type ScrapeSource,
  type WorkSort,
} from '@kikoeru-next/core';
import { mimeTypeForFileName, normalizeWorkno } from '@kikoeru-next/shared';
import {
  createLoginRateLimiter,
  isLoopbackAddress,
  isSameOrigin,
  listLanAddresses,
  listLanInterfaces,
  normalizeClientIp,
} from './access.js';
import { sendFileStream } from './stream.js';

export interface CreateAppOptions {
  databasePath: string;
  dataDir?: string;
  libraryPath?: string;
  proxyUrl?: string;
  ffprobePath?: string;
  webRoot?: string;
  boundToLan?: boolean;
  onAccessModeChange?: (lanEnabled: boolean) => void;
  logger?: boolean;
  exportSource?: ExportSource;
  onLogReady?: (logger: OperationLogger) => void;
}

function clampInt(value: string | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const PUBLIC_API_PATHS = new Set([
  '/api/ping',
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/logout',
]);

const AUDIT_EXCLUDED_PATHS = new Set([
  '/api/settings',
  '/api/scan',
  '/api/scrape',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/logs',
  '/api/playback',
  '/api/online/playback',
  '/api/online/login',
  '/api/online/logout',
  '/api/works/:code/scrape',
  '/api/works/:code/enrich',
  '/api/works/:code/probe',
]);
const AUDIT_EXCLUDED_PREFIXES = ['/api/export/jobs'];

const SETTINGS_LABELS: Record<string, string> = {
  libraryPaths: '库根',
  proxyUrl: '代理地址',
  ffprobePath: 'ffprobe 路径',
  ffmpegPath: 'ffmpeg 路径',
  asmroneBaseUrl: 'asmr.one 地址',
  exportConcurrency: '导出并发',
  lanEnabled: '局域网访问',
};

async function openFolderInSystem(targetPath: string): Promise<void> {
  const command =
    process.platform === 'win32'
      ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe')
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open';
  await new Promise<void>((resolve, reject) => {
    // windowsHide 不能设为 true，否则 Explorer 的窗口会被一起隐藏。
    const child = spawn(command, [targetPath], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export function createApp(options: CreateAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1024 * 1024,
    trustProxy: false,
  });
  const db = openDatabase(options.databasePath);
  const operationLog = new OperationLogger(db);
  options.onLogReady?.(operationLog);
  const logEvent = (input: OperationLogInput) => operationLog.record(input);
  const dataDir = path.resolve(
    options.dataDir ??
      (options.databasePath === ':memory:'
        ? 'data'
        : path.dirname(path.resolve(options.databasePath))),
  );
  const settingsDefaults = {
    libraryPath: options.libraryPath ? path.resolve(options.libraryPath) : '',
    proxyUrl: options.proxyUrl ?? '',
    ffprobePath: options.ffprobePath ?? 'ffprobe',
  };
  const getSettings = () => readSettings(db, settingsDefaults);
  let lanEnabled = getSettings().lanEnabled;
  const loginLimiter = createLoginRateLimiter();
  const sameLibraryRoot = (left: string, right: string): boolean =>
    normalizeLibraryPaths([left, right]).length === 1;
  const assetsDir = path.join(dataDir, 'assets');
  const secretKey = loadOrCreateSecretKey(dataDir);
  const webRoot = options.webRoot ? path.resolve(options.webRoot) : '';
  const servesWeb = webRoot !== '' && existsSync(path.join(webRoot, 'index.html'));
  let scanning = false;
  let activeScrapeJobId: number | null = null;
  let onlineProvider: AsmrOneProvider | null = null;
  let onlineProviderKey = '';
  const libraryKindCache = new Map<string, { kind: LibraryKind; at: number }>();
  const libraryKindFor = async (rootPath: string): Promise<LibraryKind> => {
    const key = rootPath.trim().toLowerCase();
    const cached = libraryKindCache.get(key);
    if (cached && Date.now() - cached.at < 5 * 60_000) {
      return cached.kind;
    }
    const kind = await detectLibraryKind(rootPath);
    libraryKindCache.set(key, { kind, at: Date.now() });
    return kind;
  };
  failInterruptedJobs(db);
  cleanupAuthSessions(db);
  logEvent({
    category: 'system',
    action: 'server.start',
    message: `服务已初始化${servesWeb ? '（含网页界面）' : ''}`,
    detail: { dataDir, lanEnabled },
  });

  app.addHook('onResponse', async (request, reply) => {
    const method = request.method;
    if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') {
      return;
    }
    const route = request.routeOptions?.url ?? request.url.split('?')[0] ?? '';
    if (!route.startsWith('/api/') || AUDIT_EXCLUDED_PATHS.has(route)) {
      return;
    }
    if (AUDIT_EXCLUDED_PREFIXES.some((prefix) => route.startsWith(prefix))) {
      return;
    }
    const status = reply.statusCode;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'success';
    logEvent({
      level,
      category: 'api',
      action: `${method.toLowerCase()} ${route}`,
      message: `${method} ${route} → ${status}`,
      detail: {
        method,
        route,
        status,
        durationMs: Math.round(reply.elapsedTime),
        params: request.params ?? {},
      },
      clientIp: normalizeClientIp(request.ip),
    });
  });

  app.addHook('onRequest', async (request, reply) => {
    const clientIp = normalizeClientIp(request.ip);
    if (!lanEnabled) {
      if (!isLoopbackAddress(clientIp)) {
        return reply.code(403).send({ error: '未开启局域网访问' });
      }
      return;
    }
    const method = request.method;
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      if (request.headers.origin && !isSameOrigin(request.headers.origin, request.headers.host)) {
        return reply.code(403).send({ error: '请求来源不被允许' });
      }
    }
    const pathname = request.url.split('?')[0] ?? '';
    if (!pathname.startsWith('/api/') || PUBLIC_API_PATHS.has(pathname)) {
      return;
    }
    const token = parseSessionCookie(request.headers.cookie);
    if (!findAuthSession(db, token)) {
      return reply.code(401).send({ error: '需要登录', code: 'AUTH_REQUIRED' });
    }
  });

  const getOnlineProvider = (): AsmrOneProvider => {
    const settings = getSettings();
    const key = `${settings.proxyUrl}|${settings.asmroneBaseUrl}`;
    if (!onlineProvider || onlineProviderKey !== key) {
      const previous = onlineProvider;
      onlineProvider = new AsmrOneProvider({
        proxyUrl: settings.proxyUrl,
        baseUrl: settings.asmroneBaseUrl,
      });
      onlineProviderKey = key;
      const account = getOnlineAccount(db, 'asmrone');
      if (account?.tokenEnc) {
        try {
          onlineProvider.setToken(decryptSecret(secretKey, account.tokenEnc));
        } catch {
          // 本机密钥变化后旧密文无法解开，按未登录处理，等待重新登录。
        }
      }
      if (previous) {
        void previous.close();
      }
    }
    return onlineProvider;
  };

  const sendOnlineError = (reply: FastifyReply, error: unknown) => {
    if (error instanceof AsmrOneError) {
      const status =
        error.kind === 'not_found'
          ? 404
          : error.kind === 'unauthorized'
            ? 401
            : error.kind === 'blocked'
              ? 400
              : 502;
      return reply.code(status).send({ error: error.message, kind: error.kind });
    }
    return reply.code(502).send({
      error: error instanceof Error ? error.message : String(error),
      kind: 'unknown',
    });
  };

  const exportSource = (): ExportSource => options.exportSource ?? getOnlineProvider();
  const exportQueue = new ExportQueue({
    db,
    assetsDir,
    getSource: exportSource,
    getFfmpegPath: () => getSettings().ffmpegPath,
    onEvent: (event) => {
      const { job } = event;
      const detail = {
        jobId: job.id,
        code: job.code,
        title: job.title,
        status: job.status,
        progress: job.progress,
        trackTotal: job.trackTotal,
        trackCompleted: job.trackCompleted,
      };
      switch (event.kind) {
        case 'started':
          logEvent({
            category: 'export',
            action: 'export.started',
            message: `开始导出 ${job.code}《${job.title}》`,
            detail,
          });
          break;
        case 'done':
          logEvent({
            level: 'success',
            category: 'export',
            action: 'export.done',
            message: `导出完成 ${job.code} · ${job.trackCompleted}/${job.trackTotal} 轨`,
            detail,
          });
          break;
        case 'failed':
          logEvent({
            level: 'error',
            category: 'export',
            action: 'export.failed',
            message: `导出失败 ${job.code}：${job.error}`,
            detail,
          });
          break;
        case 'paused':
          logEvent({
            level: 'warn',
            category: 'export',
            action: 'export.paused',
            message: `导出已暂停 ${job.code}`,
            detail,
          });
          break;
        case 'cancelled':
          logEvent({
            level: 'warn',
            category: 'export',
            action: 'export.cancelled',
            message: `导出已取消 ${job.code}`,
            detail,
          });
          break;
        default:
          logEvent({
            category: 'export',
            action: 'export.queued',
            message: `导出任务已排队 ${job.code}`,
            detail,
          });
          break;
      }
    },
  });
  exportQueue.start();

  const normalizeSort = (value: string | undefined): WorkSort => {
    switch (value) {
      case 'popular':
      case 'rating':
      case 'released':
      case 'title':
        return value;
      default:
        return 'updated';
    }
  };

  const normalizeOnlineOrder = (value: string | undefined): AsmrOneListOrder => {
    switch (value) {
      case 'release':
      case 'dl_count':
      case 'rate_average_2dp':
        return value;
      default:
        return 'create_date';
    }
  };

  const normalizeReviewProgress = (
    value: string | undefined,
  ): AsmrOneReviewProgress | null => {
    switch (value) {
      case 'marked':
      case 'listening':
      case 'listened':
      case 'replay':
      case 'postponed':
        return value;
      default:
        return null;
    }
  };

  const normalizeReviewOrder = (value: string | undefined): AsmrOneReviewOrder => {
    switch (value) {
      case 'userRating':
      case 'release':
      case 'review_count':
      case 'dl_count':
        return value;
      default:
        return 'updated_at';
    }
  };

  const normalizePlaylistFilter = (value: string | undefined): AsmrOnePlaylistFilter => {
    switch (value) {
      case 'owned':
      case 'liked':
        return value;
      default:
        return 'all';
    }
  };

  const normalizePlaylistId = (value: string): string =>
    /^[a-z0-9][a-z0-9_-]{7,79}$/i.test(value) ? value : '';

  const decoratePlaylist = (playlist: AsmrOnePlaylist) => ({
    ...playlist,
    displayName:
      playlist.systemKind === 'liked'
        ? '我喜欢的'
        : playlist.systemKind === 'marked'
          ? '我标记的'
          : playlist.name,
    coverUrl:
      playlist.latestWorkId > 0
        ? `/api/online/works/${playlist.latestWorkId}/cover?type=main`
        : '',
  });

  const localStateMap = (codes: string[]) =>
    new Map(listLocalWorkStates(db, codes).map((state) => [state.code, state]));

  const decorateOnlineWork = (
    work: AsmrOneWork,
    states: Map<string, { code: string; favoriteAt: string }>,
  ) => {
    const state = states.get(work.code);
    return {
      ...work,
      coverUrl: `/api/online/works/${work.id}/cover?type=main`,
      thumbUrl: `/api/online/works/${work.id}/cover?type=sam`,
      local: Boolean(state),
      favoriteAt: state?.favoriteAt ?? '',
    };
  };

  const toJobResponse = (job: JobRecord) => {
    const parseJson = (raw: string): unknown => {
      try {
        const value: unknown = JSON.parse(raw);
        if (value && typeof value === 'object' && Object.keys(value).length === 0) {
          return null;
        }
        return value;
      } catch {
        return raw;
      }
    };
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      lastError: job.lastError,
      payload: parseJson(job.payloadJson),
      result: parseJson(job.resultJson),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  };

  const toExportJobResponse = (job: ExportJobRecord) => {
    const state = parseExportState(job);
    const tracks = Object.values(state.tracks)
      .sort((a, b) => a.order - b.order)
      .map((track) => ({
        hash: track.hash,
        order: track.order,
        index: track.index,
        title: track.title,
        groupTitle: track.groupTitle,
        disc: track.disc,
        type: track.type ?? 'audio',
        relativePath: track.relativePath ?? '',
        size: track.size,
        durationMs: track.durationMs,
        bytes: track.bytes,
        file: track.file,
        status: track.status,
        error: track.error,
      }));
    return {
      id: job.id,
      code: job.code,
      title: job.title,
      remoteWorkId: job.remoteWorkId,
      status: job.status,
      progress: job.progress,
      phase: state.phase,
      trackTotal: job.trackTotal || tracks.length,
      trackCompleted: job.trackCompleted,
      targetRelativePath: job.targetRelativePath,
      targetRootPath: job.targetRootPath,
      error: job.error,
      tracks,
      result: parseExportResult(job),
      coverUrl:
        job.remoteWorkId > 0
          ? `/api/online/works/${job.remoteWorkId}/cover?type=sam`
          : '',
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  };

  app.addHook('onClose', async () => {
    await exportQueue.shutdown();
    if (onlineProvider) {
      await onlineProvider.close();
      onlineProvider = null;
    }
    db.close();
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('content-security-policy', CONTENT_SECURITY_POLICY);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    return payload;
  });

  if (servesWeb) {
    app.register(fastifyStatic, {
      root: webRoot,
      index: 'index.html',
      setHeaders: (reply, filePath) => {
        const relative = path.relative(webRoot, filePath).replace(/\\/g, '/');
        reply.header(
          'cache-control',
          relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
  }

  app.get('/api/ping', async () => ({
    ok: true,
    name: 'kikoeru-next',
    version: '1.0.6',
    serverTime: new Date().toISOString(),
  }));

  app.get('/api/health', async () => {
    const settings = getSettings();
    return {
      ok: true,
      version: '1.0.6',
      libraryPath: settings.libraryPath,
      libraryPaths: settings.libraryPaths,
      workCount: countWorks(db),
      dataDir,
    };
  });

  app.get('/api/settings', async () => getSettings());

  app.get('/api/auth/status', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const token = parseSessionCookie(request.headers.cookie);
    return {
      required: lanEnabled,
      authenticated: lanEnabled ? Boolean(findAuthSession(db, token)) : true,
      hasPassword: hasPassword(db),
    };
  });

  app.post<{ Body: { password?: unknown } }>('/api/auth/login', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!lanEnabled) {
      return reply.code(400).send({ error: '未开启局域网访问' });
    }
    if (!hasPassword(db)) {
      return reply.code(400).send({ error: '尚未设置访问密码' });
    }
    const clientIp = normalizeClientIp(request.ip);
    const decision = loginLimiter.check(clientIp);
    if (!decision.allowed) {
      logEvent({
        level: 'warn',
        category: 'auth',
        action: 'auth.login.locked',
        message: `登录尝试过于频繁，已暂时锁定（${clientIp || '未知地址'}）`,
        detail: { retryAfterSeconds: decision.retryAfterSeconds },
        clientIp,
      });
      reply.header('retry-after', String(decision.retryAfterSeconds));
      return reply.code(429).send({ error: '尝试过于频繁，请稍后再试' });
    }
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    if (!password) {
      return reply.code(400).send({ error: '请输入密码' });
    }
    if (!(await authenticatePassword(db, password))) {
      loginLimiter.recordFailure(clientIp);
      logEvent({
        level: 'warn',
        category: 'auth',
        action: 'auth.login.failed',
        message: `密码错误（${clientIp || '未知地址'}）`,
        clientIp,
      });
      return reply.code(401).send({ error: '密码不正确' });
    }
    loginLimiter.recordSuccess(clientIp);
    const session = createAuthSession(db);
    reply.header(
      'set-cookie',
      buildSessionCookie(session.token, Math.floor(SESSION_TTL_MS / 1000)),
    );
    logEvent({
      level: 'success',
      category: 'auth',
      action: 'auth.login',
      message: `登录成功（${clientIp || '未知地址'}）`,
      clientIp,
    });
    return { ok: true, expiresAt: session.expiresAt };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    revokeAuthSession(db, parseSessionCookie(request.headers.cookie));
    reply.header('set-cookie', buildClearedSessionCookie());
    logEvent({
      category: 'auth',
      action: 'auth.logout',
      message: '已退出登录',
      clientIp: normalizeClientIp(request.ip),
    });
    return { ok: true };
  });

  app.get('/api/access', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const settings = getSettings();
    const port = request.socket.localPort ?? 0;
    return {
      lanEnabled: settings.lanEnabled,
      hasPassword: hasPassword(db),
      boundToLan: options.boundToLan ?? false,
      restartRequired:
        options.boundToLan !== undefined && options.boundToLan !== settings.lanEnabled,
      port,
      addresses: listLanAddresses(port),
    };
  });

  app.get('/api/network', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return { interfaces: listLanInterfaces() };
  });

  const parseLogId = (value: string | undefined): number | undefined => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  };

  app.get<{
    Querystring: {
      limit?: string;
      before?: string;
      after?: string;
      level?: string;
      category?: string;
    };
  }>('/api/logs', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const limit = clampInt(request.query.limit, 1, 500, 200);
    const afterId = parseLogId(request.query.after);
    const beforeId = afterId ? undefined : parseLogId(request.query.before);
    return operationLog.list({
      limit,
      ...(afterId ? { afterId } : {}),
      ...(beforeId ? { beforeId } : {}),
      ...(request.query.level ? { level: request.query.level.trim() } : {}),
      ...(request.query.category ? { category: request.query.category.trim() } : {}),
    });
  });

  app.delete('/api/logs', async (request) => {
    operationLog.clear();
    const entry = logEvent({
      category: 'system',
      action: 'logs.clear',
      message: '运行日志已清空',
      clientIp: normalizeClientIp(request.ip),
    });
    return { ok: true, entry };
  });

  app.get('/api/logs/stream', async (request, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    raw.flushHeaders();
    raw.write('retry: 3000\n\n');
    const send = (entry: unknown) => {
      if (raw.writableEnded) {
        return;
      }
      raw.write(`id: ${(entry as { id?: number }).id ?? 0}\ndata: ${JSON.stringify(entry)}\n\n`);
    };
    const unsubscribe = operationLog.subscribe(send);
    const heartbeat = setInterval(() => {
      if (!raw.writableEnded) {
        raw.write(': ping\n\n');
      }
    }, 15_000);
    heartbeat.unref();
    let closed = false;
    const cleanup = () => {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.raw.on('close', cleanup);
    raw.on('close', cleanup);
    raw.write(
      `event: ready\ndata: ${JSON.stringify({ latestId: operationLog.list({ limit: 1 }).latestId })}\n\n`,
    );
  });

  app.get('/api/library/roots', async () => {
    const settings = getSettings();
    const key = (value: string): string =>
      value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const indexed = new Map(listLibraryRoots(db).map((root) => [key(root.path), root]));
    const roots = await Promise.all(
      settings.libraryPaths.map(async (rootPath) => {
        const record = indexed.get(key(rootPath));
        return {
          path: rootPath,
          rootId: record?.id ?? 0,
          workCount: record?.workCount ?? 0,
          kind: await libraryKindFor(rootPath),
        };
      }),
    );
    return { roots };
  });

  app.put<{
    Body: {
      libraryPaths?: unknown;
      libraryPath?: unknown;
      proxyUrl?: unknown;
      ffprobePath?: unknown;
      ffmpegPath?: unknown;
      asmroneBaseUrl?: unknown;
      exportConcurrency?: unknown;
      lanEnabled?: unknown;
      password?: unknown;
      currentPassword?: unknown;
    };
  }>('/api/settings', async (request, reply) => {
    const body = request.body ?? {};
    const previousSettings = getSettings();
    const clientIp = normalizeClientIp(request.ip);
    const patch: {
      libraryPaths?: string[];
      libraryPath?: string;
      proxyUrl?: string;
      ffprobePath?: string;
      ffmpegPath?: string;
      asmroneBaseUrl?: string;
      exportConcurrency?: number;
      lanEnabled?: boolean;
    } = {};
    if (body.libraryPaths !== undefined) {
      if (
        !Array.isArray(body.libraryPaths) ||
        body.libraryPaths.some((value) => typeof value !== 'string')
      ) {
        return reply.code(400).send({ error: 'libraryPaths 必须是字符串数组' });
      }
      const rawPaths = body.libraryPaths as string[];
      if (rawPaths.filter((value) => value.trim()).length > MAX_LIBRARY_ROOTS) {
        return reply.code(400).send({ error: `最多配置 ${MAX_LIBRARY_ROOTS} 个库根` });
      }
      patch.libraryPaths = normalizeLibraryPaths(rawPaths);
    }
    for (const key of [
      'libraryPath',
      'proxyUrl',
      'ffprobePath',
      'ffmpegPath',
      'asmroneBaseUrl',
    ] as const) {
      const value = body[key];
      if (value === undefined) {
        continue;
      }
      if (typeof value !== 'string') {
        return reply.code(400).send({ error: `${key} 必须是字符串` });
      }
      patch[key] = value;
    }
    if (body.exportConcurrency !== undefined) {
      if (
        typeof body.exportConcurrency !== 'number' ||
        !Number.isFinite(body.exportConcurrency)
      ) {
        return reply.code(400).send({ error: 'exportConcurrency 必须是 1–3 的数字' });
      }
      patch.exportConcurrency = Math.min(3, Math.max(1, Math.round(body.exportConcurrency)));
    }
    if (body.lanEnabled !== undefined) {
      if (typeof body.lanEnabled !== 'boolean') {
        return reply.code(400).send({ error: 'lanEnabled 必须是布尔值' });
      }
      patch.lanEnabled = body.lanEnabled;
    }
    const nextLanEnabled = patch.lanEnabled ?? lanEnabled;
    const hasExistingPassword = hasPassword(db);
    let newPassword: string | null = null;
    if (body.password !== undefined) {
      if (typeof body.password !== 'string') {
        return reply.code(400).send({ error: 'password 必须是字符串' });
      }
      try {
        validatePassword(body.password);
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
      if (hasExistingPassword && lanEnabled) {
        if (
          typeof body.currentPassword !== 'string' ||
          !(await authenticatePassword(db, body.currentPassword))
        ) {
          return reply.code(401).send({ error: '当前密码不正确' });
        }
      }
      newPassword = body.password;
    }
    if (nextLanEnabled && !hasExistingPassword && !newPassword) {
      return reply.code(400).send({ error: '开启局域网访问前请先设置访问密码' });
    }
    if (newPassword) {
      await setPassword(db, newPassword);
      revokeAllAuthSessions(db);
    }
    const saved = writeSettings(db, patch);
    if (saved.lanEnabled && !findAuthSession(db, parseSessionCookie(request.headers.cookie))) {
      const session = createAuthSession(db);
      reply.header(
        'set-cookie',
        buildSessionCookie(session.token, Math.floor(SESSION_TTL_MS / 1000)),
      );
    }
    if (saved.lanEnabled !== lanEnabled) {
      lanEnabled = saved.lanEnabled;
      options.onAccessModeChange?.(lanEnabled);
    }
    const changedKeys = (
      [
        'libraryPaths',
        'proxyUrl',
        'ffprobePath',
        'ffmpegPath',
        'asmroneBaseUrl',
        'exportConcurrency',
        'lanEnabled',
      ] as const
    ).filter(
      (key) => JSON.stringify(previousSettings[key]) !== JSON.stringify(saved[key]),
    );
    if (newPassword) {
      logEvent({
        level: 'success',
        category: 'auth',
        action: 'auth.password.changed',
        message: '访问密码已更新，旧会话已全部失效',
        clientIp,
      });
    }
    if (changedKeys.includes('lanEnabled')) {
      logEvent({
        level: 'success',
        category: 'settings',
        action: 'settings.lan',
        message: saved.lanEnabled ? '局域网访问已开启' : '局域网访问已关闭',
        detail: { lanEnabled: saved.lanEnabled },
        clientIp,
      });
    }
    if (changedKeys.length > 0) {
      const detail: Record<string, unknown> = {};
      for (const key of changedKeys) {
        detail[key] = saved[key];
      }
      logEvent({
        category: 'settings',
        action: 'settings.update',
        message: `已更新设置：${changedKeys.map((key) => SETTINGS_LABELS[key] ?? key).join('、')}`,
        detail,
        clientIp,
      });
    }
    return {
      ...saved,
      restartRequired:
        options.boundToLan !== undefined && options.boundToLan !== saved.lanEnabled,
    };
  });

  app.get<{
    Querystring: {
      q?: string;
      tag?: string;
      circle?: string;
      va?: string;
      limit?: string;
      offset?: string;
      sort?: string;
      favorite?: string;
    };
  }>('/api/works', async (request) => {
    const limit = clampInt(request.query.limit, 1, 200, 60);
    const offset = clampInt(request.query.offset, 0, 1_000_000, 0);
    const query = request.query.q?.trim() ?? '';
    const tag = request.query.tag?.trim() ?? '';
    const circle = request.query.circle?.trim() ?? '';
    const va = request.query.va?.trim() ?? '';
    const sort = normalizeSort(request.query.sort);
    const favoriteOnly = request.query.favorite === '1';
    return {
      items: listWorks(db, { query, tag, circle, va, limit, offset, sort, favoriteOnly }),
      total: listWorkTotal(db, { query, tag, circle, va, favoriteOnly }),
      limit,
      offset,
      sort,
      favoriteOnly,
      tag,
      circle,
      va,
    };
  });

  app.get('/api/works/random', async (_request, reply) => {
    const work = getRandomWork(db);
    if (!work) {
      return reply.code(404).send({ error: '曲库中还没有可播放的作品' });
    }
    return work;
  });

  app.patch<{ Params: { code: string }; Body: Record<string, unknown> }>(
    '/api/works/:code',
    async (request, reply) => {
      const code = normalizeWorkno(request.params.code);
      if (!code) {
        return reply.code(400).send({ error: 'RJ号格式不正确' });
      }
      const work = getWorkByCode(db, code);
      if (!work) {
        return reply.code(404).send({ error: '作品不存在' });
      }
      const body = request.body ?? {};
      const readText = (key: string, fallback: string): string | null => {
        const value = body[key];
        if (value === undefined) {
          return fallback;
        }
        if (typeof value !== 'string') {
          return null;
        }
        return value.trim();
      };
      const readList = (key: string, fallback: string[]): string[] | null => {
        const value = body[key];
        if (value === undefined) {
          return fallback;
        }
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
          return null;
        }
        return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
      };
      const title = readText('title', work.title);
      const circle = readText('circle', work.circle);
      const releaseDate = readText('releaseDate', work.releaseDate);
      const workType = readText('workType', work.workType);
      const tags = readList('tags', work.tags);
      const vas = readList('vas', work.vas);
      if (
        title === null ||
        circle === null ||
        releaseDate === null ||
        workType === null ||
        tags === null ||
        vas === null
      ) {
        return reply.code(400).send({ error: '作品信息字段格式不正确' });
      }
      if (!title) {
        return reply.code(400).send({ error: '标题不能为空' });
      }
      let rating = work.rating;
      if (body.rating !== undefined) {
        if (body.rating === null) {
          rating = null;
        } else if (
          typeof body.rating === 'number' &&
          Number.isFinite(body.rating) &&
          body.rating >= 0 &&
          body.rating <= 5
        ) {
          rating = Math.round(body.rating * 100) / 100;
        } else {
          return reply.code(400).send({ error: '评分必须是 0 到 5 之间的数字' });
        }
      }
      let priceYen = work.priceYen;
      if (body.priceYen !== undefined) {
        if (body.priceYen === null) {
          priceYen = null;
        } else if (
          typeof body.priceYen === 'number' &&
          Number.isInteger(body.priceYen) &&
          body.priceYen >= 0
        ) {
          priceYen = body.priceYen;
        } else {
          return reply.code(400).send({ error: '价格必须是非负整数' });
        }
      }
      updateWorkManualMetadata(db, work.id, {
        title,
        circle,
        releaseDate,
        workType,
        tags,
        vas,
        rating,
        priceYen,
      });
      return getWorkByCode(db, code);
    },
  );

  app.get<{ Params: { code: string } }>('/api/works/:code', async (request, reply) => {
    const code = normalizeWorkno(request.params.code);
    if (!code) {
      return reply.code(400).send({ error: 'RJ号格式不正确' });
    }
    const work = getWorkByCode(db, code);
    if (!work) {
      return reply.code(404).send({ error: '作品不存在' });
    }
    return { ...work, playback: getPlayback(db, work.id) };
  });

  app.get<{ Params: { code: string } }>('/api/works/:code/files', async (request, reply) => {
    const code = normalizeWorkno(request.params.code);
    if (!code) {
      return reply.code(400).send({ error: 'RJ号格式不正确' });
    }
    const location = getWorkRootLocation(db, code);
    if (!location) {
      return reply.code(404).send({ error: '作品不存在' });
    }
    try {
      const result = await listWorkFiles({
        db,
        rootPath: location.rootPath,
        workPath: location.relativePath,
        workId: location.id,
      });
      return { code, workPath: location.relativePath, ...result };
    } catch (error) {
      logEvent({
        level: 'warn',
        category: 'library',
        action: 'work.files.failed',
        message: `读取作品文件失败 ${code}：${
          error instanceof Error ? error.message : String(error)
        }`,
        detail: { code },
        clientIp: normalizeClientIp(request.ip),
      });
      return reply.code(500).send({ error: '读取作品文件失败' });
    }
  });

  app.get<{ Params: { code: string }; Querystring: { path?: string } }>(
    '/api/works/:code/file',
    async (request, reply) => {
      const code = normalizeWorkno(request.params.code);
      if (!code) {
        return reply.code(400).send({ error: 'RJ号格式不正确' });
      }
      const relative = typeof request.query.path === 'string' ? request.query.path : '';
      if (!relative || relative.includes('\0')) {
        return reply.code(400).send({ error: 'path 不正确' });
      }
      const location = getWorkRootLocation(db, code);
      if (!location) {
        return reply.code(404).send({ error: '作品不存在' });
      }
      const fullRelative = [location.relativePath, relative]
        .filter(Boolean)
        .join('/')
        .replace(/\\/g, '/');
      const resolved = await resolveLibraryFile(location.rootPath, fullRelative);
      if (!resolved) {
        return reply.code(404).send({ error: '文件不存在或不可访问' });
      }
      reply.header('cache-control', 'private, max-age=0, must-revalidate');
      return sendFileStream(reply, {
        filePath: resolved.absolutePath,
        size: resolved.size,
        mimeType: mimeTypeForFileName(relative),
        rangeHeader: request.headers.range,
        headOnly: request.method === 'HEAD',
      });
    },
  );

  app.post<{ Params: { code: string } }>(
    '/api/works/:code/open-folder',
    async (request, reply) => {
      if (!isLoopbackAddress(request.ip)) {
        return reply.code(403).send({ error: '仅本机可打开本地文件夹' });
      }
      const code = normalizeWorkno(request.params.code);
      if (!code) {
        return reply.code(400).send({ error: 'RJ号格式不正确' });
      }
      const location = getWorkRootLocation(db, code);
      if (!location) {
        return reply.code(404).send({ error: '作品不存在' });
      }
      const rootPath = path.resolve(location.rootPath);
      const targetPath = path.resolve(
        rootPath,
        ...location.relativePath.split('/').filter(Boolean),
      );
      try {
        const [realRoot, realTarget] = await Promise.all([
          fsPromises.realpath(rootPath),
          fsPromises.realpath(targetPath),
        ]);
        if (!isPathInside(realRoot, realTarget)) {
          return reply.code(404).send({ error: '作品目录不存在' });
        }
        const stat = await fsPromises.stat(realTarget);
        if (!stat.isDirectory()) {
          return reply.code(404).send({ error: '作品目录不存在' });
        }
        try {
          await openFolderInSystem(realTarget);
        } catch (error) {
          request.log.error({ err: error }, '打开本地文件夹失败');
          return reply.code(500).send({ error: '无法打开本地文件夹' });
        }
        logEvent({
          category: 'library',
          action: 'work.folder.open',
          message: `打开本地文件夹 ${code}`,
          detail: { code },
          clientIp: normalizeClientIp(request.ip),
        });
        return { opened: true };
      } catch {
        return reply.code(404).send({ error: '作品目录不存在或不可访问' });
      }
    },
  );

  app.delete<{ Params: { code: string }; Body: { deleteFiles?: unknown } }>(
    '/api/works/:code',
    async (request, reply) => {
      if (!isLoopbackAddress(request.ip)) {
        return reply.code(403).send({ error: '仅本机可删除作品' });
      }
      const code = normalizeWorkno(request.params.code);
      if (!code) {
        return reply.code(400).send({ error: 'RJ号格式不正确' });
      }
      const location = getWorkRootLocation(db, code);
      if (!location) {
        return reply.code(404).send({ error: '作品不存在' });
      }
      const deleteFiles = request.body?.deleteFiles === true;
      if (deleteFiles) {
        const relativePath = location.relativePath.replace(/\\/g, '/').trim();
        if (!relativePath) {
          return reply.code(400).send({ error: '作品目录为空，无法删除本地文件' });
        }
        const rootPath = path.resolve(location.rootPath);
        const targetPath = path.resolve(
          rootPath,
          ...relativePath.split('/').filter(Boolean),
        );
        if (targetPath === rootPath || !isPathInside(rootPath, targetPath)) {
          return reply.code(400).send({ error: '作品目录不在库根内' });
        }
        try {
          const [realRoot, realTarget] = await Promise.all([
            fsPromises.realpath(rootPath),
            fsPromises.realpath(targetPath),
          ]);
          if (!isPathInside(realRoot, realTarget)) {
            return reply.code(403).send({ error: '作品目录不在库根内' });
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            request.log.error({ err: error }, '校验作品目录失败');
            return reply.code(500).send({ error: '无法校验作品目录' });
          }
        }
        try {
          await fsPromises.rm(targetPath, {
            recursive: true,
            force: true,
            maxRetries: 2,
          });
        } catch (error) {
          request.log.error({ err: error }, '删除本地作品文件失败');
          return reply.code(500).send({ error: '无法删除本地作品文件' });
        }
      }
      const deleted = deleteWork(db, code);
      if (!deleted) {
        return reply.code(404).send({ error: '作品不存在' });
      }
      logEvent({
        category: 'library',
        action: 'work.delete',
        message: `从曲库删除 ${code}${deleteFiles ? '（含本地文件）' : ''}`,
        detail: { code, deleteFiles },
        clientIp: normalizeClientIp(request.ip),
      });
      return { deleted: true, filesDeleted: deleteFiles };
    },
  );

  app.put<{ Params: { code: string }; Body: { favorite?: unknown } }>(
    '/api/works/:code/favorite',
    async (request, reply) => {
      const code = normalizeWorkno(request.params.code);
      if (!code) {
        return reply.code(400).send({ error: 'RJ号格式不正确' });
      }
      if (typeof request.body?.favorite !== 'boolean') {
        return reply.code(400).send({ error: 'favorite 必须是布尔值' });
      }
      const result = setWorkFavorite(db, code, request.body.favorite);
      if (!result) {
        return reply.code(404).send({ error: '作品不存在' });
      }
      return { code, favoriteAt: result.favoriteAt };
    },
  );

  app.post<{ Params: { code: string } }>('/api/works/:code/enrich', async (request, reply) => {
    const code = normalizeWorkno(request.params.code);
    if (!code) {
      return reply.code(400).send({ error: 'RJ号格式不正确' });
    }
    const work = getWorkByCode(db, code);
    if (!work) {
      return reply.code(404).send({ error: '作品不存在' });
    }
    try {
      const info = await getOnlineProvider().fetchWorkInfo(code);
      updateWorkOnlineMetadata(db, work.id, {
        rating: info.rating,
        priceYen: info.priceYen,
        vas: info.vas,
      });
      logEvent({
        level: 'success',
        category: 'online',
        action: 'online.enrich',
        message: `已补全在线资料 ${code}`,
        detail: { code, title: info.title },
        clientIp: normalizeClientIp(request.ip),
      });
      return { work: getWorkByCode(db, code) };
    } catch (error) {
      logEvent({
        level: 'warn',
        category: 'online',
        action: 'online.enrich.failed',
        message: `补全在线资料失败 ${code}：${error instanceof Error ? error.message : String(error)}`,
        detail: { code },
        clientIp: normalizeClientIp(request.ip),
      });
      return sendOnlineError(reply, error);
    }
  });

  app.post<{ Params: { code: string }; Body?: { source?: unknown } }>(
    '/api/works/:code/scrape',
    async (request, reply) => {
      const code = normalizeWorkno(request.params.code);
      if (!code) {
        return reply.code(400).send({ error: 'RJ号格式不正确' });
      }
      if (activeScrapeJobId !== null) {
        return reply.code(409).send({ error: '批量刮削进行中，请稍后再试', jobId: activeScrapeJobId });
      }
      const requested = request.body?.source;
      if (
        requested !== undefined &&
        requested !== 'auto' &&
        requested !== 'dlsite' &&
        requested !== 'asmrone'
      ) {
        return reply.code(400).send({ error: '刮削来源只能是 auto / dlsite / asmr.one' });
      }
      const source = requested === 'dlsite' || requested === 'asmrone' ? requested : 'auto';
      const work = listWorksForScrape(db).find((item) => item.code === code);
      if (!work) {
        return reply.code(404).send({ error: '作品不存在' });
      }
      const settings = getSettings();
      const clientIp = normalizeClientIp(request.ip);
      const scrapeOptions = {
        assetsDir,
        ffmpegPath: settings.ffmpegPath,
        force: true,
      };
      let result: Awaited<ReturnType<typeof scrapeWork>>;
      let usedSource: ScrapeSource = 'dlsite';
      const provider = source === 'asmrone' ? null : new DlsiteProvider({ proxyUrl: settings.proxyUrl });
      try {
        if (source === 'asmrone') {
          result = await scrapeWorkFromAsmrOne(db, getOnlineProvider(), work, scrapeOptions);
          usedSource = 'asmrone';
        } else {
          result = await scrapeWork(db, provider!, work, scrapeOptions);
          if (source === 'auto' && result.status === 'not_found') {
            result = await scrapeWorkFromAsmrOne(db, getOnlineProvider(), work, scrapeOptions);
            usedSource = 'asmrone';
          }
        }
        logEvent({
          level: result.status === 'ok' ? 'success' : 'warn',
          category: 'scrape',
          action: result.cover === 'failed' ? 'scrape.cover.failed' : 'scrape.work.done',
          message:
            result.status === 'ok'
              ? `刮削完成 ${code}（${usedSource === 'asmrone' ? 'asmr.one' : 'DLsite'}）`
              : `${result.cover === 'failed' ? '封面下载失败' : '刮削未完成'} ${code}：${result.message}`,
          detail: {
            code,
            source: usedSource,
            status: result.status,
            cover: result.cover,
            message: result.message,
            title: result.title,
          },
          clientIp,
        });
        return { ...result, source: usedSource, work: getWorkByCode(db, code) };
      } catch (error) {
        logEvent({
          level: 'error',
          category: 'scrape',
          action: 'scrape.failed',
          message: `刮削失败 ${code}：${error instanceof Error ? error.message : String(error)}`,
          detail: { code, source: usedSource },
          clientIp,
        });
        throw error;
      } finally {
        await provider?.close();
      }
    },
  );

  app.post<{ Params: { code: string } }>('/api/works/:code/probe', async (request, reply) => {
    const code = normalizeWorkno(request.params.code);
    if (!code) {
      return reply.code(400).send({ error: 'RJ号格式不正确' });
    }
    const work = getWorkByCode(db, code);
    if (!work) {
      return reply.code(404).send({ error: '作品不存在' });
    }
    const result = await probeWorkDurations(db, work.id, {
      ffprobePath: getSettings().ffprobePath,
      concurrency: 2,
    });
    logEvent({
      level: result.failed > 0 ? 'warn' : 'success',
      category: 'library',
      action: 'probe.done',
      message: `时长探测完成 ${code}：${result.updated}/${result.total} 条${
        result.failed > 0 ? `，失败 ${result.failed} 条` : ''
      }`,
      detail: {
        code,
        total: result.total,
        updated: result.updated,
        failed: result.failed,
        skipped: result.skipped,
      },
      clientIp: normalizeClientIp(request.ip),
    });
    return { ...result, work: getWorkByCode(db, code) };
  });

  app.post<{ Body: { rootPath?: unknown } }>('/api/scan', async (request, reply) => {
    if (scanning) {
      return reply.code(409).send({ error: '扫描进行中' });
    }
    const rawRoot = request.body?.rootPath;
    if (rawRoot !== undefined && typeof rawRoot !== 'string') {
      return reply.code(400).send({ error: 'rootPath 必须是字符串' });
    }
    const requested = typeof rawRoot === 'string' ? rawRoot.trim() : '';
    const settings = getSettings();
    const targets = requested ? [requested] : settings.libraryPaths;
    if (targets.length === 0) {
      return reply.code(400).send({ error: '未配置库路径' });
    }
    if (requested) {
      const alreadyConfigured = settings.libraryPaths.some((rootPath) =>
        sameLibraryRoot(rootPath, requested),
      );
      if (!alreadyConfigured && settings.libraryPaths.length >= MAX_LIBRARY_ROOTS) {
        return reply
          .code(400)
          .send({ error: `最多配置 ${MAX_LIBRARY_ROOTS} 个库根，请先在设置中移除一个` });
      }
    }
    scanning = true;
    const clientIp = normalizeClientIp(request.ip);
    const startedAt = Date.now();
    logEvent({
      category: 'scan',
      action: 'scan.start',
      message: `开始扫描${requested ? `库根 ${requested}` : ` ${targets.length} 个库根`}`,
      detail: { targets },
      clientIp,
    });
    try {
      const results = [];
      for (const target of targets) {
        results.push(await scanLibrary({ db, rootPath: target }));
      }
      for (const result of results) {
        for (const error of result.errors) {
          logEvent({
            level: 'warn',
            category: 'scan',
            action: 'scan.file.failed',
            message: `扫描 ${result.rootPath} 时遇到问题：${error}`,
            detail: { rootPath: result.rootPath, error },
            clientIp,
          });
        }
      }
      const worksFound = results.reduce((sum, result) => sum + result.worksFound, 0);
      const worksAdded = results.reduce((sum, result) => sum + result.worksAdded, 0);
      const tracksFound = results.reduce((sum, result) => sum + result.tracksFound, 0);
      const errorCount = results.reduce((sum, result) => sum + result.errors.length, 0);
      logEvent({
        level: errorCount > 0 ? 'warn' : 'success',
        category: 'scan',
        action: 'scan.done',
        message: `扫描完成：${worksFound} 部作品 / ${tracksFound} 条音轨，新增 ${worksAdded} 部${
          errorCount > 0 ? `，${errorCount} 个问题` : ''
        }`,
        detail: {
          targets,
          worksFound,
          worksAdded,
          tracksFound,
          errorCount,
          durationMs: Date.now() - startedAt,
        },
        clientIp,
      });
      if (requested) {
        // 定向扫描新目录时顺手登记库根，保留「扫描即配置」的旧行为，
        // 并把用户输入替换成解析后的绝对路径。
        const scanned = results[0];
        if (scanned) {
          const paths = [...settings.libraryPaths];
          const index = paths.findIndex((rootPath) =>
            sameLibraryRoot(rootPath, requested),
          );
          if (index >= 0) {
            paths[index] = scanned.rootPath;
          } else {
            paths.push(scanned.rootPath);
          }
          writeSettings(db, { libraryPaths: paths });
        }
        return scanned;
      }
      return { results };
    } catch (error) {
      logEvent({
        level: 'error',
        category: 'scan',
        action: 'scan.failed',
        message: `扫描失败：${error instanceof Error ? error.message : String(error)}`,
        detail: { targets },
        clientIp,
      });
      return reply.code(500).send({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      scanning = false;
    }
  });

  app.post<{ Body: { codes?: unknown; force?: unknown; rootPath?: unknown } }>(
    '/api/scrape',
    async (request, reply) => {
      if (activeScrapeJobId !== null) {
        return reply
          .code(409)
          .send({ error: '刮削任务进行中', jobId: activeScrapeJobId });
      }
      const body = request.body ?? {};
      if (body.rootPath !== undefined && typeof body.rootPath !== 'string') {
        return reply.code(400).send({ error: 'rootPath 必须是字符串' });
      }
      const rootPath = typeof body.rootPath === 'string' ? body.rootPath.trim() : '';
      const settings = getSettings();
      if (
        rootPath &&
        settings.libraryPaths.length > 0 &&
        !settings.libraryPaths.some((configured) => sameLibraryRoot(configured, rootPath))
      ) {
        return reply.code(400).send({ error: '库根不在设置中，请先在设置中添加' });
      }
      let codes: string[] | null = null;
      if (body.codes !== undefined) {
        if (!Array.isArray(body.codes)) {
          return reply.code(400).send({ error: 'codes 必须是数组' });
        }
        codes = body.codes
          .filter((value): value is string => typeof value === 'string')
          .map((value) => normalizeWorkno(value))
          .filter((value) => value.length > 0);
        if (codes.length === 0) {
          return reply.code(400).send({ error: '没有有效的RJ号' });
        }
      }
      const allWorks = listWorksForScrape(db, rootPath);
      const targets = codes
        ? allWorks.filter((work) => codes.includes(work.code))
        : allWorks;
      if (targets.length === 0) {
        return reply.code(400).send({ error: '没有可刮削的作品' });
      }

      const force = body.force === true;
      const clientIp = normalizeClientIp(request.ip);
      const scrapeStartedAt = Date.now();
      const jobId = createJob(db, 'scrape', {
        codes,
        total: targets.length,
        force,
      });
      activeScrapeJobId = jobId;
      updateJob(db, jobId, { status: 'running' });
      logEvent({
        category: 'scrape',
        action: 'scrape.start',
        message: `开始刮削 ${targets.length} 部作品${force ? '（强制忽略负缓存）' : ''}`,
        detail: { total: targets.length, force, codes: codes ?? targets.map((work) => work.code) },
        clientIp,
      });

      const provider = new DlsiteProvider({ proxyUrl: settings.proxyUrl });
      void (async () => {
        try {
          const results = await scrapeWorks(db, provider, targets, {
            assetsDir,
            ffmpegPath: settings.ffmpegPath,
            force,
            onProgress: (done, total, result) => {
              updateJob(db, jobId, {
                progress: total > 0 ? done / total : 0,
                payload: {
                  codes,
                  total,
                  force,
                  current: {
                    code: result.code,
                    title: result.title,
                    status: result.status,
                    cover: result.cover,
                    index: done,
                    total,
                  },
                },
              });
              const coverNote =
                result.cover === 'ok'
                  ? '，封面已缓存'
                  : result.cover === 'failed'
                    ? '，封面下载失败'
                    : '，无封面';
              if (result.status === 'cached') {
                logEvent({
                  category: 'scrape',
                  action: 'scrape.cached',
                  message: `跳过 ${result.code}：${result.message}`,
                  detail: {
                    code: result.code,
                    title: result.title,
                    status: result.status,
                    cover: result.cover,
                    message: result.message,
                    index: done,
                    total,
                  },
                  clientIp,
                });
                return;
              }
              const success = result.status === 'ok' && result.cover !== 'failed';
              logEvent({
                level: success ? 'success' : 'warn',
                category: 'scrape',
                action:
                  result.cover === 'failed'
                    ? 'scrape.cover.failed'
                    : success
                      ? 'scrape.work.done'
                      : 'scrape.work.failed',
                message: success
                  ? `刮削完成 ${result.code}《${result.title}》${coverNote}`
                  : `${result.cover === 'failed' ? '封面下载失败' : '刮削未完成'} ${result.code}：${result.message}`,
                detail: {
                  code: result.code,
                  title: result.title,
                  status: result.status,
                  cover: result.cover,
                  message: result.message,
                  index: done,
                  total,
                },
                clientIp,
              });
            },
          });
          const failed = results.filter(
            (result) => result.status !== 'ok' && result.status !== 'cached',
          ).length;
          const cached = results.filter((result) => result.status === 'cached').length;
          const coverFailed = results.filter((result) => result.cover === 'failed').length;
          const ok = results.filter(
            (result) => result.status === 'ok' || result.status === 'partial',
          ).length;
          logEvent({
            level: failed > 0 || coverFailed > 0 ? 'warn' : 'success',
            category: 'scrape',
            action: 'scrape.done',
            message: `刮削完成：成功 ${ok} 部${cached > 0 ? `，负缓存跳过 ${cached} 部` : ''}${
              failed > 0 ? `，失败 ${failed} 部` : ''
            }${coverFailed > 0 ? `，封面失败 ${coverFailed} 部` : ''}`,
            detail: {
              total: results.length,
              ok,
              failed,
              cached,
              coverFailed,
              force,
              durationMs: Date.now() - scrapeStartedAt,
            },
            clientIp,
          });
          updateJob(db, jobId, {
            status: 'done',
            progress: 1,
            result: { total: results.length, failed, cached, results },
          });
        } catch (error) {
          logEvent({
            level: 'error',
            category: 'scrape',
            action: 'scrape.failed',
            message: `刮削任务失败：${error instanceof Error ? error.message : String(error)}`,
            detail: { jobId, force },
            clientIp,
          });
          updateJob(db, jobId, {
            status: 'failed',
            lastError: error instanceof Error ? error.message : String(error),
          });
        } finally {
          activeScrapeJobId = null;
          await provider.close();
        }
      })();

      return reply.code(202).send({ jobId, total: targets.length });
    },
  );

  app.get<{ Querystring: { limit?: string; type?: string } }>('/api/jobs', async (request) => {
    const limit = clampInt(request.query.limit, 1, 50, 10);
    const type = request.query.type?.trim() || undefined;
    return { items: listJobs(db, limit, type).map(toJobResponse) };
  });

  app.get<{ Params: { jobId: string } }>('/api/jobs/:jobId', async (request, reply) => {
    const jobId = Number.parseInt(request.params.jobId, 10);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return reply.code(400).send({ error: 'jobId 不正确' });
    }
    const job = getJob(db, jobId);
    if (!job) {
      return reply.code(404).send({ error: '任务不存在' });
    }
    return toJobResponse(job);
  });

  const parseExportJobId = (raw: string): number => {
    const jobId = Number.parseInt(raw, 10);
    return Number.isInteger(jobId) && jobId > 0 ? jobId : 0;
  };

  app.get<{ Querystring: { limit?: string; status?: string } }>(
    '/api/export/jobs',
    async (request) => {
      const limit = clampInt(request.query.limit, 1, 100, 30);
      const statusParam = request.query.status?.trim() ?? '';
      const statuses: ExportJobStatus[] = [
        'queued',
        'running',
        'paused',
        'done',
        'failed',
        'cancelled',
      ];
      const status = statuses.find((item) => item === statusParam);
      return { items: listExportJobs(db, limit, status).map(toExportJobResponse) };
    },
  );

  app.get<{ Params: { jobId: string } }>('/api/export/jobs/:jobId', async (request, reply) => {
    const jobId = parseExportJobId(request.params.jobId);
    if (!jobId) {
      return reply.code(400).send({ error: 'jobId 不正确' });
    }
    const job = getExportJob(db, jobId);
    if (!job) {
      return reply.code(404).send({ error: '导出任务不存在' });
    }
    return toExportJobResponse(job);
  });

  app.post<{
    Body: { code?: unknown; hashes?: unknown; concurrency?: unknown; rootPath?: unknown };
  }>('/api/export/jobs', async (request, reply) => {
    const body = request.body ?? {};
    const code = normalizeWorkno(typeof body.code === 'string' ? body.code : '');
    if (!code) {
      return reply.code(400).send({ error: 'RJ号格式不正确' });
    }
    let hashes: string[] | null = null;
    if (body.hashes !== undefined) {
      if (
        !Array.isArray(body.hashes) ||
        body.hashes.length === 0 ||
        body.hashes.some((value) => typeof value !== 'string' || !value.trim())
      ) {
        return reply.code(400).send({ error: 'hashes 必须是非空字符串数组' });
      }
      hashes = [...new Set(body.hashes.map((value) => (value as string).trim()))];
    }
    let concurrency = getSettings().exportConcurrency;
    if (body.concurrency !== undefined) {
      if (typeof body.concurrency !== 'number' || !Number.isFinite(body.concurrency)) {
        return reply.code(400).send({ error: 'concurrency 必须是 1–3 的数字' });
      }
      concurrency = Math.min(3, Math.max(1, Math.round(body.concurrency)));
    }
    const settings = getSettings();
    if (body.rootPath !== undefined && typeof body.rootPath !== 'string') {
      return reply.code(400).send({ error: 'rootPath 必须是字符串' });
    }
    const requestedRoot = typeof body.rootPath === 'string' ? body.rootPath.trim() : '';
    let targetRootPath = settings.libraryPaths[0] ?? '';
    if (requestedRoot) {
      const configured = settings.libraryPaths.find((rootPath) =>
        sameLibraryRoot(rootPath, requestedRoot),
      );
      if (!configured) {
        return reply.code(400).send({ error: '导出目标库根不在设置中，请先在设置中添加' });
      }
      targetRootPath = configured;
    }
    if (!targetRootPath) {
      return reply.code(400).send({ error: '未配置库路径，请先在设置中选择库根' });
    }
    const existing = getWorkByCode(db, code);
    if (existing) {
      return reply.code(409).send({
        error: `本地库已存在 ${code}，已跳过导出`,
        localWork: {
          code: existing.code,
          title: existing.title,
          trackCount: existing.trackCount,
        },
      });
    }
    const active = findActiveExportJobForCode(db, code);
    if (active) {
      return reply.code(409).send({
        error: '该作品已有导出任务',
        jobId: active.id,
        status: active.status,
      });
    }
    let info: AsmrOneWork;
    try {
      info = await exportSource().fetchWorkInfo(code);
    } catch (error) {
      return sendOnlineError(reply, error);
    }
    if (!info.id) {
      return reply.code(502).send({ error: 'asmr.one 未返回作品 ID，无法导出' });
    }
    const jobId = createExportJob(db, {
      remoteWorkId: info.id,
      code,
      title: info.title || code,
      targetRootPath,
      concurrency,
      hashes,
      work: { ...info, code: info.code || code },
    });
    logEvent({
      category: 'export',
      action: 'export.create',
      message: `已创建导出任务 ${code}《${info.title || code}》`,
      detail: {
        jobId,
        code,
        remoteWorkId: info.id,
        targetRootPath,
        concurrency,
        hashes: hashes?.length ?? null,
      },
      clientIp: normalizeClientIp(request.ip),
    });
    exportQueue.pump();
    const job = getExportJob(db, jobId);
    return reply.code(202).send({ job: job ? toExportJobResponse(job) : null });
  });

  for (const action of ['pause', 'resume', 'retry'] as const) {
    app.post<{ Params: { jobId: string } }>(
      `/api/export/jobs/:jobId/${action}`,
      async (request, reply) => {
        const jobId = parseExportJobId(request.params.jobId);
        if (!jobId) {
          return reply.code(400).send({ error: 'jobId 不正确' });
        }
        const job = getExportJob(db, jobId);
        if (!job) {
          return reply.code(404).send({ error: '导出任务不存在' });
        }
        try {
          if (action === 'pause') {
            exportQueue.pause(jobId);
          } else if (action === 'resume') {
            exportQueue.resume(jobId);
          } else {
            exportQueue.retry(jobId);
          }
        } catch (error) {
          return reply
            .code(409)
            .send({ error: error instanceof Error ? error.message : String(error) });
        }
        const updated = getExportJob(db, jobId);
        return updated ? toExportJobResponse(updated) : null;
      },
    );
  }

  app.post<{ Params: { jobId: string } }>(
    '/api/export/jobs/:jobId/cancel',
    async (request, reply) => {
      const jobId = parseExportJobId(request.params.jobId);
      if (!jobId) {
        return reply.code(400).send({ error: 'jobId 不正确' });
      }
      const job = getExportJob(db, jobId);
      if (!job) {
        return reply.code(404).send({ error: '导出任务不存在' });
      }
      try {
        await exportQueue.cancel(jobId);
      } catch (error) {
        return reply
          .code(409)
          .send({ error: error instanceof Error ? error.message : String(error) });
      }
      const updated = getExportJob(db, jobId);
      return updated ? toExportJobResponse(updated) : null;
    },
  );

  app.delete<{ Params: { jobId: string } }>(
    '/api/export/jobs/:jobId',
    async (request, reply) => {
      const jobId = parseExportJobId(request.params.jobId);
      if (!jobId) {
        return reply.code(400).send({ error: 'jobId 不正确' });
      }
      const job = getExportJob(db, jobId);
      if (!job) {
        return reply.code(404).send({ error: '导出任务不存在' });
      }
      if (job.status === 'queued' || job.status === 'running' || job.status === 'paused') {
        return reply.code(409).send({ error: '任务尚未结束，请先取消再删除' });
      }
      deleteExportJob(db, jobId);
      logEvent({
        category: 'export',
        action: 'export.deleted',
        message: `已删除导出任务 ${job.code}`,
        detail: { jobId, code: job.code, status: job.status },
        clientIp: normalizeClientIp(request.ip),
      });
      return { deleted: true };
    },
  );

  app.get<{ Params: { assetId: string }; Querystring: { size?: string } }>(
    '/api/assets/:assetId',
    async (request, reply) => {
      const assetId = Number.parseInt(request.params.assetId, 10);
      if (!Number.isInteger(assetId) || assetId <= 0) {
        return reply.code(400).send({ error: 'assetId 不正确' });
      }
      const asset = getAssetById(db, assetId);
      if (!asset) {
        return reply.code(404).send({ error: '资产不存在' });
      }
      const sizeParam = request.query.size;
      const size = sizeParam === '240' || sizeParam === '600' ? sizeParam : 'original';
      const resolved = await resolveAssetFile(assetsDir, asset, size);
      if (!resolved) {
        return reply.code(404).send({ error: '资产文件缺失' });
      }
      reply.header('cache-control', 'public, max-age=31536000, immutable');
      reply.type(resolved.mime);
      return reply.send(createReadStream(resolved.absolutePath));
    },
  );

  app.get<{ Querystring: { limit?: string } }>('/api/playback/recent', async (request) => {
    const limit = clampInt(request.query.limit, 1, 50, 12);
    return { items: listRecentPlayback(db, limit) };
  });

  app.get<{ Params: { workId: string } }>('/api/playback/:workId', async (request, reply) => {
    const workId = Number.parseInt(request.params.workId, 10);
    if (!Number.isInteger(workId) || workId <= 0) {
      return reply.code(400).send({ error: 'workId 不正确' });
    }
    return (
      getPlayback(db, workId) ?? { workId, trackId: null, positionMs: 0, updatedAt: '' }
    );
  });

  app.put<{ Body: { workId?: number; trackId?: number | null; positionMs?: number } }>(
    '/api/playback',
    async (request, reply) => {
      const body = request.body ?? {};
      const workId = Number(body.workId);
      const positionMs = Number(body.positionMs);
      if (!Number.isInteger(workId) || workId <= 0) {
        return reply.code(400).send({ error: 'workId 不正确' });
      }
      if (!Number.isFinite(positionMs) || positionMs < 0) {
        return reply.code(400).send({ error: 'positionMs 不正确' });
      }
      const trackId =
        body.trackId === null || body.trackId === undefined ? null : Number(body.trackId);
      if (trackId !== null && (!Number.isInteger(trackId) || trackId <= 0)) {
        return reply.code(400).send({ error: 'trackId 不正确' });
      }
      savePlayback(db, { workId, trackId, positionMs });
      return { ok: true };
    },
  );

  app.get<{ Params: { trackId: string } }>(
    '/api/tracks/:trackId/stream',
    async (request, reply) => {
      const trackId = Number.parseInt(request.params.trackId, 10);
      if (!Number.isInteger(trackId) || trackId <= 0) {
        return reply.code(400).send({ error: 'trackId 不正确' });
      }
      const record = getTrackFile(db, trackId);
      if (!record) {
        return reply.code(404).send({ error: '音轨不存在' });
      }
      const resolved = await resolveLibraryFile(record.rootPath, record.relativePath);
      if (!resolved) {
        return reply.code(403).send({ error: '文件不可访问' });
      }
      return sendFileStream(reply, {
        filePath: resolved.absolutePath,
        size: resolved.size,
        mimeType: mimeTypeForFileName(record.relativePath),
        rangeHeader: request.headers.range,
        headOnly: request.method === 'HEAD',
      });
    },
  );

  app.get('/api/online/account', async () => {
    const account = getOnlineAccount(db, 'asmrone');
    return account?.tokenEnc
      ? { connected: true, username: account.username, updatedAt: account.updatedAt }
      : { connected: false, username: '', updatedAt: '' };
  });

  app.post<{ Body: { username?: unknown; password?: unknown } }>(
    '/api/online/login',
    async (request, reply) => {
      const body = request.body ?? {};
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (!username || !password) {
        return reply.code(400).send({ error: '用户名和密码都不能为空' });
      }
      try {
        const provider = getOnlineProvider();
        const result = await provider.login(username, password);
        saveOnlineAccount(db, {
          provider: 'asmrone',
          username: result.name,
          tokenEnc: encryptSecret(secretKey, result.token),
        });
        provider.setToken(result.token);
        logEvent({
          level: 'success',
          category: 'online',
          action: 'online.login',
          message: `已连接 asmr.one：${result.name}`,
          detail: { username: result.name },
          clientIp: normalizeClientIp(request.ip),
        });
        return { connected: true, username: result.name };
      } catch (error) {
        logEvent({
          level: 'warn',
          category: 'online',
          action: 'online.login.failed',
          message: `asmr.one 登录失败：${error instanceof Error ? error.message : String(error)}`,
          detail: { username },
          clientIp: normalizeClientIp(request.ip),
        });
        return sendOnlineError(reply, error);
      }
    },
  );

  app.post('/api/online/logout', async (request) => {
    deleteOnlineAccount(db, 'asmrone');
    if (onlineProvider) {
      onlineProvider.setToken(null);
    }
    logEvent({
      category: 'online',
      action: 'online.logout',
      message: '已退出 asmr.one',
      clientIp: normalizeClientIp(request.ip),
    });
    return { connected: false };
  });

  app.get<{ Querystring: { q?: string; page?: string; pageSize?: string } }>(
    '/api/online/search',
    async (request, reply) => {
      const keyword = request.query.q?.trim() ?? '';
      const page = clampInt(request.query.page, 1, 500, 1);
      const pageSize = clampInt(request.query.pageSize, 1, 50, 24);
      if (!keyword) {
        return { items: [], total: 0, page, pageSize };
      }
      try {
        const result = await getOnlineProvider().search(keyword, page, pageSize);
        const states = localStateMap(result.items.map((item) => item.code));
        return {
          ...result,
          items: result.items.map((item) => decorateOnlineWork(item, states)),
        };
      } catch (error) {
        return sendOnlineError(reply, error);
      }
    },
  );

  app.get<{
    Querystring: { order?: string; page?: string; pageSize?: string };
  }>('/api/online/works', async (request, reply) => {
    const order = normalizeOnlineOrder(request.query.order);
    const page = clampInt(request.query.page, 1, 5000, 1);
    const pageSize = clampInt(request.query.pageSize, 1, 50, 20);
    try {
      const result = await getOnlineProvider().listWorks(order, page, pageSize);
      const states = localStateMap(result.items.map((item) => item.code));
      return {
        ...result,
        order,
        items: result.items.map((item) => decorateOnlineWork(item, states)),
      };
    } catch (error) {
      return sendOnlineError(reply, error);
    }
  });

  app.get('/api/online/random', async (_request, reply) => {
    try {
      const provider = getOnlineProvider();
      const head = await provider.listWorks('dl_count', 1, 1);
      const total = Math.max(1, head.total);
      const pages = Math.max(1, Math.ceil(total / 20));
      const page = Math.floor(Math.random() * pages) + 1;
      const result = await provider.listWorks('dl_count', page, 20);
      const candidates = result.items.filter((item) => item.id > 0 && item.code);
      const audioCandidates = candidates.filter((item) => (item.durationMs ?? 0) > 0);
      const pool = audioCandidates.length > 0 ? audioCandidates : candidates;
      const work = pool[Math.floor(Math.random() * pool.length)];
      if (!work) {
        return reply.code(404).send({ error: '在线曲库暂时没有可用作品' });
      }
      const states = localStateMap([work.code]);
      return { work: decorateOnlineWork(work, states) };
    } catch (error) {
      return sendOnlineError(reply, error);
    }
  });

  app.get<{
    Querystring: {
      tab?: string;
      progress?: string;
      page?: string;
      pageSize?: string;
      order?: string;
      sort?: string;
    };
  }>('/api/online/favorites', async (request, reply) => {
    const tab = request.query.tab === 'progress' ? 'progress' : 'review';
    const progress =
      tab === 'progress' ? (normalizeReviewProgress(request.query.progress) ?? 'marked') : null;
    const page = clampInt(request.query.page, 1, 5000, 1);
    const pageSize = clampInt(request.query.pageSize, 1, 50, 20);
    const order = normalizeReviewOrder(request.query.order);
    const sort = request.query.sort === 'asc' ? 'asc' : 'desc';
    try {
      const result = await getOnlineProvider().listReviews({ page, pageSize, progress, order, sort });
      const states = localStateMap(result.items.map((item) => item.code));
      return {
        ...result,
        tab,
        progress: progress ?? '',
        order,
        sort,
        items: result.items.map((item) => ({
          ...decorateOnlineWork(item, states),
          userRating: item.userRating,
          reviewText: item.reviewText,
          progress: item.progress,
          updatedAt: item.updatedAt,
          userName: item.userName,
        })),
      };
    } catch (error) {
      return sendOnlineError(reply, error);
    }
  });

  app.get<{
    Querystring: { filterBy?: string; page?: string; pageSize?: string };
  }>('/api/online/playlists', async (request, reply) => {
    const filterBy = normalizePlaylistFilter(request.query.filterBy);
    const page = clampInt(request.query.page, 1, 5000, 1);
    const pageSize = clampInt(request.query.pageSize, 1, 50, 20);
    try {
      const result = await getOnlineProvider().listPlaylists({ page, pageSize, filterBy });
      return {
        ...result,
        filterBy,
        items: result.items.map(decoratePlaylist),
      };
    } catch (error) {
      return sendOnlineError(reply, error);
    }
  });

  app.get<{
    Params: { id: string };
    Querystring: { page?: string; pageSize?: string };
  }>('/api/online/playlists/:id', async (request, reply) => {
    const id = normalizePlaylistId(request.params.id);
    if (!id) {
      return reply.code(400).send({ error: '播放列表 ID 不正确' });
    }
    const page = clampInt(request.query.page, 1, 5000, 1);
    const pageSize = clampInt(request.query.pageSize, 1, 50, 20);
    const provider = getOnlineProvider();
    try {
      const playlist = await provider.fetchPlaylistMetadata(id);
      const works = await provider.fetchPlaylistWorks(id, page, pageSize);
      const states = localStateMap(works.items.map((item) => item.code));
      const coverWorkId =
        playlist.latestWorkId > 0 ? playlist.latestWorkId : (works.items[0]?.id ?? 0);
      return {
        playlist: decoratePlaylist({ ...playlist, latestWorkId: coverWorkId }),
        works: works.items.map((item) => decorateOnlineWork(item, states)),
        total: works.total,
        page: works.page,
        pageSize: works.pageSize,
      };
    } catch (error) {
      return sendOnlineError(reply, error);
    }
  });

  app.get<{ Params: { code: string } }>('/api/online/works/:code', async (request, reply) => {
    const code = normalizeWorkno(request.params.code);
    if (!code) {
      return reply.code(400).send({ error: 'RJ号格式不正确' });
    }
    const provider = getOnlineProvider();
    try {
      const info = await provider.fetchWorkInfo(code);
      const work: AsmrOneWork = { ...info, code: info.code || code };
      const localWork = getWorkByCode(db, work.code);
      const tracks: Array<{
        index: number;
        hash: string;
        title: string;
        disc: number;
        groupTitle: string;
        durationMs: number | null;
        size: number;
        streamUrl: string;
      }> = [];
      let trackTree: AsmrOneTrackNode[] = [];
      let tracksError = '';
      if (work.id > 0) {
        try {
          const result = await provider.fetchTracks(work.id);
          trackTree = result.tree;
          result.items.forEach((track, index) => {
            tracks.push({
              index: index + 1,
              hash: track.hash,
              title: track.title,
              disc: track.disc,
              groupTitle: track.groupTitle,
              durationMs: track.durationMs,
              size: track.size,
              streamUrl: `/api/online/works/${work.id}/tracks/${encodeURIComponent(
                track.hash,
              )}/stream`,
            });
          });
        } catch (error) {
          tracksError = error instanceof Error ? error.message : String(error);
        }
      }
      return {
        work: {
          ...work,
          coverUrl: `/api/online/works/${work.id}/cover?type=main`,
          thumbUrl: `/api/online/works/${work.id}/cover?type=sam`,
          local: Boolean(localWork),
          favoriteAt: localWork?.favoriteAt ?? '',
        },
        tracks,
        trackTree,
        tracksError,
        playback:
          work.id > 0 ? getOnlinePlayback(db, 'asmrone', work.id) : null,
        localWork: localWork
          ? {
              id: localWork.id,
              code: localWork.code,
              trackCount: localWork.trackCount,
              favoriteAt: localWork.favoriteAt,
              coverAssetId: localWork.coverAssetId,
            }
          : null,
      };
    } catch (error) {
      return sendOnlineError(reply, error);
    }
  });

  app.put<{
    Body: {
      remoteWorkId?: unknown;
      code?: unknown;
      trackHash?: unknown;
      trackIndex?: unknown;
      positionMs?: unknown;
    };
  }>('/api/online/playback', async (request, reply) => {
    const body = request.body ?? {};
    const remoteWorkId = Number(body.remoteWorkId);
    if (!Number.isInteger(remoteWorkId) || remoteWorkId <= 0) {
      return reply.code(400).send({ error: 'remoteWorkId 不正确' });
    }
    const code = normalizeWorkno(typeof body.code === 'string' ? body.code : '');
    if (!code) {
      return reply.code(400).send({ error: 'RJ号格式不正确' });
    }
    const trackHash = typeof body.trackHash === 'string' ? body.trackHash.trim() : '';
    if (!trackHash) {
      return reply.code(400).send({ error: 'trackHash 不能为空' });
    }
    const trackIndex = body.trackIndex === undefined ? 0 : Number(body.trackIndex);
    if (!Number.isInteger(trackIndex) || trackIndex < 0) {
      return reply.code(400).send({ error: 'trackIndex 不正确' });
    }
    const positionMs = Number(body.positionMs);
    if (!Number.isFinite(positionMs) || positionMs < 0) {
      return reply.code(400).send({ error: 'positionMs 不正确' });
    }
    return saveOnlinePlayback(db, {
      provider: 'asmrone',
      remoteWorkId,
      code,
      trackHash,
      trackIndex,
      positionMs,
    });
  });

  app.get<{ Params: { workId: string }; Querystring: { type?: string } }>(
    '/api/online/works/:workId/cover',
    async (request, reply) => {
      const workId = Number.parseInt(request.params.workId, 10);
      if (!Number.isInteger(workId) || workId <= 0) {
        return reply.code(400).send({ error: 'workId 不正确' });
      }
      const type = request.query.type === 'sam' ? 'sam' : 'main';
      try {
        const cover = await getOnlineProvider().fetchCover(workId, type);
        reply.header('cache-control', 'public, max-age=86400');
        reply.type(cover.contentType);
        return reply.send(cover.buffer);
      } catch (error) {
        return sendOnlineError(reply, error);
      }
    },
  );

  app.get<{ Params: { workId: string; hash: string } }>(
    '/api/online/works/:workId/tracks/:hash/stream',
    async (request, reply) => {
      const workId = Number.parseInt(request.params.workId, 10);
      if (!Number.isInteger(workId) || workId <= 0) {
        return reply.code(400).send({ error: 'workId 不正确' });
      }
      const provider = getOnlineProvider();
      try {
        const tracks = await provider.fetchTracks(workId);
        const track =
          tracks.items.find((item) => item.hash === request.params.hash) ??
          tracks.files?.find((item) => item.hash === request.params.hash);
        if (!track) {
          return reply.code(404).send({ error: '在线文件不存在' });
        }
        const controller = new AbortController();
        reply.raw.once('close', () => controller.abort());
        const upstream = await provider.openTrackStream(
          track.streamUrl,
          request.headers.range,
          controller.signal,
        );
        for (const name of [
          'content-type',
          'content-length',
          'content-range',
          'accept-ranges',
          'etag',
          'last-modified',
        ]) {
          const value = upstream.headers[name];
          if (value) {
            reply.header(name, value);
          }
        }
        reply.header('cache-control', 'no-store');
        return reply.code(upstream.status).send(upstream.body);
      } catch (error) {
        return sendOnlineError(reply, error);
      }
    },
  );

  app.setNotFoundHandler((request, reply) => {
    if (request.url === '/api' || request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: '接口不存在' });
    }
    if (servesWeb && request.method === 'GET') {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: '未找到资源' });
  });

  return app;
}
