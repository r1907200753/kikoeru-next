import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

const LAN_IP = '192.168.1.50';
const LAN_HOST = `${LAN_IP}:31777`;
const PASSWORD = 'correct-horse-battery';

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  return String(value ?? '').split(';')[0] ?? '';
}

function hasClearedCookie(response: { headers: Record<string, unknown> }): boolean {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  return /Max-Age=0/.test(String(value ?? ''));
}

test('局域网关闭时只接受本机请求', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-access-off-'));
  try {
    const app = createApp({ databasePath: path.join(root, 'test.sqlite') });
    await app.ready();
    try {
      const local = await app.inject({ method: 'GET', url: '/api/health' });
      assert.equal(local.statusCode, 200);

      const remote = await app.inject({
        method: 'GET',
        url: '/api/health',
        remoteAddress: LAN_IP,
      });
      assert.equal(remote.statusCode, 403);
      assert.match(remote.json<{ error: string }>().error, /未开启局域网访问/);

      const ping = await app.inject({
        method: 'GET',
        url: '/api/ping',
        remoteAddress: LAN_IP,
      });
      assert.equal(ping.statusCode, 403);
    } finally {
      await app.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('开启局域网：密码校验、登录、来源校验与会话生命周期', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-access-on-'));
  try {
    const app = createApp({
      databasePath: path.join(root, 'test.sqlite'),
      boundToLan: false,
    });
    await app.ready();
    try {
      const withoutPassword = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { lanEnabled: true },
      });
      assert.equal(withoutPassword.statusCode, 400);
      assert.match(withoutPassword.json<{ error: string }>().error, /请先设置访问密码/);

      const shortPassword = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { lanEnabled: true, password: 'short' },
      });
      assert.equal(shortPassword.statusCode, 400);

      const enable = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { lanEnabled: true, password: PASSWORD },
      });
      assert.equal(enable.statusCode, 200);
      const enableBody = enable.json<{ lanEnabled: boolean; restartRequired: boolean }>();
      assert.equal(enableBody.lanEnabled, true);
      assert.equal(enableBody.restartRequired, true);
      const initialCookie = cookieFrom(enable);
      assert.match(initialCookie, /^kikoeru_session=/);

      const remoteHealth = await app.inject({
        method: 'GET',
        url: '/api/health',
        remoteAddress: LAN_IP,
      });
      assert.equal(remoteHealth.statusCode, 401);
      assert.equal(remoteHealth.json<{ code: string }>().code, 'AUTH_REQUIRED');

      const ping = await app.inject({
        method: 'GET',
        url: '/api/ping',
        remoteAddress: LAN_IP,
      });
      assert.equal(ping.statusCode, 200);

      const status = await app.inject({
        method: 'GET',
        url: '/api/auth/status',
        remoteAddress: LAN_IP,
      });
      assert.equal(status.statusCode, 200);
      assert.deepEqual(status.json(), {
        required: true,
        authenticated: false,
        hasPassword: true,
      });

      const spoofed = await app.inject({
        method: 'GET',
        url: '/api/health',
        remoteAddress: LAN_IP,
        headers: { 'x-forwarded-for': '127.0.0.1' },
      });
      assert.equal(spoofed.statusCode, 401);

      const wrong = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: LAN_IP,
        payload: { password: 'not-the-password' },
      });
      assert.equal(wrong.statusCode, 401);

      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: LAN_IP,
        payload: { password: PASSWORD },
      });
      assert.equal(login.statusCode, 200);
      const sessionCookie = cookieFrom(login);
      assert.match(sessionCookie, /^kikoeru_session=/);

      const withCookie = await app.inject({
        method: 'GET',
        url: '/api/health',
        remoteAddress: LAN_IP,
        headers: { cookie: sessionCookie },
      });
      assert.equal(withCookie.statusCode, 200);

      const badOrigin = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        remoteAddress: LAN_IP,
        headers: {
          cookie: sessionCookie,
          host: LAN_HOST,
          origin: 'http://evil.example',
        },
        payload: { proxyUrl: 'http://127.0.0.1:7890' },
      });
      assert.equal(badOrigin.statusCode, 403);

      const goodOrigin = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        remoteAddress: LAN_IP,
        headers: {
          cookie: sessionCookie,
          host: LAN_HOST,
          origin: `http://${LAN_HOST}`,
        },
        payload: { proxyUrl: 'http://127.0.0.1:7890' },
      });
      assert.equal(goodOrigin.statusCode, 200);

      const access = await app.inject({
        method: 'GET',
        url: '/api/access',
        remoteAddress: LAN_IP,
        headers: { cookie: sessionCookie },
      });
      assert.equal(access.statusCode, 200);
      const accessBody = access.json<{
        lanEnabled: boolean;
        hasPassword: boolean;
        boundToLan: boolean;
        addresses: Array<{ address: string; url: string }>;
      }>();
      assert.equal(accessBody.lanEnabled, true);
      assert.equal(accessBody.hasPassword, true);
      assert.equal(accessBody.boundToLan, false);
      assert.ok(Array.isArray(accessBody.addresses));

      const logout = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        remoteAddress: LAN_IP,
        headers: { cookie: sessionCookie, host: LAN_HOST, origin: `http://${LAN_HOST}` },
      });
      assert.equal(logout.statusCode, 200);
      assert.equal(hasClearedCookie(logout), true);

      const afterLogout = await app.inject({
        method: 'GET',
        url: '/api/health',
        remoteAddress: LAN_IP,
        headers: { cookie: sessionCookie },
      });
      assert.equal(afterLogout.statusCode, 401);

      const loginAgain = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: LAN_IP,
        payload: { password: PASSWORD },
      });
      assert.equal(loginAgain.statusCode, 200);

      const change = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        remoteAddress: LAN_IP,
        headers: {
          cookie: cookieFrom(loginAgain),
          host: LAN_HOST,
          origin: `http://${LAN_HOST}`,
        },
        payload: { password: 'a-brand-new-password', currentPassword: PASSWORD },
      });
      assert.equal(change.statusCode, 200);
      const renewedCookie = cookieFrom(change);
      assert.match(renewedCookie, /^kikoeru_session=/);

      const oldSession = await app.inject({
        method: 'GET',
        url: '/api/health',
        remoteAddress: LAN_IP,
        headers: { cookie: cookieFrom(loginAgain) },
      });
      assert.equal(oldSession.statusCode, 401);

      const renewedSession = await app.inject({
        method: 'GET',
        url: '/api/health',
        remoteAddress: LAN_IP,
        headers: { cookie: renewedCookie },
      });
      assert.equal(renewedSession.statusCode, 200);

      const disable = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        remoteAddress: LAN_IP,
        headers: {
          cookie: renewedCookie,
          host: LAN_HOST,
          origin: `http://${LAN_HOST}`,
        },
        payload: { lanEnabled: false },
      });
      assert.equal(disable.statusCode, 200);
      assert.equal(disable.json<{ lanEnabled: boolean }>().lanEnabled, false);

      const remoteAfterDisable = await app.inject({
        method: 'GET',
        url: '/api/health',
        remoteAddress: LAN_IP,
        headers: { cookie: renewedCookie },
      });
      assert.equal(remoteAfterDisable.statusCode, 403);

      const localAfterDisable = await app.inject({ method: 'GET', url: '/api/health' });
      assert.equal(localAfterDisable.statusCode, 200);
    } finally {
      await app.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('网卡列表遵循鉴权并从接口返回 MAC', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-access-network-'));
  try {
    const app = createApp({
      databasePath: path.join(root, 'test.sqlite'),
      boundToLan: false,
    });
    await app.ready();
    try {
      const local = await app.inject({ method: 'GET', url: '/api/network' });
      assert.equal(local.statusCode, 200);
      assert.equal(local.headers['cache-control'], 'no-store');
      const localBody = local.json<{
        interfaces: Array<{ name: string; address: string; mac: string }>;
      }>();
      assert.ok(Array.isArray(localBody.interfaces));
      for (const item of localBody.interfaces) {
        assert.ok(item.name.length > 0);
        assert.match(item.address, /^\d{1,3}(\.\d{1,3}){3}$/);
        assert.match(item.mac, /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
      }

      const enable = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { lanEnabled: true, password: PASSWORD },
      });
      assert.equal(enable.statusCode, 200);

      const remote = await app.inject({
        method: 'GET',
        url: '/api/network',
        remoteAddress: LAN_IP,
      });
      assert.equal(remote.statusCode, 401);
      assert.equal(remote.json<{ code: string }>().code, 'AUTH_REQUIRED');

      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: LAN_IP,
        payload: { password: PASSWORD },
      });
      assert.equal(login.statusCode, 200);

      const authorized = await app.inject({
        method: 'GET',
        url: '/api/network',
        remoteAddress: LAN_IP,
        headers: { cookie: cookieFrom(login) },
      });
      assert.equal(authorized.statusCode, 200);
      assert.ok(Array.isArray(authorized.json<{ interfaces: unknown[] }>().interfaces));
    } finally {
      await app.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('登录失败限速按客户端 IP 生效', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-access-limit-'));
  try {
    const app = createApp({
      databasePath: path.join(root, 'test.sqlite'),
      boundToLan: true,
    });
    await app.ready();
    try {
      const enable = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { lanEnabled: true, password: PASSWORD },
      });
      assert.equal(enable.statusCode, 200);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const failure = await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          remoteAddress: LAN_IP,
          payload: { password: `wrong-password-${attempt}` },
        });
        assert.equal(failure.statusCode, 401);
      }

      const locked = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: LAN_IP,
        payload: { password: PASSWORD },
      });
      assert.equal(locked.statusCode, 429);
      assert.ok(Number(locked.headers['retry-after']) > 0);

      const otherClient = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '192.168.1.51',
        payload: { password: PASSWORD },
      });
      assert.equal(otherClient.statusCode, 200);
    } finally {
      await app.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
