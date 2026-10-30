import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerSaveBlocker,
  session,
  shell,
  Tray,
} from 'electron';
import type { OperationLogInput } from '@kikoeru-next/core';
import { startEmbeddedServer, type EmbeddedServer } from './server.js';

declare const __dirname: string;

app.setName('Kikoeru Next');

const isDevAttach = process.argv.includes('--dev') || Boolean(process.env.KIKOERU_DEV_URL);
const isSmokeTest = process.argv.includes('--smoke-test');
const devUrl = process.env.KIKOERU_DEV_URL ?? 'http://localhost:5173';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: EmbeddedServer | null = null;
let currentOrigin = '';
let isQuitting = false;
let closingServer = false;
let trayHintShown = false;
let playbackBlockerId: number | null = null;

function recordLog(input: OperationLogInput): void {
  if (server) {
    server.recordLog(input);
    return;
  }
  const line = `[${input.level ?? 'info'}] ${input.message}`;
  if (input.level === 'error') {
    console.error(line);
  } else if (input.level === 'warn') {
    console.warn(line);
  } else {
    console.info(line);
  }
}

function resolveDataDir(): string {
  const override = process.env.KIKOERU_DATA_DIR;
  if (override) {
    return path.resolve(override);
  }
  if (isSmokeTest) {
    return path.join(app.getPath('temp'), 'kikoeru-next-smoke');
  }
  return path.join(app.getPath('userData'), 'data');
}

function resolveWebRoot(): string {
  if (!app.isPackaged) {
    return path.join(__dirname, 'web');
  }
  return path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'web');
}

function resolveIconPath(): string {
  if (!app.isPackaged) {
    return path.join(__dirname, 'icon.png');
  }
  return path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'icon.png');
}

function portRange(): { start: number; end: number } {
  const parsed = Number.parseInt(process.env.KIKOERU_PORT ?? '', 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65_535) {
    return { start: parsed, end: Math.min(65_535, parsed + 10) };
  }
  return { start: 31_777, end: 31_787 };
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function sameOrigin(value: string): boolean {
  try {
    return new URL(value).origin === currentOrigin;
  } catch {
    return false;
  }
}

function setPlaybackActive(active: boolean): void {
  if (active && playbackBlockerId === null) {
    playbackBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    recordLog({
      category: 'desktop',
      action: 'desktop.power.block',
      message: '已阻止系统休眠（播放中）',
    });
    return;
  }
  if (!active && playbackBlockerId !== null) {
    if (powerSaveBlocker.isStarted(playbackBlockerId)) {
      powerSaveBlocker.stop(playbackBlockerId);
    }
    playbackBlockerId = null;
    recordLog({
      category: 'desktop',
      action: 'desktop.power.release',
      message: '已解除系统休眠阻止',
    });
  }
}

function showWindow(): void {
  if (!mainWindow) {
    mainWindow = createWindow(currentOrigin);
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(origin: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#f2f6f7',
    icon: resolveIconPath(),
    title: 'Kikoeru Next',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('close', (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    win.hide();
    recordLog({
      category: 'desktop',
      action: 'desktop.window.hide',
      message: '桌面窗口已隐藏到托盘',
    });
    if (!trayHintShown && process.platform === 'win32') {
      trayHintShown = true;
      tray?.displayBalloon({
        title: 'Kikoeru Next 仍在运行',
        content: '窗口已隐藏到托盘，手机仍可继续访问；右键托盘图标可退出。',
      });
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url) && !sameOrigin(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (sameOrigin(url)) {
      return;
    }
    event.preventDefault();
    if (isHttpUrl(url)) {
      void shell.openExternal(url);
    }
  });

  if (isDevAttach) {
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        win.webContents.toggleDevTools();
      }
    });
  }

  let retried = false;
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || !sameOrigin(validatedUrl)) {
      return;
    }
    recordLog({
      level: 'error',
      category: 'desktop',
      action: 'desktop.page.failed',
      message: `页面加载失败（${errorCode} ${errorDescription}）：${validatedUrl}`,
      detail: { errorCode, errorDescription, url: validatedUrl },
    });
    console.error(`页面加载失败（${errorCode} ${errorDescription}）：${validatedUrl}`);
    if (!retried) {
      retried = true;
      setTimeout(() => {
        if (!win.isDestroyed()) {
          void win.loadURL(origin);
        }
      }, 1000);
    }
  });

  void win.loadURL(origin).catch((error: unknown) => {
    console.error('加载页面失败：', error);
  });

  return win;
}

