import { useMemo, useState, type CSSProperties } from 'react';
import type { TrackSummary } from '../api';
import { formatTime } from '../format';
import { ChevronDownIcon, FileIcon, FolderIcon, PauseIcon, PlayIcon } from '../icons';
import {
  buildTrackTree,
  countTracks,
  fileNameFor,
  type TrackDirNode,
} from '../track-tree';

function TrackRow({
  track,
  queue,
  active,
  playing,
  onPlay,
  depth,
}: {
  track: TrackSummary;
  queue: TrackSummary[];
  active: boolean;
  playing: boolean;
  onPlay: (track: TrackSummary, queue: TrackSummary[]) => void;
  depth: number;
}) {
  const style = { '--depth': depth } as CSSProperties;
  return (
    <button
      type="button"
      className={`dir-track${active ? ' is-active' : ''}`}
      style={style}
      onClick={() => onPlay(track, queue)}
      title={track.relativePath || track.title}
    >
      <span className="dir-track-icon">
        {active && playing ? <span className="playing-bars"><i /><i /><i /></span> : <FileIcon />}
      </span>
      <span className="dir-track-name">{fileNameFor(track)}</span>
      <span className="dir-track-time">
        {track.durationMs ? formatTime(track.durationMs) : '—'}
      </span>
      <span className="dir-track-play" aria-hidden="true">
        {active && playing ? <PauseIcon /> : <PlayIcon />}
      </span>
    </button>
  );
}

function FolderGroup({
  node,
  depth,
  collapsed,
  onToggle,
  activeTrackId,
  playing,
  onPlay,
}: {
  node: TrackDirNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  activeTrackId: number | null;
  playing: boolean;
  onPlay: (track: TrackSummary, queue: TrackSummary[]) => void;
}) {
  const open = !collapsed.has(node.path);
  const style = { '--depth': depth } as CSSProperties;
  return (
    <div className="dir-folder">
      <button
        type="button"
        className={`dir-folder-head${open ? ' is-open' : ''}`}
        style={style}
        onClick={() => onToggle(node.path)}
        aria-expanded={open}
      >
        <ChevronDownIcon className="dir-chevron" />
        <FolderIcon />
        <span className="dir-folder-name">{node.name}</span>
        <em>{countTracks(node)} 轨</em>
      </button>
      {open ? (
        <div className="dir-folder-body">
          {node.dirs.map((child) => (
            <FolderGroup
              key={child.path}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              activeTrackId={activeTrackId}
              playing={playing}
              onPlay={onPlay}
            />
          ))}
          {node.tracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              queue={node.tracks}
              depth={depth + 1}
              active={track.id === activeTrackId}
              playing={playing}
              onPlay={onPlay}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TrackDirectory({
  tracks,
  workPath = '',
  activeTrackId = null,
  playing = false,
  onPlay,
  className = '',
}: {
  tracks: TrackSummary[];
  workPath?: string;
  activeTrackId?: number | null;
  playing?: boolean;
  onPlay: (track: TrackSummary, queue: TrackSummary[]) => void;
  className?: string;
}) {
  const tree = useMemo(() => buildTrackTree(tracks, workPath), [tracks, workPath]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggle = (path: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  if (tracks.length === 0) {
    return <p className={`dir-empty ${className}`.trim()}>没有可播放的音频文件。</p>;
  }

  return (
    <div className={`track-directory ${className}`.trim()}>
      {tree.tracks.map((track) => (
        <TrackRow
          key={track.id}
          track={track}
          queue={tree.tracks}
          depth={0}
          active={track.id === activeTrackId}
          playing={playing}
          onPlay={onPlay}
        />
      ))}
      {tree.dirs.map((node) => (
        <FolderGroup
          key={node.path}
          node={node}
          depth={0}
          collapsed={collapsed}
          onToggle={toggle}
          activeTrackId={activeTrackId}
          playing={playing}
          onPlay={onPlay}
        />
      ))}
    </div>
  );
}
