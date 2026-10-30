import { useEffect } from 'react';
import type { CurrentTrack, PlayerApi } from './player';

type MediaAction =
  | 'play'
  | 'pause'
  | 'previoustrack'
  | 'nexttrack'
  | 'seekbackward'
  | 'seekforward'
  | 'seekto';

const HANDLED_ACTIONS: MediaAction[] = [
  'play',
  'pause',
  'previoustrack',
  'nexttrack',
  'seekbackward',
  'seekforward',
];

function artworkFor(current: CurrentTrack): MediaImage[] {
  if (current.coverUrl) {
    return [{ src: current.coverUrl }];
  }
  if (!current.coverAssetId) {
    return [];
  }
  return [{ src: `/api/assets/${current.coverAssetId}?size=600` }];
}

/** 把播放状态同步到系统媒体面板（锁屏、通知栏、蓝牙耳机按键）。 */
export function useMediaSession(player: PlayerApi): void {
  const { current, playing, positionMs, durationMs } = player;

  useEffect(() => {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') {
      return;
    }
    if (!current) {
      navigator.mediaSession.metadata = null;
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.track.title || current.workTitle,
      artist: current.workTitle,
      album: current.workCode,
      artwork: artworkFor(current),
    });
  }, [current]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) {
      return;
    }
    const session = navigator.mediaSession;
    const audio = player.audioElement;
    const register = (action: MediaAction, handler: MediaSessionActionHandler | null) => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // 某些浏览器只支持部分动作。
      }
    };
    register('play', () => {
      if (audio) {
        void audio.play().catch(() => undefined);
      }
    });
    register('pause', () => player.pause());
    register('previoustrack', () => player.prev());
    register('nexttrack', () => player.next());
    register('seekbackward', (details) => player.seekBy(-(details.seekOffset ?? 10) * 1000));
    register('seekforward', (details) => player.seekBy((details.seekOffset ?? 10) * 1000));
    register('seekto', (details) => {
      if (typeof details.seekTime === 'number') {
        player.seek(details.seekTime * 1000);
      }
    });
    return () => {
      for (const action of HANDLED_ACTIONS) {
        register(action, null);
      }
      register('seekto', null);
    };
  }, [player.audioElement, player.pause, player.prev, player.next, player.seek, player.seekBy]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) {
      return;
    }
    navigator.mediaSession.playbackState = current ? (playing ? 'playing' : 'paused') : 'none';
  }, [current, playing]);

  useEffect(() => {
    if (
      !('mediaSession' in navigator) ||
      typeof navigator.mediaSession.setPositionState !== 'function' ||
      !current ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0
    ) {
      return;
    }
    const duration = durationMs / 1000;
    const position = Math.min(Math.max(positionMs / 1000, 0), duration);
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position,
      });
    } catch {
      // 位置状态仅影响系统面板进度条。
    }
  }, [current, durationMs, positionMs]);
}
