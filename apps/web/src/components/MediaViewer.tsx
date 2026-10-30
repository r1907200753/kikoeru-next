import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { workFileUrl, type WorkFileEntry } from '../api';
import { formatBytes, formatTime } from '../format';
import { BackIcon, ChevronRightIcon, CloseIcon } from '../icons';
import type { PlayerApi } from '../player';
import {
  fetchSubtitle,
  findActiveCueIndex,
  formatCueTime,
  subtitleFormatLabel,
  type ParsedSubtitle,
} from '../subtitles';

export type MediaViewerState =
  | { kind: 'image'; code: string; items: WorkFileEntry[]; index: number }
  | { kind: 'video'; code: string; entry: WorkFileEntry }
  | { kind: 'subtitle'; code: string; entry: WorkFileEntry };

const RISKY_VIDEO_EXTENSIONS = ['.mkv', '.avi', '.wmv', '.flv', '.ts'];

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index).toLowerCase();
}

function fileUrl(code: string, entry: WorkFileEntry): string {
  return entry.url ?? workFileUrl(code, entry.path);
}

export function MediaViewer({
  state,
  player,
  onClose,
  onNavigate,
}: {
  state: MediaViewerState;
  player: PlayerApi;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (state.kind !== 'image') {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onNavigate(state.index - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        onNavigate(state.index + 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [state, onClose, onNavigate]);

  const backdropClose = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  if (state.kind === 'image') {
    const entry = state.items[state.index];
    if (!entry) {
      return null;
    }
    return (
      <div className="media-viewer media-viewer--image" onMouseDown={backdropClose}>
        <div className="media-image-stage">
          <img src={fileUrl(state.code, entry)} alt={entry.name} />
        </div>
        <header className="media-viewer-bar">
          <div className="media-viewer-title">
            <strong>{entry.name}</strong>
            <span>
              {state.index + 1} / {state.items.length} · {formatBytes(entry.size)}
            </span>
          </div>
          <button type="button" className="media-viewer-close" onClick={onClose} aria-label="关闭图片">
            <CloseIcon />
          </button>
        </header>
        <button
          type="button"
          className="media-nav media-nav--prev"
          onClick={() => onNavigate(state.index - 1)}
          disabled={state.index <= 0}
          aria-label="上一张"
        >
          <BackIcon />
        </button>
        <button
          type="button"
          className="media-nav media-nav--next"
          onClick={() => onNavigate(state.index + 1)}
          disabled={state.index >= state.items.length - 1}
          aria-label="下一张"
        >
          <ChevronRightIcon />
        </button>
      </div>
    );
  }

  if (state.kind === 'video') {
    const risky = RISKY_VIDEO_EXTENSIONS.includes(extensionOf(state.entry.name));
    return (
      <div className="media-viewer media-viewer--video" onMouseDown={backdropClose}>
        <div className="media-video-card">
          <header className="media-viewer-bar">
            <div className="media-viewer-title">
              <strong>{state.entry.name}</strong>
              <span>
                {formatBytes(state.entry.size)}
                {state.entry.durationMs ? ` · ${formatTime(state.entry.durationMs)}` : ''}
              </span>
            </div>
            <button type="button" className="media-viewer-close" onClick={onClose} aria-label="关闭视频">
              <CloseIcon />
            </button>
          </header>
          <video
            className="media-video"
            src={fileUrl(state.code, state.entry)}
            controls
            autoPlay
            playsInline
          />
          {risky ? (
            <p className="media-hint">
              浏览器对 {extensionOf(state.entry.name).slice(1).toUpperCase()} 封装的支持有限，
              若无法播放可下载后用本地播放器打开。
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return <SubtitleViewer state={state} player={player} onClose={onClose} backdropClose={backdropClose} />;
}

function SubtitleViewer({
  state,
  player,
  onClose,
  backdropClose,
}: {
  state: Extract<MediaViewerState, { kind: 'subtitle' }>;
  player: PlayerApi;
  onClose: () => void;
  backdropClose: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  const [parsed, setParsed] = useState<ParsedSubtitle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setParsed(null);
    fetchSubtitle(fileUrl(state.code, state.entry), state.entry.name)
      .then((result) => {
        if (!cancelled) {
          setParsed(result);
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
  }, [state.code, state.entry.path, state.entry.name]);

  const hasPlayer = player.current !== null;
  const activeIndex =
    parsed && hasPlayer ? findActiveCueIndex(parsed.cues, player.positionMs) : -1;

  useEffect(() => {
    if (activeIndex < 0 || !player.playing) {
      return;
    }
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex, player.playing]);

  const seekTo = (startMs: number) => {
    if (!player.current) {
      return;
    }
    player.seek(startMs);
  };

  return (
    <div className="media-viewer media-viewer--subtitle" onMouseDown={backdropClose}>
      <div className="media-subtitle-card">
        <header className="media-viewer-bar">
          <div className="media-viewer-title">
            <strong>{state.entry.name}</strong>
            <span>
              {parsed ? `${subtitleFormatLabel(parsed.format)} · ${parsed.cues.length} 条时间轴` : ''}
            </span>
          </div>
          <button type="button" className="media-viewer-close" onClick={onClose} aria-label="关闭字幕">
            <CloseIcon />
          </button>
        </header>

        {loading ? <p className="media-status">正在读取字幕…</p> : null}
        {error ? (
          <div className="notice notice--error notice--inline" role="alert">
            <span>{error}</span>
          </div>
        ) : null}

        {parsed && !loading ? (
          <>
            {!hasPlayer ? (
              <p className="media-status media-status--hint">
                先在文件列表里播放一条音轨，再点击时间行就能跳转。
              </p>
            ) : null}
            {parsed.notes.length > 0 ? (
              <div className="subtitle-notes">
                {parsed.notes.map((note) => (
                  <span key={note}>{note}</span>
                ))}
              </div>
            ) : null}
            {parsed.cues.length > 0 ? (
              <ol className="subtitle-cues">
                {parsed.cues.map((cue, index) => (
                  <li key={`${cue.startMs}-${index}`}>
                    <button
                      type="button"
                      ref={index === activeIndex ? activeRef : undefined}
                      className={`subtitle-cue${index === activeIndex ? ' is-active' : ''}`}
                      onClick={() => seekTo(cue.startMs)}
                      disabled={!hasPlayer}
                    >
                      <time>{formatCueTime(cue.startMs)}</time>
                      <span>{cue.text || '…'}</span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <pre className="subtitle-plain">{parsed.plain || '文件是空的。'}</pre>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
