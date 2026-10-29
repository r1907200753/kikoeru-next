import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TrackSummary } from '../src/api';
import {
  buildTrackTree,
  countTracks,
  fileNameFor,
  folderLabelFor,
  folderQueueFor,
} from '../src/track-tree';

function makeTrack(
  id: number,
  relativePath: string,
  overrides: Partial<TrackSummary> = {},
): TrackSummary {
  return {
    id,
    workId: 1,
    title: `音轨 ${id}`,
    disc: 1,
    idx: id,
    durationMs: 60_000,
    fileName: relativePath.split(/[\\/]/).pop() ?? '',
    relativePath,
    size: 1024,
    variants: [],
    ...overrides,
  };
}

const WORK_PATH = 'RJ01426916 差分作品';
const SE_1 = makeTrack(1, 'RJ01426916 差分作品\\1.本編\\1.SEあり\\01 - 开场.mp3');
const SE_2 = makeTrack(2, 'RJ01426916 差分作品\\1.本編\\1.SEあり\\02 - 第二轨.mp3');
const NO_SE_1 = makeTrack(3, 'RJ01426916 差分作品/1.本編/2.SEなし/01 - 开场.mp3');
const NO_SE_2 = makeTrack(4, 'RJ01426916 差分作品/1.本編/2.SEなし/02 - 第二轨.mp3');
const ROOT_TRACK = makeTrack(5, 'RJ01426916 差分作品\\00 - 特典.mp3');

test('文件夹队列只收集同一差分目录并保持原顺序', () => {
  const tracks = [SE_1, SE_2, NO_SE_1, NO_SE_2, ROOT_TRACK];
  assert.deepEqual(
    folderQueueFor(tracks, WORK_PATH, SE_1).map((item) => item.id),
    [1, 2],
  );
  assert.deepEqual(
    folderQueueFor(tracks, WORK_PATH, NO_SE_2).map((item) => item.id),
    [3, 4],
  );
  assert.deepEqual(
    folderQueueFor(tracks, WORK_PATH, ROOT_TRACK).map((item) => item.id),
    [5],
  );
});

test('文件夹标签取最近一级目录，根目录为空串', () => {
  assert.equal(folderLabelFor(SE_1, WORK_PATH), '1.SEあり');
  assert.equal(folderLabelFor(NO_SE_1, WORK_PATH), '2.SEなし');
  assert.equal(folderLabelFor(ROOT_TRACK, WORK_PATH), '');
});

test('音轨不在列表或目录不在列表中时回退为单曲队列', () => {
  const ghost = makeTrack(99, 'RJ01426916 差分作品\\9.別ver\\01 - 未扫描.mp3');
  const tracks = [SE_1, SE_2, NO_SE_1, NO_SE_2];
  assert.deepEqual(
    folderQueueFor(tracks, WORK_PATH, ghost).map((item) => item.id),
    [99],
  );
});

test('目录树按层级分组、保留根音轨并统计总轨数', () => {
  const tree = buildTrackTree([SE_1, SE_2, NO_SE_1, NO_SE_2, ROOT_TRACK], WORK_PATH);
  assert.deepEqual(
    tree.tracks.map((item) => item.id),
    [5],
  );
  assert.deepEqual(
    tree.dirs.map((node) => node.name),
    ['1.本編'],
  );
  const main = tree.dirs[0];
  assert.ok(main);
  assert.equal(main.path, '/1.本編');
  assert.deepEqual(
    main.dirs.map((node) => node.name),
    ['1.SEあり', '2.SEなし'],
  );
  assert.deepEqual(
    main.dirs.map((node) => node.tracks.length),
    [2, 2],
  );
  assert.equal(countTracks(tree), 5);
  assert.equal(countTracks(main), 4);
});

test('文件名兼容反斜杠路径并带标题兜底', () => {
  assert.equal(fileNameFor(SE_1), '01 - 开场.mp3');
  assert.equal(fileNameFor(NO_SE_1), '01 - 开场.mp3');
  const bare = makeTrack(7, '', { fileName: '', title: '只有标题' });
  assert.equal(fileNameFor(bare), '只有标题');
});
