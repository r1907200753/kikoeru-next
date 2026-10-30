import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OnlineWorkDetail } from '../src/api';
import { buildOnlinePlayerData } from '../src/online-player';

const DETAIL: OnlineWorkDetail = {
  work: {
    id: 1234,
    code: 'RJ01234567',
    title: '在线测试',
    circle: '测试社团',
    releaseDate: '2026-01-01',
    rating: 4.5,
    priceYen: 990,
    reviewCount: 1,
    dlCount: 2,
    tags: ['ASMR'],
    vas: ['声优A'],
    durationMs: 3000,
    coverUrl: '/api/online/works/1234/cover?type=main',
    thumbUrl: '/api/online/works/1234/cover?type=sam',
    local: false,
    favoriteAt: '',
  },
  tracks: [
    {
      index: 1,
      hash: 'audio-hash',
      title: '01 开场.wav',
      disc: 1,
      groupTitle: '正式版',
      durationMs: 1500,
      size: 100,
      streamUrl: '/api/online/works/1234/tracks/audio-hash/stream',
    },
  ],
  trackTree: [
    {
      type: 'folder',
      title: '正式版',
      children: [
        {
          type: 'audio',
          title: '01 开场.wav',
          hash: 'audio-hash',
          durationMs: 1500,
          size: 100,
        },
        {
          type: 'text',
          title: '01 开场.vtt',
          hash: 'sub-hash',
          size: 10,
        },
        {
          type: 'image',
          title: '封面.png',
          hash: 'image-hash',
          size: 20,
        },
      ],
    },
  ],
  tracksError: '',
  playback: null,
  localWork: null,
};

test('在线作品转换为全局播放器队列与文件列表', () => {
  const data = buildOnlinePlayerData(DETAIL);
  assert.equal(data.tracks.length, 1);
  assert.equal(data.tracks[0]?.source, 'online');
  assert.equal(data.tracks[0]?.relativePath, '正式版/01 开场.wav');
  assert.equal(data.tracks[0]?.streamUrl, '/api/online/works/1234/tracks/audio-hash/stream');
  assert.equal(data.tracks[0]?.onlineWorkId, 1234);
  assert.equal(data.tracks[0]?.onlineIndex, 0);
  assert.equal(data.work.code, 'RJ01234567');
  assert.equal(data.work.tracks.length, 1);

  assert.deepEqual(
    data.files.map((file) => [file.path, file.kind]),
    [
      ['正式版/01 开场.wav', 'audio'],
      ['正式版/01 开场.vtt', 'subtitle'],
      ['正式版/封面.png', 'image'],
    ],
  );
  assert.equal(
    data.files[1]?.url,
    '/api/online/works/1234/tracks/sub-hash/stream',
  );
  assert.equal(data.files[0]?.trackId, data.tracks[0]?.id);
  assert.equal(data.context.source, 'online');
  assert.equal(data.context.coverUrl, DETAIL.work.coverUrl);
});
