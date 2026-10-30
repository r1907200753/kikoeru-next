import type { CSSProperties } from 'react';
import { formatTime } from '../format';
import {
  ArrowUpRightIcon,
  ExpandIcon,
  Forward10Icon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  Rewind10Icon,
  VolumeIcon,
} from '../icons';
import type { PlayerApi } from '../player';
import { WorkCover } from './WorkCard';

function fillStyle(percent: number): CSSProperties {
  return { '--fill': `${Math.min(100, Math.max(0, percent))}%` } as CSSProperties;
}

export function PlayerBar({ player, onExpand }: { player: PlayerApi; onExpand: () => void }) {
  const { current, playing, positionMs, durationMs, volume } = player;
  if (!current) {
    return null;
  }
  const progress = durationMs > 0 ? (positionMs / durationMs) * 100 : 0;
  const detailHref =
    current.source === 'online'
      ? `#/online/${encodeURIComponent(current.workCode)}`
      : `#/work/${encodeURIComponent(current.workCode)}`;

  return (
    <div className="player-dock" role="region" aria-label="迷你播放器">
      <input
        className="range player-progress"
        type="range"
        min={0}
        max={Math.max(1, durationMs)}
        step={100}
        value={Math.min(positionMs, Math.max(1, durationMs))}
        onChange={(event) => player.seek(Number(event.target.value))}
        style={fillStyle(progress)}
        aria-label="播放进度"
      />

      {player.error ? (
        <div className="player-toast" role="alert">
          <span>{player.error}</span>
          <button type="button" onClick={player.clearError} aria-label="关闭提示">
            ×
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className="player-track"
        onClick={onExpand}
        aria-label="打开全屏播放器"
      >
        <WorkCover
          code={current.workCode}
          coverAssetId={current.coverAssetId}
          size="mini"
          {...(current.coverUrl ? { src: current.coverUrl } : {})}
        />
        <span className="player-track-text">
          <span className="player-track-title">{current.track.title}</span>
          <span className="player-track-sub">
            {current.workCode} · {current.workTitle}
          </span>
        </span>
      </button>

      <div className="player-controls">
        <button
          type="button"
          className="player-skip player-skip--seek"
          onClick={() => player.seekBy(-10_000)}
          aria-label="后退 10 秒"
          title="后退 10 秒"
        >
          <Rewind10Icon />
        </button>
        <button
          type="button"
          className="player-skip"
          onClick={player.prev}
          disabled={!player.hasPrev}
          aria-label="上一首"
        >
          <PrevIcon />
        </button>
        <button
          type="button"
          className="player-toggle"
          onClick={player.toggle}
          aria-label={playing ? '暂停' : '播放'}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          className="player-skip"
          onClick={player.next}
          disabled={!player.hasNext}
          aria-label="下一首"
        >
          <NextIcon />
        </button>
        <button
          type="button"
          className="player-skip player-skip--seek"
          onClick={() => player.seekBy(10_000)}
          aria-label="前进 10 秒"
          title="前进 10 秒"
        >
          <Forward10Icon />
        </button>
      </div>

      <div className="player-side">
        <span className="player-time">
          {formatTime(positionMs)} / {formatTime(durationMs)}
        </span>
        <div className="player-volume">
          <VolumeIcon />
          <input
            className="range range--sm"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(event) => player.setVolume(Number(event.target.value))}
            style={fillStyle(volume * 100)}
            aria-label="音量"
          />
        </div>
        <a
          className="player-expand"
          href={detailHref}
          aria-label="打开作品详情"
          title="打开作品详情"
        >
          <ArrowUpRightIcon />
        </a>
        <button
          type="button"
          className="player-expand"
          onClick={onExpand}
          aria-label="打开全屏播放器"
        >
          <ExpandIcon />
        </button>
      </div>
    </div>
  );
}
