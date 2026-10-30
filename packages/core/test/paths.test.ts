import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isIgnoredName,
  isPathInside,
  resolveLibraryFile,
  toPosixRelative,
} from '../src/paths.js';

test('忽略隐藏文件、系统目录与临时目录', () => {
  assert.equal(isIgnoredName('.kikoeru-tmp'), true);
  assert.equal(isIgnoredName('__MACOSX'), true);
  assert.equal(isIgnoredName('Thumbs.db'), true);
  assert.equal(isIgnoredName('System Volume Information'), true);
  assert.equal(isIgnoredName('$RECYCLE.BIN'), true);
  assert.equal(isIgnoredName('RJ01426915 正常作品'), false);
});

test('相对路径统一成正斜杠', () => {
  const root = path.resolve('C:/library');
  const child = path.join(root, 'RJ01426915 测试', '音声', '01.mp3');
  assert.equal(toPosixRelative(root, child), 'RJ01426915 测试/音声/01.mp3');
});

test('isPathInside 拒绝父目录与绝对路径逃逸', () => {
  const root = path.resolve('C:/library');
  assert.equal(isPathInside(root, path.join(root, 'RJ01426915', '01.mp3')), true);
  assert.equal(isPathInside(root, path.join(root, '..', 'outside.mp3')), false);
  assert.equal(isPathInside(root, 'D:/outside.mp3'), false);
});

test('resolveLibraryFile 读取真实文件并拒绝路径穿越', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kikoeru-paths-'));
  try {
    const workDir = path.join(root, 'RJ01426915 测试');
    await fs.mkdir(workDir);
    await fs.writeFile(path.join(workDir, '01.mp3'), Buffer.from('test'));
    await fs.writeFile(path.join(root, '..', 'kikoeru-outside.mp3'), Buffer.from('outside'));

    const resolved = await resolveLibraryFile(root, 'RJ01426915 测试/01.mp3');
    assert.equal(resolved?.size, 4);
    assert.equal(resolved?.absolutePath.endsWith('01.mp3'), true);
    assert.equal(await resolveLibraryFile(root, '../kikoeru-outside.mp3'), null);
    assert.equal(await resolveLibraryFile(root, 'RJ01426915 测试/不存在.mp3'), null);
    assert.equal(await resolveLibraryFile(root, ''), null);
  } finally {
    await fs.rm(path.join(root, '..', 'kikoeru-outside.mp3'), { force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
});
