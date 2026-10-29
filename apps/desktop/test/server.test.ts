import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, writeSettings } from '@kikoeru-next/core';
import { startEmbeddedServer, type EmbeddedServer } from '../src/server.js';

const PASSWORD = 'lan-password-123';

function listenOn(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function freePort(): Promise<number> {
  const server = await listenOn(0);
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function makeWebRoot(root: string): Promise<string> {
  const webRoot = path.join(root, 'web');
  await fs.mkdir(webRoot, { recursive: true });
  await fs.writeFile(path.join(webRoot, 'index.html'), '<div id="root"></div>');
  return webRoot;
}

async function waitFor<T>(check: () => Promise<T | null>, timeoutMs = 4000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value !== null) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error('等待超时');
}

async function closeQuietly(server: EmbeddedServer | null): Promise<void> {
  await server?.close().catch(() => undefined);
}

test('内嵌服务监听指定端口并提供 API，关闭后释放端口', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-desktop-'));
  const port = await freePort();
  let server: EmbeddedServer | null = null;
  try {
    server = await startEmbeddedServer({
      databasePath: path.join(root, 'app.sqlite'),
      dataDir: root,
      webRoot: await makeWebRoot(root),
      portRange: { start: port, end: port + 3 },
    });
    assert.equal(server.port, port);
    assert.equal(server.origin, `http://127.0.0.1:${port}`);

    const ping = await fetch(`${server.origin}/api/ping`);
    assert.equal(ping.status, 200);
    assert.equal(((await ping.json()) as { ok: boolean }).ok, true);

    await server.close();
    server = null;
    const probe = await listenOn(port);
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  } finally {
    await closeQuietly(server);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('桌面端日志写入后可通过日志 API 读取', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-desktop-logs-'));
  const port = await freePort();
  let server: EmbeddedServer | null = null;
  try {
    server = await startEmbeddedServer({
      databasePath: path.join(root, 'app.sqlite'),
      dataDir: root,
      webRoot: await makeWebRoot(root),
      portRange: { start: port, end: port + 3 },
    });
    server.recordLog({
      level: 'warn',
      category: 'desktop',
      action: 'desktop.test',
      message: '桌面端测试日志',
      detail: { source: 'test' },
    });
    const response = await fetch(`${server.origin}/api/logs?category=desktop&limit=20`);
    assert.equal(response.status, 200);
    const page = (await response.json()) as {
      items: Array<{ action: string; level: string; message: string; detail: unknown }>;
    };
    assert.ok(
      page.items.some(
        (item) =>
          item.action === 'desktop.server.start' ||
          item.action === 'desktop.test',
      ),
    );
    const custom = page.items.find((item) => item.action === 'desktop.test');
    assert.ok(custom);
    assert.equal(custom.level, 'warn');
    assert.deepEqual(custom.detail, { source: 'test' });
  } finally {
    await closeQuietly(server);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('端口被占用时按范围向后回退', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-desktop-fallback-'));
  const port = await freePort();
  const blocker = await listenOn(port);
  let server: EmbeddedServer | null = null;
  try {
    server = await startEmbeddedServer({
      databasePath: path.join(root, 'app.sqlite'),
      dataDir: root,
      webRoot: await makeWebRoot(root),
      portRange: { start: port, end: port + 3 },
    });
    assert.notEqual(server.port, port);
    assert.ok(server.port > port && server.port <= port + 3);
    const ping = await fetch(`${server.origin}/api/ping`);
    assert.equal(ping.status, 200);
  } finally {
    await closeQuietly(server);
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('局域网模式下跳过被本机回环占用的端口', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-desktop-lan-fallback-'));
  const port = await freePort();
  const blocker = await listenOn(port);
  let server: EmbeddedServer | null = null;
  try {
    const databasePath = path.join(root, 'app.sqlite');
    const db = openDatabase(databasePath);
    writeSettings(db, { lanEnabled: true });
    db.close();

    server = await startEmbeddedServer({
      databasePath,
      dataDir: root,
      webRoot: await makeWebRoot(root),
      portRange: { start: port, end: port + 3 },
    });
    assert.equal(server.lanEnabled, true);
    assert.notEqual(server.port, port);
    assert.ok(server.port > port && server.port <= port + 3);
    const ping = await fetch(`${server.origin}/api/ping`);
    assert.equal(ping.status, 200);
  } finally {
    await closeQuietly(server);
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('局域网开关触发重绑并在重启后保留设置', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-desktop-lan-'));
  const port = await freePort();
  let server: EmbeddedServer | null = null;
  try {
    const databasePath = path.join(root, 'app.sqlite');
    const webRoot = await makeWebRoot(root);
    server = await startEmbeddedServer({
      databasePath,
      dataDir: root,
      webRoot,
      portRange: { start: port, end: port + 3 },
    });
    assert.equal(server.lanEnabled, false);

    const enable = await fetch(`${server.origin}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lanEnabled: true, password: PASSWORD }),
    });
    assert.equal(enable.status, 200);
    const enableCookie = (enable.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    assert.match(enableCookie, /^kikoeru_session=/);

    const enabledAccess = await waitFor(async () => {
      const response = await fetch(`${server?.origin}/api/access`, {
        headers: { cookie: enableCookie },
      });
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as { boundToLan: boolean; lanEnabled: boolean };
      return body.boundToLan && body.lanEnabled ? body : null;
    });
    assert.equal(enabledAccess.boundToLan, true);
    assert.equal(server.port, port);
    assert.equal(server.lanEnabled, true);

    const disable = await fetch(`${server.origin}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: enableCookie },
      body: JSON.stringify({ lanEnabled: false }),
    });
    assert.equal(disable.status, 200);
    await waitFor(async () => {
      const response = await fetch(`${server?.origin}/api/access`);
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as { boundToLan: boolean };
      return body.boundToLan ? null : body;
    });
    assert.equal(server.lanEnabled, false);

    await server.close();
    server = null;

    server = await startEmbeddedServer({
      databasePath,
      dataDir: root,
      webRoot,
      portRange: { start: port, end: port + 3 },
    });
    assert.equal(server.lanEnabled, false);
  } finally {
    await closeQuietly(server);
    await fs.rm(root, { recursive: true, force: true });
  }
});
