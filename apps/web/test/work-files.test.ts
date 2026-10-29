import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkFileEntry } from '../src/api';
import {
  audioFilesOf,
  audioRelativePath,
  breadcrumbTrail,
  choosePreferredFolder,
  dirnameOf,
  filesInFolder,
  folderSubtitles,
  foldersIn,
  normalizeFolder,
  relativeToWork,
  subtitlesForAudio,
} from '../src/work-files';

function makeFile(path: string, kind: WorkFileEntry['kind'] = 'other'): WorkFileEntry {
  const name = path.split('/').pop() ?? path;
  return {
    path,
    name,
    kind,
    size: 1024,
    mtimeMs: 0,
    durationMs: kind === 'audio' ? 60_000 : null,
    trackId: kind === 'audio' ? 1 : null,
  };
}

const FILES: WorkFileEntry[] = [
  makeFile('01 特典.mp3', 'audio'),
  makeFile('01_本編/1.SEあり/01 开场.mp3', 'audio'),
  makeFile('01_本編/1.SEあり/01 开场.mp3.vtt', 'subtitle'),
  makeFile('01_本編/1.SEあり/01 开场.lrc', 'subtitle'),
  makeFile('01_本編/1.SEあり/02 第二轨.mp3', 'audio'),
  makeFile('01_本編/1.SEあり/02 第二轨.srt', 'subtitle'),
  makeFile('01_本編/1.SEあり/cover.jpg', 'image'),
  makeFile('01_本編/2.SEなし/01 开场.mp3', 'audio'),
  makeFile('01_本編/台本.txt', 'subtitle'),
  makeFile('02_extra/deep/inner/note.txt', 'other'),
];

test('normalizeFolder 统一斜杠并去掉首尾分隔符', () => {
  assert.equal(normalizeFolder('/01_本編/'), '01_本編');
  assert.equal(normalizeFolder('01_本編\\1.SEあり'), '01_本編/1.SEあり');
  assert.equal(normalizeFolder(''), '');
});

test('dirnameOf 取 posix 父目录', () => {
  assert.equal(dirnameOf('01_本編/1.SEあり/01.mp3'), '01_本編/1.SEあり');
  assert.equal(dirnameOf('01.mp3'), '');
});

test('foldersIn 只列直接子目录并统计子孙文件数', () => {
  const root = foldersIn(FILES, '');
  assert.deepEqual(
    root.map((folder) => [folder.name, folder.path, folder.fileCount]),
    [
      ['01_本編', '01_本編', 8],
      ['02_extra', '02_extra', 1],
    ],
  );
  const main = foldersIn(FILES, '01_本編');
  assert.deepEqual(
    main.map((folder) => [folder.name, folder.path, folder.fileCount]),
    [
      ['1.SEあり', '01_本編/1.SEあり', 6],
      ['2.SEなし', '01_本編/2.SEなし', 1],
    ],
  );
  assert.deepEqual(foldersIn(FILES, '01_本編/2.SEなし'), []);
});

test('filesInFolder 只返回当前目录的文件', () => {
  assert.deepEqual(
    filesInFolder(FILES, '').map((file) => file.path),
    ['01 特典.mp3'],
  );
  assert.deepEqual(
    filesInFolder(FILES, '/01_本編/').map((file) => file.path),
    ['01_本編/台本.txt'],
  );
  assert.deepEqual(
    filesInFolder(FILES, '01_本編/1.SEあり').map((file) => file.name),
    ['01 开场.mp3', '01 开场.mp3.vtt', '01 开场.lrc', '02 第二轨.mp3', '02 第二轨.srt', 'cover.jpg'],
  );
});

test('breadcrumbTrail 生成累计路径', () => {
  assert.deepEqual(breadcrumbTrail('/01_本編/1.SEあり/'), [
    { name: '01_本編', path: '01_本編' },
    { name: '1.SEあり', path: '01_本編/1.SEあり' },
  ]);
  assert.deepEqual(breadcrumbTrail(''), []);
});

