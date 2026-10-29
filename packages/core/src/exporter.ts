import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { storeWorkCover } from './assets.js';
import {
  findNextQueuedExportJob,
  getExportJob,
  parseExportPayload,
  pauseInterruptedExports,
  updateExportJob,
  type ExportJobRecord,
  type ExportJobResult,
  type ExportJobState,
  type ExportJobStatus,
  type ExportTrackState,
  type UpdateExportJobPatch,
} from './export-jobs.js';
import {
  EXPORT_COMPLETE_MARKER,
  EXPORT_INCOMPLETE_MARKER,
  EXPORT_TMP_DIR,
  isPathInside,
} from './paths.js';
import { getWorkByCode } from './repository.js';
import { scanWorkDir, type ScanResult } from './scanner.js';
import type { AsmrOneWork } from './providers/asmrone.js';
import {
  SIDECAR_FILE,
  applySidecarToWork,
  readExportSidecar,
  type ExportSidecar,
} from './sidecar.js';

export interface ExportTrackInfo {
  hash: string;
  title: string;
  disc: number;
  groupTitle: string;
  durationMs: number | null;
  size: number;
  streamUrl: string;
}

export interface ExportCoverData {
  buffer: Buffer;
  contentType: string;
}

export interface ExportStreamResult {
  status: number;
  headers: Record<string, string>;
  body: Readable;
}

export interface ExportSource {
  fetchWorkInfo(code: string): Promise<AsmrOneWork>;
  fetchTracks(
    workId: number,
    options?: { force?: boolean },
  ): Promise<{ items: ExportTrackInfo[] }>;
  fetchCover(workId: number, type: 'main' | 'sam'): Promise<ExportCoverData>;
  openTrackStream(
    url: string,
    range: string | undefined,
    signal?: AbortSignal,
  ): Promise<ExportStreamResult>;
}

const MAX_TRACK_ATTEMPTS = 3;
const MAX_RATE_LIMIT_ATTEMPTS = 5;
const MAX_DIR_TITLE_CHARS = 80;
const MAX_TRACK_TITLE_CHARS = 60;
const PERSIST_INTERVAL_MS = 400;

const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;
const RESERVED_NAMES = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i;

export function sanitizeExportName(value: string, fallback: string, maxChars: number): string {
  let name = value
    .replace(ILLEGAL_NAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  const chars = [...name];
  if (chars.length > maxChars) {
    name = chars.slice(0, maxChars).join('').trim().replace(/[.\s]+$/g, '');
  }
  if (!name) {
    name = fallback;
  }
  if (RESERVED_NAMES.test(name)) {
    name = `_${name}`;
  }
  return name;
}

const AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus']);

function extensionFromHeaders(contentType: string, url: string): string {
  const type = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  const byType: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'application/ogg': 'ogg',
    'audio/opus': 'opus',
  };
  const mapped = byType[type];
  if (mapped) {
    return mapped;
  }
  try {
    const fromUrl = path.extname(new URL(url).pathname).slice(1).toLowerCase();
    if (AUDIO_EXTENSIONS.has(fromUrl)) {
      return fromUrl;
    }
  } catch {
    // URL 解析失败时回退 mp3
  }
  return 'mp3';
}

function coverExtension(contentType: string): string {
  const type = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  if (type === 'image/png') {
    return 'png';
  }
  if (type === 'image/webp') {
    return 'webp';
  }
  return 'jpg';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('导出已中止');
  }
}

function retryAfterMs(headers: Record<string, string>): number {
  const raw = headers['retry-after'];
  if (!raw) {
    return 5_000;
  }
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(30_000, seconds * 1000);
  }
  const date = Date.parse(raw);
  if (Number.isFinite(date)) {
    return Math.min(30_000, Math.max(1_000, date - Date.now()));
  }
  return 5_000;
}

