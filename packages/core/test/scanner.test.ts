import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  countWorks,
  EXPORT_INCOMPLETE_MARKER,
  getWorkByCode,
  listWorks,
  openDatabase,
  scanLibrary,
  scanWorkDir,
} from '../src/index.js';

async function writeFile(root: string, relativePath: string, bytes = 16): Promise<void> {
  const target = path.join(root, ...relativePath.split('/'));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, Buffer.alloc(bytes, 0x61));
}

async function createLibrary(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-library-'));
  await writeFile(root, 'RJ01426915 测试作品/01 - 开场.mp3');
  await writeFile(root, 'RJ01426915 测试作品/02 - 第二轨.flac');
  await writeFile(root, 'RJ01426915 测试作品/10 - 结尾.mp3');
  await writeFile(root, '[RJ123456] 另一作品/01.mp3');
  await writeFile(root, 'BJ1234567 第三作品/01.wav');
  await writeFile(root, '合集/RJ7654321 嵌套作品/01.ogg');
  await writeFile(root, 'ZZZ-dup/RJ01426915 重复作品/01.mp3');
  await writeFile(root, '随便目录/01.mp3');
  await writeFile(root, '.kikoeru-tmp/01.mp3');
  await writeFile(root, '__MACOSX/01.mp3');
  return root;
}

test('扫描识别 RJ/BJ/VJ 作品、中文标题、嵌套目录并跳过重复与忽略目录', async () => {
  const root = await createLibrary();
  const db = openDatabase(':memory:');
  try {
    const result = await scanLibrary({ db, rootPath: root });
    assert.equal(result.worksFound, 4);
    assert.equal(result.worksAdded, 4);
    assert.equal(result.tracksFound, 6);
    assert.equal(result.skippedDuplicates, 1);
    assert.deepEqual(result.errors, []);
    assert.equal(countWorks(db), 4);

    const work = getWorkByCode(db, 'RJ01426915');
    assert.ok(work);
    assert.equal(work.title, '测试作品');
    assert.deepEqual(
      work.tracks.map((track) => track.title),
      ['开场', '第二轨', '结尾'],
    );
    assert.equal(work.tracks[0]?.fileName, '01 - 开场.mp3');

    const nested = getWorkByCode(db, 'RJ7654321');
    assert.equal(nested?.title, '嵌套作品');
    assert.equal(nested?.tracks.length, 1);
    assert.equal(listWorks(db, { limit: 10, offset: 0 }).length, 4);

    const again = await scanLibrary({ db, rootPath: root });
    assert.equal(again.worksAdded, 0);
    assert.equal(again.worksUpdated, 4);
    assert.equal(countWorks(db), 4);
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('扫描跳过带未完成标记的导出目录，定向扫描可单目录入库', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-scan-export-'));
  const db = openDatabase(':memory:');
  try {
    await writeFile(root, 'RJ01426918 定向作品/01 - 开场.mp3');
    const direct = await scanWorkDir({
      db,
      rootPath: root,
      relativePath: 'RJ01426918 定向作品',
    });
    assert.equal(direct.worksFound, 1);
    assert.equal(direct.tracksFound, 1);
    assert.equal(getWorkByCode(db, 'RJ01426918')?.tracks.length, 1);

    await writeFile(root, 'RJ99999999 半成品/01.mp3');
    await writeFile(root, `RJ99999999 半成品/${EXPORT_INCOMPLETE_MARKER}`, 2);
    const full = await scanLibrary({ db, rootPath: root });
    assert.equal(full.skippedIncomplete, 1);
    assert.equal(full.worksFound, 1);
    assert.equal(getWorkByCode(db, 'RJ99999999'), null);
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('扫描会新增文件并在文件消失后清理音轨记录', async () => {
  const root = await createLibrary();
  const db = openDatabase(':memory:');
  try {
    await scanLibrary({ db, rootPath: root });
    await writeFile(root, 'RJ01426915 测试作品/03 - 新增.mp3');
    const added = await scanLibrary({ db, rootPath: root });
    assert.equal(added.tracksFound, 7);
    assert.equal(getWorkByCode(db, 'RJ01426915')?.tracks.length, 4);

    await fs.rm(path.join(root, 'RJ01426915 测试作品', '02 - 第二轨.flac'));
    const removed = await scanLibrary({ db, rootPath: root });
    assert.equal(removed.tracksFound, 6);
    const work = getWorkByCode(db, 'RJ01426915');
    assert.deepEqual(
      work?.tracks.map((track) => track.title),
      ['开场', '新增', '结尾'],
    );
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
