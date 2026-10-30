import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpClient } from '../src/http.js';
import { runWebDavProbes } from '../src/webdav.js';

interface VirtualEntry {
  directory: boolean;
  body: Buffer;
}

const entries = new Map<string, VirtualEntry>([
  ['/dav', { directory: true, body: Buffer.alloc(0) }],
  ['/dav/RJ01426915', { directory: true, body: Buffer.alloc(0) }],
  ['/dav/RJ01426915/テスト.mp3', { directory: false, body: Buffer.alloc(4096, 0x62) }],
]);

function normalizePath(pathname: string): string {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // 保持原样
  }
  return decoded.replace(/\/+$/, '') || '/';
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hrefFor(path: string, directory: boolean): string {
  const encoded = encodeURI(path);
  return directory && !encoded.endsWith('/') ? `${encoded}/` : encoded;
}

function multiStatus(root: string): string {
  const children = [...entries.keys()].filter((path) => {
    if (path === root) {
      return false;
    }
    const prefix = root === '/' ? '/' : `${root}/`;
    return path.startsWith(prefix) && !path.slice(prefix.length).includes('/');
  });
  const paths = [root, ...children];
  const responses = paths.map((path) => {
    const entry = entries.get(path);
    const directory = entry?.directory ?? false;
    return `<D:response>
      <D:href>${escapeXml(hrefFor(path, directory))}</D:href>
      <D:propstat>
        <D:prop>
          <D:resourcetype>${directory ? '<D:collection/>' : ''}</D:resourcetype>
          <D:getcontentlength>${entry?.body.length ?? 0}</D:getcontentlength>
        </D:prop>
        <D:status>HTTP/1.1 200 OK</D:status>
      </D:propstat>
    </D:response>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${responses.join('')}</D:multistatus>`;
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function rangeOf(header: string | undefined, total: number): { start: number; end: number } | null {
  const match = /^bytes=(\d+)-(\d*)$/.exec(header ?? '');
  if (!match) {
    return null;
  }
  const start = Number.parseInt(match[1] ?? '0', 10);
  const end = match[2] ? Number.parseInt(match[2], 10) : total - 1;
  return { start, end: Math.min(end, total - 1) };
}

let mkcolSupported = true;
let writeReadonly = false;

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const path = normalizePath(url.pathname);

  if (request.method === 'PROPFIND') {
    if (!entries.has(path)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(207, { 'content-type': 'application/xml; charset=utf-8' });
    response.end(multiStatus(path));
    return;
  }

  if (request.method === 'PUT') {
    if (writeReadonly) {
      response.writeHead(501);
      response.end();
      return;
    }
    entries.set(path, { directory: false, body: await readRequestBody(request) });
    response.writeHead(201);
    response.end();
    return;
  }

  if (request.method === 'MKCOL') {
    if (!mkcolSupported) {
      response.writeHead(501);
      response.end();
      return;
    }
    entries.set(path, { directory: true, body: Buffer.alloc(0) });
    response.writeHead(201);
    response.end();
    return;
  }

  if (request.method === 'MOVE') {
    const source = entries.get(path);
    if (!source) {
      response.writeHead(404);
      response.end();
      return;
    }
    const destination = request.headers.destination;
    if (!destination) {
      response.writeHead(400);
      response.end();
      return;
    }
    const destinationPath = normalizePath(new URL(destination).pathname);
    entries.delete(path);
    entries.set(destinationPath, source);
    response.writeHead(201);
    response.end();
    return;
  }

  if (request.method === 'DELETE') {
    entries.delete(path);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === 'GET') {
    const entry = entries.get(path);
    if (!entry || entry.directory) {
      response.writeHead(404);
      response.end();
      return;
    }
    const range = rangeOf(request.headers.range, entry.body.length);
    if (range) {
      const slice = entry.body.subarray(range.start, range.end + 1);
      response.writeHead(206, {
        'content-type': 'audio/mpeg',
        'content-range': `bytes ${range.start}-${range.end}/${entry.body.length}`,
      });
      response.end(slice);
      return;
    }
    response.writeHead(200, { 'content-type': 'audio/mpeg' });
    response.end(entry.body);
    return;
  }

  response.writeHead(405);
  response.end();
});

await new Promise<void>((resolve) => {
  server.listen(0, '127.0.0.1', resolve);
});
const port = (server.address() as AddressInfo).port;
const baseUrl = `http://127.0.0.1:${port}/dav`;
const client = new HttpClient({ proxy: '' });

after(async () => {
  await client.close();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('WebDAV 探针完成 PROPFIND、Range、写入、MOVE、中文名与清理', async () => {
  const results = await runWebDavProbes(client, {
    baseUrl,
    username: '',
    password: '',
    rootPath: '/',
    timeoutMs: 5000,
    writeTest: true,
  });

  assert.deepEqual(
    results.map((result) => result.name),
    ['webdav.propfind', 'webdav.range', 'webdav.write_test'],
  );
  for (const result of results) {
    assert.equal(result.status, 'pass', `${result.name}: ${result.summary}`);
  }

  const leftovers = [...entries.keys()].filter((path) => path.includes('kikoeru-next-probe'));
  assert.deepEqual(leftovers, []);
});

test('WebDAV 不支持 MKCOL 时回退到根目录写入', async () => {
  mkcolSupported = false;
  try {
    const results = await runWebDavProbes(client, {
      baseUrl,
      username: '',
      password: '',
      rootPath: '/',
      timeoutMs: 5000,
      writeTest: true,
    });

    const write = results.find((result) => result.name === 'webdav.write_test');
    assert.equal(write?.status, 'pass', write?.summary);
    assert.match(write?.summary ?? '', /不支持 MKCOL/);
    const details = write?.details as { mode?: string; mkcolStatus?: number } | undefined;
    assert.equal(details?.mode, 'root');
    assert.equal(details?.mkcolStatus, 501);

    const leftovers = [...entries.keys()].filter((path) => path.includes('kikoeru-next-probe'));
    assert.deepEqual(leftovers, []);
  } finally {
    mkcolSupported = true;
  }
});

test('WebDAV 只读时不把写入失败判为探针异常', async () => {
  mkcolSupported = false;
  writeReadonly = true;
  try {
    const results = await runWebDavProbes(client, {
      baseUrl,
      username: '',
      password: '',
      rootPath: '/',
      timeoutMs: 5000,
      writeTest: true,
    });

    const write = results.find((result) => result.name === 'webdav.write_test');
    assert.equal(write?.status, 'skip', write?.summary);
    assert.match(write?.summary ?? '', /导出请使用本地挂载盘/);
  } finally {
    mkcolSupported = true;
    writeReadonly = false;
  }
});