async function fileSize(target: string): Promise<number> {
  try {
    const stat = await fs.stat(target);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function uniqueDirectory(root: string, baseName: string): Promise<string> {
  for (let index = 1; index <= 50; index += 1) {
    const name = index === 1 ? baseName : `${baseName} (${index})`;
    const candidate = path.join(root, name);
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
  throw new Error(`目标目录重名过多：${baseName}`);
}

async function findCompletedExportDir(rootPath: string, code: string): Promise<string> {
  let entries;
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return '';
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${code} `)) {
      continue;
    }
    if (await exists(path.join(rootPath, entry.name, EXPORT_COMPLETE_MARKER))) {
      return entry.name;
    }
  }
  return '';
}

async function cleanupTmpRoot(rootPath: string, jobId: number): Promise<void> {
  await fs
    .rm(path.join(rootPath, EXPORT_TMP_DIR, `export-${jobId}`), { recursive: true, force: true })
    .catch(() => undefined);
}

async function moveIntoPlace(tmpDir: string, finalDir: string): Promise<void> {
  try {
    await fs.rename(tmpDir, finalDir);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (!['EXDEV', 'EPERM', 'EACCES', 'EIO', 'EINVAL', 'ENOTEMPTY', 'EEXIST'].includes(code)) {
      throw error;
    }
  }
  // 挂载盘不支持 rename 时回退复制；复制期间写标记，扫描器不会读取半成品。
  await fs.mkdir(finalDir, { recursive: true });
  await fs.writeFile(
    path.join(finalDir, EXPORT_INCOMPLETE_MARKER),
    JSON.stringify({ copiedAt: new Date().toISOString() }),
  );
  try {
    await fs.cp(tmpDir, finalDir, { recursive: true, force: true });
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(path.join(finalDir, EXPORT_INCOMPLETE_MARKER), { force: true });
  } catch (error) {
    throw new Error(`复制到目标目录失败（半成品已标记，不会入库）：${describeError(error)}`);
  }
}

async function appendStream(
  body: Readable,
  target: string,
  append: boolean,
  onBytes: (bytes: number) => void,
): Promise<void> {
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      onBytes(chunk.length);
      callback(null, chunk);
    },
  });
  await pipeline(body, meter, createWriteStream(target, { flags: append ? 'a' : 'w' }));
}

interface DownloadTrackOptions {
  source: ExportSource;
  workId: number;
  track: ExportTrackInfo;
  state: ExportTrackState;
  tracksDir: string;
  signal: AbortSignal;
  onBytes: (delta: number) => void;
}

async function refreshTrackUrl(
  source: ExportSource,
  workId: number,
  hash: string,
  fallback: ExportTrackInfo,
): Promise<ExportTrackInfo> {
  const fresh = await source.fetchTracks(workId, { force: true });
  return fresh.items.find((item) => item.hash === hash) ?? fallback;
}

async function downloadTrack(options: DownloadTrackOptions): Promise<void> {
  const { source, workId, state, tracksDir, signal, onBytes } = options;
  let track = options.track;
  const partPath = path.join(tracksDir, state.partFile);
  const expected = track.size > 0 ? track.size : 0;
  let attempts = 0;
  let authRefreshed = false;
  let restartedForSize = false;

  for (;;) {
    throwIfAborted(signal);
    try {
      let partSize = await fileSize(partPath);
      if (expected > 0 && partSize === expected) {
        state.bytes = partSize;
        state.status = 'done';
        state.error = '';
        return;
      }
      if (expected > 0 && partSize > expected) {
        await fs.rm(partPath, { force: true });
        partSize = 0;
      }

      const response = await source.openTrackStream(
        track.streamUrl,
        partSize > 0 ? `bytes=${partSize}-` : undefined,
        signal,
      );

      if (response.status === 401 || response.status === 403) {
        await response.body.destroy();
        if (authRefreshed) {
          throw new Error('asmr.one 拒绝下载该音轨，请重新登录后再试');
        }
        authRefreshed = true;
        track = await refreshTrackUrl(source, workId, track.hash, track);
        continue;
      }
      if (response.status === 429) {
        await response.body.destroy();
        attempts += 1;
        if (attempts >= MAX_RATE_LIMIT_ATTEMPTS) {
          throw new Error('asmr.one 下载限速，请稍后重试');
        }
        await sleep(retryAfterMs(response.headers));
        continue;
      }
      if (response.status === 416) {
        await response.body.destroy();
        if (expected > 0 && partSize >= expected) {
          state.bytes = partSize;
          state.status = 'done';
          state.error = '';
          return;
        }
        await fs.rm(partPath, { force: true });
        attempts += 1;
        if (attempts >= MAX_TRACK_ATTEMPTS) {
          throw new Error('断点位置无效，无法继续下载');
        }
        continue;
      }
      if (response.status >= 500) {
        await response.body.destroy();
        attempts += 1;
        if (attempts >= MAX_TRACK_ATTEMPTS) {
          throw new Error(`asmr.one 返回 HTTP ${response.status}`);
        }
        await sleep(Math.min(8_000, 500 * 2 ** attempts));
        continue;
      }
      if (response.status !== 200 && response.status !== 206) {
        await response.body.destroy();
        throw new Error(`音轨下载失败：HTTP ${response.status}`);
      }

      const append = response.status === 206 && partSize > 0;
      if (!append && partSize > 0) {
        await fs.rm(partPath, { force: true });
      }
      // 以磁盘上的 .part 大小为准，避免暂停时内存计数领先于已落盘字节。
      state.bytes = append ? partSize : 0;
      await appendStream(response.body, partPath, append, (bytes) => {
        state.bytes += bytes;
        onBytes(bytes);
      });

      const finalSize = await fileSize(partPath);
      if (expected > 0 && finalSize !== expected) {
        await fs.rm(partPath, { force: true });
        state.bytes = 0;
        if (restartedForSize) {
          throw new Error(`文件大小不符（期望 ${expected}，实际 ${finalSize}）`);
        }
        restartedForSize = true;
        continue;
      }

      state.bytes = finalSize;
      state.ext = extensionFromHeaders(
        response.headers['content-type'] ?? '',
        track.streamUrl,
      );
      state.status = 'done';
      state.error = '';
      return;
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      attempts += 1;
      if (attempts >= MAX_TRACK_ATTEMPTS) {
        state.status = 'failed';
        state.error = describeError(error);
        throw error;
      }
      await sleep(Math.min(8_000, 400 * 2 ** attempts));
    }
  }
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  parentSignal: AbortSignal,
): Promise<void> {
  const local = new AbortController();
  const signal = AbortSignal.any([parentSignal, local.signal]);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      if (signal.aborted) {
        return;
      }
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) {
        return;
      }
      await worker(item);
    }
  });
  const results = await Promise.allSettled(runners);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure && failure.status === 'rejected') {
    local.abort();
    throw failure.reason;
  }
}

export interface ExportJobUpdate {
  state?: ExportJobState;
  progress?: number;
  trackTotal?: number;
  trackCompleted?: number;
  targetRelativePath?: string;
}

export interface RunExportJobOptions {
  db: DatabaseSync;
  job: ExportJobRecord;
  source: ExportSource;
  assetsDir: string;
  ffmpegPath: string;
  signal: AbortSignal;
  onUpdate: (patch: ExportJobUpdate) => void;
}

function countDone(state: ExportJobState, hashes: string[]): number {
  return hashes.filter((hash) => state.tracks[hash]?.status === 'done').length;
}

function computeProgress(state: ExportJobState, hashes: string[]): number {
  let totalBytes = 0;
  let doneBytes = 0;
  for (const hash of hashes) {
    const track = state.tracks[hash];
    if (!track) {
      continue;
    }
    if (track.size > 0) {
      totalBytes += track.size;
      doneBytes += Math.min(track.size, track.bytes);
    }
  }
  if (totalBytes > 0) {
    return Math.min(0.95, doneBytes / totalBytes);
  }
  if (hashes.length === 0) {
    return 0;
  }
  return Math.min(0.95, countDone(state, hashes) / hashes.length);
}

function buildResult(
  relativePath: string,
  rootPath: string,
  state: ExportJobState,
  hashes: string[],
  cover: 'ok' | 'failed' | 'none',
  scan: ScanResult | null,
  scanError: string,
): ExportJobResult {
  let bytes = 0;
  for (const hash of hashes) {
    bytes += state.tracks[hash]?.bytes ?? 0;
  }
  return {
    relativePath,
    absolutePath: path.join(rootPath, ...relativePath.split('/')),
    trackCount: hashes.length,
    bytes,
    cover,
    scan: scan ? { ...scan, scanError } : { scanError },
  };
}

export async function runExportJob(options: RunExportJobOptions): Promise<ExportJobResult> {
  const { db, job, source, assetsDir, ffmpegPath, signal, onUpdate } = options;
  const payload = parseExportPayload(job);
  if (!payload) {
    throw new Error('导出任务参数损坏，请重新创建任务');
  }
  const work = payload.work;
  const rootPath = path.resolve(job.targetRootPath);
  const rootStat = await fs.stat(rootPath);
  if (!rootStat.isDirectory()) {
    throw new Error(`库根不是目录：${rootPath}`);
  }

  const state: ExportJobState = (() => {
    try {
      const parsed: unknown = JSON.parse(job.stateJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const value = parsed as Partial<ExportJobState>;
        const phase =
          value.phase === 'finalize' || value.phase === 'scan' || value.phase === 'done'
            ? value.phase
            : 'download';
        const tracks =
          value.tracks && typeof value.tracks === 'object' ? value.tracks : {};
        return { phase, tracks };
      }
    } catch {
      // 状态损坏时按全新任务继续
    }
    return { phase: 'download', tracks: {} };
  })();

  const finishExisting = async (relativePath: string): Promise<ExportJobResult> => {
    const finalDir = path.resolve(rootPath, ...relativePath.split('/'));
    if (!isPathInside(rootPath, finalDir)) {
      throw new Error('导出目录不在库根内');
    }
    await cleanupTmpRoot(rootPath, job.id);
    const hashes = Object.keys(state.tracks).sort(
      (a, b) => (state.tracks[a]?.order ?? 0) - (state.tracks[b]?.order ?? 0),
    );
    let scan: ScanResult | null = null;
    let scanError = '';
    try {
      scan = await scanWorkDir({ db, rootPath, relativePath });
    } catch (error) {
      scanError = describeError(error);
    }
    if (!scan) {
      return buildResult(relativePath, rootPath, state, hashes, 'none', null, scanError);
    }
    const sidecar = await readExportSidecar(finalDir);
    const workRow = getWorkByCode(db, work.code);
    if (sidecar && workRow) {
      applySidecarToWork(db, workRow.id, sidecar);
    }
    const cover = await applyCoverAsset({
      db,
      assetsDir,
      ffmpegPath,
      finalDir,
      workId: workRow?.id ?? 0,
      coverFile: sidecar?.work.cover ?? '',
      workIdOnline: work.id,
    });
    onUpdate({
      progress: 1,
      trackTotal: hashes.length,
      trackCompleted: hashes.length,
      state: { ...state, phase: 'done' },
    });
    return buildResult(relativePath, rootPath, state, hashes, cover, scan, scanError);
  };

  // 已经 rename 完成但后续步骤失败的任务：只补扫描与入库。
  if (job.targetRelativePath) {
    return finishExisting(job.targetRelativePath);
  }

  // 上次 rename 成功后未写回 target_path 的极端情况：按目录名找完整导出目录。
  const recoveredDir = await findCompletedExportDir(rootPath, work.code);
  if (recoveredDir) {
    onUpdate({ targetRelativePath: recoveredDir });
    return finishExisting(recoveredDir);
  }

  const existing = getWorkByCode(db, work.code);
  if (existing) {
    throw new Error(`本地库已存在 ${work.code}，已跳过导出`);
  }

  const tracksResult = await source.fetchTracks(work.id, { force: true });
  const allTracks = tracksResult.items.filter((track) => track.hash && track.streamUrl);
  const selectedHashes = payload.hashes === null ? null : new Set(payload.hashes);
  const selected = selectedHashes
    ? allTracks.filter((track) => selectedHashes.has(track.hash))
    : allTracks;
  if (selected.length === 0) {
    throw new Error('没有可导出的音轨（可能未登录或作品没有音频）');
  }
  const missing = selectedHashes
    ? [...selectedHashes].filter((hash) => !allTracks.some((track) => track.hash === hash))
    : [];
  if (missing.length > 0) {
    throw new Error(`有 ${missing.length} 条音轨已不存在，请刷新后重试`);
  }

  const tmpRoot = path.join(rootPath, EXPORT_TMP_DIR, `export-${job.id}`);
  const workTmpDir = path.join(tmpRoot, 'work');
  const tracksDir = path.join(workTmpDir, 'tracks');
  await fs.mkdir(tracksDir, { recursive: true });

  // 建立/恢复每轨状态；文件名基于本次选中的顺序，保持稳定。
  const orderedHashes: string[] = [];
  selected.forEach((track, position) => {
    const order = position + 1;
    const prefix = String(order).padStart(2, '0');
    const baseName = sanitizeExportName(track.title, `音轨 ${order}`, MAX_TRACK_TITLE_CHARS);
    const existingState = state.tracks[track.hash];
    const partFile = existingState?.partFile || `${prefix} - ${baseName}.part`;
    const trackState: ExportTrackState = {
      hash: track.hash,
      order,
      index: allTracks.findIndex((item) => item.hash === track.hash) + 1,
      title: track.title,
      groupTitle: track.groupTitle,
      disc: track.disc,
      size: track.size,
      durationMs: track.durationMs,
      bytes: existingState?.bytes ?? 0,
      ext: existingState?.ext ?? '',
      partFile,
      file: existingState?.file ?? '',
      status: existingState?.status === 'done' ? 'done' : 'pending',
      error: '',
    };
    orderedHashes.push(track.hash);
    state.tracks[track.hash] = trackState;
  });

  // 上次完成但临时文件已不存在的轨道需要重新下载。
  for (const hash of orderedHashes) {
    const trackState = state.tracks[hash];
    if (!trackState || trackState.status !== 'done' || !trackState.file) {
      continue;
    }
    if (!(await exists(path.join(tracksDir, trackState.file)))) {
      trackState.status = 'pending';
      trackState.bytes = 0;
      trackState.file = '';
    }
  }

  state.phase = 'download';
  let lastPersist = 0;
  const persist = (force: boolean): void => {
    const now = Date.now();
    if (!force && now - lastPersist < PERSIST_INTERVAL_MS) {
      return;
    }
    lastPersist = now;
    onUpdate({
      state,
      progress: computeProgress(state, orderedHashes),
      trackTotal: orderedHashes.length,
      trackCompleted: countDone(state, orderedHashes),
    });
  };
  persist(true);

  let cover: 'ok' | 'failed' | 'none' = 'none';
  let coverFile = '';
  try {
    const image = await source.fetchCover(work.id, 'main');
    const ext = coverExtension(image.contentType);
    coverFile = `cover.${ext}`;
    await fs.writeFile(path.join(workTmpDir, coverFile), image.buffer);
    cover = 'ok';
  } catch {
    cover = 'failed';
  }

  const pending = selected.filter((track) => state.tracks[track.hash]?.status !== 'done');
  try {
    await runWithConcurrency(
      pending,
      Math.max(1, Math.min(3, payload.concurrency || 2)),
      async (track) => {
        const trackState = state.tracks[track.hash];
        if (!trackState) {
          return;
        }
        throwIfAborted(signal);
        trackState.status = 'downloading';
        persist(true);
        await downloadTrack({
          source,
          workId: work.id,
          track,
          state: trackState,
          tracksDir,
          signal,
          onBytes: () => persist(false),
        });
        const ext = trackState.ext || 'mp3';
        const prefix = String(trackState.order).padStart(2, '0');
        const baseName = sanitizeExportName(
          trackState.title,
          `音轨 ${trackState.order}`,
          MAX_TRACK_TITLE_CHARS,
        );
        const finalName = `${prefix} - ${baseName}.${ext}`;
        const finalPath = path.join(tracksDir, finalName);
        await fs.rm(finalPath, { force: true });
        await fs.rename(path.join(tracksDir, trackState.partFile), finalPath);
        trackState.file = finalName;
        persist(true);
      },
      signal,
    );
  } finally {
    persist(true);
  }

  throwIfAborted(signal);

  // 写 sidecar 与完成标记，之后整目录原子改名。
  const sidecarTracks = orderedHashes
    .map((hash) => state.tracks[hash])
    .filter((track): track is ExportTrackState => Boolean(track))
    .map((track) => ({
      index: track.index,
      disc: track.disc,
      groupTitle: track.groupTitle,
      title: track.title,
      file: track.file,
      durationMs: track.durationMs,
      size: track.bytes,
    }));
  const sidecar: ExportSidecar = {
    schema: 1,
    exportedAt: new Date().toISOString(),
    source: {
      provider: 'asmrone',
      workId: work.id,
      code: work.code,
      url: `https://www.asmr.one/work/${work.code}`,
    },
    work: {
      code: work.code,
      title: work.title || job.title,
      circle: work.circle,
      releaseDate: work.releaseDate,
      workType: '',
      tags: work.tags,
      vas: work.vas,
      rating: work.rating,
      priceYen: work.priceYen,
      durationMs: work.durationMs,
      cover: coverFile,
    },
    tracks: sidecarTracks,
  };
  await fs.writeFile(
    path.join(workTmpDir, SIDECAR_FILE),
    `${JSON.stringify(sidecar, null, 2)}\n`,
    'utf8',
  );
  const totalBytes = sidecarTracks.reduce((sum, track) => sum + track.size, 0);
  await fs.writeFile(
    path.join(workTmpDir, EXPORT_COMPLETE_MARKER),
    `${JSON.stringify(
      {
        jobId: job.id,
        code: work.code,
        exportedAt: new Date().toISOString(),
        tracks: sidecarTracks.length,
        bytes: totalBytes,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  state.phase = 'finalize';
  onUpdate({ state, progress: 0.96 });
  throwIfAborted(signal);
  const dirTitle = sanitizeExportName(work.title || job.title, work.code, MAX_DIR_TITLE_CHARS);
  const baseDirName = `${work.code} [${dirTitle}]`;
  const finalDir = await uniqueDirectory(rootPath, baseDirName);
  await moveIntoPlace(workTmpDir, finalDir);
  await cleanupTmpRoot(rootPath, job.id);
  const relativePath = path
    .relative(rootPath, finalDir)
    .split(path.sep)
    .join('/');
  onUpdate({ targetRelativePath: relativePath, state: { ...state, phase: 'scan' } });
  throwIfAborted(signal);

  let scan: ScanResult | null = null;
  let scanError = '';
  try {
    scan = await scanWorkDir({ db, rootPath, relativePath });
  } catch (error) {
    scanError = describeError(error);
  }
  const workRow = getWorkByCode(db, work.code);
  if (workRow) {
    const sidecarRead = (await readExportSidecar(finalDir)) ?? sidecar;
    applySidecarToWork(db, workRow.id, sidecarRead);
    cover = await applyCoverAsset({
      db,
      assetsDir,
      ffmpegPath,
      finalDir,
      workId: workRow.id,
      coverFile,
      workIdOnline: work.id,
    });
  }

  onUpdate({
    progress: 1,
    trackTotal: orderedHashes.length,
    trackCompleted: orderedHashes.length,
    state: { ...state, phase: 'done' },
  });
  return buildResult(relativePath, rootPath, state, orderedHashes, cover, scan, scanError);
}

async function applyCoverAsset(input: {
  db: DatabaseSync;
  assetsDir: string;
  ffmpegPath: string;
  finalDir: string;
  workId: number;
  coverFile: string;
  workIdOnline: number;
}): Promise<'ok' | 'failed' | 'none'> {
  if (!input.workId || !input.coverFile) {
    return 'none';
  }
  const coverPath = path.join(input.finalDir, input.coverFile);
  try {
    const buffer = await fs.readFile(coverPath);
    await storeWorkCover({
      db: input.db,
      assetsDir: input.assetsDir,
      workId: input.workId,
      buffer,
      contentType: input.coverFile.endsWith('.png')
        ? 'image/png'
        : input.coverFile.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg',
      originUrl: `https://www.asmr.one/work/${input.workIdOnline}`,
      source: 'asmrone',
      ffmpegPath: input.ffmpegPath,
    });
    return 'ok';
  } catch {
    return 'failed';
  }
}