function createTray(): void {
  const icon = nativeImage.createFromPath(resolveIconPath());
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Kikoeru Next');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => showWindow() },
      {
        label: '在浏览器中打开',
        click: () => {
          recordLog({
            category: 'desktop',
            action: 'desktop.tray.browser',
            message: '从托盘在浏览器中打开',
            detail: { origin: currentOrigin },
          });
          void shell.openExternal(currentOrigin);
        },
      },
      { type: 'separator' },
      {
        label: '退出 Kikoeru Next',
        click: () => {
          recordLog({
            category: 'desktop',
            action: 'desktop.tray.exit',
            message: '从托盘退出 Kikoeru Next',
          });
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
}

function registerIpc(): void {
  ipcMain.on('kikoeru:playback-active', (event, active: unknown) => {
    if (typeof active !== 'boolean') {
      return;
    }
    const senderUrl = event.senderFrame?.url ?? '';
    if (!sameOrigin(senderUrl)) {
      return;
    }
    setPlaybackActive(active);
  });
}

function shutdownServer(): Promise<void> {
  setPlaybackActive(false);
  const active = server;
  server = null;
  return active ? active.close() : Promise.resolve();
}

async function bootstrap(): Promise<void> {
  Menu.setApplicationMenu(null);
  app.setAppUserModelId('io.kikoeru.next');
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write');
  });
  registerIpc();

  if (isDevAttach) {
    currentOrigin = new URL(devUrl).origin;
    console.info(`开发模式：连接到 ${devUrl}`);
  } else {
    const dataDir = resolveDataDir();
    const webRoot = resolveWebRoot();
    server = await startEmbeddedServer({
      databasePath: process.env.KIKOERU_DB_PATH ?? path.join(dataDir, 'kikoeru.sqlite'),
      dataDir,
      webRoot,
      portRange: portRange(),
      onOriginChange: (nextOrigin) => {
        const previousOrigin = currentOrigin;
        currentOrigin = nextOrigin;
        if (!mainWindow || mainWindow.isDestroyed()) {
          return;
        }
        try {
          if (new URL(mainWindow.webContents.getURL()).origin === previousOrigin) {
            void mainWindow.loadURL(nextOrigin);
          }
        } catch {
          // 页面尚未加载完成时无需重载。
        }
      },
    });
    currentOrigin = server.origin;
    recordLog({
      level: 'success',
      category: 'desktop',
      action: 'desktop.start',
      message: `Kikoeru Next 已启动：${server.origin}（${
        server.lanEnabled ? '局域网已开启' : '仅本机'
      }）`,
      detail: {
        origin: server.origin,
        port: server.port,
        lanEnabled: server.lanEnabled,
        dataDir,
        packaged: app.isPackaged,
        version: app.getVersion(),
      },
    });
    console.info(`Kikoeru Next 服务已启动：${server.origin}（${server.lanEnabled ? '局域网已开启' : '仅本机'}）`);
  }

  mainWindow = createWindow(currentOrigin);
  createTray();

  app.on('second-instance', () => {
    recordLog({
      category: 'desktop',
      action: 'desktop.second-instance',
      message: '检测到重复启动，已聚焦现有窗口',
    });
    showWindow();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow(currentOrigin);
    } else {
      showWindow();
    }
  });
}

