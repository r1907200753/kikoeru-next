import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkno, parseWorkno, parseWorkTitle } from '../src/workno.js';

test('识别 6/7/8 位 RJ/BJ/VJ 番号', () => {
  assert.deepEqual(parseWorkno('RJ123456'), { code: 'RJ123456', type: 'RJ', digits: '123456' });
  assert.deepEqual(parseWorkno('[RJ1234567] 标题'), {
    code: 'RJ1234567',
    type: 'RJ',
    digits: '1234567',
  });
  assert.equal(parseWorkno('bj12345678 作品')?.code, 'BJ12345678');
  assert.equal(parseWorkno('VJ01426915')?.type, 'VJ');
});

test('拒绝过短、过长或前缀错误的番号', () => {
  assert.equal(parseWorkno('RJ12345'), null);
  assert.equal(parseWorkno('RJ123456789'), null);
  assert.equal(parseWorkno('XJ123456'), null);
  assert.equal(parseWorkno('随便一个目录'), null);
});

test('从目录名清洗作品标题', () => {
  assert.equal(parseWorkTitle('[RJ01426915] 测试作品', 'RJ01426915'), '测试作品');
  assert.equal(parseWorkTitle('RJ01426915 テスト作品', 'RJ01426915'), 'テスト作品');
  assert.equal(parseWorkTitle('【RJ01426915】中文标题', 'RJ01426915'), '中文标题');
  assert.equal(parseWorkTitle('RJ01426915', 'RJ01426915'), 'RJ01426915');
});

test('normalizeWorkno 返回规范化番号或空串', () => {
  assert.equal(normalizeWorkno('作品 rj01426915 测试'), 'RJ01426915');
  assert.equal(normalizeWorkno('无番号'), '');
});
