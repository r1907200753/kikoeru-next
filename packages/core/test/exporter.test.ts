import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  EXPORT_COMPLETE_MARKER,
  EXPORT_TMP_DIR,
  ExportQueue,
  createExportJob,
  getExportJob,
  getWorkByCode,
  openDatabase,
  runExportJob,
  scanLibrary,
  updateExportJob,
  type AsmrOneWork,
  type ExportJobState,
  type ExportSource,
  type ExportTrackInfo,
} from '../src/index.js';

const COVER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lW1P0QAAAABJRU5ErkJggg==',
  'base64',
);

const WORK: AsmrOneWork = {
  id: 4242,
  code: 'RJ01426917',
  title: '测试/作品',
  circle: '测试社团',
  releaseDate: '2026-01-01',
  rating: 4.5,
  priceYen: 990,
  reviewCount: 12,
  dlCount: 345,
  tags: ['ASMR', '耳かき'],
  vas: ['声优A'],
  durationMs: 3000,
};

function track(hash: string, title: string, size: number, streamUrl: string): ExportTrackInfo {
  return {
    hash,
    title,
    disc: 1,
    groupTitle: '第一轨',
    durationMs: hash === 'hash-a' ? 1000 : 2000,
    size,
    streamUrl,
  };
}

interface StubAudio {
  bytes: Buffer;
  contentType: string;
}

interface AudioServer {
  base: string;
  requests: Array<{ path: string; range: string }>;
  rateLimit: { remaining: number };
  close: () => Promise<void>;
}

