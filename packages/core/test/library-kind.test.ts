import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyLibraryPath, detectLibraryKind } from '../src/library-kind.js';

test('库根分类识别本地盘、UNC 与 POSIX 挂载点', () => {
  assert.equal(classifyLibraryPath('\\\\NAS\\asmr', 'win32'), 'mounted');
  assert.equal(classifyLibraryPath('//nas/share', 'win32'), 'mounted');
  assert.equal(classifyLibraryPath('K:\\音频', 'win32'), 'local');
  assert.equal(classifyLibraryPath('', 'win32'), 'local');
  assert.equal(classifyLibraryPath('/mnt/nas', 'linux'), 'mounted');
  assert.equal(classifyLibraryPath('/media/usb', 'linux'), 'mounted');
  assert.equal(classifyLibraryPath('/Volumes/Cloud', 'darwin'), 'mounted');
  assert.equal(classifyLibraryPath('/home/user', 'linux'), 'local');
});

test('系统盘与 UNC 路径无需查询分区', async () => {
  assert.equal(await detectLibraryKind('\\\\NAS\\asmr', 'win32'), 'mounted');
  assert.equal(await detectLibraryKind('C:\\library', 'win32'), 'local');
  assert.equal(await detectLibraryKind('/mnt/nas', 'linux'), 'mounted');
});
