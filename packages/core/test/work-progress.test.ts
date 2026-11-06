import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getWorkByCode,
  listWorkTotal,
  listWorks,
  openDatabase,
  scanLibrary,
  setWorkProgress,
} from '../src/index.js';

test('作品进度标记可保存、替换与清除', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-progress-'));
  const db = openDatabase(':memory:');
  try {
    const workDir = path.join(root, 'RJ01426915 测试作品');
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(path.join(workDir, '01.mp3'), Buffer.alloc(16, 0x61));
    await scanLibrary({ db, rootPath: root });

    assert.equal(getWorkByCode(db, 'RJ01426915')?.progress, '');
    assert.deepEqual(setWorkProgress(db, 'RJ01426915', 'listening'), {
      code: 'RJ01426915',
      progress: 'listening',
    });
    assert.equal(getWorkByCode(db, 'RJ01426915')?.progress, 'listening');

    setWorkProgress(db, 'RJ01426915', 'listened');
    assert.equal(getWorkByCode(db, 'RJ01426915')?.progress, 'listened');

    assert.deepEqual(setWorkProgress(db, 'RJ01426915', null), {
      code: 'RJ01426915',
      progress: '',
    });
    assert.equal(getWorkByCode(db, 'RJ01426915')?.progress, '');
    assert.equal(setWorkProgress(db, 'RJ99999999', 'marked'), null);
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('作品列表可按进度筛选并返回匹配总数', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-progress-filter-'));
  const db = openDatabase(':memory:');
  try {
    for (const [code, title] of [
      ['RJ01426930', '甲'],
      ['RJ01426931', '乙'],
      ['RJ01426932', '丙'],
    ]) {
      const workDir = path.join(root, `${code} ${title}`);
      await fs.mkdir(workDir, { recursive: true });
      await fs.writeFile(path.join(workDir, '01.mp3'), Buffer.alloc(16, 0x61));
    }
    await scanLibrary({ db, rootPath: root });
    setWorkProgress(db, 'RJ01426930', 'listening');
    setWorkProgress(db, 'RJ01426931', 'marked');

    const codes = (progress: 'marked' | 'listening' | 'listened' | 'replay' | 'none') =>
      listWorks(db, { limit: 10, offset: 0, progress }).map((work) => work.code);

    assert.deepEqual(codes('listening'), ['RJ01426930']);
    assert.deepEqual(codes('marked'), ['RJ01426931']);
    assert.deepEqual(codes('none'), ['RJ01426932']);
    assert.deepEqual(codes('listened'), []);
    assert.deepEqual(codes('replay'), []);

    assert.equal(listWorkTotal(db, { progress: 'listening' }), 1);
    assert.equal(listWorkTotal(db, { progress: 'marked' }), 1);
    assert.equal(listWorkTotal(db, { progress: 'none' }), 1);
    assert.equal(listWorkTotal(db, { progress: 'listened' }), 0);
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