export type ExportQueueEventKind =
  | 'started'
  | 'done'
  | 'failed'
  | 'paused'
  | 'cancelled'
  | 'queued';

export interface ExportQueueEvent {
  kind: ExportQueueEventKind;
  job: ExportJobRecord;
  status: ExportJobStatus;
  error: string;
}

export interface ExportQueueOptions {
  db: DatabaseSync;
  getSource: () => ExportSource;
  assetsDir: string;
  getFfmpegPath: () => string;
  onEvent?: (event: ExportQueueEvent) => void;
}

interface ActiveExportRun {
  jobId: number;
  controller: AbortController;
  pauseRequested: boolean;
  cancelRequested: boolean;
  done: Promise<void>;
}

export class ExportQueue {
  private active: ActiveExportRun | null = null;
  private stopping = false;

  constructor(private readonly options: ExportQueueOptions) {}

  start(): void {
    pauseInterruptedExports(this.options.db);
    this.pump();
  }

  get activeJobId(): number | null {
    return this.active?.jobId ?? null;
  }

  pump(): void {
    if (this.active || this.stopping) {
      return;
    }
    const job = findNextQueuedExportJob(this.options.db);
    if (!job) {
      return;
    }
    const controller = new AbortController();
    const active: ActiveExportRun = {
      jobId: job.id,
      controller,
      pauseRequested: false,
      cancelRequested: false,
      done: Promise.resolve(),
    };
    this.active = active;
    active.done = this.execute(job, active).finally(() => {
      if (this.active === active) {
        this.active = null;
      }
      this.pump();
    });
  }

