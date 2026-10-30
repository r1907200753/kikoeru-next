import assert from 'node:assert/strict';
import test from 'node:test';
import { localizeTag, localizeTags, tagFilterVariants } from '../src/tag-labels.js';

test('日文标签映射为中文并保留未知标签', () => {
  assert.equal(localizeTag('癒し'), '治愈');
  assert.equal(localizeTag('バイノーラル/ダミヘ'), '双声道立体声/人头麦');
  assert.equal(localizeTag('閉じ込め'), '限制自由');
  assert.equal(localizeTag('ASMR'), 'ASMR');
  assert.equal(localizeTag('未知标签'), '未知标签');
  assert.equal(localizeTag('  耳舐め  '), '舔耳');
  assert.equal(localizeTag('   '), '   ');
});

test('localizeTags 去重并保持顺序', () => {
  assert.deepEqual(localizeTags(['癒し', '治愈', '耳舐め']), ['治愈', '舔耳']);
  assert.deepEqual(localizeTags([]), []);
});

test('tagFilterVariants 同时兼容中日文标签筛选', () => {
  const chinese = tagFilterVariants('治愈');
  assert.ok(chinese.includes('治愈'));
  assert.ok(chinese.includes('癒し'));
  const japanese = tagFilterVariants('癒し');
  assert.ok(japanese.includes('治愈'));
  assert.deepEqual(tagFilterVariants('   '), []);
});
