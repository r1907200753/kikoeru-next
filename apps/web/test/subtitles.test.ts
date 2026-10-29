import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeSubtitleBuffer,
  findActiveCueIndex,
  formatCueTime,
  parseSubtitle,
  parseSubtitleTime,
} from '../src/subtitles';

test('parseSubtitleTime 支持逗号毫秒、点号和省略小时', () => {
  assert.equal(parseSubtitleTime('00:01:02,500'), 62_500);
  assert.equal(parseSubtitleTime('1:02:03.004'), 3_723_004);
  assert.equal(parseSubtitleTime('02:03.4'), 123_400);
  assert.equal(parseSubtitleTime('没有时间'), null);
});

test('formatCueTime 按小时决定格式', () => {
  assert.equal(formatCueTime(5_000), '0:05');
  assert.equal(formatCueTime(65_000), '1:05');
  assert.equal(formatCueTime(3_725_000), '1:02:05');
});

test('WebVTT 解析忽略头部与 NOTE，并清理标签', () => {
  const content = [
    'WEBVTT',
    '',
    'NOTE 这是注释',
    '',
    'intro',
    '00:00:01.000 --> 00:00:03.500 align:middle',
    '<v 春>おかえりなさい</v>',
    '',
    '00:00:04.000 --> 00:00:06.000',
    '二行目<br>です',
  ].join('\n');
  const parsed = parseSubtitle(content, 'sample.vtt');
  assert.equal(parsed.format, 'vtt');
  assert.deepEqual(
    parsed.cues.map((cue) => [cue.startMs, cue.endMs, cue.text]),
    [
      [1_000, 3_500, 'おかえりなさい'],
      [4_000, 6_000, '二行目\nです'],
    ],
  );
});

test('SRT 兼容 CRLF 与序号行', () => {
  const content = [
    '1',
    '00:00:01,000 --> 00:00:02,500',
    '<i>第一句</i>',
    '',
    '2',
    '00:00:03,000 --> 00:00:04,000',
    '第二句',
  ].join('\r\n');
  const parsed = parseSubtitle(content, 'sample.srt');
  assert.equal(parsed.format, 'srt');
  assert.deepEqual(
    parsed.cues.map((cue) => [cue.startMs, cue.endMs, cue.text]),
    [
      [1_000, 2_500, '第一句'],
      [3_000, 4_000, '第二句'],
    ],
  );
});

test('LRC 支持一行多个时间戳、元数据与空行', () => {
  const content = [
    '[ti:测试曲]',
    '[ar:测试者]',
    '[00:01.00]第一句',
    '[00:03.00][00:05.00]副歌',
    '[00:07.00]',
  ].join('\n');
  const parsed = parseSubtitle(content, 'sample.lrc');
  assert.equal(parsed.format, 'lrc');
  assert.deepEqual(parsed.notes, ['ti: 测试曲', 'ar: 测试者']);
  assert.deepEqual(
    parsed.cues.map((cue) => [cue.startMs, cue.text]),
    [
      [1_000, '第一句'],
      [3_000, '副歌'],
      [5_000, '副歌'],
      [7_000, ''],
    ],
  );
  assert.deepEqual(
    parsed.cues.map((cue) => cue.endMs),
    [3_000, 5_000, 7_000, null],
  );
});

test('ASS 按 Format 顺序取值并去掉覆盖码', () => {
  const content = [
    '[Script Info]',
    'Title: 测试',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\\an8}上に表示, カンマも本文',
    'Comment: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,コメントは無視',
  ].join('\n');
  const parsed = parseSubtitle(content, 'sample.ass');
  assert.equal(parsed.format, 'ass');
  assert.deepEqual(
    parsed.cues.map((cue) => [cue.startMs, cue.endMs, cue.text]),
    [[1_000, 3_500, '上に表示, カンマも本文']],
  );
});

test('SAMI 按 SYNC 切分并以下一个时间点收尾', () => {
  const content = [
    '<SAMI>',
    '<BODY>',
    '<SYNC Start=1000><P Class=JP>おはよう<br>ございます',
    '<SYNC Start=4000><P Class=JP>&nbsp;',
    '<SYNC Start=6000><P Class=JP>またね',
    '</BODY>',
    '</SAMI>',
  ].join('\n');
  const parsed = parseSubtitle(content, 'sample.smi');
  assert.equal(parsed.format, 'smi');
  assert.deepEqual(
    parsed.cues.map((cue) => [cue.startMs, cue.endMs, cue.text]),
    [
      [1_000, 4_000, 'おはよう\nございます'],
      [6_000, null, 'またね'],
    ],
  );
});

test('txt 按内容嗅探 WebVTT 与 LRC', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nテスト';
  assert.equal(parseSubtitle(vtt, 'script.txt').format, 'vtt');
  const lrc = '[00:01.00]テスト';
  assert.equal(parseSubtitle(lrc, 'script.txt').format, 'lrc');
  const plain = '只是一段台本，没有时间轴。';
  const parsed = parseSubtitle(plain, 'script.txt');
  assert.equal(parsed.format, 'text');
  assert.equal(parsed.cues.length, 0);
  assert.equal(parsed.plain, plain);
});

test('GBK 编码字幕回退到 GB18030 解码', () => {
  const bytes = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]);
  assert.equal(decodeSubtitleBuffer(bytes.buffer as ArrayBuffer), '你好');
});

test('活动台词按时间区间判定，间隔处不高亮', () => {
  const cues = [
    { startMs: 1_000, endMs: 2_000, text: 'a' },
    { startMs: 5_000, endMs: 6_000, text: 'b' },
  ];
  assert.equal(findActiveCueIndex(cues, 500), -1);
  assert.equal(findActiveCueIndex(cues, 1_500), 0);
  assert.equal(findActiveCueIndex(cues, 4_000), -1);
  assert.equal(findActiveCueIndex(cues, 5_200), 1);
  assert.equal(findActiveCueIndex(cues, 9_000), -1);
});
