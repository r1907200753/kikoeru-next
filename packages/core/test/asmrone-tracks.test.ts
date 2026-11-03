import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AsmrOneProvider } from '../src/index.js';

test('ASMR.one 文件树保留非音频节点并生成完整文件列表', async () => {
  const payload = [
    {
      type: 'folder',
      title: '正式版',
      children: [
        {
          type: 'audio',
          hash: 'audio-hash',
          title: '01 开场.wav',
          mediaStreamUrl: 'https://media.example.test/stream/01.wav',
          mediaDownloadUrl: 'https://download.example.test/01.wav',
          duration: 1.5,
          size: 10,
        },
        {
          type: 'text',
          hash: 'text-hash',
          title: '台本.txt',
          mediaStreamUrl: 'https://media.example.test/stream/台本.txt',
          mediaDownloadUrl: 'https://download.example.test/台本.txt',
          size: 5,
        },
      ],
    },
  ];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/api/works') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ works: [] }));
      return;
    }
    if (url.pathname === '/api/tracks/4242') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('测试服务启动失败');
  }
  const provider = new AsmrOneProvider({
    baseUrl: `http://127.0.0.1:${address.port}`,
    minIntervalMs: 0,
    timeoutMs: 5_000,
  });
  try {
    const result = await provider.fetchTracks(4242);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.title, '01 开场.wav');
    assert.equal(result.files.length, 2);
    assert.deepEqual(
      result.files.map((file) => [file.type, file.relativePath]),
      [
        ['audio', '正式版/01 开场.wav'],
        ['text', '正式版/台本.txt'],
      ],
    );
    assert.equal(result.files[1]?.size, 5);
    assert.equal(result.files[1]?.downloadUrl, 'https://download.example.test/台本.txt');
    assert.equal(result.tree[0]?.type, 'folder');
    assert.deepEqual(
      result.tree[0]?.children?.map((node) => node.type),
      ['audio', 'text'],
    );
  } finally {
    await provider.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('ASMR.one 进度标记读取与写入使用源站 review 接口', async () => {
  let reviewBody = '';
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/api/works') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ works: [] }));
      return;
    }
    if (url.pathname === '/api/work/4242' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 4242,
          userRating: 4.5,
          progress: 'listening',
          review_text: 'メモ',
        }),
      );
      return;
    }
    if (url.pathname === '/api/review' && request.method === 'PUT') {
      request.on('data', (chunk) => {
        reviewBody += chunk.toString();
      });
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: 'ok' }));
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('测试服务启动失败');
  }
  const provider = new AsmrOneProvider({
    baseUrl: `http://127.0.0.1:${address.port}`,
    minIntervalMs: 0,
    timeoutMs: 5_000,
  });
  try {
    const state = await provider.fetchWorkUserState(4242);
    assert.deepEqual(state, {
      userRating: 4.5,
      progress: 'listening',
      reviewText: 'メモ',
    });
    await provider.setReviewProgress(4242, state!, 'replay');
    assert.deepEqual(JSON.parse(reviewBody), {
      work_id: 4242,
      rating: 4.5,
      review_text: 'メモ',
      progress: 'replay',
    });
  } finally {
    await provider.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('ASMR.one 语言版本过滤未入库的空白版本', async () => {
  const payload = {
    id: 4242,
    workno: 'RJ01194525',
    title: '日本語作品',
    translation_info: { lang: 'ja', is_original: true },
    language_editions: [
      { workno: 'RJ01194526', label: '簡体中文' },
      { workno: 'RJ01194527', label: 'English' },
      { workno: 'RJ01194528', label: '한국어' },
    ],
    other_language_editions_in_db: [
      {
        source_id: 'RJ01194526',
        lang: 'zh-cn',
        title: '简体中文作品',
        is_original: false,
      },
    ],
  };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/api/works') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ works: [] }));
      return;
    }
    if (url.pathname === '/api/workInfo/RJ01194525') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('测试服务启动失败');
  }
  const provider = new AsmrOneProvider({
    baseUrl: `http://127.0.0.1:${address.port}`,
    minIntervalMs: 0,
    timeoutMs: 5_000,
  });
  try {
    const work = await provider.fetchWorkInfo('RJ01194525');
    assert.deepEqual(
      work.languageEditions?.map((edition) => [edition.code, edition.label, edition.title]),
      [
        ['RJ01194525', '日本語', '日本語作品'],
        ['RJ01194526', '簡体中文', '简体中文作品'],
      ],
    );
  } finally {
    await provider.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
