import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  getOnlineWork,
  saveOnlinePlayback,
  setWorkFavorite,
  type OnlineTrack,
  type OnlineWorkDetail,
} from '../api';
import { formatBytes, formatTime } from '../format';
import { preferredOnlineTrackIndex } from '../online';
import { usePreferences } from '../preferences';
import {
  ClockIcon,
  DiscIcon,
  DownloadIcon,
  FolderIcon,
  GlobeIcon,
  HeartIcon,
  ListIcon,
  PauseIcon,
  PlayIcon,
  StarIcon,
} from '../icons';
import { ExportDialog } from './ExportDialog';
import { OnlineFilesPanel } from './OnlineFilesPanel';
import { WorkCover } from './WorkCard';

export function OnlineWorkPage({
  code,
  onLibraryChanged,
}: {
  code: string;
  onLibraryChanged: () => void;
}) {
  const [detail, setDetail] = useState<OnlineWorkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [audioError, setAudioError] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [onlineView, setOnlineView] = useState<'tree' | 'list'>('tree');
  const [preferences] = usePreferences();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeIndexRef = useRef(-1);
  activeIndexRef.current = activeIndex;
  const detailRef = useRef<OnlineWorkDetail | null>(null);
  detailRef.current = detail;
  const pendingSeekRef = useRef(0);
  const resumeRef = useRef<{ index: number; positionMs: number } | null>(null);
  const lastPersistRef = useRef('');
  const lastPersistAtRef = useRef(0);
  const autoplayRef = useRef(false);

  const persistProgress = useCallback((index: number, seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !audio.getAttribute('src')) {
      // 还没真正加载音轨（例如只看到遗留的续播位置）时不要覆盖已有进度。
      return;
    }
    const info = detailRef.current;
    const track = info?.tracks[index];
    if (!info || !track || info.work.id <= 0) {
      return;
    }
    const positionMs = Math.max(0, Math.round(seconds * 1000));
    const stamp = `${index}:${positionMs}`;
    if (lastPersistRef.current === stamp) {
      return;
    }
    lastPersistRef.current = stamp;
    void saveOnlinePlayback({
      remoteWorkId: info.work.id,
      code: info.work.code,
      trackHash: track.hash,
      trackIndex: index,
      positionMs,
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    setExportOpen(false);
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    const audio = audioRef.current;
    if (audio) {
      if (detailRef.current && activeIndexRef.current >= 0) {
        persistProgress(activeIndexRef.current, audio.currentTime);
      }
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    pendingSeekRef.current = 0;
    resumeRef.current = null;
    lastPersistRef.current = '';
    lastPersistAtRef.current = 0;
    autoplayRef.current = false;
    setLoading(true);
    setError('');
    setDetail(null);
    setActiveIndex(-1);
    setPlaying(false);
    setPositionMs(0);
    setDurationMs(0);
    setAudioError('');
    getOnlineWork(code)
      .then((data) => {
        if (cancelled) {
          return;
        }
        setDetail(data);
        const saved = data.playback;
        if (!saved) {
          return;
        }
        let index = data.tracks.findIndex((track) => track.hash === saved.trackHash);
        if (
          index < 0 &&
          saved.trackIndex >= 0 &&
          saved.trackIndex < data.tracks.length
        ) {
          index = saved.trackIndex;
        }
        if (index < 0) {
          return;
        }
        resumeRef.current = { index, positionMs: saved.positionMs };
        pendingSeekRef.current = saved.positionMs;
        setActiveIndex(index);
        setPositionMs(saved.positionMs);
        setDurationMs(data.tracks[index]?.durationMs ?? 0);
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
  }, [code, reloadKey, persistProgress]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const onTime = () => {
      setPositionMs(audio.currentTime * 1000);
      if (!audio.paused) {
        const now = Date.now();
        if (now - lastPersistAtRef.current >= 5000) {
          lastPersistAtRef.current = now;
          persistProgress(activeIndexRef.current, audio.currentTime);
        }
      }
    };
    const onMeta = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
      setDurationMs(duration);
      const pending = pendingSeekRef.current;
      if (pending > 0) {
        pendingSeekRef.current = 0;
        const limit = audio.duration > 0 ? Math.max(0, audio.duration - 1) : pending / 1000;
        audio.currentTime = Math.min(pending / 1000, limit);
        setPositionMs(Math.min(pending, limit * 1000));
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      if (audio.ended) {
        persistProgress(activeIndexRef.current, 0);
        return;
      }
      persistProgress(activeIndexRef.current, audio.currentTime);
    };
    const onError = () => {
      setAudioError('在线音轨加载失败，可能需要登录，或代理/网络不可用');
      setPlaying(false);
    };
    const onEnded = () => {
      const tracks = detail?.tracks ?? [];
      const endedIndex = activeIndexRef.current;
      persistProgress(endedIndex, 0);
      const nextIndex = endedIndex + 1;
      if (nextIndex < tracks.length) {
        const track = tracks[nextIndex];
        if (track) {
          pendingSeekRef.current = 0;
          setActiveIndex(nextIndex);
          setPositionMs(0);
          setDurationMs(track.durationMs ?? 0);
          audio.src = track.streamUrl;
          persistProgress(nextIndex, 0);
          void audio.play().catch(() => setAudioError('浏览器拦截了自动播放'));
        }
      } else {
        setPlaying(false);
        setPositionMs(0);
      }
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('ended', onEnded);
    };
  }, [detail, persistProgress]);

  useEffect(() => {
    const saveCurrent = () => {
      const audio = audioRef.current;
      if (audio && detailRef.current && activeIndexRef.current >= 0) {
        persistProgress(activeIndexRef.current, audio.currentTime);
      }
    };
    window.addEventListener('pagehide', saveCurrent);
    return () => {
      window.removeEventListener('pagehide', saveCurrent);
      saveCurrent();
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
    };
  }, [persistProgress]);

  const tracks = detail?.tracks ?? [];
  const preferredIndex = preferredOnlineTrackIndex(tracks, preferences.onlineAudioPriority);

  const playTrack = (index: number, seekMs?: number) => {
    const audio = audioRef.current;
    const track = tracks[index];
    if (!audio || !track) {
      return;
    }
    setAudioError('');
    const hasSource = audio.getAttribute('src') === track.streamUrl;
    if (index === activeIndexRef.current && hasSource) {
      if (audio.paused) {
        void audio.play().catch(() => setAudioError('浏览器拦截了播放，请再点一次'));
      } else {
        audio.pause();
      }
      return;
    }
    if (index !== activeIndexRef.current) {
      persistProgress(activeIndexRef.current, audio.currentTime);
    }
    const seek =
      seekMs ?? (resumeRef.current?.index === index ? resumeRef.current.positionMs : 0);
    if (resumeRef.current?.index === index) {
      resumeRef.current = null;
    }
    pendingSeekRef.current = seek;
    setActiveIndex(index);
    setPositionMs(seek);
    setDurationMs(track.durationMs ?? 0);
    audio.src = track.streamUrl;
    audio.load();
    void audio.play().catch(() => setAudioError('浏览器拦截了播放，请再点一次'));
  };

  const stepTrack = (delta: number) => {
    const target = activeIndex + delta;
    if (target >= 0 && target < tracks.length) {
      playTrack(target);
    }
  };

  useEffect(() => {
    if (!detail || tracks.length === 0 || autoplayRef.current) {
      return;
    }
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem('kikoeru.onlineAutoplay');
    } catch {
      pending = null;
    }
    if (pending !== detail.work.code) {
      return;
    }
    try {
      sessionStorage.removeItem('kikoeru.onlineAutoplay');
    } catch {
      // 隐私模式下忽略。
    }
    autoplayRef.current = true;
    resumeRef.current = null;
    playTrack(preferredIndex);
  }, [detail, tracks.length, playTrack, preferredIndex]);

  const toggleFavorite = async () => {
    const work = detail?.work;
    if (!work || !work.local || favoriteBusy) {
      return;
    }
    const next = !work.favoriteAt;
    setFavoriteBusy(true);
    try {
      const result = await setWorkFavorite(work.code, next);
      setDetail((previous) =>
        previous
          ? {
              ...previous,
              work: { ...previous.work, favoriteAt: result.favoriteAt },
              localWork: previous.localWork
                ? { ...previous.localWork, favoriteAt: result.favoriteAt }
                : previous.localWork,
            }
          : previous,
      );
      onLibraryChanged();
    } catch {
      // 失败时保持原状态，下一次刷新会回到服务端真实值。
    } finally {
      setFavoriteBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="page online-page">
        <div className="online-hero online-hero--skeleton">
          <div className="cover cover--hero skeleton-cover" />
          <div className="skeleton-lines">
            <div className="skeleton-line skeleton-line--short" />
            <div className="skeleton-line skeleton-line--title" />
            <div className="skeleton-line" />
            <div className="skeleton-line skeleton-line--short" />
          </div>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="page online-page">
        <div className="empty-card">
          <div className="empty-icon">
            <GlobeIcon />
          </div>
          <h2>打不开这部在线作品</h2>
          <p>{error || 'asmr.one 没有返回该作品。'}</p>
          <div className="empty-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setReloadKey((value) => value + 1)}
            >
              重试
            </button>
            <a className="btn btn-ghost" href="#/search">
              返回搜索
            </a>
          </div>
        </div>
      </div>
    );
  }

  const work = detail.work;
  const favorite = Boolean(work.favoriteAt);
  const editionOptions = [...(work.languageEditions ?? [])];
  if (!editionOptions.some((edition) => edition.code === work.code)) {
    editionOptions.unshift({
      code: work.code,
      label: '当前版本',
      lang: '',
      title: work.title,
      isOriginal: false,
    });
  }
  const hasTree = (detail.trackTree?.length ?? 0) > 0;
  const showTree = hasTree && onlineView === 'tree';
  const activeTrack: OnlineTrack | undefined = tracks[activeIndex];
  const progress = durationMs > 0 ? (positionMs / durationMs) * 100 : 0;
  const savedPlayback = detail.playback;
  const savedIndex = (() => {
    if (!savedPlayback) {
      return -1;
    }
    const byHash = tracks.findIndex((track) => track.hash === savedPlayback.trackHash);
    if (byHash >= 0) {
      return byHash;
    }
    return savedPlayback.trackIndex >= 0 && savedPlayback.trackIndex < tracks.length
      ? savedPlayback.trackIndex
      : -1;
  })();
  const resumeInfo =
    savedPlayback && savedIndex >= 0 && savedPlayback.positionMs >= 3000
      ? { index: savedIndex, positionMs: savedPlayback.positionMs }
      : null;

  return (
    <div className="page online-page">
      <section className="online-hero">
        <WorkCover code={work.code} size="hero" src={work.coverUrl} />
        <div className="online-hero-info">
          <div className="chips">
            <span className="chip chip--online">
              <GlobeIcon /> asmr.one
            </span>
            {work.code ? <span className="chip chip--accent">{work.code}</span> : null}
            {work.local ? <span className="chip chip--local">已在本地库</span> : null}
            {work.releaseDate ? <span className="chip chip--muted">{work.releaseDate}</span> : null}
          </div>
          <h1>{work.title}</h1>
          <p className="work-circle">{work.circle || '未知社团'}</p>
          {editionOptions.length > 1 ? (
            <label className="online-language">
              <GlobeIcon />
              <span>版本</span>
              <select
                value={work.code}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next && next !== work.code) {
                    window.location.hash = `#/online/${encodeURIComponent(next)}`;
                  }
                }}
                aria-label="切换作品语言版本"
              >
                {editionOptions.map((edition) => (
                  <option key={edition.code} value={edition.code}>
                    {edition.label || edition.code} · {edition.code}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="work-tags">
            {work.vas.map((va) => (
              <span className="chip chip--tag" key={`va-${va}`}>
                {va}
              </span>
            ))}
            {work.tags.map((tag) => (
              <span className="chip chip--tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          <div className="work-meta-row">
            {work.rating !== null && work.rating > 0 ? (
              <span className="work-meta work-meta--rating">
                <StarIcon />
                <strong>{work.rating.toFixed(2)}</strong>
                {work.reviewCount > 0 ? ` · ${work.reviewCount} 评价` : ''}
              </span>
            ) : null}
            {work.priceYen !== null ? (
              <span className="work-meta">¥{work.priceYen.toLocaleString()}</span>
            ) : null}
            <span className="work-meta">
              <DiscIcon />
              <strong>{tracks.length > 0 ? tracks.length : '—'}</strong> 条音轨
            </span>
            {work.durationMs ? (
              <span className="work-meta">{formatTime(work.durationMs)}</span>
            ) : null}
          </div>
          <div className="work-actions">
            {tracks[0] ? (
              <button
                type="button"
                className="btn btn-primary btn-compact"
                onClick={() => playTrack(preferredIndex)}
              >
                <PlayIcon /> 在线试听
              </button>
            ) : null}
            {resumeInfo ? (
              <button
                type="button"
                className="btn btn-tonal btn-compact"
                onClick={() => playTrack(resumeInfo.index, resumeInfo.positionMs)}
              >
                <ClockIcon /> 继续试听 · {formatTime(resumeInfo.positionMs)}
              </button>
            ) : null}
            {work.local ? (
              <>
                <a className="btn btn-tonal btn-compact" href={`#/work/${encodeURIComponent(work.local ? work.code : '')}`}>
                  <FolderIcon /> 打开本地版本
                </a>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  onClick={() => void toggleFavorite()}
                  disabled={favoriteBusy}
                >
                  <HeartIcon filled={favorite} />
                  {favorite ? '取消收藏' : '收藏'}
                </button>
              </>
            ) : (
              <>
                {tracks.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn-tonal btn-compact"
                    onClick={() => setExportOpen(true)}
                  >
                    <DownloadIcon /> 导出到本地库
                  </button>
                ) : null}
                <span className="online-note">
                  未入库 · 在线播放经本机代理，asmr.one token 不会出现在浏览器
                </span>
              </>
            )}
          </div>
          {detail.tracksError ? (
            <div className="notice notice--error notice--inline" role="alert">
              <span>音轨列表获取失败：{detail.tracksError}</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="track-panel">
        <div className="section-head">
          <h2>{showTree ? '在线文件' : '在线音轨'}</h2>
          <span className="section-hint">{tracks.length} 条</span>
          {hasTree ? (
            <button
              type="button"
              className={`files-toggle${showTree ? '' : ' is-active'}`}
              onClick={() => setOnlineView(showTree ? 'list' : 'tree')}
            >
              {showTree ? <ListIcon /> : <FolderIcon />} {showTree ? '列表' : '文件树'}
            </button>
          ) : null}
        </div>
        {tracks.length === 0 ? (
          <p className="track-empty">没有可试听的音轨，可能需要登录或该作品仅提供下载。</p>
        ) : showTree ? (
          <OnlineFilesPanel
            key={work.code}
            tree={detail.trackTree ?? []}
            tracks={tracks}
            activeIndex={activeIndex}
            playing={playing}
            onPlay={playTrack}
          />
        ) : (
          <ol className="track-list">
            {tracks.map((track, index) => {
              const active = index === activeIndex;
              return (
                <li key={`${track.hash}-${index}`} className={`track-row${active ? ' is-active' : ''}`}>
                  <button
                    type="button"
                    className="track-main"
                    onClick={() => playTrack(index)}
                  >
                    <span className="track-index">
                      {active && playing ? (
                        <span className="playing-bars" aria-label="正在播放">
                          <i />
                          <i />
                          <i />
                        </span>
                      ) : (
                        String(index + 1).padStart(2, '0')
                      )}
                    </span>
                    <span className="track-title-wrap">
                      {track.groupTitle ? <em className="track-disc">{track.groupTitle}</em> : null}
                      <span className="track-title">{track.title}</span>
                    </span>
                    <span className="track-duration">
                      {track.durationMs ? formatTime(track.durationMs) : '—'}
                    </span>
                    <span className="track-action" aria-hidden="true">
                      {active && playing ? <PauseIcon /> : <PlayIcon />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {detail.localWork && detail.localWork.trackCount > 0 ? (
          <p className="settings-hint">
            本地版本共 {detail.localWork.trackCount} 条音轨，可打开本地作品继续收听并保存进度。
          </p>
        ) : null}
      </section>

      {activeTrack ? (
        <div className="online-player" role="region" aria-label="在线试听播放器">
          <div className="online-player-info">
            <span className="online-player-title">{activeTrack.title}</span>
            <span className="online-player-sub">
              {work.code} · {formatBytes(activeTrack.size)}
            </span>
          </div>
          <button
            type="button"
            className="player-skip"
            onClick={() => stepTrack(-1)}
            disabled={activeIndex <= 0}
            aria-label="上一条音轨"
          >
            ‹
          </button>
          <button
            type="button"
            className="player-toggle"
            onClick={() => playTrack(activeIndex)}
            aria-label={playing ? '暂停' : '播放'}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            className="player-skip"
            onClick={() => stepTrack(1)}
            disabled={activeIndex >= tracks.length - 1}
            aria-label="下一条音轨"
          >
            ›
          </button>
          <div className="online-player-progress">
            <span>{formatTime(positionMs)}</span>
            <input
              className="range range--sm"
              type="range"
              min={0}
              max={Math.max(1, durationMs)}
              step={250}
              value={Math.min(positionMs, Math.max(1, durationMs))}
              onChange={(event) => {
                const audio = audioRef.current;
                const value = Number(event.target.value);
                if (audio && audio.readyState >= 1) {
                  audio.currentTime = value / 1000;
                }
                setPositionMs(value);
              }}
              style={{ '--fill': `${Math.min(100, Math.max(0, progress))}%` } as CSSProperties}
              aria-label="在线播放进度"
            />
            <span>{formatTime(durationMs)}</span>
          </div>
          {audioError ? (
            <button
              type="button"
              className="online-player-error"
              onClick={() => setAudioError('')}
              title="点击关闭"
            >
              {audioError}
            </button>
          ) : null}
        </div>
      ) : null}

      <ExportDialog
        open={exportOpen}
        work={work}
        tracks={tracks}
        onClose={() => setExportOpen(false)}
        onLibraryChanged={() => {
          onLibraryChanged();
          setReloadKey((value) => value + 1);
        }}
      />

      <audio ref={audioRef} preload="metadata" className="audio-engine" />
    </div>
  );
}
