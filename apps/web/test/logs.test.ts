import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OperationLogEntry } from '../src/api.js';
import {
  formatLogEntry,
  formatLogTime,
  logCategoryLabel,
  matchesLogFilter,
  mergeLogEntries,
  serializeLogEntries,
} from '../src/logs.js';

function entry(overrides: Partial<OperationLogEntry> = {}): OperationLogEntry {
  return {
    id: 1,
    level: 'info',
    category: 'system',
    action: 'test.event',
    message: '测试事件',
    detail: {},
    clientIp: '',
    createdAt: '2026-10-28T04:00:00.000Z',
    ...overrides,
  };
}

test('日志合并按 id 去重排序并限制条数', () => {
  const merged = mergeLogEntries(
    [entry({ id: 2, message: '旧消息' }), entry({ id: 1 })],
    [entry({ id: 2, message: '新消息' }), entry({ id: 3 })],
  );
  assert.deepEqual(
    merged.map((item) => item.id),
    [1, 2, 3],
  );
  assert.equal(merged[1]?.message, '新消息');

  const fallbackA = entry({ id: 0, createdAt: '2026-10-28T04:00:00.000Z' });
  const fallbackB = entry({ id: 0, createdAt: '2026-10-28T04:00:01.000Z' });
  const fallbackMerged = mergeLogEntries([fallbackA], [fallbackA, fallbackB]);
  assert.equal(fallbackMerged.length, 2);

  const capped = mergeLogEntries(
    [entry({ id: 1 }), entry({ id: 2 })],
    [entry({ id: 3 }), entry({ id: 4 })],
    2,
  );
  assert.deepEqual(
    capped.map((item) => item.id),
    [3, 4],
  );
});

test('日志筛选与类别标签', () => {
  assert.equal(logCategoryLabel('scrape'), '刮削');
  assert.equal(logCategoryLabel('custom'), 'custom');
  assert.equal(matchesLogFilter(entry(), { category: 'all', onlyProblems: false }), true);
  assert.equal(matchesLogFilter(entry(), { category: 'scan', onlyProblems: false }), false);
  assert.equal(matchesLogFilter(entry({ level: 'warn' }), { category: 'all', onlyProblems: true }), true);
  assert.equal(matchesLogFilter(entry({ level: 'error' }), { category: 'system', onlyProblems: true }), true);
  assert.equal(matchesLogFilter(entry({ level: 'success' }), { category: 'all', onlyProblems: true }), false);
});

test('日志时间与复制文本格式化', () => {
  const now = new Date(2026, 9, 28, 12, 0, 0);
  const today = new Date(2026, 9, 28, 9, 5, 7).toISOString();
  const yesterday = new Date(2026, 9, 27, 23, 5, 7).toISOString();
  assert.equal(formatLogTime(today, now), '09:05:07');
  assert.equal(formatLogTime(yesterday, now), '10-27 23:05:07');
  assert.equal(formatLogTime('not-a-date', now), 'not-a-date');

  const formatted = formatLogEntry(
    entry({ level: 'warn', category: 'export', message: '导出失败', createdAt: today }),
    now,
  );
  assert.equal(formatted, '[09:05:07] [警告] [导出] 导出失败');

  const serialized = serializeLogEntries(
    [entry({ createdAt: today }), entry({ id: 2, category: 'auth', createdAt: today })],
    now,
  );
  assert.equal(serialized.split('\n').length, 2);
  assert.match(serialized, /\[系统\] 测试事件/);
  assert.match(serialized, /\[访问\] 测试事件/);
});
