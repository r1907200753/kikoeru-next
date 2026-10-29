import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, readSettings, writeSettings } from '../src/index.js';

test('设置默认值来自环境，写入后覆盖并持久化', () => {
  const db = openDatabase(':memory:');
  try {
    const defaults = {
      libraryPath: 'K:/音频',
      proxyUrl: 'http://127.0.0.1:7890',
      ffprobePath: 'D:/ffmpeg/bin/ffprobe.exe',
    };
    const initial = readSettings(db, defaults);
    assert.equal(initial.libraryPath, 'K:/音频');
    assert.equal(initial.ffmpegPath, 'D:/ffmpeg/bin/ffmpeg.exe');

    const updated = writeSettings(db, {
      libraryPath: ' X:/ASMR ',
      proxyUrl: '',
      ffmpegPath: 'D:/tools/ffmpeg.exe',
    });
    assert.equal(updated.libraryPath, 'X:/ASMR');
    assert.equal(updated.proxyUrl, '');
    assert.equal(updated.ffmpegPath, 'D:/tools/ffmpeg.exe');

    const reread = readSettings(db, defaults);
    assert.equal(reread.libraryPath, 'X:/ASMR');
    assert.equal(reread.proxyUrl, '');
  } finally {
    db.close();
  }
});