  private emitEvent(kind: ExportQueueEventKind, jobId: number): void {
    if (!this.options.onEvent) {
      return;
    }
    const job = getExportJob(this.options.db, jobId);
    if (!job) {
      return;
    }
    try {
      this.options.onEvent({ kind, job, status: job.status, error: job.error });
    } catch {
      // 日志回调异常不能影响导出任务。
    }
  }

  private tmpDirFor(job: ExportJobRecord): string {
    return path.join(job.targetRootPath, EXPORT_TMP_DIR, `export-${job.id}`);
  }

  private async cleanupTmp(job: ExportJobRecord): Promise<void> {
    try {
      await fs.rm(this.tmpDirFor(job), { recursive: true, force: true });
    } catch {
      // 临时目录清理失败不阻塞任务状态变更
    }
  }

  private async execute(job: ExportJobRecord, active: ActiveExportRun): Promise<void> {
    const db = this.options.db;
    updateExportJob(db, job.id, { status: 'running', error: '' });
    this.emitEvent('started', job.id);
    try {
      const result = await runExportJob({
        db,
        job,
        source: this.options.getSource(),
        assetsDir: this.options.assetsDir,
        ffmpegPath: this.options.getFfmpegPath(),
        signal: active.controller.signal,
        onUpdate: (patch) => updateExportJob(db, job.id, patch as UpdateExportJobPatch),
      });
      if (active.cancelRequested) {
        await this.cleanupTmp(job);
        updateExportJob(db, job.id, {
          status: 'cancelled',
          error: '已取消',
          progress: 0,
          trackCompleted: 0,
          state: { phase: 'download', tracks: {} },
        });
        this.emitEvent('cancelled', job.id);
        return;
      }
      updateExportJob(db, job.id, { status: 'done', progress: 1, error: '', result });
      this.emitEvent('done', job.id);
    } catch (error) {
      if (active.cancelRequested) {
        await this.cleanupTmp(job);
        updateExportJob(db, job.id, {
          status: 'cancelled',
          error: '已取消',
          progress: 0,
          trackCompleted: 0,
          state: { phase: 'download', tracks: {} },
        });
        this.emitEvent('cancelled', job.id);
        return;
      }
      if (active.pauseRequested || this.stopping) {
        updateExportJob(db, job.id, {
          status: 'paused',
          error: this.stopping ? '服务关闭，导出已暂停' : '',
        });
        this.emitEvent('paused', job.id);
        return;
      }
      updateExportJob(db, job.id, { status: 'failed', error: describeError(error) });
      this.emitEvent('failed', job.id);
    }
  }

