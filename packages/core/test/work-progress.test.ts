import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getWorkByCode,
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
