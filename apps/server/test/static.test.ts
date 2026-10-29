import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

async function makeWebRoot(root: string): Promise<string> {
  const webRoot = path.join(root, 'web');
  await fs.mkdir(path.join(webRoot, 'assets'), { recursive: true });
  await fs.writeFile(
    path.join(webRoot, 'index.html'),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/app-abc123.js"></script></body></html>',
  );
  await fs.writeFile(path.join(webRoot, 'assets', 'app-abc123.js'), 'console.log("kikoeru");');
  await fs.writeFile(path.join(webRoot, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await fs.writeFile(
    path.join(webRoot, 'manifest.webmanifest'),
    JSON.stringify({ name: 'Kikoeru Next', start_url: '/', display: 'standalone' }),
  );
  await fs.mkdir(path.join(webRoot, 'icons'), { recursive: true });
  await fs.writeFile(
    path.join(webRoot, 'icons', 'apple-touch-icon.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  return webRoot;
}

test('单源托管：首页、指纹资源、SPA 回退与安全头', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-static-'));
  try {
    const webRoot = await makeWebRoot(root);
    const app = createApp({
      databasePath: path.join(root, 'data', 'test.sqlite'),
      webRoot,
    });
    await app.ready();
    try {
      const index = await app.inject({ method: 'GET', url: '/' });
      assert.equal(index.statusCode, 200);
      assert.match(index.headers['content-type'] as string, /text\/html/);
      assert.match(index.body, /<div id="root"><\/div>/);
      assert.equal(index.headers['cache-control'], 'no-cache');
      assert.equal(
        index.headers['content-security-policy'],
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      );
      assert.equal(index.headers['x-content-type-options'], 'nosniff');
      assert.equal(index.headers['referrer-policy'], 'no-referrer');

      const asset = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
      assert.equal(asset.statusCode, 200);
      assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
      assert.match(asset.headers['content-type'] as string, /javascript/);

      const icon = await app.inject({ method: 'GET', url: '/favicon.svg' });
      assert.equal(icon.statusCode, 200);
      assert.equal(icon.headers['cache-control'], 'no-cache');

      const fallback = await app.inject({ method: 'GET', url: '/works/123' });
      assert.equal(fallback.statusCode, 200);
      assert.match(fallback.body, /<div id="root"><\/div>/);
      assert.equal(fallback.headers['cache-control'], 'no-cache');

      const api404 = await app.inject({ method: 'GET', url: '/api/not-exist' });
      assert.equal(api404.statusCode, 404);
      assert.deepEqual(api404.json(), { error: '接口不存在' });

      const ping = await app.inject({ method: 'GET', url: '/api/ping' });
      assert.equal(ping.statusCode, 200);
      const pingBody = ping.json<{ ok: boolean; name: string; version: string; serverTime: string }>();
      assert.equal(pingBody.ok, true);
      assert.equal(pingBody.name, 'kikoeru-next');
      assert.equal(pingBody.version, '1.0.3');
      assert.ok(Number.isFinite(Date.parse(pingBody.serverTime)));
    } finally {
      await app.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('manifest 与主屏图标按静态资源托管', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-static-icons-'));
  try {
    const webRoot = await makeWebRoot(root);
    const app = createApp({
      databasePath: path.join(root, 'data', 'test.sqlite'),
      webRoot,
    });
    await app.ready();
    try {
      const manifest = await app.inject({ method: 'GET', url: '/manifest.webmanifest' });
      assert.equal(manifest.statusCode, 200);
      assert.match(manifest.headers['content-type'] as string, /application\/manifest\+json/);
      assert.equal(manifest.headers['cache-control'], 'no-cache');
      assert.equal((manifest.json<{ display: string }>()).display, 'standalone');

      const icon = await app.inject({ method: 'GET', url: '/icons/apple-touch-icon.png' });
      assert.equal(icon.statusCode, 200);
      assert.match(icon.headers['content-type'] as string, /image\/png/);
      assert.equal(icon.headers['cache-control'], 'no-cache');
    } finally {
      await app.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('未配置 webRoot 时不接管前端路由', async () => {  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-static-off-'));
  try {
    const app = createApp({ databasePath: path.join(root, 'test.sqlite') });
    await app.ready();
    try {
      const response = await app.inject({ method: 'GET', url: '/' });
      assert.equal(response.statusCode, 404);
      assert.deepEqual(response.json(), { error: '未找到资源' });
    } finally {
      await app.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