async function startAudioServer(audio: Map<string, StubAudio>): Promise<AudioServer> {
  const requests: AudioServer['requests'] = [];
  const rateLimit = { remaining: 0 };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const range = request.headers.range ?? '';
    requests.push({ path: url.pathname, range });
    if (rateLimit.remaining > 0) {
      rateLimit.remaining -= 1;
      response.writeHead(429, { 'retry-after': '0', 'content-type': 'text/plain' });
      response.end('slow down');
      return;
    }
    const item = audio.get(url.pathname);
    if (!item) {
      response.writeHead(404);
      response.end();
      return;
    }
    const match = /^bytes=(\d+)-$/.exec(range);
    if (match) {
      const start = Number(match[1]);
      if (start >= item.bytes.length) {
        response.writeHead(416, { 'content-range': `bytes */${item.bytes.length}` });
        response.end();
        return;
      }
      response.writeHead(206, {
        'content-type': item.contentType,
        'content-range': `bytes ${start}-${item.bytes.length - 1}/${item.bytes.length}`,
      });
      response.end(item.bytes.subarray(start));
      return;
    }
    response.writeHead(200, {
      'content-type': item.contentType,
      'content-length': String(item.bytes.length),
    });
    response.end(item.bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('测试音频服务启动失败');
  }
  return {
    base: `http://127.0.0.1:${address.port}`,
    requests,
    rateLimit,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function createHttpSource(
  tracks: ExportTrackInfo[],
  files?: ExportTrackInfo[],
): ExportSource {
  return {
    async fetchWorkInfo() {
      return WORK;
    },
    async fetchTracks() {
      return files ? { items: tracks, files } : { items: tracks };
    },
    async fetchCover() {
      return { buffer: COVER_PNG, contentType: 'image/png' };
    },
    async openTrackStream(url, range, signal) {
      const response = await fetch(url, {
        headers: range ? { range } : {},
        signal: signal ?? null,
      });
      if (!response.body) {
        throw new Error('测试响应没有 body');
      }
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      };
    },
  };
}

async function createJob(
  db: ReturnType<typeof openDatabase>,
  rootPath: string,
  hashes: string[] | null = null,
  code = WORK.code,
): Promise<number> {
  return createExportJob(db, {
    remoteWorkId: WORK.id,
    code,
    title: WORK.title,
    targetRootPath: rootPath,
    concurrency: 2,
    hashes,
    work: { ...WORK, code },
  });
}

async function waitFor<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = read();
    if (predicate(value)) {
      return value;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('等待导出状态超时');
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

test('导出完整链路：下载、sidecar、完成标记、原子改名、扫描入库与封面', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-export-'));
  const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-assets-'));
  const audio = new Map<string, StubAudio>([
    ['/audio/a', { bytes: Buffer.from('abcdefgh'), contentType: 'audio/mpeg' }],
    ['/audio/b', { bytes: Buffer.from('12345'), contentType: 'audio/flac' }],
  ]);
  const server = await startAudioServer(audio);
  const source = createHttpSource([
    track('hash-a', '开场/前奏', 8, `${server.base}/audio/a`),
    track('hash-b', '第二轨', 5, `${server.base}/audio/b`),
  ]);
  const db = openDatabase(':memory:');
  try {
    const jobId = await createJob(db, root);
    const job = getExportJob(db, jobId);
    assert.ok(job);
    const result = await runExportJob({
      db,
      job,
      source,
      assetsDir,
      ffmpegPath: 'ffmpeg',
      signal: new AbortController().signal,
      onUpdate: (patch) => updateExportJob(db, jobId, patch),
    });

    assert.equal(result.relativePath, 'RJ01426917 [测试 作品]');
    assert.equal(result.trackCount, 2);
    assert.equal(result.bytes, 13);
    assert.equal(result.cover, 'ok');

    const finalDir = path.join(root, 'RJ01426917 [测试 作品]');
    const entries = await fs.readdir(finalDir);
    const trackEntries = await fs.readdir(path.join(finalDir, 'tracks'));
    assert.ok(trackEntries.includes('01 - 开场 前奏.mp3'));
    assert.ok(trackEntries.includes('02 - 第二轨.flac'));
    assert.ok(entries.includes('cover.png'));
    assert.ok(entries.includes('metadata.json'));
    assert.ok(entries.includes(EXPORT_COMPLETE_MARKER));

    const sidecar = JSON.parse(
      await fs.readFile(path.join(finalDir, 'metadata.json'), 'utf8'),
    ) as { schema: number; tracks: Array<{ file: string; durationMs: number }> };
    assert.equal(sidecar.schema, 1);
    assert.deepEqual(
      sidecar.tracks.map((item) => item.file),
      ['01 - 开场 前奏.mp3', '02 - 第二轨.flac'],
    );

    const work = getWorkByCode(db, 'RJ01426917');
    assert.ok(work);
    assert.equal(work.title, '测试/作品');
    assert.equal(work.circle, '测试社团');
    assert.equal(work.metadataStatus, 'sidecar');
    assert.equal(work.tracks.length, 2);
    assert.deepEqual(
      work.tracks.map((item) => item.title),
      ['开场 前奏', '第二轨'],
    );
    assert.deepEqual(
      work.tracks.map((item) => item.durationMs),
      [1000, 2000],
    );
    assert.ok(work.coverAssetId);

    const saved = getExportJob(db, jobId);
    assert.equal(saved?.trackCompleted, 2);
    assert.equal(saved?.progress, 1);
    await assert.rejects(fs.access(path.join(root, EXPORT_TMP_DIR, `export-${jobId}`)));
  } finally {
    db.close();
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(assetsDir, { recursive: true, force: true });
  }
});

test('导出完整文件树：保留文件夹并只把音频写入曲库', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-export-tree-'));
  const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-assets-'));
  const server = await startAudioServer(
    new Map([
      ['/media/audio', { bytes: Buffer.from('abcdefgh'), contentType: 'audio/wav' }],
      ['/media/text', { bytes: Buffer.from('hello'), contentType: 'text/plain' }],
    ]),
  );
  const audioFile: ExportTrackInfo = {
    ...track('hash-a', '01 开场.wav', 8, `${server.base}/media/audio`),
    type: 'audio',
    relativePath: '正式版/01 开场.wav',
  };
  const textFile: ExportTrackInfo = {
    hash: 'hash-t',
    title: '台本.txt',
    disc: 1,
    groupTitle: '台本',
    durationMs: null,
    size: 5,
    streamUrl: `${server.base}/media/text`,
    type: 'text',
    relativePath: '台本/台本.txt',
  };
  const db = openDatabase(':memory:');
  try {
    const jobId = await createJob(db, root);
    const job = getExportJob(db, jobId);
    assert.ok(job);
    const result = await runExportJob({
      db,
      job,
      source: createHttpSource([audioFile], [audioFile, textFile]),
      assetsDir,
      ffmpegPath: 'ffmpeg',
      signal: new AbortController().signal,
      onUpdate: (patch) => updateExportJob(db, jobId, patch),
    });

    assert.equal(result.trackCount, 2);
    assert.equal(result.audioCount, 1);
    assert.equal(result.bytes, 13);
    assert.equal(result.cover, 'ok');

    const finalDir = path.join(root, 'RJ01426917 [测试 作品]');
    assert.equal(
      (await fs.readFile(path.join(finalDir, '正式版', '01 开场.wav'))).toString(),
      'abcdefgh',
    );
    assert.equal(
      (await fs.readFile(path.join(finalDir, '台本', '台本.txt'))).toString(),
      'hello',
    );
    await assert.rejects(fs.access(path.join(finalDir, 'tracks')));

    const sidecar = JSON.parse(
      await fs.readFile(path.join(finalDir, 'metadata.json'), 'utf8'),
    ) as { tracks: Array<{ file: string }> };
    assert.deepEqual(
      sidecar.tracks.map((item) => item.file),
      ['01 开场.wav'],
    );
    assert.equal(getWorkByCode(db, 'RJ01426917')?.tracks.length, 1);
  } finally {
    db.close();
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(assetsDir, { recursive: true, force: true });
  }
});