test('audioFilesOf 只保留带 trackId 的音频', () => {
  const files = [
    ...FILES,
    makeFile('01_本編/unindexed.flac', 'audio'),
  ];
  const broken = files[files.length - 1];
  if (broken) {
    broken.trackId = null;
  }
  assert.deepEqual(
    audioFilesOf(files).map((file) => file.path),
    [
      '01 特典.mp3',
      '01_本編/1.SEあり/01 开场.mp3',
      '01_本編/1.SEあり/02 第二轨.mp3',
      '01_本編/2.SEなし/01 开场.mp3',
    ],
  );
});

test('relativeToWork 去掉作品目录前缀', () => {
  assert.equal(
    relativeToWork('RJ00000001 作品/01_本編/1.SEあり/01 开场.mp3', 'RJ00000001 作品'),
    '01_本編/1.SEあり/01 开场.mp3',
  );
  assert.equal(relativeToWork('01_本編/01.mp3', ''), '01_本編/01.mp3');
  assert.equal(
    audioRelativePath(
      { fileName: '01 开场.mp3', relativePath: 'RJ00000001 作品/01_本編/1.SEあり/01 开场.mp3' },
      'RJ00000001 作品',
    ),
    '01_本編/1.SEあり/01 开场.mp3',
  );
});

test('subtitlesForAudio 优先同名字幕并按格式排序', () => {
  assert.deepEqual(
    subtitlesForAudio(FILES, '01_本編/1.SEあり/01 开场.mp3').map((file) => file.name),
    ['01 开场.mp3.vtt', '01 开场.lrc'],
  );
  assert.deepEqual(
    subtitlesForAudio(FILES, '01_本編/1.SEあり/02 第二轨.mp3').map((file) => file.name),
    ['02 第二轨.srt'],
  );
  assert.deepEqual(subtitlesForAudio(FILES, '01_本編/1.SEあり/03 无字幕.mp3'), []);
});

test('字幕可以穿透到同作品其他格式目录', () => {
  const files = [
    makeFile('本編/MP3/01 开场.mp3', 'audio'),
    makeFile('本編/WAV/01 开场.wav', 'audio'),
    makeFile('本編/WAV/01 开场.wav.vtt', 'subtitle'),
    makeFile('本編/WAV/01 开场.lrc', 'subtitle'),
    makeFile('本編/WAV/02 其他.wav.vtt', 'subtitle'),
  ];
  assert.deepEqual(
    subtitlesForAudio(files, '本編/MP3/01 开场.mp3').map((file) => file.path),
    ['本編/WAV/01 开场.wav.vtt', '本編/WAV/01 开场.lrc'],
  );
  assert.deepEqual(
    folderSubtitles(files, '本編/MP3/01 开场.mp3').map((file) => file.path),
    ['本編/WAV/01 开场.lrc', '本編/WAV/01 开场.wav.vtt'],
  );
});

test('folderSubtitles 返回当前文件夹与跨目录匹配字幕', () => {
  assert.deepEqual(
    folderSubtitles(FILES, '01_本編/1.SEあり/01 开场.mp3').map((file) => file.name),
    ['01 开场.lrc', '01 开场.mp3.vtt', '02 第二轨.srt'],
  );
  assert.deepEqual(folderSubtitles(FILES, '01 特典.mp3'), []);
});

test('智能路径按效果音与音频类型选择目录', () => {
  assert.equal(
    choosePreferredFolder(FILES, {
      smartPath: true,
      preferEffectSound: true,
      audioPriority: 'mp3',
    }),
    '01_本編/1.SEあり',
  );
  assert.equal(
    choosePreferredFolder(FILES, {
      smartPath: false,
      preferEffectSound: true,
      audioPriority: 'mp3',
    }),
    '',
  );
  assert.equal(
    choosePreferredFolder([makeFile('01 特典.flac', 'audio')], {
      smartPath: true,
      preferEffectSound: true,
      audioPriority: 'flac',
    }),
    '',
  );
});
