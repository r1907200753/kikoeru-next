import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAudioFileName,
  isImageFileName,
  isSubtitleFileName,
  mimeTypeForFileName,
  naturalCompare,
} from '../src/media.js';

test('识别音频、图片与字幕扩展名', () => {
  assert.equal(isAudioFileName('01 - 开场.MP3'), true);
  assert.equal(isAudioFileName('track.flac'), true);
  assert.equal(isAudioFileName('cover.jpg'), false);
  assert.equal(isImageFileName('cover.webp'), true);
  assert.equal(isSubtitleFileName('01.vtt'), true);
  assert.equal(isSubtitleFileName('readme.md'), false);
});

test('返回正确的媒体类型', () => {
  assert.equal(mimeTypeForFileName('a.mp3'), 'audio/mpeg');
  assert.equal(mimeTypeForFileName('a.FLAC'), 'audio/flac');
  assert.equal(mimeTypeForFileName('a.jpg'), 'image/jpeg');
  assert.equal(mimeTypeForFileName('a.unknown'), 'application/octet-stream');
});

test('自然排序把数字按大小而不是字典序排列', () => {
  const names = ['10 - c.mp3', '2 - b.mp3', '1 - a.mp3'];
  names.sort(naturalCompare);
  assert.deepEqual(names, ['1 - a.mp3', '2 - b.mp3', '10 - c.mp3']);
});