  pause(jobId: number): void {
    const job = getExportJob(this.options.db, jobId);
    if (!job) {
      throw new Error('导出任务不存在');
    }
    if (this.active?.jobId === jobId) {
      this.active.pauseRequested = true;
      this.active.controller.abort();
      return;
    }
    if (job.status === 'queued') {
      updateExportJob(this.options.db, jobId, { status: 'paused', error: '' });
      this.emitEvent('paused', jobId);
      return;
    }
    throw new Error('只有排队或运行中的任务可以暂停');
  }

  resume(jobId: number): void {
    const job = getExportJob(this.options.db, jobId);
    if (!job) {
      throw new Error('导出任务不存在');
    }
    if (job.status !== 'paused') {
      throw new Error('只有已暂停的任务可以继续');
    }
    updateExportJob(this.options.db, jobId, { status: 'queued', error: '' });
    this.emitEvent('queued', jobId);
    this.pump();
  }

  async cancel(jobId: number): Promise<void> {
    const job = getExportJob(this.options.db, jobId);
    if (!job) {
      throw new Error('导出任务不存在');
    }
    if (job.status === 'done') {
      throw new Error('已完成的任务不能取消');
    }
    if (this.active?.jobId === jobId) {
      this.active.cancelRequested = true;
      this.active.controller.abort();
      return;
    }
    if (job.status === 'cancelled') {
      return;
    }
    await this.cleanupTmp(job);
    updateExportJob(this.options.db, jobId, {
      status: 'cancelled',
      error: '已取消',
      progress: 0,
      trackCompleted: 0,
      state: { phase: 'download', tracks: {} },
    });
    this.emitEvent('cancelled', jobId);
  }

  retry(jobId: number): void {
    const job = getExportJob(this.options.db, jobId);
    if (!job) {
      throw new Error('导出任务不存在');
    }
    if (job.status !== 'failed' && job.status !== 'cancelled') {
      throw new Error('只有失败或已取消的任务可以重试');
    }
    const patch: UpdateExportJobPatch = { status: 'queued', error: '' };
    if (job.status === 'cancelled') {
      patch.progress = 0;
      patch.trackCompleted = 0;
      patch.state = { phase: 'download', tracks: {} };
    }
    updateExportJob(this.options.db, jobId, patch);
    this.emitEvent('queued', jobId);
    this.pump();
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    const active = this.active;
    if (active) {
      active.controller.abort();
      await active.done.catch(() => undefined);
    }
  }
}
