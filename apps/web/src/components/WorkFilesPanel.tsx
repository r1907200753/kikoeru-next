import { useEffect, useMemo, useState } from 'react';
import {
  listWorkFiles,
  workFileUrl,
  type TrackSummary,
  type WorkDetail,
  type WorkFileEntry,
  type WorkFilesResult,
} from '../api';
import { formatBytes, formatTime } from '../format';
import {
  ChevronRightIcon,
  ExpandIcon,
  FileIcon,
  FolderIcon,
  ImageIcon,
  ListIcon,
  MusicIcon,
  PauseIcon,
  PlayIcon,
  SubtitleIcon,
  VideoIcon,
} from '../icons';
import type { PlayerApi, PlayerContext } from '../player';
import {
  audioFilesOf,
  breadcrumbTrail,
  choosePreferredFolder,
  filesInFolder,
  foldersIn,
} from '../work-files';
import { usePreferences } from '../preferences';
import { MediaViewer, type MediaViewerState } from './MediaViewer';

const KIND_LABEL: Record<WorkFileEntry['kind'], string> = {
  audio: '音频',
  video: '视频',
  image: '图片',
  subtitle: '字幕 / 台本',
  other: '文件',
};

function kindIcon(kind: WorkFileEntry['kind']) {
  switch (kind) {
    case 'audio':
      return <MusicIcon />;
    case 'video':
      return <VideoIcon />;
    case 'image':
      return <ImageIcon />;
    case 'subtitle':
      return <SubtitleIcon />;
    default:
      return <FileIcon />;
  }
}