test('断点续传会从 .part 文件继续并使用 Range', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-export-resume-'));
  const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-assets-'));
  const server = await startAudioServer(
    new Map([['/audio/a', { bytes: Buffer.from('abcdefgh'), contentType: 'audio/mpeg' }]]),
  );
  const db = openDatabase(':memory:');
  try {
    const jobId = await createJob(db, root, ['hash-a']);
    const tracksDir = path.join(root, EXPORT_TMP_DIR, `export-${jobId}`, 'work', 'tracks');
    await fs.mkdir(tracksDir, { recursive: true });
    await fs.writeFile(
      path.join(tracksDir, '01 - 开场 前奏.mp3.part'),
      Buffer.from('abc'),
    );
    const state: ExportJobState = {
      phase: 'download',
      tracks: {
        'hash-a': {
          hash: 'hash-a',
          order: 1,
          index: 1,
          title: '开场/前奏',
          groupTitle: '第一轨',
          disc: 1,
          size: 8,
          durationMs: 1000,
          bytes: 3,
          ext: '',
          partFile: '01 - 开场 前奏.mp3.part',
          file: '',
          status: 'pending',
          error: '',
        },
      },
    };
    updateExportJob(db, jobId, { state });
    const job = getExportJob(db, jobId);
    assert.ok(job);
    const result = await runExportJob({
      db,
      job,
      source: createHttpSource([
        track('hash-a', '开场/前奏', 8, `${server.base}/audio/a`),
      ]),
      assetsDir,
      ffmpegPath: 'ffmpeg',
      signal: new AbortController().signal,
      onUpdate: (patch) => updateExportJob(db, jobId, patch),
    });

    assert.equal(server.requests[0]?.range, 'bytes=3-');
    assert.ok(server.requests[0]?.path === '/audio/a');
    const finalFile = path.join(
      root,
      result.relativePath,
      'tracks',
      '01 - 开场 前奏.mp3',
    );
    assert.equal((await fs.readFile(finalFile)).toString(), 'abcdefgh');
    assert.equal(result.bytes, 8);
  } finally {
    db.close();
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(assetsDir, { recursive: true, force: true });
  }
});

test('遇到 429 会按 Retry-After 重试后继续下载', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-export-429-'));
  const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-assets-'));
  const server = await startAudioServer(
    new Map([['/audio/a', { bytes: Buffer.from('abcdefgh'), contentType: 'audio/mpeg' }]]),
  );
  server.rateLimit.remaining = 2;
  const db = openDatabase(':memory:');
  try {
    const jobId = await createJob(db, root, ['hash-a']);
    const job = getExportJob(db, jobId);
    assert.ok(job);
    const result = await runExportJob({
      db,
      job,
      source: createHttpSource([
        track('hash-a', '开场/前奏', 8, `${server.base}/audio/a`),
      ]),
      assetsDir,
      ffmpegPath: 'ffmpeg',
      signal: new AbortController().signal,
      onUpdate: (patch) => updateExportJob(db, jobId, patch),
    });
    assert.equal(server.requests.length, 3);
    assert.equal(result.bytes, 8);
    assert.equal(getWorkByCode(db, 'RJ01426917')?.tracks.length, 1);
  } finally {
    db.close();
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(assetsDir, { recursive: true, force: true });
  }
});

