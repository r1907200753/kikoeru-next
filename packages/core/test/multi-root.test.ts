import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getOnlinePlayback,
  getWorkByCode,
  listLibraryRoots,
  listWorks,
  listWorksForScrape,
  openDatabase,
  readSettings,
  saveOnlinePlayback,
  scanLibrary,
  scanWorkDir,
  writeSettings,
} from '../src/index.js';

async function writeFile(root: string, relativePath: string, bytes = 16): Promise<void> {
  const target = path.join(root, ...relativePath.split('/'));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, Buffer.alloc(bytes, 0x61));
}

test('多库根分别扫描，同一番号只保留先入库的库根', async () => {
  const rootA = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-root-a-'));
  const rootB = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-root-b-'));
  const db = openDatabase(':memory:');
  try {
    await writeFile(rootA, 'RJ11111111 A作品/01.mp3');
    await writeFile(rootB, 'RJ22222222 B作品/01.mp3');
    await writeFile(rootB, 'RJ11111111 重复作品/01.mp3');

    const first = await scanLibrary({ db, rootPath: rootA });
    assert.equal(first.worksAdded, 1);
    const second = await scanLibrary({ db, rootPath: rootB });
    assert.equal(second.worksFound, 2);
    assert.equal(second.worksAdded, 1);
    assert.equal(second.skippedDuplicates, 1);
    assert.deepEqual(second.duplicates, [
      {
        code: 'RJ11111111',
        path: 'RJ11111111 重复作品',
        keptPath: 'RJ11111111 A作品',
      },
    ]);

    assert.equal(listWorks(db, { limit: 10, offset: 0 }).length, 2);
    const kept = getWorkByCode(db, 'RJ11111111');
    assert.equal(kept?.relativePath, 'RJ11111111 A作品');

    const roots = listLibraryRoots(db);
    assert.equal(roots.length, 2);
    assert.deepEqual(
      roots.map((root) => root.workCount),
      [1, 1],
    );
    assert.equal(listWorksForScrape(db, rootB).length, 1);
    assert.equal(listWorksForScrape(db, rootB)[0]?.code, 'RJ22222222');
    assert.equal(listWorksForScrape(db, `${rootB}${path.sep}`).length, 1);
    assert.equal(listWorksForScrape(db).length, 2);
  } finally {
    db.close();
    await fs.rm(rootA, { recursive: true, force: true });
    await fs.rm(rootB, { recursive: true, force: true });
  }
});

test('定向扫描跨库根重复目录时跳过且不搬移作品', async () => {
  const rootA = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-dir-a-'));
  const rootB = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-dir-b-'));
  const db = openDatabase(':memory:');
  try {
    await writeFile(rootA, 'RJ12345678 原作品/01.mp3');
    await writeFile(rootB, 'RJ12345678 副本/01.mp3');
    await scanLibrary({ db, rootPath: rootA });
    const result = await scanWorkDir({
      db,
      rootPath: rootB,
      relativePath: 'RJ12345678 副本',
    });
    assert.equal(result.worksFound, 1);
    assert.equal(result.skippedDuplicates, 1);
    assert.equal(result.duplicates[0]?.keptPath, 'RJ12345678 原作品');
    assert.ok(result.errors.length > 0);
    assert.equal(getWorkByCode(db, 'RJ12345678')?.relativePath, 'RJ12345678 原作品');
  } finally {
    db.close();
    await fs.rm(rootA, { recursive: true, force: true });
    await fs.rm(rootB, { recursive: true, force: true });
  }
});

test('设置支持多库根、去重、上限与旧单路径迁移', async () => {
  const db = openDatabase(':memory:');
  try {
    const initial = readSettings(db, {
      libraryPaths: ['K:/音频', 'X:/ASMR'],
      ffprobePath: '/opt/ffprobe',
    });
    assert.deepEqual(initial.libraryPaths, ['K:/音频', 'X:/ASMR']);
    assert.equal(initial.libraryPath, 'K:/音频');

    const updated = writeSettings(db, {
      libraryPaths: [' X:/A ', 'x:/a', 'Y:/B', ''],
    });
    assert.deepEqual(updated.libraryPaths, ['X:/A', 'Y:/B']);
    assert.equal(updated.libraryPath, 'X:/A');

    const primary = writeSettings(db, { libraryPath: 'P:/新主库' });
    assert.deepEqual(primary.libraryPaths, ['P:/新主库', 'Y:/B']);

    const capped = writeSettings(db, {
      libraryPaths: Array.from({ length: 12 }, (_, index) => `Z:/库${index}`),
    });
    assert.equal(capped.libraryPaths.length, 8);

    db.prepare("DELETE FROM settings WHERE key = 'library.paths'").run();
    db.prepare(
      `INSERT INTO settings (key, value_json) VALUES ('library.path', ?)
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
    ).run(JSON.stringify('L:/旧库'));
    const legacy = readSettings(db, { libraryPaths: ['D:/默认'] });
    assert.deepEqual(legacy.libraryPaths, ['L:/旧库', 'D:/默认']);
    assert.equal(legacy.libraryPath, 'L:/旧库');
  } finally {
    db.close();
  }
});

test('在线播放进度按作品覆盖保存并可读取', () => {
  const db = openDatabase(':memory:');
  try {
    const first = saveOnlinePlayback(db, {
      provider: 'asmrone',
      remoteWorkId: 42,
      code: 'RJ01426915',
      trackHash: 'hash-a',
      trackIndex: 2,
      positionMs: 12345,
    });
    assert.equal(first.positionMs, 12345);

    const stored = getOnlinePlayback(db, 'asmrone', 42);
    assert.deepEqual(
      stored && {
        remoteWorkId: stored.remoteWorkId,
        code: stored.code,
        trackHash: stored.trackHash,
        trackIndex: stored.trackIndex,
        positionMs: stored.positionMs,
      },
      {
        remoteWorkId: 42,
        code: 'RJ01426915',
        trackHash: 'hash-a',
        trackIndex: 2,
        positionMs: 12345,
      },
    );

    saveOnlinePlayback(db, {
      provider: 'asmrone',
      remoteWorkId: 42,
      code: 'RJ01426915',
      trackHash: 'hash-b',
      trackIndex: 3,
      positionMs: 900,
    });
    assert.equal(getOnlinePlayback(db, 'asmrone', 42)?.trackHash, 'hash-b');
    assert.equal(getOnlinePlayback(db, 'asmrone', 99), null);
  } finally {
    db.close();
  }
});

test('作品详情返回由目录推导的变体标签', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-variant-'));
  const db = openDatabase(':memory:');
  try {
    await writeFile(root, 'RJ01426916 差分作品/1.本編/2.SEなし/01.mp3');
    await writeFile(root, 'RJ01426916 差分作品/00 - 特典.mp3');
    await scanLibrary({ db, rootPath: root });
    const work = getWorkByCode(db, 'RJ01426916');
    assert.ok(work);
    const nested = work.tracks.find((track) => track.title === '01');
    const rootTrack = work.tracks.find((track) => track.title === '特典');
    assert.deepEqual(nested?.variants, ['本編', 'SEなし']);
    assert.deepEqual(rootTrack?.variants, []);
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
