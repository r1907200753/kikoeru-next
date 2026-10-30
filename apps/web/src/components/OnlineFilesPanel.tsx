import { useMemo, useState } from 'react';
import type { OnlineFileType, OnlineTrack, OnlineTrackNode } from '../api';
import { formatBytes, formatTime } from '../format';
import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  ImageIcon,
  MusicIcon,
  PauseIcon,
  PlayIcon,
  SubtitleIcon,
  VideoIcon,
} from '../icons';

function fileTypeLabel(type: OnlineFileType): string {
  if (type === 'audio') {
    return '音频';
  }
  if (type === 'video') {
    return '视频';
  }
  if (type === 'image') {
    return '图片';
  }
  if (type === 'text') {
    return '文本';
  }
  return '其他';
}

function OnlineFileIcon({ type }: { type: OnlineFileType }) {
  if (type === 'audio') {
    return <MusicIcon />;
  }
  if (type === 'video') {
    return <VideoIcon />;
  }
  if (type === 'image') {
    return <ImageIcon />;
  }
  if (type === 'text') {
    return <SubtitleIcon />;
  }
  return <FileIcon />;
}

export function OnlineFilesPanel({
  tree,
  tracks,
  activeIndex,
  playing,
  onPlay,
}: {
  tree: OnlineTrackNode[];
  tracks: OnlineTrack[];
  activeIndex: number;
  playing: boolean;
  onPlay: (index: number) => void;
}) {
  const [path, setPath] = useState<number[]>([]);
  const { nodes, trail, used } = useMemo(() => {
    let current = tree;
    const labels: string[] = [];
    const indexes: number[] = [];
    for (const index of path) {
      const node = current[index];
      if (!node || node.type !== 'folder') {
        break;
      }
      labels.push(node.title);
      indexes.push(index);
      current = node.children ?? [];
    }
    return { nodes: current, trail: labels, used: indexes };
  }, [tree, path]);

  const folderCount = nodes.filter((node) => node.type === 'folder').length;
  const audioCount = nodes.filter((node) => node.type === 'audio').length;
  const otherCount = nodes.filter(
    (node) => node.type !== 'folder' && node.type !== 'audio',
  ).length;

  return (
    <section className="online-files-panel">
      <nav className="files-crumbs" aria-label="在线文件路径">
        <button
          type="button"
          className={`files-crumb${used.length === 0 ? ' is-current' : ''}`}
          onClick={() => setPath([])}
        >
          ROOT
        </button>
        {trail.map((label, depth) => (
          <span className="files-crumb-item" key={`${label}-${depth}`}>
            <span className="files-crumb-sep">/</span>
            <button
              type="button"
              className={`files-crumb${depth === trail.length - 1 ? ' is-current' : ''}`}
              onClick={() => setPath(used.slice(0, depth + 1))}
            >
              {label}
            </button>
          </span>
        ))}
      </nav>
      <p className="files-count online-files-count">
        {folderCount > 0 ? `${folderCount} 个文件夹 · ` : ''}
        {audioCount} 条音轨
        {otherCount > 0 ? ` · ${otherCount} 个其他文件` : ''}
      </p>
      {nodes.length === 0 ? (
        <p className="track-empty">这个文件夹里没有文件。</p>
      ) : (
        <ol className="files-list">
          {nodes.map((node, index) => {
            if (node.type === 'folder') {
              return (
                <li key={`folder-${node.title}-${index}`}>
                  <button
                    type="button"
                    className="file-row file-row--folder"
                    onClick={() => setPath([...used, index])}
                  >
                    <span className="file-icon file-icon--folder">
                      <FolderIcon />
                    </span>
                    <span className="file-main">
                      <span className="file-name">{node.title}</span>
                      <span className="file-sub">文件夹</span>
                    </span>
                    <span className="file-meta">{node.children?.length ?? 0} 项</span>
                    <span className="file-action">
                      <ChevronRightIcon />
                    </span>
                  </button>
                </li>
              );
            }
            const trackIndex = node.hash
              ? tracks.findIndex((track) => track.hash === node.hash)
              : -1;
            if (node.type !== 'audio') {
              return (
                <li key={`${node.type}-${node.hash ?? node.title}-${index}`}>
                  <div className="file-row file-row--static">
                    <span className={`file-icon file-icon--${node.type}`}>
                      <OnlineFileIcon type={node.type} />
                    </span>
                    <span className="file-main">
                      <span className="file-name" title={node.title}>
                        {node.title}
                      </span>
                      <span className="file-sub">{fileTypeLabel(node.type)}</span>
                    </span>
                    <span className="file-meta">
                      {node.size ? formatBytes(node.size) : ''}
                    </span>
                    <span className="file-action" />
                  </div>
                </li>
              );
            }
            const active = trackIndex >= 0 && trackIndex === activeIndex;
            const meta = [
              node.durationMs ? formatTime(node.durationMs) : '—',
              node.size ? formatBytes(node.size) : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={`audio-${node.hash ?? node.title}-${index}`}>
                <button
                  type="button"
                  className={`file-row${active ? ' is-active' : ''}`}
                  onClick={() => {
                    if (trackIndex >= 0) {
                      onPlay(trackIndex);
                    }
                  }}
                  disabled={trackIndex < 0}
                >
                  <span className="file-icon file-icon--audio">
                    <MusicIcon />
                  </span>
                  <span className="file-main">
                    <span className="file-name" title={node.title}>
                      {node.title}
                    </span>
                    <span className="file-sub">音频</span>
                  </span>
                  <span className="file-meta">{meta}</span>
                  <span className={`file-action${active ? ' file-action--play' : ''}`}>
                    {active && playing ? <PauseIcon /> : <PlayIcon />}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
