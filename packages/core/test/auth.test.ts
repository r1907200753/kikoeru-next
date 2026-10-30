import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  authenticatePassword,
  buildClearedSessionCookie,
  buildSessionCookie,
  changePassword,
  cleanupAuthSessions,
  createAuthSession,
  findAuthSession,
  hasPassword,
  hashPassword,
  parseSessionCookie,
  revokeAllAuthSessions,
  revokeAuthSession,
  SESSION_COOKIE_NAME,
  setPassword,
  validatePassword,
  verifyPassword,
} from '../src/auth.js';
import { openDatabase } from '../src/db.js';

test('密码策略与 scrypt 校验', async () => {
  assert.throws(() => validatePassword('1234567'), /至少需要 8 个字符/);
  assert.throws(() => validatePassword('x'.repeat(129)), /不能超过 128 个字符/);
  assert.throws(() => validatePassword(12345678 as unknown), /格式不正确/);
  assert.equal(validatePassword('correct-horse'), 'correct-horse');

  const hash = await hashPassword('correct-horse');
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('correct-horse', hash), true);
  assert.equal(await verifyPassword('wrong-horse', hash), false);
  assert.equal(await verifyPassword('correct-horse', ''), false);
  assert.equal(await verifyPassword('correct-horse', 'scrypt$bad'), false);
  assert.equal(await verifyPassword('correct-horse', 'scrypt$16384$8$1$@@@$@@@'), false);

  const other = await hashPassword('correct-horse');
  assert.notEqual(other, hash);
  assert.equal(await verifyPassword('correct-horse', other), true);
});

test('密码存储与修改后会话失效', async () => {
  const db = openDatabase(':memory:');
  try {
    assert.equal(hasPassword(db), false);
    await setPassword(db, 'first-password');
    assert.equal(hasPassword(db), true);
    assert.equal(await authenticatePassword(db, 'first-password'), true);
    assert.equal(await authenticatePassword(db, 'not-the-password'), false);

    const first = createAuthSession(db);
    assert.ok(findAuthSession(db, first.token));

    assert.equal(await changePassword(db, 'wrong-password', 'second-password'), false);
    assert.equal(await changePassword(db, 'first-password', 'second-password'), true);
    assert.equal(findAuthSession(db, first.token), null);
    assert.equal(await authenticatePassword(db, 'first-password'), false);
    assert.equal(await authenticatePassword(db, 'second-password'), true);
  } finally {
    db.close();
  }
});

test('会话创建、撤销与过期清理', async () => {
  const db = openDatabase(':memory:');
  try {
    const session = createAuthSession(db, 60_000);
    assert.match(session.token, /^[A-Za-z0-9_-]{40,}$/);
    assert.ok(Date.parse(session.expiresAt) > Date.now());
    const found = findAuthSession(db, session.token);
    assert.equal(found?.expiresAt, session.expiresAt);

    const expired = createAuthSession(db, 1);
    db.prepare('UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ?').run(
      new Date(Date.now() - 1000).toISOString(),
      createHash('sha256').update(expired.token).digest('hex'),
    );
    assert.equal(findAuthSession(db, expired.token), null);

    revokeAuthSession(db, session.token);
    assert.equal(findAuthSession(db, session.token), null);

    const another = createAuthSession(db);
    revokeAllAuthSessions(db);
    assert.equal(findAuthSession(db, another.token), null);

    cleanupAuthSessions(db);
    const count = db.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get() as {
      count: number;
    };
    assert.equal(Number(count.count), 0);
  } finally {
    db.close();
  }
});

test('会话 Cookie 解析与构建', () => {
  assert.equal(
    parseSessionCookie(`${SESSION_COOKIE_NAME}=abc123; theme=dark`),
    'abc123',
  );
  assert.equal(parseSessionCookie(`theme=dark; ${SESSION_COOKIE_NAME}=tok%2Fen`), 'tok/en');
  assert.equal(parseSessionCookie(''), '');
  assert.equal(parseSessionCookie('broken'), '');
  assert.equal(parseSessionCookie(`${SESSION_COOKIE_NAME}=%E0%A4%A`), '');

  const cookie = buildSessionCookie('token-value', 3600);
  assert.match(cookie, /^kikoeru_session=token-value; Path=\/; HttpOnly; SameSite=Lax; Max-Age=3600$/);
  assert.match(buildSessionCookie('token-value', 3600, true), /; Secure$/);
  const cleared = buildClearedSessionCookie();
  assert.match(cleared, /Max-Age=0/);
  assert.equal(parseSessionCookie(cleared), '');
});

test('数据库迁移到 V7 并包含会话表与日志表', () => {
  const db = openDatabase(':memory:');
  try {
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
    assert.equal(Number(version.user_version), 7);
    for (const name of ['auth_sessions', 'operation_logs']) {
      const table = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name) as { name?: string } | undefined;
      assert.equal(table?.name, name);
    }
  } finally {
    db.close();
  }
});