test('本地库已有相同番号时拒绝导出', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-export-dup-'));
  const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-assets-'));
  const db = openDatabase(':memory:');
  try {
    const existingDir = path.join(root, 'RJ01426917 已有作品');
    await fs.mkdir(existingDir, { recursive: true });
    await fs.writeFile(path.join(existingDir, '01.mp3'), Buffer.from('x'));
    await scanLibrary({ db, rootPath: root });

    const unusedSource: ExportSource = {
      async fetchWorkInfo() {
        throw new Error('不应拉取作品信息');
      },
      async fetchTracks() {
        throw new Error('不应拉取音轨');
      },
      async fetchCover() {
        throw new Error('不应拉取封面');
      },
      async openTrackStream() {
        throw new Error('不应下载音轨');
      },
    };
    const jobId = await createJob(db, root);
    const job = getExportJob(db, jobId);
    assert.ok(job);
    await assert.rejects(
      runExportJob({
        db,
        job,
        source: unusedSource,
        assetsDir,
        ffmpegPath: 'ffmpeg',
        signal: new AbortController().signal,
        onUpdate: () => undefined,
      }),
      /本地库已存在 RJ01426917/,
    );
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(assetsDir, { recursive: true, force: true });
  }
});

test('导出队列支持暂停、继续与取消排队任务', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-export-queue-'));
  const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-assets-'));
  const db = openDatabase(':memory:');
  let callCount = 0;
  const media = Buffer.from('abcdefgh');
  const tracks: ExportTrackInfo[] = [
    {
      hash: 'hash-a',
      title: '开场/前奏',
      disc: 1,
      groupTitle: '第一轨',
      durationMs: 1000,
      size: media.length,
      streamUrl: 'stub://audio/a',
    },
  ];
  const source: ExportSource = {
    async fetchWorkInfo() {
      return WORK;
    },
    async fetchTracks() {
      return { items: tracks };
    },
    async fetchCover() {
      return { buffer: COVER_PNG, contentType: 'image/png' };
    },
    async openTrackStream(_url, _range, signal) {
      callCount += 1;
      if (callCount === 1) {
        let sent = false;
        const stream = new Readable({
          read() {
            if (sent) {
              return;
            }
            sent = true;
            this.push(media.subarray(0, 3));
          },
        });
        const onAbort = () => stream.destroy(new Error('aborted'));
        signal?.addEventListener('abort', onAbort, { once: true });
        stream.on('close', () => signal?.removeEventListener('abort', onAbort));
        return {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
          body: stream,
        };
      }
      return {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
        body: Readable.from([media]),
      };
    },
  };
  const queue = new ExportQueue({
    db,
    getSource: () => source,
    assetsDir,
    getFfmpegPath: () => 'ffmpeg',
  });
  try {
    const firstJobId = await createJob(db, root, ['hash-a']);
    queue.start();
    await waitFor(() => callCount, (value) => value === 1);
    await waitFor(() => getExportJob(db, firstJobId)?.status, (value) => value === 'running');

    queue.pause(firstJobId);
    await waitFor(() => getExportJob(db, firstJobId)?.status, (value) => value === 'paused');

    queue.resume(firstJobId);
    const done = await waitFor(
      () => getExportJob(db, firstJobId),
      (value) => value?.status === 'done',
    );
    assert.equal(done?.progress, 1);
    assert.equal(getWorkByCode(db, 'RJ01426917')?.tracks.length, 1);

    const queuedJobId = await createJob(db, root, ['hash-a'], 'RJ01426918');
    await queue.cancel(queuedJobId);
    const cancelled = getExportJob(db, queuedJobId);
    assert.equal(cancelled?.status, 'cancelled');
    assert.equal(cancelled?.progress, 0);
  } finally {
    await queue.shutdown();
    db.close();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(assetsDir, { recursive: true, force: true });
  }
});
