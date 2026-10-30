import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { openDatabase, readSettings } from '@kikoeru-next/core';
import { createApp } from './app.js';

const dataDir = path.resolve(process.env.KIKOERU_DATA_DIR ?? 'data');
const databasePath = process.env.KIKOERU_DB_PATH ?? path.join(dataDir, 'kikoeru.sqlite');
const libraryPath = process.env.KIKOERU_LIBRARY_PATH ?? '';
const proxyUrl = process.env.KIKOERU_PROXY_URL ?? '';
const ffprobePath = process.env.KIKOERU_FFPROBE_PATH ?? 'ffprobe';
const hostOverride = process.env.KIKOERU_HOST ?? '';
const port = Number.parseInt(process.env.KIKOERU_PORT ?? '31777', 10);
const webRoot =
  process.env.KIKOERU_WEB_DIR ??
  fileURLToPath(new URL('../../web/dist/', import.meta.url));

const probeDb = openDatabase(databasePath);
const initialLanEnabled = readSettings(probeDb, { libraryPath, proxyUrl, ffprobePath }).lanEnabled;
probeDb.close();

function hostForLan(lanEnabled: boolean): string {
  if (hostOverride) {
    return hostOverride;
  }
  return lanEnabled ? '0.0.0.0' : '127.0.0.1';
}

function isLanHost(host: string): boolean {
  return host !== '127.0.0.1' && host !== 'localhost' && host !== '::1';
}

let app: FastifyInstance | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let pendingLan: boolean | null = null;

async function start(lanEnabled: boolean): Promise<FastifyInstance> {
  const host = hostForLan(lanEnabled);
  const instance = createApp({
    databasePath,
    dataDir,
    libraryPath,
    proxyUrl,
    ffprobePath,
    webRoot,
    boundToLan: isLanHost(host),
    onAccessModeChange: (enabled) => scheduleRestart(enabled),
    logger: true,
  });
  await instance.listen({ host, port });
  return instance;
}

function scheduleRestart(lanEnabled: boolean): void {
  if (hostOverride) {
    return;
  }
  pendingLan = lanEnabled;
  if (restartTimer) {
    return;
  }
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void restart();
  }, 600);
}

async function restart(): Promise<void> {
  if (pendingLan === null) {
    return;
  }
  const target = pendingLan;
  pendingLan = null;
  try {
    await app?.close();
    app = await start(target);
    app.log.info(`监听地址已切换为${target ? '局域网 + 本机' : '仅本机'}`);
  } catch (error) {
    console.error('切换监听地址失败：', error);
  }
  if (pendingLan !== null) {
    scheduleRestart(pendingLan);
  }
}

try {
  const started = await start(initialLanEnabled);
  app = started;
  started.log.info(`Kikoeru Next: http://127.0.0.1:${port}`);
  if (!libraryPath) {
    started.log.info('未配置 KIKOERU_LIBRARY_PATH，可在 POST /api/scan 中传 rootPath');
  }
} catch (error) {
  app?.log.error(error);
  process.exit(1);
}
