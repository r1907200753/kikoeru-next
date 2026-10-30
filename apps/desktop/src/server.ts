import type { FastifyInstance } from 'fastify';
import { createServer } from 'node:net';
import {
  openDatabase,
  readSettings,
  type OperationLogger,
  type OperationLogInput,
} from '@kikoeru-next/core';
import { createApp } from '../../server/src/app.js';

export interface EmbeddedServerOptions {
  databasePath: string;
  dataDir: string;
  webRoot: string;
  portRange?: { start: number; end: number };
  onOriginChange?: (origin: string) => void;
}

export interface EmbeddedServer {
  readonly origin: string;
  readonly port: number;
  readonly lanEnabled: boolean;
  recordLog(input: OperationLogInput): void;
  close(): Promise<void>;
}

const DEFAULT_PORT_RANGE = { start: 31777, end: 31787 };
const RESTART_DELAY_MS = 400;

function isAddressInUse(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'EADDRINUSE'
  );
}

function canBindLoopback(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

function readInitialLan(databasePath: string): boolean {
  const db = openDatabase(databasePath);
  try {
    return readSettings(db, {
      libraryPath: process.env.KIKOERU_LIBRARY_PATH ?? '',
      proxyUrl: process.env.KIKOERU_PROXY_URL ?? '',
      ffprobePath: process.env.KIKOERU_FFPROBE_PATH ?? 'ffprobe',
    }).lanEnabled;
  } finally {
    db.close();
  }
}

export async function startEmbeddedServer(
  options: EmbeddedServerOptions,
): Promise<EmbeddedServer> {
  const range = options.portRange ?? DEFAULT_PORT_RANGE;
  let port = range.start;
  let lanEnabled = readInitialLan(options.databasePath);
  let instance: FastifyInstance | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingLan: boolean | null = null;
  let closed = false;
  let activeLogger: OperationLogger | null = null;
  const pendingLogs: OperationLogInput[] = [];

  const record = (input: OperationLogInput): void => {
    if (activeLogger) {
      activeLogger.record(input);
      return;
    }
    pendingLogs.push(input);
    if (pendingLogs.length > 50) {
      pendingLogs.shift();
    }
  };

  const attachLogger = (logger: OperationLogger): void => {
    activeLogger = logger;
    while (pendingLogs.length > 0) {
      const input = pendingLogs.shift();
      if (input) {
        logger.record(input);
      }
    }
  };

  const originFor = (value: number): string => `http://127.0.0.1:${value}`;
  const hostFor = (lan: boolean): string => (lan ? '0.0.0.0' : '127.0.0.1');

  async function listen(
    lan: boolean,
    preferredPort: number,
  ): Promise<{ app: FastifyInstance; port: number }> {
    let lastError: unknown = null;
    for (let candidate = preferredPort; candidate <= range.end; candidate += 1) {
      if (!(await canBindLoopback(candidate))) {
        lastError = Object.assign(new Error(`端口 ${candidate} 已被本机服务占用`), {
          code: 'EADDRINUSE',
        });
        continue;
      }
      const app = createApp({
        databasePath: options.databasePath,
        dataDir: options.dataDir,
        libraryPath: process.env.KIKOERU_LIBRARY_PATH ?? '',
        proxyUrl: process.env.KIKOERU_PROXY_URL ?? '',
        ffprobePath: process.env.KIKOERU_FFPROBE_PATH ?? 'ffprobe',
        webRoot: options.webRoot,
        boundToLan: lan,
        onAccessModeChange: (enabled) => scheduleRestart(enabled),
        onLogReady: attachLogger,
        logger: false,
      });
      try {
        await app.listen({ host: hostFor(lan), port: candidate });
        return { app, port: candidate };
      } catch (error) {
        lastError = error;
        await app.close().catch(() => undefined);
        if (!isAddressInUse(error)) {
          throw error;
        }
      }
    }
    throw lastError ?? new Error('没有可用的端口');
  }

  async function restart(): Promise<void> {
    if (closed || pendingLan === null) {
      return;
    }
    const target = pendingLan;
    pendingLan = null;
    const previousPort = port;
    try {
      await instance?.close();
      instance = null;
      const started = await listen(target, previousPort);
      instance = started.app;
      lanEnabled = target;
      if (started.port !== previousPort) {
        port = started.port;
        options.onOriginChange?.(originFor(port));
      }
      record({
        level: 'success',
        category: 'desktop',
        action: 'desktop.lan',
        message: `监听地址已切换为${target ? '局域网 + 本机' : '仅本机'}（端口 ${port}）`,
        detail: { lanEnabled: target, port },
      });
      console.info(`监听地址已切换为${target ? '局域网 + 本机' : '仅本机'}（端口 ${port}）`);
    } catch (error) {
      record({
        level: 'error',
        category: 'desktop',
        action: 'desktop.lan.failed',
        message: `切换监听地址失败：${error instanceof Error ? error.message : String(error)}`,
        detail: { target },
      });
      console.error('切换监听地址失败：', error);
      try {
        const fallback = await listen(!target, previousPort);
        instance = fallback.app;
        lanEnabled = !target;
        if (fallback.port !== previousPort) {
          port = fallback.port;
          options.onOriginChange?.(originFor(port));
        }
      } catch (fallbackError) {
        record({
          level: 'error',
          category: 'desktop',
          action: 'desktop.listen.failed',
          message: `恢复本地监听失败：${
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          }`,
        });
        console.error('恢复本地监听失败：', fallbackError);
      }
    }
    if (pendingLan !== null && restartTimer === null) {
      scheduleRestart(pendingLan);
    }
  }

  function scheduleRestart(enabled: boolean): void {
    if (closed) {
      return;
    }
    pendingLan = enabled;
    if (restartTimer) {
      return;
    }
    restartTimer = setTimeout(() => {
      restartTimer = null;
      void restart();
    }, RESTART_DELAY_MS);
  }

  const started = await listen(lanEnabled, port);
  instance = started.app;
  port = started.port;
  record({
    category: 'desktop',
    action: 'desktop.server.start',
    message: `服务已监听 http://127.0.0.1:${port}（${
      lanEnabled ? '局域网已开启' : '仅本机'
    }）`,
    detail: {
      preferredPort: range.start,
      port,
      portFallback: port !== range.start,
      lanEnabled,
    },
  });

  return {
    get origin() {
      return originFor(port);
    },
    get port() {
      return port;
    },
    get lanEnabled() {
      return lanEnabled;
    },
    recordLog(input) {
      record(input);
    },
    async close() {
      closed = true;
      pendingLan = null;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      const current = instance;
      instance = null;
      activeLogger = null;
      await current?.close();
    },
  };
}
