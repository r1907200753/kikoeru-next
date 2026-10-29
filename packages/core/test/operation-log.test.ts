import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import {
  MAX_OPERATION_LOGS,
  OperationLogger,
  type OperationLogEntry,
} from '../src/operation-log.js';

function seed(logger: OperationLogger, count: number): void {
  for (let index = 0; index < count; index += 1) {
    logger.record({
      level: index % 2 === 0 ? 'info' : 'warn',
      category: index % 3 === 0 ? 'scan' : 'api',
      action: `seed.${index}`,
      message: `第 ${index} 条`,
    });
  }
}

test('操作日志记录、按 id 倒序与最新 id', () => {
  const db = openDatabase(':memory:');
  try {
    const logger = new OperationLogger(db);
    const first = logger.record({
      level: 'success',
      category: 'settings',
      action: 'settings.update',
      message: '已更新设置',
      detail: { proxyUrl: 'http://127.0.0.1:7890' },
      clientIp: '192.168.1.9',
    });
    const second = logger.record({
      category: 'system',
      action: 'server.start',
      message: '服务已初始化',
    });
    assert.ok(first.id > 0);
    assert.equal(second.id, first.id + 1);
    assert.equal(first.level, 'success');
    assert.ok(Date.parse(first.createdAt) > 0);

    const page = logger.list();
    assert.equal(page.items.length, 2);
    assert.equal(page.items[0]?.id, second.id);
    assert.equal(page.items[1]?.id, first.id);
    assert.equal(page.latestId, second.id);
    assert.equal(page.hasMore, false);
    assert.deepEqual(page.items[1]?.detail, { proxyUrl: 'http://127.0.0.1:7890' });
    assert.equal(page.items[1]?.clientIp, '192.168.1.9');
  } finally {
    db.close();
  }
});

test('操作日志敏感字段与 URL 凭据脱敏', () => {
  const db = openDatabase(':memory:');
  try {
    const logger = new OperationLogger(db);
    logger.record({
      category: 'auth',
      action: 'auth.login',
      message: '登录 http://user:pass@example.test/path password=123456',
      detail: {
        password: 'plain-password',
        token: 'secret-token',
        nested: {
          authorization: 'Bearer abc',
          cookie: 'kikoeru_session=abc',
          keep: 'http://name:pw@example.test/a',
        },
        items: Array.from({ length: 30 }, (_, index) => index),
      },
    });
    const entry = logger.list().items[0] as OperationLogEntry;
    assert.equal(entry.message.includes('user:pass'), false);
    assert.match(entry.message, /\/\/\*\*\*@example\.test/);
    assert.equal(entry.message.includes('password=123456'), false);
    const detail = entry.detail as Record<string, unknown>;
    assert.equal(detail.password, '***');
    assert.equal(detail.token, '***');
    const nested = detail.nested as Record<string, unknown>;
    assert.equal(nested.authorization, '***');
    assert.equal(nested.cookie, '***');
    assert.equal(nested.keep, 'http://***@example.test/a');
    assert.equal((detail.items as unknown[]).length, 20);
  } finally {
    db.close();
  }
});

test('操作日志按类别、级别与 id 游标筛选', () => {
  const db = openDatabase(':memory:');
  try {
    const logger = new OperationLogger(db);
    seed(logger, 12);
    const all = logger.list({ limit: 100 }).items;
    const warns = logger.list({ level: 'warn', limit: 100 }).items;
    assert.equal(warns.length, 6);
    assert.ok(warns.every((entry) => entry.level === 'warn'));

    const scans = logger.list({ category: 'scan', limit: 100 }).items;
    assert.equal(scans.length, 4);

    const middle = all[5] as OperationLogEntry;
    const next = logger.list({ afterId: middle.id, limit: 2 });
    assert.equal(next.items.length, 2);
    assert.ok(next.items[0]?.id === middle.id + 1);
    assert.ok(next.items[1]?.id === middle.id + 2);
    assert.equal(next.hasMore, true);

    const previous = logger.list({ beforeId: middle.id, limit: 2 });
    assert.equal(previous.items.length, 2);
    assert.ok((previous.items[0]?.id ?? 0) > (previous.items[1]?.id ?? 0));

    assert.equal(logger.list({ limit: 0 }).items.length, 1);
    assert.equal(logger.list({ limit: 9999 }).items.length, 12);
  } finally {
    db.close();
  }
});

test('操作日志保留上限、清空与订阅', () => {
  const db = openDatabase(':memory:');
  try {
    const logger = new OperationLogger(db);
    const seen: OperationLogEntry[] = [];
    const unsubscribe = logger.subscribe((entry) => seen.push(entry));
    seed(logger, 3);
    assert.equal(seen.length, 3);
    unsubscribe();
    seed(logger, 2);
    assert.equal(seen.length, 3);

    seed(logger, MAX_OPERATION_LOGS + 5);
    const count = db.prepare('SELECT COUNT(*) AS count FROM operation_logs').get() as {
      count: number;
    };
    assert.equal(Number(count.count), MAX_OPERATION_LOGS);
    const newest = logger.list({ limit: 1 }).items[0] as OperationLogEntry;
    const oldest = db
      .prepare('SELECT MIN(id) AS id FROM operation_logs')
      .get() as { id?: number };
    assert.ok(Number(oldest.id) > 1);

    logger.clear();
    const cleared = logger.list();
    assert.equal(cleared.items.length, 0);
    assert.equal(cleared.latestId, 0);
    assert.equal(newest.id > 0, true);
  } finally {
    db.close();
  }
});
