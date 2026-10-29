import assert from 'node:assert/strict';
import test from 'node:test';
import type { OnlineTrack } from '../src/api';
import { preferredOnlineTrackIndex } from '../src/online';

function makeTrack(title: string, groupTitle = ''): OnlineTrack {
  return {
    index: 1,
    hash: title,
    title,
    disc: 1,
    groupTitle,
    durationMs: null,
    size: 0,
    streamUrl: '',
  };
}

test('在线音频类型偏好优先匹配扩展名与分组', () => {
  const tracks = [
    makeTrack('01. 开场.mp3'),
    makeTrack('01. 开场.wav', 'WAV'),
    makeTrack('02. 结尾.flac'),
  ];
  assert.equal(preferredOnlineTrackIndex(tracks, 'wav'), 1);
  assert.equal(preferredOnlineTrackIndex(tracks, 'flac'), 2);
  assert.equal(preferredOnlineTrackIndex(tracks, 'm4a'), 0);
  assert.equal(preferredOnlineTrackIndex([], 'mp3'), -1);
});
