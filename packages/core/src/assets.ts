import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { generateWebpVariant } from './ffmpeg.js';
import { isPathInside } from './paths.js';
import { getAsset, linkWorkAsset, upsertAsset, type AssetRecord } from './repository.js';

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif';

export interface ImageInfo {
  kind: ImageKind;
  ext: string;
  mime: string;
}

const IMAGE_INFO: Record<ImageKind, ImageInfo> = {
  jpeg: { kind: 'jpeg', ext: 'jpg', mime: 'image/jpeg' },
  png: { kind: 'png', ext: 'png', mime: 'image/png' },
  webp: { kind: 'webp', ext: 'webp', mime: 'image/webp' },
  gif: { kind: 'gif', ext: 'gif', mime: 'image/gif' },
  avif: { kind: 'avif', ext: 'avif', mime: 'image/avif' },
};

export function detectImage(buffer: Buffer): ImageInfo | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return IMAGE_INFO.jpeg;
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return IMAGE_INFO.png;
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return IMAGE_INFO.webp;
  }
  if (buffer.length >= 6 && buffer.toString('ascii', 0, 6).startsWith('GIF8')) {
    return IMAGE_INFO.gif;
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 12).includes('ftypavif')) {
    return IMAGE_INFO.avif;
  }
  return null;
}

export function imageDimensions(buffer: Buffer): { width: number; height: number } | null {
  const info = detectImage(buffer);
  if (!info) {
    return null;
  }
  try {
    if (info.kind === 'png' && buffer.length >= 24) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (info.kind === 'gif' && buffer.length >= 10) {
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (info.kind === 'jpeg') {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buffer[offset + 1] ?? 0;
        if (marker === 0xd8 || marker === 0xd9) {
          offset += 2;
          continue;
        }
        const length = buffer.readUInt16BE(offset + 2);
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        ) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return width > 0 && height > 0 ? { width, height } : null;
        }
        offset += 2 + length;
      }
      return null;
    }
    if (info.kind === 'webp' && buffer.length >= 30) {
      const format = buffer.toString('ascii', 12, 16);
      if (format === 'VP8X') {
        const width = 1 + buffer.readUIntLE(24, 3);
        const height = 1 + buffer.readUIntLE(27, 3);
        return { width, height };
      }
      if (format === 'VP8 ') {
        const width = buffer.readUInt16LE(26) & 0x3fff;
        const height = buffer.readUInt16LE(28) & 0x3fff;
        return width > 0 && height > 0 ? { width, height } : null;
      }
      if (format === 'VP8L') {
        const b0 = buffer[21] ?? 0;
        const b1 = buffer[22] ?? 0;
        const b2 = buffer[23] ?? 0;
        const b3 = buffer[24] ?? 0;
        const width = 1 + (((b1 & 0x3f) << 8) | b0);
        const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        return { width, height };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function assetRelativePath(sha256: string, ext: string): string {
  return `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.${ext}`;
}

async function writeAtomic(target: string, data: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  await fs.writeFile(temp, data);
  await fs.rename(temp, target);
}

async function fileExists(target: string): Promise<boolean> {
  try {
    const stat = await fs.stat(target);
    return stat.isFile();
  } catch {
    return false;
  }
}

export interface StoreImageInput {
  db: DatabaseSync;
  assetsDir: string;
  workId: number;
  buffer: Buffer;
  contentType: string;
  originUrl: string;
  source: string;
  ffmpegPath: string;
}

export interface StoredImage {
  assetId: number;
  width: number | null;
  height: number | null;
  sha256: string;
  variants: number[];
}

export async function storeWorkCover(input: StoreImageInput): Promise<StoredImage> {
  const info = detectImage(input.buffer);
  if (!info) {
    throw new Error(`封面不是有效图片（Content-Type: ${input.contentType || '空'}）`);
  }
  const sha256 = crypto.createHash('sha256').update(input.buffer).digest('hex');
  const relative = assetRelativePath(sha256, info.ext);
  const absolute = path.join(path.resolve(input.assetsDir), ...relative.split('/'));
  if (!(await fileExists(absolute))) {
    await writeAtomic(absolute, input.buffer);
  }

  const dimensions = imageDimensions(input.buffer);
  const variants: number[] = [];
  for (const width of [240, 600]) {
    const variantPath = path.join(path.dirname(absolute), `${sha256}_${width}.webp`);
    if (await fileExists(variantPath)) {
      variants.push(width);
      continue;
    }
    if (await generateWebpVariant(input.ffmpegPath, absolute, variantPath, width)) {
      variants.push(width);
    }
  }

  const assetId = upsertAsset(input.db, {
    sha256,
    kind: 'cover',
    mime: info.mime,
    bytes: input.buffer.length,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    path: relative,
  });
  linkWorkAsset(input.db, {
    workId: input.workId,
    role: 'cover',
    assetId,
    source: input.source,
    originUrl: input.originUrl,
  });

  return {
    assetId,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    sha256,
    variants,
  };
}

export interface ResolvedAssetFile {
  absolutePath: string;
  mime: string;
}

export async function resolveAssetFile(
  assetsDir: string,
  asset: AssetRecord,
  size: 'original' | '240' | '600',
): Promise<ResolvedAssetFile | null> {
  const root = path.resolve(assetsDir);
  const absolute = path.resolve(root, ...asset.path.split('/'));
  if (!isPathInside(root, absolute)) {
    return null;
  }
  if (size !== 'original') {
    const variant = path.join(path.dirname(absolute), `${asset.sha256}_${size}.webp`);
    if (await fileExists(variant)) {
      return { absolutePath: variant, mime: 'image/webp' };
    }
  }
  if (await fileExists(absolute)) {
    return { absolutePath: absolute, mime: asset.mime };
  }
  return null;
}

export function getAssetById(db: DatabaseSync, assetId: number): AssetRecord | null {
  return getAsset(db, assetId);
}
