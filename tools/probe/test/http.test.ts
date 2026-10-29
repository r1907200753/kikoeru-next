import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpClient, redactText, redactUrl } from '../src/http.js';

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/json') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, method: request.method }));
    return;
  }
  if (url.pathname === '/redirect') {
    response.writeHead(302, { location: '/json' });
    response.end();
    return;
  }
  if (url.pathname === '/range') {
    const bytes = Buffer.alloc(256, 0x61);
    response.writeHead(206, {
      'content-type': 'application/octet-stream',
      'content-range': 'bytes 0-63/256',
    });
    response.end(bytes.subarray(0, 64));
    return;
  }
  if (url.pathname === '/large') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end(Buffer.alloc(10_000, 0x61));
    return;
  }
  response.writeHead(404);
  response.end('not found');
});

await new Promise<void>((resolve) => {
  server.listen(0, '127.0.0.1', resolve);
});
const port = (server.address() as AddressInfo).port;
const baseUrl = `http://127.0.0.1:${port}`;
const client = new HttpClient({ proxy: '' });

after(async () => {
  await client.close();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('请求 JSON 并跟随重定向', async () => {
  const response = await client.request(`${baseUrl}/redirect`);
  assert.equal(response.status, 200);
  assert.equal(response.redirected, true);
  assert.deepEqual(JSON.parse(response.text), { ok: true, method: 'GET' });
});

test('POST 遇到 302 后改为 GET 并丢弃请求体', async () => {
  const response = await client.request(`${baseUrl}/redirect`, {
    method: 'POST',
    body: 'hello',
    headers: { 'content-type': 'text/plain' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.text), { ok: true, method: 'GET' });
});

test('getPrefix 发送 Range 并识别 206', async () => {
  const response = await client.getPrefix(`${baseUrl}/range`, 64);
  assert.equal(response.status, 206);
  assert.equal(response.rangeHonored, true);
  assert.equal(response.body.length, 64);
  assert.equal(response.headers['content-range'], 'bytes 0-63/256');
});

test('超过 maxBytes 时截断并标记', async () => {
  const response = await client.request(`${baseUrl}/large`, { maxBytes: 100 });
  assert.equal(response.status, 200);
  assert.equal(response.body.length, 100);
  assert.equal(response.truncated, true);
});

test('redactUrl 与 redactText 不泄露凭据和 token', () => {
  const url = redactUrl('https://user:pass@example.test/api?token=secret&foo=1');
  assert.ok(!url.includes('pass'));
  assert.ok(!url.includes('secret'));
  assert.ok(url.includes('foo=1'));

  const text = redactText('proxy=http://user:pass@127.0.0.1:7890&token=abc');
  assert.ok(!text.includes('pass'));
  assert.ok(!text.includes('abc'));
});