async function runSmokeTest(): Promise<void> {
  const resultPath = process.env.KIKOERU_SMOKE_RESULT ?? path.join(process.cwd(), 'smoke-result.json');
  try {
    await app.whenReady();
    registerIpc();
    const dataDir = resolveDataDir();
    const embedded = await startEmbeddedServer({
      databasePath: path.join(dataDir, 'kikoeru.sqlite'),
      dataDir,
      webRoot: resolveWebRoot(),
      portRange: portRange(),
    });
    currentOrigin = embedded.origin;
    const pingResponse = await fetch(`${embedded.origin}/api/ping`);
    const ping = (await pingResponse.json()) as { ok?: boolean };
    const indexResponse = await fetch(`${embedded.origin}/`);
    const index = await indexResponse.text();
    const scriptMatch = /src="(\/assets\/[^"]+\.js)"/.exec(index);
    const scriptPath = scriptMatch?.[1] ?? '';
    const scriptResponse = scriptPath ? await fetch(`${embedded.origin}${scriptPath}`) : null;

    const testWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await testWindow.loadURL(embedded.origin);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const renderer = (await testWindow.webContents.executeJavaScript(
      `(() => ({
        platform: window.kikoeruDesktop?.platform ?? null,
        title: document.title,
        rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
      }))()`,
    )) as { platform: string | null; title: string; rootChildren: number };
    if (renderer.platform) {
      await testWindow.webContents.executeJavaScript('window.kikoeruDesktop.setPlaybackActive(true)');
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    const blockerActive =
      playbackBlockerId !== null && powerSaveBlocker.isStarted(playbackBlockerId);
    await testWindow.webContents
      .executeJavaScript('window.kikoeruDesktop?.setPlaybackActive(false)')
      .catch(() => undefined);
    testWindow.destroy();

    const result = {
      ok:
        pingResponse.ok &&
        ping.ok === true &&
        indexResponse.ok &&
        index.includes('<div id="root">') &&
        scriptPath !== '' &&
        scriptResponse?.ok === true &&
        renderer.platform === process.platform &&
        renderer.rootChildren > 0 &&
        blockerActive,
      origin: embedded.origin,
      renderer,
      blockerActive,
      port: embedded.port,
      script: scriptPath,
      scriptBytes: scriptResponse ? (await scriptResponse.text()).length : 0,
      node: process.versions.node,
      sqlite: process.versions.sqlite,
      electron: process.versions.electron,
      dataDir,
      defaultDataDir: path.join(app.getPath('userData'), 'data'),
      userData: app.getPath('userData'),
      packaged: app.isPackaged,
      resources: process.resourcesPath,
    };
    writeFileSync(resultPath, JSON.stringify(result, null, 2));
    await embedded.close();
    app.exit(result.ok ? 0 : 1);
  } catch (error) {
    writeFileSync(
      resultPath,
      JSON.stringify({ ok: false, error: error instanceof Error ? error.stack : String(error) }),
    );
    app.exit(1);
  }
}

if (isSmokeTest) {
  void runSmokeTest();
} else {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('before-quit', (event) => {
      isQuitting = true;
      if (server && !closingServer) {
        recordLog({
          category: 'desktop',
          action: 'desktop.quit',
          message: 'Kikoeru Next 正在退出',
        });
        event.preventDefault();
        closingServer = true;
        void shutdownServer().finally(() => app.quit());
      }
    });
    app.on('window-all-closed', () => {
      if (process.platform === 'darwin') {
        return;
      }
      if (!tray) {
        app.quit();
      }
    });
    void app
      .whenReady()
      .then(bootstrap)
      .catch((error: unknown) => {
        console.error('启动失败：', error);
        dialog.showErrorBox(
          'Kikoeru Next 启动失败',
          error instanceof Error ? error.message : String(error),
        );
        app.quit();
      });
  }
}
