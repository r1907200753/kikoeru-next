import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getSetting, setSetting } from './repository.js';

const KEY_PASSWORD_HASH = 'security.passwordHash';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_NAME = 'kikoeru_session';

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N: n, r, p, maxmem: 256 * 1024 * 1024 }, (error, key) => {
      if (error) {
        reject(error);
      } else {
        resolve(key);
      }
    });
  });
}

export function validatePassword(password: unknown): string {
  if (typeof password !== 'string') {
    throw new Error('密码格式不正确');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`密码不能超过 ${MAX_PASSWORD_LENGTH} 个字符`);
  }
  return password;
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt, KEY_LENGTH, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored) {
    return false;
  }
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const n = Number.parseInt(parts[1] ?? '', 10);
  const r = Number.parseInt(parts[2] ?? '', 10);
  const p = Number.parseInt(parts[3] ?? '', 10);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  // 限制参数上限，避免被篡改的库值把 CPU/内存拖死。
  if (n < 1024 || n > 262144 || r < 1 || r > 32 || p < 1 || p > 16) {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] ?? '', 'base64');
    expected = Buffer.from(parts[5] ?? '', 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }
  let actual: Buffer;
  try {
    actual = await deriveKey(password, salt, expected.length, n, r, p);
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hasPassword(db: DatabaseSync): boolean {
  return getSetting(db, KEY_PASSWORD_HASH, '') !== '';
}

export async function setPassword(db: DatabaseSync, password: string): Promise<void> {
  const hash = await hashPassword(password);
  setSetting(db, KEY_PASSWORD_HASH, hash);
}

export async function changePassword(
  db: DatabaseSync,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const stored = getSetting(db, KEY_PASSWORD_HASH, '');
  if (stored && !(await verifyPassword(currentPassword, stored))) {
    return false;
  }
  await setPassword(db, newPassword);
  revokeAllAuthSessions(db);
  return true;
}

export async function authenticatePassword(db: DatabaseSync, password: string): Promise<boolean> {
  const stored = getSetting(db, KEY_PASSWORD_HASH, '');
  if (!stored) {
    return false;
  }
  return verifyPassword(password, stored);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface AuthSession {
  token: string;
  expiresAt: string;
}

export function createAuthSession(db: DatabaseSync, ttlMs = SESSION_TTL_MS): AuthSession {
  cleanupAuthSessions(db);
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = new Date(now + ttlMs).toISOString();
  db.prepare(
    'INSERT INTO auth_sessions (token_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(hashToken(token), new Date(now).toISOString(), new Date(now).toISOString(), expiresAt);
  return { token, expiresAt };
}

export function findAuthSession(db: DatabaseSync, token: string): AuthSession | null {
  if (!token) {
    return null;
  }
  const tokenHash = hashToken(token);
  const row = db
    .prepare('SELECT expires_at FROM auth_sessions WHERE token_hash = ?')
    .get(tokenHash) as { expires_at?: unknown } | undefined;
  if (!row) {
    return null;
  }
  const expiresAt = typeof row.expires_at === 'string' ? row.expires_at : '';
  if (!expiresAt || Date.parse(expiresAt) <= Date.now()) {
    db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  // 每小时最多刷新一次 last_seen，避免每个请求都写库。
  const lastSeen = db
    .prepare('SELECT last_seen_at FROM auth_sessions WHERE token_hash = ?')
    .get(tokenHash) as { last_seen_at?: unknown } | undefined;
  const lastSeenMs = Date.parse(typeof lastSeen?.last_seen_at === 'string' ? lastSeen.last_seen_at : '');
  if (!Number.isFinite(lastSeenMs) || Date.now() - lastSeenMs > 60 * 60 * 1000) {
    db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?').run(
      new Date().toISOString(),
      tokenHash,
    );
  }
  return { token, expiresAt };
}

export function revokeAuthSession(db: DatabaseSync, token: string): void {
  if (!token) {
    return;
  }
  db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hashToken(token));
}

export function revokeAllAuthSessions(db: DatabaseSync): void {
  db.prepare('DELETE FROM auth_sessions').run();
}

export function cleanupAuthSessions(db: DatabaseSync): void {
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(new Date().toISOString());
}

export function parseSessionCookie(cookieHeader: string | undefined): string {
  if (!cookieHeader) {
    return '';
  }
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    if (name === SESSION_COOKIE_NAME) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return '';
      }
    }
  }
  return '';
}

export function buildSessionCookie(
  token: string,
  maxAgeSeconds: number,
  secure = false,
): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function buildClearedSessionCookie(secure = false): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}
