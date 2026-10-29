import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getScrapeCache,
  getWorkByCode,
  listWorksForScrape,
  openDatabase,
  scanLibrary,
  scrapeWork,
  scrapeWorkFromAsmrOne,
  type AsmrOneProvider,
  type DlsiteProvider,
  type DlsiteFetchResult,
  type ScrapeWorkItem,
} from '../src/index.js';

async function createLibrary(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-scrape-'));
  const workDir = path.join(root, 'RJ01426915 测试作品');
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(path.join(workDir, '01 - 开场.mp3'), Buffer.alloc(16, 0x61));
  return root;
}

function okResult(code: string): DlsiteFetchResult {
  return {
    status: 'ok',
    message: '',
    data: {
      code,
      title: '官方标题',
      circle: '官方社团',
      workType: '音声作品',
      releaseDate: '2024-02-03',
      tags: ['癒し', 'ささやき'],
      vas: ['声优A'],
      rating: 4.82,
      priceYen: 2750,
      coverUrls: ['https://img.dlsite.jp/cover.jpg'],
      sourceUrl: 'https://www.dlsite.com/maniax/work/=/product_id/RJ01426915.html',
      productId: code,
      translationOriginalCode: '',
      raw: { product: null, info: null, page: null },
    },
  };
}

function fakeProvider(result: DlsiteFetchResult, counters: { calls: number }): DlsiteProvider {
  return {
    fetchWork: async () => {
      counters.calls += 1;
      return result;
    },
    fetchImage: async () => ({
      ok: false,
      status: 500,
      buffer: Buffer.alloc(0),
      contentType: '',
      message: 'HTTP 500',
    }),
  } as unknown as DlsiteProvider;
}

test('刮削成功写入官方元数据与来源，封面失败标记 partial', async () => {
  const root = await createLibrary();
  const db = openDatabase(':memory:');
  try {
    await scanLibrary({ db, rootPath: root });
    const item = listWorksForScrape(db)[0];
    assert.ok(item);
    const counters = { calls: 0 };
    const result = await scrapeWork(db, fakeProvider(okResult(item.code), counters), item, {
      assetsDir: path.join(root, 'assets'),
      ffmpegPath: 'missing-ffmpeg',
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.cover, 'failed');
    assert.equal(counters.calls, 1);

    const work = getWorkByCode(db, item.code);
    assert.equal(work?.title, '官方标题');
    assert.equal(work?.circle, '官方社团');
    assert.equal(work?.releaseDate, '2024-02-03');
    assert.equal(work?.workType, '音声作品');
    assert.deepEqual(work?.tags, ['治愈', '低语']);
    assert.equal(work?.rating, 4.82);
    assert.equal(work?.priceYen, 2750);
    assert.deepEqual(work?.vas, ['声优A']);
    assert.equal(work?.metadataStatus, 'partial');
    assert.equal(getScrapeCache(db, 'dlsite', item.code), null);
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

function pngBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(64);
  buffer.writeUInt8(0x89, 0);
  buffer.write('PNG', 1, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function fakeAsmrProvider(code: string): AsmrOneProvider {
  return {
    fetchWorkInfo: async () => ({
      id: 9001,
      code,
      title: '在线标题',
      circle: '在线社团',
      releaseDate: '2024-03-04',
      rating: 4.87,
      priceYen: 880,
      reviewCount: 12,
      dlCount: 34,
      tags: ['癒し', '耳舐め'],
      vas: ['声优A'],
      durationMs: null,
    }),
    fetchCover: async () => ({
      buffer: pngBuffer(600, 480),
      contentType: 'image/png',
    }),
  } as unknown as AsmrOneProvider;
}

test('asmr.one 刮削写入中文标签、评分与来源', async () => {
  const root = await createLibrary();
  const db = openDatabase(':memory:');
  try {
    await scanLibrary({ db, rootPath: root });
    const item = listWorksForScrape(db)[0];
    assert.ok(item);
    const result = await scrapeWorkFromAsmrOne(db, fakeAsmrProvider(item.code), item, {
      assetsDir: path.join(root, 'assets'),
      ffmpegPath: 'missing-ffmpeg',
    });
    assert.equal(result.source, 'asmrone');
    assert.equal(result.cover, 'ok');
    assert.equal(result.status, 'ok');

    const work = getWorkByCode(db, item.code);
    assert.equal(work?.title, '在线标题');
    assert.equal(work?.circle, '在线社团');
    assert.equal(work?.releaseDate, '2024-03-04');
    assert.equal(work?.rating, 4.87);
    assert.equal(work?.priceYen, 880);
    assert.deepEqual(work?.tags, ['治愈', '舔耳']);
    assert.deepEqual(work?.vas, ['声优A']);
    assert.equal(work?.metadataStatus, 'scraped');
    assert.ok(work?.coverAssetId);
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('404 写入负缓存，第二次刮削直接命中缓存', async () => {
  const db = openDatabase(':memory:');
  try {
    const item: ScrapeWorkItem = {
      id: 999,
      code: 'RJ99999999',
      title: '本地标题',
      circle: '',
      releaseDate: '',
      workType: '',
      tags: [],
      metadataStatus: 'local',
    };
    const counters = { calls: 0 };
    const provider = fakeProvider(
      { status: 'not_found', message: 'DLsite 上不存在该作品（404）', httpStatus: 404 },
      counters,
    );
    const first = await scrapeWork(db, provider, item, {
      assetsDir: path.join(os.tmpdir(), 'kikoeru-assets-none'),
      ffmpegPath: 'missing-ffmpeg',
    });
    assert.equal(first.status, 'not_found');
    assert.equal(counters.calls, 1);
    assert.equal(getScrapeCache(db, 'dlsite', item.code)?.status, 'not_found');

    const second = await scrapeWork(db, provider, item, {
      assetsDir: path.join(os.tmpdir(), 'kikoeru-assets-none'),
      ffmpegPath: 'missing-ffmpeg',
    });
    assert.equal(second.status, 'cached');
    assert.equal(counters.calls, 1);

    const forced = await scrapeWork(db, provider, item, {
      assetsDir: path.join(os.tmpdir(), 'kikoeru-assets-none'),
      ffmpegPath: 'missing-ffmpeg',
      force: true,
    });
    assert.equal(forced.status, 'not_found');
    assert.equal(counters.calls, 2);
  } finally {
    db.close();
  }
});
