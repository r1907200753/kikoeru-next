import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const KEY_BYTES = 32;
const KEY_FILE = 'secret.key';
const IV_BYTES = 12;

export function loadOrCreateSecretKey(dataDir: string): Buffer {
  const keyPath = path.join(dataDir, KEY_FILE);
  if (fs.existsSync(keyPath)) {
    const key = fs.readFileSync(keyPath);
    if (key.length !== KEY_BYTES) {
      throw new Error(`密钥文件长度不正确：${keyPath}`);
    }
    return key;
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const key = crypto.randomBytes(KEY_BYTES);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptSecret(key: Buffer, payload: string): string {
  const [ivPart, tagPart, dataPart] = payload.split('.');
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error('密文格式不正确');
  }
  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  const data = Buffer.from(dataPart, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
