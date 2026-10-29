import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackVariants } from '../src/index.js';

const WORK = 'RJ01426916 差分作品';

test('变体标签取作品目录下的文件夹并去掉序号前缀', () => {
  assert.deepEqual(
    trackVariants(`${WORK}/1.本編/2.SEなし/01 - 开场.mp3`, WORK),
    ['本編', 'SEなし'],
  );
  assert.deepEqual(trackVariants(`${WORK}/mp3/01.mp3`, WORK), ['mp3']);
  assert.deepEqual(
    trackVariants(`RJ01426916 差分作品\\1.本編\\1.SEあり\\01.mp3`, WORK),
    ['本編', 'SEあり'],
  );
});

test('变体标签跳过碟号、泛化目录与重复项', () => {
  assert.deepEqual(
    trackVariants(`${WORK}/Disc 1/本編/audio/本編/01.mp3`, WORK),
    ['本編'],
  );
  assert.deepEqual(trackVariants(`${WORK}/CD2/音声/01.mp3`, WORK), []);
});

test('作品根目录的散轨没有变体标签，且最多保留四个', () => {
  assert.deepEqual(trackVariants(`${WORK}/01 - 特典.mp3`, WORK), []);
  assert.deepEqual(
    trackVariants(`${WORK}/特典/本編/SEあり/第2版/附赠/追加/01.mp3`, WORK),
    ['特典', '本編', 'SEあり', '第2版'],
  );
});
