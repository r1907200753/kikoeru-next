import { useEffect, useRef, useState } from 'react';
import {
  getOnlineWork,
  setWorkFavorite,
  type OnlineWorkDetail,
} from '../api';
import { formatTime } from '../format';
import { preferredOnlineTrackIndex } from '../online';
import { buildOnlinePlayerData } from '../online-player';
import { trackKey, type PlayerApi } from '../player';
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
  player,
  onLibraryChanged,
}: {
  code: string;
  player: PlayerApi;
  onLibraryChanged: () => void;
}) {
  const [detail, setDetail] = useState<OnlineWorkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [onlineView, setOnlineView] = useState<'tree' | 'list'>('tree');
  const [preferences] = usePreferences();
  const autoplayRef = useRef(false);
  const loadedCodeRef = useRef('');

  useEffect(() => {
    setExportOpen(false);
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    const codeChanged = loadedCodeRef.current !== code;
    loadedCodeRef.current = code;
    setError('');
    if (codeChanged) {
      autoplayRef.current = false;
      setLoading(true);
      setDetail(null);
    }
    getOnlineWork(code)
      .then((data) => {
        if (!cancelled) {
          setDetail(data);
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
  }, [code, reloadKey]);

  const playerData = detail ? buildOnlinePlayerData(detail) : null;
  const tracks = playerData?.tracks ?? [];
  const context = playerData?.context ?? null;
  const savedPlayback = detail?.playback ?? null;
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
  const isCurrentWork = Boolean(
    detail &&
      player.current?.source === 'online' &&
      player.current.workCode === detail.work.code,
  );
  const activeIndex =
    isCurrentWork && player.current
      ? tracks.findIndex((track) => trackKey(track) === trackKey(player.current!.track))
      : -1;
  const playing = isCurrentWork && player.playing;
  const preferredIndex = preferredOnlineTrackIndex(
    detail?.tracks ?? [],
    preferences.onlineAudioPriority,
  );
  const resumeInfo =
    savedPlayback && savedIndex >= 0 && savedPlayback.positionMs >= 3000 && !isCurrentWork
      ? { index: savedIndex, positionMs: savedPlayback.positionMs }
      : null;

  const playTrack = (index: number, seekMs?: number) => {
    const track = tracks[index];
    if (!track || !context) {
      return;
    }
    const current = player.current;
    if (
      current &&
      current.source === 'online' &&
      trackKey(current.track) === trackKey(track) &&
      seekMs === undefined
    ) {
      player.toggle();
      return;
    }
    const startMs =
      seekMs ?? (savedPlayback && savedIndex === index ? savedPlayback.positionMs : 0);
    player.play(track, context, startMs);
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
    playTrack(preferredIndex);
  }, [detail, tracks.length, preferredIndex]);

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
                {tracks.length > 0 || hasTree ? (
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
          <span className="section-hint">
            {showTree ? `${(detail.trackTree ?? []).length} 项` : `${tracks.length} 条`}
          </span>
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
        {tracks.length === 0 && !hasTree ? (
          <p className="track-empty">没有可试听的音轨，可能需要登录或该作品仅提供下载。</p>
        ) : showTree ? (
          <OnlineFilesPanel
            key={work.code}
            tree={detail.trackTree ?? []}
            tracks={detail.tracks}
            activeIndex={activeIndex}
            playing={playing}
            onPlay={playTrack}
          />
        ) : tracks.length === 0 ? (
          <p className="track-empty">没有可试听的音轨，可能需要登录或该作品仅提供下载。</p>
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

      <ExportDialog
        open={exportOpen}
        work={work}
        tree={detail.trackTree ?? []}
        tracks={detail.tracks}
        onClose={() => setExportOpen(false)}
        onLibraryChanged={() => {
          onLibraryChanged();
          setReloadKey((value) => value + 1);
        }}
      />
    </div>
  );
}