export function WorkFilesPanel({
  code,
  work,
  player,
}: {
  code: string;
  work: WorkDetail;
  player: PlayerApi;
}) {
  const [data, setData] = useState<WorkFilesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [folder, setFolder] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [viewer, setViewer] = useState<MediaViewerState | null>(null);
  const [preferences] = usePreferences();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);
    setFolder('');
    setShowAll(false);
    setViewer(null);
    listWorkFiles(code)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setFolder(choosePreferredFolder(result.files, preferences));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, reloadKey, preferences]);

  const files = data?.files ?? [];
  const trackById = useMemo(
    () => new Map(work.tracks.map((track) => [track.id, track] as const)),
    [work.tracks],
  );
  const trail = useMemo(() => breadcrumbTrail(folder), [folder]);
  const folders = useMemo(() => foldersIn(files, folder), [files, folder]);
  const currentFiles = useMemo(() => filesInFolder(files, folder), [files, folder]);
  const visibleFiles = showAll ? files : currentFiles;
  const audioCount = useMemo(
    () => audioFilesOf(visibleFiles).filter((file) => file.trackId !== null).length,
    [visibleFiles],
  );

  const contextFor = (tracks: TrackSummary[]): PlayerContext => ({
    workId: work.id,
    workCode: work.code,
    workTitle: work.title,
    coverAssetId: work.coverAssetId,
    workPath: work.relativePath,
    tracks,
    workTracks: work.tracks,
  });

  const playFile = (entry: WorkFileEntry) => {
    const track = entry.trackId === null ? undefined : trackById.get(entry.trackId);
    if (!track) {
      return;
    }
    if (player.current?.track.id === track.id) {
      player.toggle();
      return;
    }
    const queue: TrackSummary[] = [];
    for (const file of audioFilesOf(visibleFiles)) {
      if (file.trackId === null) {
        continue;
      }
      const item = trackById.get(file.trackId);
      if (item) {
        queue.push(item);
      }
    }
    if (!queue.some((item) => item.id === track.id)) {
      queue.push(track);
    }
    player.play(track, contextFor(queue), 0);
  };

  const openImage = (entry: WorkFileEntry) => {
    const images = visibleFiles.filter((file) => file.kind === 'image');
    const index = images.findIndex((file) => file.path === entry.path);
    if (images.length === 0) {
      return;
    }
    setViewer({ kind: 'image', code, items: images, index: Math.max(0, index) });
  };

  const openFile = (entry: WorkFileEntry) => {
    switch (entry.kind) {
      case 'audio':
        playFile(entry);
        break;
      case 'video':
        player.pause();
        setViewer({ kind: 'video', code, entry });
        break;
      case 'image':
        openImage(entry);
        break;
      case 'subtitle':
        setViewer({ kind: 'subtitle', code, entry });
        break;
      default:
        break;
    }
  };

  const navigateImage = (index: number) => {
    setViewer((current) => {
      if (!current || current.kind !== 'image') {
        return current;
      }
      const next = Math.min(current.items.length - 1, Math.max(0, index));
      return { ...current, index: next };
    });
  };

  const goFolder = (path: string) => {
    setShowAll(false);
    setFolder(path);
  };

  const countLabel = showAll
    ? `${visibleFiles.length} 个文件 · ${audioCount} 条音轨`
    : [
        folders.length > 0 ? `${folders.length} 个文件夹` : null,
        `${visibleFiles.length} 个文件`,
        audioCount > 0 ? `${audioCount} 条音轨` : null,
      ]
        .filter((part): part is string => Boolean(part))
        .join(' · ');

  return (
    <section className="files-panel">
      <header className="files-head">
        <div className="files-title-row">
          <h2>
            <FolderIcon /> 文件
          </h2>
          <span className="files-count">{countLabel}</span>
          <button
            type="button"
            className={`files-toggle${showAll ? ' is-active' : ''}`}
            onClick={() => setShowAll((value) => !value)}
          >
            <ListIcon /> {showAll ? '按文件夹浏览' : '查看全部文件'}
          </button>
        </div>
        <nav className="files-crumbs" aria-label="文件路径">
          <button
            type="button"
            className={`files-crumb${folder === '' && !showAll ? ' is-current' : ''}`}
            onClick={() => goFolder('')}
          >
            ROOT
          </button>
          {trail.map((crumb) => (
            <span className="files-crumb-item" key={crumb.path}>
              <span className="files-crumb-sep">/</span>
              <button
                type="button"
                className={`files-crumb${!showAll && crumb.path === folder ? ' is-current' : ''}`}
                onClick={() => goFolder(crumb.path)}
              >
                {crumb.name}
              </button>
            </span>
          ))}
          {showAll ? (
            <span className="files-crumb-item">
              <span className="files-crumb-sep">/</span>
              <span className="files-crumb is-current">全部文件</span>
            </span>
          ) : null}
        </nav>
      </header>

      {loading ? (
        <div className="files-loading">
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line skeleton-line--short" />
        </div>
      ) : error ? (
        <div className="files-error">
          <div className="notice notice--error notice--inline" role="alert">
            <span>{error}</span>
          </div>
          <button
            type="button"
            className="btn btn-tonal"
            onClick={() => setReloadKey((value) => value + 1)}
          >
            重试
          </button>
        </div>
      ) : files.length === 0 ? (
        <p className="file-empty">这个作品目录里没有找到可显示的文件。</p>
      ) : (
        <ol className="files-list">
          {!showAll
            ? folders.map((dir) => (
                <li key={`dir:${dir.path}`}>
                  <button
                    type="button"
                    className="file-row file-row--folder"
                    onClick={() => goFolder(dir.path)}
                  >
                    <span className="file-icon file-icon--folder">
                      <FolderIcon />
                    </span>
                    <span className="file-main">
                      <span className="file-name">{dir.name}</span>
                      <span className="file-sub">文件夹</span>
                    </span>
                    <span className="file-meta">{dir.fileCount} 个文件</span>
                    <span className="file-action">
                      <ChevronRightIcon />
                    </span>
                  </button>
                </li>
              ))
            : null}
          {visibleFiles.length === 0 ? (
            <li>
              <p className="file-empty">这个文件夹里没有文件。</p>
            </li>
          ) : null}
          {visibleFiles.map((entry) => {
            const active =
              entry.kind === 'audio' &&
              entry.trackId !== null &&
              player.current?.track.id === entry.trackId;
            const playing = Boolean(active) && player.playing;
            const meta =
              (entry.kind === 'audio' || entry.kind === 'video') && entry.durationMs !== null
                ? formatTime(entry.durationMs)
                : formatBytes(entry.size);
            const action =
              entry.kind === 'audio' ? (
                playing ? (
                  <PauseIcon />
                ) : (
                  <PlayIcon />
                )
              ) : entry.kind === 'video' ? (
                <PlayIcon />
              ) : entry.kind === 'image' ? (
                <ExpandIcon />
              ) : entry.kind === 'subtitle' ? (
                <ChevronRightIcon />
              ) : (
                <FileIcon />
              );
            const body = (
              <>
                <span className={`file-icon file-icon--${entry.kind}`}>
                  {kindIcon(entry.kind)}
                </span>
                <span className="file-main">
                  <span className="file-name" title={entry.path}>
                    {entry.name}
                  </span>
                  <span className="file-sub">{KIND_LABEL[entry.kind]}</span>
                </span>
                <span className="file-meta">{meta}</span>
                <span className={`file-action${entry.kind === 'audio' ? ' file-action--play' : ''}`}>
                  {action}
                </span>
              </>
            );
            if (entry.kind === 'other') {
              return (
                <li key={entry.path}>
                  <a
                    className="file-row"
                    href={workFileUrl(code, entry.path)}
                    download={entry.name}
                    title={`下载 ${entry.name}`}
                  >
                    {body}
                  </a>
                </li>
              );
            }
            return (
              <li key={entry.path}>
                <button
                  type="button"
                  className={`file-row${active ? ' is-active' : ''}`}
                  onClick={() => openFile(entry)}
                >
                  {body}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {data && data.warnings.length > 0 ? (
        <div className="files-notes">
          {data.warnings.slice(0, 3).map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
          {data.warnings.length > 3 ? (
            <span>还有 {data.warnings.length - 3} 条提示未显示</span>
          ) : null}
        </div>
      ) : null}
      {data?.truncated ? <p className="files-notes">文件过多，仅显示了一部分。</p> : null}

      {viewer ? (
        <MediaViewer
          state={viewer}
          player={player}
          onClose={() => setViewer(null)}
          onNavigate={navigateImage}
        />
      ) : null}
    </section>
  );
}
