import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assetRelativePath,
  detectImage,
  imageDimensions,
} from '../src/assets.js';

function pngBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(64);
  buffer.writeUInt8(0x89, 0);
  buffer.write('PNG', 1, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function jpegBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt8(0xff, 0);
  buffer.writeUInt8(0xd8, 1);
  buffer.writeUInt8(0xff, 2);
  buffer.writeUInt8(0xc0, 3);
  buffer.writeUInt16BE(17, 4);
  buffer.writeUInt8(8, 6);
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  return buffer;
}

test('识别 PNG/JPEG 魔数与尺寸', () => {
  const png = pngBuffer(600, 480);
  assert.equal(detectImage(png)?.kind, 'png');
  assert.deepEqual(imageDimensions(png), { width: 600, height: 480 });

  const jpeg = jpegBuffer(800, 600);
  assert.equal(detectImage(jpeg)?.kind, 'jpeg');
  assert.deepEqual(imageDimensions(jpeg), { width: 800, height: 600 });
});

test('拒绝非图片内容', () => {
  assert.equal(detectImage(Buffer.from('<svg></svg>')), null);
  assert.equal(detectImage(Buffer.alloc(0)), null);
});

test('内容寻址路径按哈希分层', () => {
  const path = assetRelativePath('abcdef0123456789', 'jpg');
  assert.equal(path, 'ab/cd/abcdef0123456789.jpg');
});
