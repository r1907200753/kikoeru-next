import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { AsmrOneWork, ExportSource } from '@kikoeru-next/core';
import { createApp } from '../src/app.js';

const COVER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface ExportJobBody {
  id: number;
  code: string;
  status: string;
  progress: number;
  phase: string;
  trackTotal: number;
  trackCompleted: number;
  targetRelativePath: string;
  error: string;
  tracks: Array<{ title: string; status: string; bytes: number }>;
  result: {
    relativePath: string;
    trackCount: number;
    bytes: number;
    cover: string;
  } | null;
}

async function waitForExportDone(
  app: ReturnType<typeof createApp>,
  jobId: number,
): Promise<ExportJobBody> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: 'GET', url: `/api/export/jobs/${jobId}` });
    assert.equal(response.statusCode, 200);
    const job = response.json<ExportJobBody>();
    if (job.status === 'done') {
      return job;
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new Error(`导出任务 ${job.status}：${job.error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('等待导出任务完成超时');
}

test('扫描、作品详情、Range 流与续播', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-api-'));
  const dataDir = path.join(root, 'data');
  try {
    const workDir = path.join(root, 'RJ01426915 测试作品');
    await fs.mkdir(path.join(workDir, '特典'), { recursive: true });
    await fs.writeFile(path.join(workDir, '01 - 开场.mp3'), Buffer.from('0123456789'));
    await fs.writeFile(path.join(workDir, '02 - 第二轨.mp3'), Buffer.from('abcdefghij'));
    await fs.writeFile(path.join(workDir, '特典', '封面.jpg'), Buffer.from('jpegdata'));
    await fs.writeFile(path.join(workDir, '特典', 'PV.mp4'), Buffer.from('mp4data'));
    await fs.writeFile(
      path.join(workDir, '字幕.vtt'),
      Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\nhello\n'),
    );
    await fs.writeFile(path.join(workDir, 'notes.ass'), Buffer.from('[Script Info]\n'));
    await fs.writeFile(path.join(workDir, 'readme.pdf'), Buffer.from('%PDF'));
    await fs.writeFile(path.join(workDir, '.DS_Store'), Buffer.from('junk'));

    const app = createApp({
      databasePath: path.join(dataDir, 'test.sqlite'),
      libraryPath: root,
    });
    await app.ready();
    try {
      const scan = await app.inject({
        method: 'POST',
        url: '/api/scan',
        payload: { rootPath: root },
      });
      assert.equal(scan.statusCode, 200);
      const scanBody = scan.json<{ worksFound: number; tracksFound: number }>();
      assert.equal(scanBody.worksFound, 1);
      assert.equal(scanBody.tracksFound, 2);

      const list = await app.inject({ method: 'GET', url: '/api/works?limit=10' });
      assert.equal(list.statusCode, 200);
      const listBody = list.json<{
        total: number;
        items: Array<{ code: string; title: string; trackCount: number }>;
      }>();
      assert.equal(listBody.total, 1);
      assert.equal(listBody.items[0]?.code, 'RJ01426915');
      assert.equal(listBody.items[0]?.title, '测试作品');
      assert.equal(listBody.items[0]?.trackCount, 2);

      const detail = await app.inject({ method: 'GET', url: '/api/works/RJ01426915' });
      assert.equal(detail.statusCode, 200);
      const detailBody = detail.json<{
        id: number;
        tracks: Array<{ id: number; title: string }>;
      }>();
      assert.equal(detailBody.tracks.length, 2);
      const firstTrack = detailBody.tracks[0];
      assert.ok(firstTrack);
      assert.equal(firstTrack.title, '开场');

      const files = await app.inject({
        method: 'GET',
        url: '/api/works/RJ01426915/files',
      });
      assert.equal(files.statusCode, 200);
      const filesBody = files.json<{
        code: string;
        truncated: boolean;
        files: Array<{
          path: string;
          kind: string;
          trackId: number | null;
        }>;
      }>();
      assert.equal(filesBody.code, 'RJ01426915');
      assert.equal(filesBody.truncated, false);
      const fileByPath = new Map(filesBody.files.map((file) => [file.path, file]));
      assert.equal(fileByPath.get('特典/封面.jpg')?.kind, 'image');
      assert.equal(fileByPath.get('特典/PV.mp4')?.kind, 'video');
      assert.equal(fileByPath.get('字幕.vtt')?.kind, 'subtitle');
      assert.equal(fileByPath.get('notes.ass')?.kind, 'subtitle');
      assert.equal(fileByPath.get('readme.pdf')?.kind, 'other');
      assert.ok(fileByPath.get('01 - 开场.mp3')?.trackId);
      assert.ok(!fileByPath.has('.DS_Store'));

      const imageFile = await app.inject({
        method: 'GET',
        url: `/api/works/RJ01426915/file?path=${encodeURIComponent('特典/封面.jpg')}`,
      });
      assert.equal(imageFile.statusCode, 200);
      assert.equal(imageFile.headers['content-type'], 'image/jpeg');
      assert.equal(imageFile.rawPayload.toString(), 'jpegdata');

      const fileRange = await app.inject({
        method: 'GET',
        url: `/api/works/RJ01426915/file?path=${encodeURIComponent('01 - 开场.mp3')}`,
        headers: { range: 'bytes=2-5' },
      });
      assert.equal(fileRange.statusCode, 206);
      assert.equal(fileRange.headers['content-range'], 'bytes 2-5/10');
      assert.equal(fileRange.rawPayload.toString(), '2345');

      const traversal = await app.inject({
        method: 'GET',
        url: `/api/works/RJ01426915/file?path=${encodeURIComponent('../secret.txt')}`,
      });
      assert.equal(traversal.statusCode, 404);
      const emptyPath = await app.inject({
        method: 'GET',
        url: '/api/works/RJ01426915/file?path=',
      });
      assert.equal(emptyPath.statusCode, 400);
      const missingWorkFiles = await app.inject({
        method: 'GET',
        url: '/api/works/RJ00000000/files',
      });
      assert.equal(missingWorkFiles.statusCode, 404);

      const badScrapeSource = await app.inject({
        method: 'POST',
        url: '/api/works/RJ01426915/scrape',
        payload: { source: 'unknown' },
      });
      assert.equal(badScrapeSource.statusCode, 400);

      const remoteOpenFolder = await app.inject({
        method: 'POST',
        url: '/api/works/RJ01426915/open-folder',
        remoteAddress: '192.168.1.20',
      });
      assert.equal(remoteOpenFolder.statusCode, 403);
      const missingOpenFolder = await app.inject({
        method: 'POST',
        url: '/api/works/RJ00000000/open-folder',
      });
      assert.equal(missingOpenFolder.statusCode, 404);

      const full = await app.inject({
        method: 'GET',
        url: `/api/tracks/${firstTrack.id}/stream`,
      });
      assert.equal(full.statusCode, 200);
      assert.equal(full.headers['accept-ranges'], 'bytes');
      assert.equal(full.headers['content-type'], 'audio/mpeg');
      assert.equal(full.rawPayload.toString(), '0123456789');

      const range = await app.inject({
        method: 'GET',
        url: `/api/tracks/${firstTrack.id}/stream`,
        headers: { range: 'bytes=2-5' },
      });
      assert.equal(range.statusCode, 206);
      assert.equal(range.headers['content-range'], 'bytes 2-5/10');
      assert.equal(range.rawPayload.toString(), '2345');

      const suffix = await app.inject({
        method: 'GET',
        url: `/api/tracks/${firstTrack.id}/stream`,
        headers: { range: 'bytes=-3' },
      });
      assert.equal(suffix.statusCode, 206);
      assert.equal(suffix.rawPayload.toString(), '789');

      const invalid = await app.inject({
        method: 'GET',
        url: `/api/tracks/${firstTrack.id}/stream`,
        headers: { range: 'bytes=99-' },
      });
      assert.equal(invalid.statusCode, 416);
      assert.equal(invalid.headers['content-range'], 'bytes */10');

      const head = await app.inject({
        method: 'HEAD',
        url: `/api/tracks/${firstTrack.id}/stream`,
      });
      assert.equal(head.statusCode, 200);
      assert.equal(head.headers['accept-ranges'], 'bytes');
      assert.equal(head.rawPayload.length, 0);

      const save = await app.inject({
        method: 'PUT',
        url: '/api/playback',
        payload: { workId: detailBody.id, trackId: firstTrack.id, positionMs: 1234 },
      });
      assert.equal(save.statusCode, 200);
      const playback = await app.inject({
        method: 'GET',
        url: `/api/playback/${detailBody.id}`,
      });
      assert.equal(playback.statusCode, 200);
      const playbackBody = playback.json<{ trackId: number | null; positionMs: number }>();
      assert.equal(playbackBody.trackId, firstTrack.id);
      assert.equal(playbackBody.positionMs, 1234);

      const recent = await app.inject({ method: 'GET', url: '/api/playback/recent' });
      assert.equal(recent.statusCode, 200);
      const recentBody = recent.json<{
        items: Array<{ code: string; trackId: number; positionMs: number; trackTitle: string }>;
      }>();
      assert.equal(recentBody.items.length, 1);
      assert.equal(recentBody.items[0]?.code, 'RJ01426915');
      assert.equal(recentBody.items[0]?.trackId, firstTrack.id);
      assert.equal(recentBody.items[0]?.positionMs, 1234);
      assert.equal(recentBody.items[0]?.trackTitle, '开场');

      const reset = await app.inject({
        method: 'PUT',
        url: '/api/playback',
        payload: { workId: detailBody.id, trackId: firstTrack.id, positionMs: 0 },
      });
      assert.equal(reset.statusCode, 200);
      const recentReset = await app.inject({ method: 'GET', url: '/api/playback/recent' });
      const resetBody = recentReset.json<{ items: Array<{ positionMs: number }> }>();
      assert.equal(resetBody.items.length, 1);
      assert.equal(resetBody.items[0]?.positionMs, 0);

      const missing = await app.inject({ method: 'GET', url: '/api/tracks/99999/stream' });
      assert.equal(missing.statusCode, 404);
    } finally {
      await app.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('设置读写、任务与资产接口的参数校验', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-settings-'));
  const dataDir = path.join(root, 'data');
  try {
    const app = createApp({
      databasePath: path.join(dataDir, 'test.sqlite'),
      dataDir,
      libraryPath: root,
    });
    await app.ready();
    try {
      const initial = await app.inject({ method: 'GET', url: '/api/settings' });
      assert.equal(initial.statusCode, 200);
      const initialBody = initial.json<{ libraryPath: string; ffprobePath: string }>();
      assert.equal(initialBody.libraryPath, root);
      assert.equal(initialBody.ffprobePath, 'ffprobe');

      const save = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { proxyUrl: 'http://127.0.0.1:7890', ffmpegPath: 'D:/ffmpeg/bin/ffmpeg.exe' },
      });
      assert.equal(save.statusCode, 200);
      const saved = save.json<{ proxyUrl: string; ffmpegPath: string }>();
      assert.equal(saved.proxyUrl, 'http://127.0.0.1:7890');
      assert.equal(saved.ffmpegPath, 'D:/ffmpeg/bin/ffmpeg.exe');

      const invalid = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { libraryPath: 123 },
      });
      assert.equal(invalid.statusCode, 400);

      const job = await app.inject({ method: 'GET', url: '/api/jobs/999' });
      assert.equal(job.statusCode, 404);
      const badJob = await app.inject({ method: 'GET', url: '/api/jobs/0' });
      assert.equal(badJob.statusCode, 400);

      const asset = await app.inject({ method: 'GET', url: '/api/assets/999' });
      assert.equal(asset.statusCode, 404);

      const badScrape = await app.inject({
        method: 'POST',
        url: '/api/scrape',
        payload: { codes: 'RJ01426915' },
      });
      assert.equal(badScrape.statusCode, 400);

      const emptyScrape = await app.inject({ method: 'POST', url: '/api/scrape', payload: {} });
      assert.equal(emptyScrape.statusCode, 400);
    } finally {
      await app.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('真实 HTTP 监听的 Range 请求返回 206', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-http-'));
  try {
    const workDir = path.join(root, 'RJ01426915 测试作品');
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(path.join(workDir, '01 - 开场.mp3'), Buffer.from('0123456789'));

    const app = createApp({
      databasePath: path.join(root, 'data', 'test.sqlite'),
      libraryPath: root,
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const address = app.server.address();
      assert.ok(address && typeof address === 'object');
      const base = `http://127.0.0.1:${address.port}`;

      const scan = await fetch(`${base}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rootPath: root }),
      });
      assert.equal(scan.status, 200);

      const detail = (await fetch(`${base}/api/works/RJ01426915`).then((response) =>
        response.json(),
      )) as { tracks: Array<{ id: number }> };
      const trackId = detail.tracks[0]?.id;
      assert.ok(trackId);

      const range = await fetch(`${base}/api/tracks/${trackId}/stream`, {
        headers: { Range: 'bytes=1-3' },
      });
      assert.equal(range.status, 206);
      assert.equal(range.headers.get('content-range'), 'bytes 1-3/10');
      assert.equal(range.headers.get('accept-ranges'), 'bytes');
      assert.equal(await range.text(), '123');
    } finally {
      await app.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('标签筛选、随机作品、手动元数据与差分目录排序', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-features-'));
  const dataDir = path.join(root, 'data');
  try {
    const seDir = path.join(root, 'RJ01426916 差分作品', '1.本編', '1.SEあり');
    const noSeDir = path.join(root, 'RJ01426916 差分作品', '1.本編', '2.SEなし');
    await fs.mkdir(seDir, { recursive: true });
    await fs.mkdir(noSeDir, { recursive: true });
    await fs.writeFile(path.join(seDir, '01 - 开场.mp3'), Buffer.from('a'));
    await fs.writeFile(path.join(seDir, '02 - 第二轨.mp3'), Buffer.from('b'));
    await fs.writeFile(path.join(noSeDir, '01 - 开场.mp3'), Buffer.from('c'));
    await fs.writeFile(path.join(noSeDir, '02 - 第二轨.mp3'), Buffer.from('d'));

    const app = createApp({
      databasePath: path.join(dataDir, 'test.sqlite'),
      dataDir,
      libraryPath: root,
    });
    await app.ready();
    try {
      const scan = await app.inject({
        method: 'POST',
        url: '/api/scan',
        payload: { rootPath: root },
      });
      assert.equal(scan.statusCode, 200);

      const detail = await app.inject({ method: 'GET', url: '/api/works/RJ01426916' });
      assert.equal(detail.statusCode, 200);
      const detailBody = detail.json<{ tracks: Array<{ relativePath: string }> }>();
      assert.deepEqual(
        detailBody.tracks.map((track) => track.relativePath.split('/').slice(-2)[0]),
        ['1.SEあり', '1.SEあり', '2.SEなし', '2.SEなし'],
      );

      const patch = await app.inject({
        method: 'PATCH',
        url: '/api/works/RJ01426916',
        payload: { tags: ['ASMR', '耳かき', 'ASMR'], rating: 4.5, priceYen: 990, vas: ['テスト'] },
      });
      assert.equal(patch.statusCode, 200);
      const patched = patch.json<{
        metadataStatus: string;
        tags: string[];
        rating: number;
        priceYen: number;
        vas: string[];
      }>();
      assert.equal(patched.metadataStatus, 'manual');
      assert.deepEqual(patched.tags, ['ASMR', '掏耳']);
      assert.equal(patched.rating, 4.5);
      assert.equal(patched.priceYen, 990);
      assert.deepEqual(patched.vas, ['テスト']);

      const byTag = await app.inject({ method: 'GET', url: '/api/works?tag=ASMR' });
      assert.equal(byTag.statusCode, 200);
      const byTagBody = byTag.json<{ total: number; items: Array<{ code: string }> }>();
      assert.equal(byTagBody.total, 1);
      assert.equal(byTagBody.items[0]?.code, 'RJ01426916');

      const missingTag = await app.inject({
        method: 'GET',
        url: `/api/works?tag=${encodeURIComponent('不存在')}`,
      });
      assert.equal(missingTag.json<{ total: number }>().total, 0);

      const random = await app.inject({ method: 'GET', url: '/api/works/random' });
      assert.equal(random.statusCode, 200);
      assert.equal(random.json<{ code: string }>().code, 'RJ01426916');

      const badRating = await app.inject({
        method: 'PATCH',
        url: '/api/works/RJ01426916',
        payload: { rating: 9 },
      });
      assert.equal(badRating.statusCode, 400);
      const badPrice = await app.inject({
        method: 'PATCH',
        url: '/api/works/RJ01426916',
        payload: { priceYen: -1 },
      });
      assert.equal(badPrice.statusCode, 400);
    } finally {
      await app.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('标签组合筛选、随机作品与手动元数据边界', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-filters-'));
  const dataDir = path.join(root, 'data');
  try {
    for (const [dir, files] of [
      ['RJ01426930 标签甲', ['01 - 甲一.mp3', '02 - 甲二.mp3']],
      ['RJ01426931 标签乙', ['01 - 乙.mp3']],
      ['RJ01426932 标签丙', ['01 - 丙.mp3']],
    ] as const) {
      const workDir = path.join(root, dir);
      await fs.mkdir(workDir, { recursive: true });
      for (const file of files) {
        await fs.writeFile(path.join(workDir, file), Buffer.from('x'));
      }
    }

    const app = createApp({
      databasePath: path.join(dataDir, 'test.sqlite'),
      dataDir,
      libraryPath: root,
    });
    await app.ready();
    try {
      const emptyRandom = await app.inject({ method: 'GET', url: '/api/works/random' });
      assert.equal(emptyRandom.statusCode, 404);

      const scan = await app.inject({
        method: 'POST',
        url: '/api/scan',
        payload: { rootPath: root },
      });
      assert.equal(scan.statusCode, 200);
      assert.equal(scan.json<{ worksFound: number }>().worksFound, 3);

      for (const [code, payload] of [
        [
          'RJ01426930',
          {
            tags: ['ASMR', '耳かき', ' ASMR ', ''],
            rating: 4.25,
            priceYen: 1200,
            vas: ['声优A', '声优A'],
          },
        ],
        ['RJ01426931', { tags: ['ASMR', '癒し'], rating: 3 }],
        ['RJ01426932', { tags: ['癒し'] }],
      ] as const) {
        const response = await app.inject({
          method: 'PATCH',
          url: `/api/works/${code}`,
          payload,
        });
        assert.equal(response.statusCode, 200);
      }

      const favorite = await app.inject({
        method: 'PUT',
        url: '/api/works/RJ01426930/favorite',
        payload: { favorite: true },
      });
      assert.equal(favorite.statusCode, 200);

      const byTag = await app.inject({ method: 'GET', url: '/api/works?tag=ASMR' });
      assert.equal(byTag.statusCode, 200);
      const byTagBody = byTag.json<{
        total: number;
        items: Array<{ code: string; tags: string[] }>;
      }>();
      assert.equal(byTagBody.total, 2);
      assert.deepEqual(
        byTagBody.items.map((item) => item.code).sort(),
        ['RJ01426930', 'RJ01426931'],
      );
      assert.deepEqual(
        byTagBody.items.find((item) => item.code === 'RJ01426930')?.tags,
        ['ASMR', '掏耳'],
      );

      const byChineseTag = await app.inject({
        method: 'GET',
        url: `/api/works?tag=${encodeURIComponent('治愈')}`,
      });
      assert.equal(byChineseTag.json<{ total: number }>().total, 2);
      const byJapaneseTag = await app.inject({
        method: 'GET',
        url: `/api/works?tag=${encodeURIComponent('癒し')}`,
      });
      assert.equal(byJapaneseTag.json<{ total: number }>().total, 2);

      const identity = await app.inject({
        method: 'PATCH',
        url: '/api/works/RJ01426930',
        payload: { circle: '测试社团', vas: ['声优A', '声优B'] },
      });
      assert.equal(identity.statusCode, 200);
      const byCircle = await app.inject({
        method: 'GET',
        url: `/api/works?circle=${encodeURIComponent('测试社团')}`,
      });
      assert.equal(byCircle.json<{ total: number }>().total, 1);
      const byVa = await app.inject({
        method: 'GET',
        url: `/api/works?va=${encodeURIComponent('声优A')}`,
      });
      const byVaBody = byVa.json<{ total: number; items: Array<{ code: string }> }>();
      assert.equal(byVaBody.total, 1);
      assert.equal(byVaBody.items[0]?.code, 'RJ01426930');

      const favoriteTag = await app.inject({
        method: 'GET',
        url: '/api/works?tag=ASMR&favorite=1',
      });
      assert.equal(favoriteTag.json<{ total: number }>().total, 1);

      const queryTag = await app.inject({
        method: 'GET',
        url: `/api/works?tag=ASMR&q=${encodeURIComponent('标签乙')}`,
      });
      const queryTagBody = queryTag.json<{ total: number; items: Array<{ code: string }> }>();
      assert.equal(queryTagBody.total, 1);
      assert.equal(queryTagBody.items[0]?.code, 'RJ01426931');

      const pageA = await app.inject({
        method: 'GET',
        url: '/api/works?tag=ASMR&sort=title&limit=1&offset=0',
      });
      const pageB = await app.inject({
        method: 'GET',
        url: '/api/works?tag=ASMR&sort=title&limit=1&offset=1',
      });
      const pageABody = pageA.json<{ total: number; items: Array<{ code: string }> }>();
      const pageBBody = pageB.json<{ total: number; items: Array<{ code: string }> }>();
      assert.equal(pageABody.total, 2);
      assert.equal(pageBBody.total, 2);
      assert.deepEqual(
        [...pageABody.items, ...pageBBody.items].map((item) => item.code).sort(),
        ['RJ01426930', 'RJ01426931'],
      );

      for (let attempt = 0; attempt < 12; attempt += 1) {
        const random = await app.inject({ method: 'GET', url: '/api/works/random' });
        assert.equal(random.statusCode, 200);
        const body = random.json<{ code: string; trackCount: number }>();
        assert.ok(['RJ01426930', 'RJ01426931', 'RJ01426932'].includes(body.code));
        assert.ok(body.trackCount > 0);
      }

      const partial = await app.inject({
        method: 'PATCH',
        url: '/api/works/RJ01426930',
        payload: { title: '手动改标题' },
      });
      assert.equal(partial.statusCode, 200);
      const partialBody = partial.json<{
        title: string;
        tags: string[];
        rating: number;
        priceYen: number;
        metadataStatus: string;
      }>();
      assert.equal(partialBody.title, '手动改标题');
      assert.deepEqual(partialBody.tags, ['ASMR', '掏耳']);
      assert.equal(partialBody.rating, 4.25);
      assert.equal(partialBody.priceYen, 1200);
      assert.equal(partialBody.metadataStatus, 'manual');

      const clearRating = await app.inject({
        method: 'PATCH',
        url: '/api/works/RJ01426930',
        payload: { rating: null },
      });
      assert.equal(clearRating.statusCode, 200);
      assert.equal(clearRating.json<{ rating: number | null }>().rating, null);

      for (const payload of [
        { title: '' },
        { title: 123 },
        { tags: ['ok', 1] },
        { rating: 6 },
        { rating: -1 },
        { priceYen: 1.5 },
        { priceYen: -1 },
        { vas: '声优' },
      ]) {
        const bad = await app.inject({
          method: 'PATCH',
          url: '/api/works/RJ01426930',
          payload,
        });
        assert.equal(bad.statusCode, 400);
      }
      const badCode = await app.inject({
        method: 'PATCH',
        url: '/api/works/XX',
        payload: { title: 'x' },
      });
      assert.equal(badCode.statusCode, 400);
      const missing = await app.inject({
        method: 'PATCH',
        url: '/api/works/RJ01999999',
        payload: { title: 'x' },
      });
      assert.equal(missing.statusCode, 404);

      const detail = await app.inject({ method: 'GET', url: '/api/works/RJ01426931' });
      const detailBody = detail.json<{
        tags: string[];
        rating: number;
        metadataStatus: string;
      }>();
      assert.deepEqual(detailBody.tags, ['ASMR', '治愈']);
      assert.equal(detailBody.rating, 3);
      assert.equal(detailBody.metadataStatus, 'manual');
    } finally {
      await app.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('在线接口错误分类与登录令牌不外泄', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-online-'));
  const dataDir = path.join(root, 'data');
  const state = {
    authStatus: 401,
    authBody: '{"error":"bad credentials"}',
    searchStatus: 200,
    searchBody: '{"works":[]}',
    worksStatus: 200,
    worksBody: '{"works":[],"pagination":{"currentPage":1,"pageSize":20,"totalCount":0}}',
    workInfoStatus: 200,
    workInfoBody: '{}',
    tracksStatus: 200,
    tracksBody: '[]',
    coverStatus: 404,
    coverBody: Buffer.alloc(0),
    reviewStatus: 200,
    reviewBody: '{"works":[],"pagination":{"currentPage":1,"pageSize":2,"totalCount":0}}',
    playlistStatus: 200,
    playlistBody: '{"playlists":[],"pagination":{"currentPage":1,"pageSize":3,"totalCount":0}}',
    playlistMetaStatus: 200,
    playlistMetaBody: '{}',
    playlistWorksStatus: 200,
    playlistWorksBody: '{"works":[],"pagination":{"currentPage":1,"pageSize":3,"totalCount":0}}',
  };
  let reviewQuery = '';
  let playlistQuery = '';
  let stub: ReturnType<typeof createServer> | null = null;
  try {
    stub = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const send = (
        status: number,
        body: string | Buffer,
        contentType = 'application/json',
      ) => {
        response.writeHead(status, {
          'content-type': contentType,
          'content-length': String(Buffer.byteLength(body)),
        });
        response.end(body);
      };
      if (url.pathname === '/api/works') {
        send(state.worksStatus, state.worksBody);
        return;
      }
      if (url.pathname === '/api/auth/me') {
        send(state.authStatus, state.authBody);
        return;
      }
      if (url.pathname.startsWith('/api/search/')) {
        send(state.searchStatus, state.searchBody);
        return;
      }
      if (url.pathname.startsWith('/api/workInfo/')) {
        send(state.workInfoStatus, state.workInfoBody);
        return;
      }
      if (url.pathname.startsWith('/api/tracks/')) {
        send(state.tracksStatus, state.tracksBody);
        return;
      }
      if (url.pathname === '/api/review') {
        reviewQuery = url.search;
        send(state.reviewStatus, state.reviewBody);
        return;
      }
      if (url.pathname === '/api/playlist/get-playlists') {
        playlistQuery = url.search;
        send(state.playlistStatus, state.playlistBody);
        return;
      }
      if (url.pathname === '/api/playlist/get-playlist-metadata') {
        send(state.playlistMetaStatus, state.playlistMetaBody);
        return;
      }
      if (url.pathname === '/api/playlist/get-playlist-works') {
        send(state.playlistWorksStatus, state.playlistWorksBody);
        return;
      }
      if (url.pathname.startsWith('/api/cover/')) {
        send(state.coverStatus, state.coverBody, 'image/png');
        return;
      }
      send(404, '{"error":"unknown stub route"}');
    });
    await new Promise<void>((resolve) => {
      stub?.listen(0, '127.0.0.1', resolve);
    });
    const address = stub.address();
    assert.ok(address && typeof address === 'object');
    const stubBase = `http://127.0.0.1:${address.port}`;

    const app = createApp({
      databasePath: path.join(dataDir, 'test.sqlite'),
      dataDir,
      libraryPath: root,
    });
    await app.ready();
    try {
      const save = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { asmroneBaseUrl: stubBase },
      });
      assert.equal(save.statusCode, 200);

      state.worksBody = JSON.stringify({
        works: [
          {
            id: 9001,
            workno: 'RJ09999991',
            title: '随机在线作品',
            circle: '随机社团',
            release: '2026-01-02',
            rate_average_2dp: 4.5,
            tags: [],
            vas: [],
          },
        ],
        pagination: { currentPage: 1, pageSize: 20, totalCount: 1 },
      });
      const randomOnline = await app.inject({
        method: 'GET',
        url: '/api/online/random',
      });
      assert.equal(randomOnline.statusCode, 200);
      const randomOnlineBody = randomOnline.json<{
        work: { code: string; title: string; rating: number | null };
      }>();
      assert.equal(randomOnlineBody.work.code, 'RJ09999991');
      assert.equal(randomOnlineBody.work.title, '随机在线作品');
      assert.equal(randomOnlineBody.work.rating, 4.5);

      state.searchStatus = 401;
      const unauthorized = await app.inject({
        method: 'GET',
        url: '/api/online/search?q=test',
      });
      assert.equal(unauthorized.statusCode, 401);
      const unauthorizedBody = unauthorized.json<{ error: string; kind: string }>();
      assert.equal(unauthorizedBody.kind, 'unauthorized');
      assert.equal(unauthorizedBody.error, 'asmr.one 要求登录或拒绝访问');

      state.searchStatus = 200;
      state.searchBody = 'not-json';
      const parseError = await app.inject({
        method: 'GET',
        url: '/api/online/search?q=test',
      });
      assert.equal(parseError.statusCode, 502);
      assert.equal(parseError.json<{ kind: string }>().kind, 'parse');

      state.workInfoStatus = 404;
      state.workInfoBody = '{"error":"missing"}';
      const missing = await app.inject({
        method: 'GET',
        url: '/api/online/works/RJ01426940',
      });
      assert.equal(missing.statusCode, 404);
      assert.equal(missing.json<{ kind: string }>().kind, 'not_found');

      state.workInfoStatus = 200;
      state.workInfoBody = JSON.stringify({
        id: 9001,
        workno: 'RJ01426940',
        title: '在线作品',
        circle: { name: '在线社团' },
        tags: ['ASMR'],
        vas: ['声优B'],
      });
      state.tracksStatus = 500;
      state.tracksBody = '{"error":"tracks boom"}';
      const degraded = await app.inject({
        method: 'GET',
        url: '/api/online/works/RJ01426940',
      });
      assert.equal(degraded.statusCode, 200);
      const degradedBody = degraded.json<{
        tracks: unknown[];
        tracksError: string;
        work: { code: string; title: string };
        localWork: unknown;
      }>();
      assert.equal(degradedBody.work.code, 'RJ01426940');
      assert.equal(degradedBody.work.title, '在线作品');
      assert.deepEqual(degradedBody.tracks, []);
      assert.equal(degradedBody.tracksError, 'tracks boom');
      assert.equal(degradedBody.localWork, null);

      state.tracksStatus = 200;
      state.tracksBody = JSON.stringify([
        {
          type: 'audio',
          hash: 'hash-a',
          title: '第一轨',
          mediaStreamUrl: `http://127.0.0.1:${address.port}/media/a.mp3`,
          duration: 1.5,
          size: 10,
        },
      ]);
      const detail = await app.inject({
        method: 'GET',
        url: '/api/online/works/RJ01426940',
      });
      assert.equal(detail.statusCode, 200);
      const detailBody = detail.json<{
        tracks: Array<{ hash: string; streamUrl: string; durationMs: number }>;
        playback: { remoteWorkId: number; trackHash: string; positionMs: number } | null;
      }>();
      assert.equal(detailBody.tracks.length, 1);
      assert.equal(detailBody.tracks[0]?.hash, 'hash-a');
      assert.equal(detailBody.tracks[0]?.durationMs, 1500);
      assert.equal(
        detailBody.tracks[0]?.streamUrl,
        '/api/online/works/9001/tracks/hash-a/stream',
      );
      assert.equal(detailBody.playback, null);

      const saveOnlinePlayback = await app.inject({
        method: 'PUT',
        url: '/api/online/playback',
        payload: {
          remoteWorkId: 9001,
          code: 'RJ01426940',
          trackHash: 'hash-a',
          trackIndex: 0,
          positionMs: 4200,
        },
      });
      assert.equal(saveOnlinePlayback.statusCode, 200);
      assert.equal(saveOnlinePlayback.json<{ positionMs: number }>().positionMs, 4200);

      const detailWithPlayback = await app.inject({
        method: 'GET',
        url: '/api/online/works/RJ01426940',
      });
      const playbackBody = detailWithPlayback.json<{
        playback: { remoteWorkId: number; trackHash: string; positionMs: number } | null;
      }>();
      assert.equal(playbackBody.playback?.remoteWorkId, 9001);
      assert.equal(playbackBody.playback?.trackHash, 'hash-a');
      assert.equal(playbackBody.playback?.positionMs, 4200);

      for (const payload of [
        { remoteWorkId: 0, code: 'RJ01426940', trackHash: 'hash-a', positionMs: 1 },
        { remoteWorkId: 9001, code: 'bad', trackHash: 'hash-a', positionMs: 1 },
        { remoteWorkId: 9001, code: 'RJ01426940', trackHash: '', positionMs: 1 },
        { remoteWorkId: 9001, code: 'RJ01426940', trackHash: 'hash-a', positionMs: -1 },
        { remoteWorkId: 9001, code: 'RJ01426940', trackHash: 'hash-a', trackIndex: -2, positionMs: 1 },
      ]) {
        const invalid = await app.inject({
          method: 'PUT',
          url: '/api/online/playback',
          payload,
        });
        assert.equal(invalid.statusCode, 400);
      }

      const blocked = await app.inject({
        method: 'GET',
        url: '/api/online/works/9001/tracks/hash-a/stream',
      });
      assert.equal(blocked.statusCode, 400);
      assert.equal(blocked.json<{ kind: string }>().kind, 'blocked');

      const unknownTrack = await app.inject({
        method: 'GET',
        url: '/api/online/works/9001/tracks/nope/stream',
      });
      assert.equal(unknownTrack.statusCode, 404);
      assert.equal(
        unknownTrack.json<{ error: string }>().error,
        '在线音轨不存在',
      );

      state.coverStatus = 404;
      const coverMissing = await app.inject({
        method: 'GET',
        url: '/api/online/works/9001/cover?type=main',
      });
      assert.equal(coverMissing.statusCode, 404);
      assert.equal(coverMissing.json<{ kind: string }>().kind, 'not_found');

      state.coverStatus = 500;
      const coverHttp = await app.inject({
        method: 'GET',
        url: '/api/online/works/9001/cover?type=main',
      });
      assert.equal(coverHttp.statusCode, 502);
      assert.equal(coverHttp.json<{ kind: string }>().kind, 'http');
      assert.match(coverHttp.json<{ error: string }>().error, /HTTP 500/);

      state.authStatus = 401;
      state.authBody = '{"error":"bad credentials"}';
      const loginDenied = await app.inject({
        method: 'POST',
        url: '/api/online/login',
        payload: { username: 'tester', password: 'secret' },
      });
      assert.equal(loginDenied.statusCode, 401);
      assert.equal(loginDenied.json<{ kind: string }>().kind, 'unauthorized');

      state.authStatus = 200;
      state.authBody = JSON.stringify({
        token: 'stub-token-123',
        user: { name: '测试用户' },
      });
      const login = await app.inject({
        method: 'POST',
        url: '/api/online/login',
        payload: { username: 'tester', password: 'secret' },
      });
      assert.equal(login.statusCode, 200);
      const loginBody = login.json<{ connected: boolean; username: string }>();
      assert.equal(loginBody.connected, true);
      assert.equal(loginBody.username, '测试用户');
      assert.ok(!login.body.includes('stub-token-123'));

      const account = await app.inject({ method: 'GET', url: '/api/online/account' });
      assert.equal(account.json<{ connected: boolean }>().connected, true);
      assert.equal(account.json<{ username: string }>().username, '测试用户');

      state.reviewBody = JSON.stringify({
        works: [
          {
            id: 9101,
            workno: 'RJ09999991',
            title: '收藏作品',
            circle_name: '收藏社团',
            rate_average_2dp: 4.5,
            userRating: 4,
            review_text: '很好听',
            progress: 'listening',
            updated_at: '2026-10-27 12:34:56',
            user_name: 'tester',
          },
        ],
        pagination: { currentPage: 2, pageSize: 2, totalCount: 42 },
      });
      const favorites = await app.inject({
        method: 'GET',
        url: '/api/online/favorites?tab=progress&progress=listening&page=2&pageSize=2&order=userRating&sort=asc',
      });
      assert.equal(favorites.statusCode, 200);
      const favoritesBody = favorites.json<{
        tab: string;
        progress: string;
        total: number;
        page: number;
        items: Array<{
          code: string;
          userRating: number | null;
          reviewText: string;
          progress: string;
          updatedAt: string;
          coverUrl: string;
        }>;
      }>();
      assert.equal(favoritesBody.tab, 'progress');
      assert.equal(favoritesBody.progress, 'listening');
      assert.equal(favoritesBody.total, 42);
      assert.equal(favoritesBody.page, 2);
      assert.equal(favoritesBody.items.length, 1);
      assert.equal(favoritesBody.items[0]?.code, 'RJ09999991');
      assert.equal(favoritesBody.items[0]?.userRating, 4);
      assert.equal(favoritesBody.items[0]?.reviewText, '很好听');
      assert.equal(favoritesBody.items[0]?.progress, 'listening');
      assert.equal(favoritesBody.items[0]?.updatedAt, '2026-10-27 12:34:56');
      assert.equal(
        favoritesBody.items[0]?.coverUrl,
        '/api/online/works/9101/cover?type=main',
      );
      assert.match(reviewQuery, /filter=listening/);
      assert.match(reviewQuery, /order=userRating/);
      assert.match(reviewQuery, /sort=asc/);

      const reviewTab = await app.inject({
        method: 'GET',
        url: '/api/online/favorites?tab=review&progress=listening',
      });
      assert.equal(reviewTab.statusCode, 200);
      assert.equal(reviewTab.json<{ tab: string; progress: string }>().tab, 'review');
      assert.equal(reviewTab.json<{ progress: string }>().progress, '');
      assert.doesNotMatch(reviewQuery, /filter=/);

      state.playlistBody = JSON.stringify({
        playlists: [
          {
            id: 'system-liked-1',
            name: '__SYS_PLAYLIST_LIKED',
            works_count: 3,
            liked_count: 1,
            latestWorkID: 9101,
          },
          {
            id: 'custom-playlist-1',
            name: '我的歌单',
            user_name: 'tester',
            works_count: 5,
          },
        ],
        pagination: { currentPage: 1, pageSize: 3, totalCount: 2 },
      });
      const playlists = await app.inject({
        method: 'GET',
        url: '/api/online/playlists?filterBy=owned&pageSize=3',
      });
      assert.equal(playlists.statusCode, 200);
      const playlistsBody = playlists.json<{
        filterBy: string;
        total: number;
        items: Array<{ displayName: string; coverUrl: string; systemKind: string }>;
      }>();
      assert.equal(playlistsBody.filterBy, 'owned');
      assert.equal(playlistsBody.total, 2);
      assert.equal(playlistsBody.items[0]?.displayName, '我喜欢的');
      assert.equal(playlistsBody.items[0]?.systemKind, 'liked');
      assert.equal(
        playlistsBody.items[0]?.coverUrl,
        '/api/online/works/9101/cover?type=main',
      );
      assert.equal(playlistsBody.items[1]?.displayName, '我的歌单');
      assert.equal(playlistsBody.items[1]?.coverUrl, '');
      assert.match(playlistQuery, /filterBy=owned/);

      state.playlistMetaBody = JSON.stringify({
        id: 'playlist-1234',
        name: '测试歌单',
        user_name: 'tester',
        works_count: 4,
      });
      state.playlistWorksBody = JSON.stringify({
        works: [{ id: 9102, workno: 'RJ09999992', title: '歌单作品' }],
        pagination: { currentPage: 1, pageSize: 3, totalCount: 4 },
      });
      const playlistDetail = await app.inject({
        method: 'GET',
        url: '/api/online/playlists/playlist-1234?pageSize=3',
      });
      assert.equal(playlistDetail.statusCode, 200);
      const playlistDetailBody = playlistDetail.json<{
        playlist: { displayName: string; coverUrl: string };
        works: Array<{ code: string }>;
        total: number;
        page: number;
        pageSize: number;
      }>();
      assert.equal(playlistDetailBody.playlist.displayName, '测试歌单');
      assert.equal(
        playlistDetailBody.playlist.coverUrl,
        '/api/online/works/9102/cover?type=main',
      );
      assert.equal(playlistDetailBody.works[0]?.code, 'RJ09999992');
      assert.equal(playlistDetailBody.total, 4);
      assert.equal(playlistDetailBody.page, 1);
      assert.equal(playlistDetailBody.pageSize, 3);

      const invalidPlaylist = await app.inject({
        method: 'GET',
        url: '/api/online/playlists/!!',
      });
      assert.equal(invalidPlaylist.statusCode, 400);

      state.playlistMetaStatus = 404;
      state.playlistMetaBody = '{"error":"missing"}';
      const missingPlaylist = await app.inject({
        method: 'GET',
        url: '/api/online/playlists/playlist-1234',
      });
      assert.equal(missingPlaylist.statusCode, 404);
      assert.equal(missingPlaylist.json<{ kind: string }>().kind, 'not_found');

      const logout = await app.inject({ method: 'POST', url: '/api/online/logout' });
      assert.equal(logout.statusCode, 200);
      const afterLogout = await app.inject({ method: 'GET', url: '/api/online/account' });
      assert.equal(afterLogout.json<{ connected: boolean }>().connected, false);
    } finally {
      await app.close();
    }
  } finally {
    if (stub) {
      await new Promise<void>((resolve) => {
        stub?.close(() => resolve());
      });
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('导出 API：创建、重复番号、队列动作与完成后入库', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-export-api-'));
  const dataDir = path.join(root, 'data');
  let releaseTracks: () => void = () => undefined;
  const tracksGate = new Promise<void>((resolve) => {
    releaseTracks = resolve;
  });
  let firstTracksCall = true;
  const baseWork: AsmrOneWork = {
    id: 9001,
    code: 'RJ01426920',
    title: '测试导出',
    circle: '测试社团',
    releaseDate: '2025-01-02',
    rating: 4.5,
    priceYen: 880,
    reviewCount: 3,
    dlCount: 10,
    tags: ['ASMR'],
    vas: ['声优A'],
    durationMs: 3000,
  };
  const audio = new Map([
    ['hash-a', Buffer.from('aaaa')],
    ['hash-b', Buffer.from('bbbbb')],
  ]);
  const tracks = [
    {
      hash: 'hash-a',
      title: '第一轨',
      disc: 1,
      groupTitle: '',
      durationMs: 1000,
      size: 4,
      streamUrl: 'https://example.test/a',
    },
    {
      hash: 'hash-b',
      title: '第二轨',
      disc: 1,
      groupTitle: '',
      durationMs: 2000,
      size: 5,
      streamUrl: 'https://example.test/b',
    },
  ];
  const source: ExportSource = {
    async fetchWorkInfo(code) {
      return code === baseWork.code ? baseWork : { ...baseWork, id: 9002, code, title: '测试导出二' };
    },
    async fetchTracks() {
      if (firstTracksCall) {
        firstTracksCall = false;
        await tracksGate;
      }
      return { items: tracks };
    },
    async fetchCover() {
      return { buffer: COVER_PNG, contentType: 'image/png' };
    },
    async openTrackStream(url) {
      const data = audio.get(url.endsWith('/a') ? 'hash-a' : 'hash-b') ?? Buffer.alloc(0);
      return {
        status: 200,
        headers: { 'content-type': 'audio/mpeg', 'content-length': String(data.length) },
        body: Readable.from([data]),
      };
    },
  };

  try {
    const app = createApp({
      databasePath: path.join(dataDir, 'test.sqlite'),
      dataDir,
      libraryPath: root,
      exportSource: source,
    });
    await app.ready();
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/export/jobs',
        payload: { code: 'rj01426920', concurrency: 2 },
      });
      assert.equal(created.statusCode, 202);
      const createdBody = created.json<{ job: ExportJobBody }>();
      assert.ok(createdBody.job);
      const jobId = createdBody.job.id;
      assert.equal(createdBody.job.code, 'RJ01426920');

      const duplicated = await app.inject({
        method: 'POST',
        url: '/api/export/jobs',
        payload: { code: 'RJ01426920' },
      });
      assert.equal(duplicated.statusCode, 409);
      const duplicatedBody = duplicated.json<{ jobId: number; status: string }>();
      assert.equal(duplicatedBody.jobId, jobId);
      assert.ok(['queued', 'running'].includes(duplicatedBody.status));

      const queuedJob = await app.inject({
        method: 'POST',
        url: '/api/export/jobs',
        payload: { code: 'RJ01426921' },
      });
      assert.equal(queuedJob.statusCode, 202);
      const queuedId = queuedJob.json<{ job: ExportJobBody }>().job.id;

      const list = await app.inject({ method: 'GET', url: '/api/export/jobs' });
      assert.equal(list.statusCode, 200);
      assert.equal(list.json<{ items: ExportJobBody[] }>().items.length, 2);

      const deleteQueued = await app.inject({
        method: 'DELETE',
        url: `/api/export/jobs/${queuedId}`,
      });
      assert.equal(deleteQueued.statusCode, 409);

      const pause = await app.inject({
        method: 'POST',
        url: `/api/export/jobs/${queuedId}/pause`,
      });
      assert.equal(pause.statusCode, 200);
      assert.equal(pause.json<ExportJobBody>().status, 'paused');

      const invalidRetry = await app.inject({
        method: 'POST',
        url: `/api/export/jobs/${queuedId}/retry`,
      });
      assert.equal(invalidRetry.statusCode, 409);

      const resume = await app.inject({
        method: 'POST',
        url: `/api/export/jobs/${queuedId}/resume`,
      });
      assert.equal(resume.statusCode, 200);
      assert.equal(resume.json<ExportJobBody>().status, 'queued');

      const cancel = await app.inject({
        method: 'POST',
        url: `/api/export/jobs/${queuedId}/cancel`,
      });
      assert.equal(cancel.statusCode, 200);
      assert.equal(cancel.json<ExportJobBody>().status, 'cancelled');

      const retry = await app.inject({
        method: 'POST',
        url: `/api/export/jobs/${queuedId}/retry`,
      });
      assert.equal(retry.statusCode, 200);
      assert.equal(retry.json<ExportJobBody>().status, 'queued');
      const cancelAgain = await app.inject({
        method: 'POST',
        url: `/api/export/jobs/${queuedId}/cancel`,
      });
      assert.equal(cancelAgain.statusCode, 200);

      const deleteCancelled = await app.inject({
        method: 'DELETE',
        url: `/api/export/jobs/${queuedId}`,
      });
      assert.equal(deleteCancelled.statusCode, 200);
      assert.equal(deleteCancelled.json<{ deleted: boolean }>().deleted, true);
      const deletedCancelled = await app.inject({
        method: 'GET',
        url: `/api/export/jobs/${queuedId}`,
      });
      assert.equal(deletedCancelled.statusCode, 404);

      releaseTracks();
      const done = await waitForExportDone(app, jobId);
      assert.equal(done.progress, 1);
      assert.equal(done.phase, 'done');
      assert.equal(done.trackCompleted, 2);
      assert.equal(done.result?.relativePath, 'RJ01426920 [测试导出]');
      assert.equal(done.result?.trackCount, 2);
      assert.equal(done.result?.bytes, 9);
      assert.equal(done.result?.cover, 'ok');
      assert.deepEqual(
        done.tracks.map((track) => [track.title, track.status, track.bytes]),
        [
          ['第一轨', 'done', 4],
          ['第二轨', 'done', 5],
        ],
      );

      const finalDir = path.join(root, 'RJ01426920 [测试导出]');
      await fs.access(path.join(finalDir, 'tracks', '01 - 第一轨.mp3'));
      await fs.access(path.join(finalDir, 'tracks', '02 - 第二轨.mp3'));
      await fs.access(path.join(finalDir, 'cover.png'));
      await fs.access(path.join(finalDir, 'metadata.json'));
      await fs.access(path.join(finalDir, '.kikoeru-export-complete'));
      await assert.rejects(fs.access(path.join(root, '.kikoeru-tmp', `export-${jobId}`)));

      const detail = await app.inject({ method: 'GET', url: '/api/works/RJ01426920' });
      assert.equal(detail.statusCode, 200);
      const detailBody = detail.json<{
        title: string;
        circle: string;
        metadataStatus: string;
        tags: string[];
        coverAssetId: number | null;
        tracks: Array<{ title: string; durationMs: number | null }>;
      }>();
      assert.equal(detailBody.title, '测试导出');
      assert.equal(detailBody.circle, '测试社团');
      assert.equal(detailBody.metadataStatus, 'sidecar');
      assert.deepEqual(detailBody.tags, ['ASMR']);
      assert.ok(detailBody.coverAssetId);
      assert.deepEqual(
        detailBody.tracks.map((track) => [track.title, track.durationMs]),
        [
          ['第一轨', 1000],
          ['第二轨', 2000],
        ],
      );

      const localDuplicate = await app.inject({
        method: 'POST',
        url: '/api/export/jobs',
        payload: { code: 'RJ01426920' },
      });
      assert.equal(localDuplicate.statusCode, 409);
      const localBody = localDuplicate.json<{
        localWork: { code: string; title: string; trackCount: number };
      }>();
      assert.equal(localBody.localWork.code, 'RJ01426920');
      assert.equal(localBody.localWork.trackCount, 2);

      const badCode = await app.inject({
        method: 'POST',
        url: '/api/export/jobs',
        payload: { code: 'not-a-code' },
      });
      assert.equal(badCode.statusCode, 400);

      const badHashes = await app.inject({
        method: 'POST',
        url: '/api/export/jobs',
        payload: { code: 'RJ01426922', hashes: [] },
      });
      assert.equal(badHashes.statusCode, 400);

      const badConcurrency = await app.inject({
        method: 'POST',
        url: '/api/export/jobs',
        payload: { code: 'RJ01426922', concurrency: '2' },
      });
      assert.equal(badConcurrency.statusCode, 400);

      const badJobId = await app.inject({ method: 'GET', url: '/api/export/jobs/0' });
      assert.equal(badJobId.statusCode, 400);
      const missingJob = await app.inject({ method: 'GET', url: '/api/export/jobs/9999' });
      assert.equal(missingJob.statusCode, 404);

      const donePause = await app.inject({
        method: 'POST',
        url: `/api/export/jobs/${jobId}/pause`,
      });
      assert.equal(donePause.statusCode, 409);
      const doneCancel = await app.inject({
        method: 'POST',
        url: `/api/export/jobs/${jobId}/cancel`,
      });
      assert.equal(doneCancel.statusCode, 409);

      const deleteDone = await app.inject({
        method: 'DELETE',
        url: `/api/export/jobs/${jobId}`,
      });
      assert.equal(deleteDone.statusCode, 200);
      const deletedDone = await app.inject({
        method: 'GET',
        url: `/api/export/jobs/${jobId}`,
      });
      assert.equal(deletedDone.statusCode, 404);
    } finally {
      await app.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('多库根设置、合并扫描、分库统计与定向扫描登记', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-roots-'));
  const rootA = path.join(base, '库A');
  const rootB = path.join(base, '库B');
  const rootC = path.join(base, '库C');
  const dataDir = path.join(base, 'data');
  const writeWork = async (root: string, dir: string, file = '01.mp3') => {
    await fs.mkdir(path.join(root, dir), { recursive: true });
    await fs.writeFile(path.join(root, dir, file), Buffer.alloc(8, 0x61));
  };
  try {
    await writeWork(rootA, 'RJ03000001 A作品');
    await writeWork(rootB, 'RJ03000002 B作品');
    await writeWork(rootB, 'RJ03000001 A副本');
    await writeWork(rootC, 'RJ03000003 C作品');
    const app = createApp({
      databasePath: path.join(dataDir, 'test.sqlite'),
      dataDir,
      libraryPath: rootA,
    });
    await app.ready();
    try {
      const initial = await app.inject({ method: 'GET', url: '/api/settings' });
      assert.deepEqual(initial.json<{ libraryPaths: string[] }>().libraryPaths, [rootA]);

      const saved = await app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { libraryPaths: [rootA, rootB, rootA] },
      });
      assert.equal(saved.statusCode, 200);
      assert.deepEqual(saved.json<{ libraryPaths: string[] }>().libraryPaths, [rootA, rootB]);

      for (const payload of [
        { libraryPaths: 'not-an-array' },
        { libraryPaths: [rootA, 1] },
        { libraryPaths: Array.from({ length: 9 }, (_, index) => path.join(base, `库${index}`)) },
      ]) {
        const invalid = await app.inject({
          method: 'PUT',
          url: '/api/settings',
          payload,
        });
        assert.equal(invalid.statusCode, 400);
      }

      const scanAll = await app.inject({ method: 'POST', url: '/api/scan' });
      assert.equal(scanAll.statusCode, 200);
      const scanBody = scanAll.json<{
        results: Array<{ rootPath: string; worksAdded: number; skippedDuplicates: number }>;
      }>();
      assert.equal(scanBody.results.length, 2);
      assert.deepEqual(
        scanBody.results.map((result) => result.worksAdded),
        [1, 1],
      );
      assert.equal(scanBody.results[1]?.skippedDuplicates, 1);

      const works = await app.inject({ method: 'GET', url: '/api/works' });
      assert.equal(works.json<{ total: number }>().total, 2);

      const roots = await app.inject({ method: 'GET', url: '/api/library/roots' });
      assert.deepEqual(
        roots.json<{ roots: Array<{ path: string; workCount: number; kind: string }> }>().roots,
        [
          { path: rootA, rootId: 1, workCount: 1, kind: 'local' },
          { path: rootB, rootId: 2, workCount: 1, kind: 'local' },
        ],
      );

      const unknownRoot = await app.inject({
        method: 'POST',
        url: '/api/scrape',
        payload: { rootPath: rootC },
      });
      assert.equal(unknownRoot.statusCode, 400);
      assert.match(unknownRoot.json<{ error: string }>().error, /库根不在设置中/);

      const badExportRoot = await app.inject({
        method: 'POST',
        url: '/api/export/jobs',
        payload: { code: 'RJ03000009', rootPath: rootC },
      });
      assert.equal(badExportRoot.statusCode, 400);
      assert.match(badExportRoot.json<{ error: string }>().error, /导出目标库根/);

      const singleScan = await app.inject({
        method: 'POST',
        url: '/api/scan',
        payload: { rootPath: rootC },
      });
      assert.equal(singleScan.statusCode, 200);
      assert.equal(singleScan.json<{ rootPath: string }>().rootPath, rootC);
      const afterScan = await app.inject({ method: 'GET', url: '/api/settings' });
      assert.deepEqual(afterScan.json<{ libraryPaths: string[] }>().libraryPaths, [
        rootA,
        rootB,
        rootC,
      ]);
      const rootsAgain = await app.inject({ method: 'GET', url: '/api/library/roots' });
      assert.deepEqual(
        rootsAgain.json<{ roots: Array<{ workCount: number }> }>().roots.map((root) => root.workCount),
        [1, 1, 1],
      );
    } finally {
      await app.close();
    }
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
