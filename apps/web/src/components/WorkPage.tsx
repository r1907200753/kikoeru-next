import { useEffect, useRef, useState } from 'react';
import {
  enrichWork,
  getWork,
  openWorkFolder,
  probeWork,
  scrapeWork,
  setWorkFavorite,
  type WorkDetail,
} from '../api';
import { formatTime } from '../format';
import {
  ClockIcon,
  DiscIcon,
  EditIcon,
  FolderIcon,
  GlobeIcon,
  HeartIcon,
  MusicIcon,
  PlayIcon,
  ScanIcon,
  StarIcon,
  UserIcon,
} from '../icons';
import type { PlayerApi } from '../player';
import { circleHref, tagHref, vaHref } from '../tags';
import { EditWorkDialog } from './EditWorkDialog';
import { WorkCover } from './WorkCard';
import { WorkFilesPanel } from './WorkFilesPanel';

const SCRAPE_SOURCE_LABEL = {
  auto: '自动',
  dlsite: 'DLsite',
  asmrone: 'asmr.one',
} as const;

export function WorkPage({
  code,
  player,
  onFavoriteChanged,
}: {
  code: string;
  player: PlayerApi;
  onFavoriteChanged: () => void;
}) {
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [scraping, setScraping] = useState(false);
  const [scrapeNote, setScrapeNote] = useState('');
  const [folderNote, setFolderNote] = useState('');
  const [scrapeSource, setScrapeSource] = useState<'auto' | 'dlsite' | 'asmrone'>('auto');
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichNote, setEnrichNote] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const probedRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setWork(null);
    getWork(code)
      .then((detail) => {
        if (!cancelled) {
          setWork(detail);
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

  useEffect(() => {
    if (!work || probedRef.current === work.code) {
      return;
    }
    if (!work.tracks.some((track) => track.durationMs === null)) {
      return;
    }
    probedRef.current = work.code;
    let cancelled = false;
    probeWork(work.code)
      .then((result) => {
        if (!cancelled) {
          setWork(result.work);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [work]);

  const rerunScrape = async () => {
    if (!work || scraping) {
      return;
    }
    setScraping(true);
    setScrapeNote('');
    try {
      const result = await scrapeWork(work.code, scrapeSource);
      if (result.work) {
        setWork(result.work);
      }
      setScrapeNote(
        `${result.source === 'asmrone' ? 'asmr.one' : 'DLsite'}：${result.message}`,
      );
      probedRef.current = '';
    } catch (err) {
      setScrapeNote(err instanceof Error ? err.message : String(err));
    } finally {
      setScraping(false);
    }
  };

  const toggleFavorite = async () => {
    if (!work || favoriteBusy) {
      return;
    }
    setFavoriteBusy(true);
    try {
      const result = await setWorkFavorite(work.code, !work.favoriteAt);
      setWork({ ...work, favoriteAt: result.favoriteAt });
      onFavoriteChanged();
    } catch (err) {
      setScrapeNote(err instanceof Error ? err.message : String(err));
    } finally {
      setFavoriteBusy(false);
    }
  };

  const enrich = async () => {
    if (!work || enriching) {
      return;
    }
    setEnriching(true);
    setEnrichNote('');
    try {
      const result = await enrichWork(work.code);
      setWork({ ...result.work, playback: work.playback });
      setEnrichNote('已从 asmr.one 同步评分、价格与声优');
    } catch (err) {
      setEnrichNote(err instanceof Error ? err.message : String(err));
    } finally {
      setEnriching(false);
    }
  };

  if (loading) {
    return (
      <div className="page work-page">
        <div className="work-hero work-hero--skeleton">
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

  if (!work) {
    return (
      <div className="page work-page">
        <div className="empty-card">
          <div className="empty-icon">
            <MusicIcon />
          </div>
          <h2>打不开这部作品</h2>
          <p>{error || '作品不存在或尚未入库。'}</p>
          <div className="empty-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setReloadKey((value) => value + 1)}
            >
              重试
            </button>
            <a className="btn btn-tonal" href={`#/online/${encodeURIComponent(code)}`}>
              <GlobeIcon /> 在线查看
            </a>
          </div>
        </div>
      </div>
    );
  }

  const context = {
    workId: work.id,
    workCode: work.code,
    workTitle: work.title,
    coverAssetId: work.coverAssetId,
    workPath: work.relativePath,
    tracks: work.tracks,
    workTracks: work.tracks,
  };
  const playback = work.playback;
  const hasMultipleDiscs = work.tracks.some((track) => track.disc > 1);
  const discCount = new Set(work.tracks.map((track) => track.disc)).size;
  const totalDuration = work.tracks.reduce((sum, track) => sum + (track.durationMs ?? 0), 0);
  const resumeTrack =
    playback && playback.trackId !== null
      ? work.tracks.find((track) => track.id === playback.trackId)
      : undefined;

  return (
    <div className="page work-page">
      <section className="work-hero">
        <WorkCover code={work.code} coverAssetId={work.coverAssetId} size="hero" />
        <div className="work-hero-info">
          <h1>{work.title}</h1>
          {work.circle ? (
            <a className="work-circle-link" href={circleHref(work.circle)}>
              <FolderIcon />
              {work.circle}
            </a>
          ) : (
            <span className="work-circle-link">未知社团</span>
          )}
          <div className="work-vas">
            <span className="work-label">CV</span>
            {work.vas.length > 0 ? (
              work.vas.map((va) => (
                <a className="work-va-chip" href={vaHref(va)} key={va}>
                  <UserIcon />
                  {va}
                </a>
              ))
            ) : (
              <span className="work-vas-empty">暂无声优信息</span>
            )}
          </div>
          <div className="work-meta-strip">
            {work.rating !== null ? (
              <span className="work-rating">
                <StarIcon /> {work.rating.toFixed(2)}
              </span>
            ) : null}
            <span className="work-meta">
              <MusicIcon />
              <strong>{work.tracks.length}</strong> 条音轨
            </span>
            {hasMultipleDiscs ? (
              <span className="work-meta">
                <DiscIcon />
                <strong>{discCount}</strong> 张碟
              </span>
            ) : null}
            {totalDuration > 0 ? (
              <span className="work-meta">
                <ClockIcon />
                <strong>{formatTime(totalDuration)}</strong>
              </span>
            ) : null}
            {work.priceYen !== null ? (
              <span className="work-meta">¥{work.priceYen.toLocaleString()}</span>
            ) : null}
            <span className="work-meta work-meta--muted">
              <FolderIcon />
              <span className="mono">{work.code}</span>
            </span>
            {work.releaseDate ? (
              <span className="work-meta work-meta--muted">{work.releaseDate}</span>
            ) : null}
          </div>
          {work.tags.length > 0 ? (
            <div className="work-tags">
              {work.tags.map((tag) => (
                <a className="chip chip--tag" href={tagHref(tag)} key={tag}>
                  {tag}
                </a>
              ))}
            </div>
          ) : null}
          <div className="work-actions">
            <button
              type="button"
              className="work-action work-action--primary"
              data-tip="播放全部"
              aria-label="播放全部"
              onClick={() => {
                const first = work.tracks[0];
                if (first) {
                  player.play(first, context, 0);
                }
              }}
              disabled={work.tracks.length === 0}
            >
              <PlayIcon />
            </button>
            {resumeTrack && playback ? (
              <button
                type="button"
                className="work-action work-action--tonal"
                data-tip={
                  playback.positionMs > 0
                    ? `继续收听 · ${formatTime(playback.positionMs)}`
                    : '重新收听'
                }
                aria-label={
                  playback.positionMs > 0
                    ? `继续收听 · ${formatTime(playback.positionMs)}`
                    : '重新收听'
                }
                onClick={() => {
                  const target =
                    playback.positionMs > 0 ? resumeTrack : (work.tracks[0] ?? resumeTrack);
                  if (target) {
                    player.play(target, context, playback.positionMs);
                  }
                }}
              >
                <ClockIcon />
              </button>
            ) : null}
            <button
              type="button"
              className={`work-action${work.favoriteAt ? ' is-active' : ''}`}
              data-tip={work.favoriteAt ? '取消收藏' : '收藏'}
              aria-label={work.favoriteAt ? '取消收藏' : '收藏'}
              onClick={() => void toggleFavorite()}
              disabled={favoriteBusy}
            >
              <HeartIcon filled={Boolean(work.favoriteAt)} />
            </button>
            <button
              type="button"
              className="work-action"
              data-tip="修改信息"
              aria-label="修改信息"
              onClick={() => setEditOpen(true)}
            >
              <EditIcon />
            </button>
            <button
              type="button"
              className="work-action"
              data-tip="打开本地文件夹"
              aria-label="打开本地文件夹"
              onClick={() => {
                if (!work) {
                  return;
                }
                setFolderNote('');
                void openWorkFolder(work.code)
                  .then(() => setFolderNote('已打开本地文件夹'))
                  .catch((err: unknown) =>
                    setFolderNote(err instanceof Error ? err.message : String(err)),
                  );
              }}
            >
              <FolderIcon />
            </button>
            <button
              type="button"
              className="work-action"
              data-tip={enriching ? '同步中…' : '同步在线评分'}
              aria-label={enriching ? '同步中' : '同步在线评分'}
              onClick={() => void enrich()}
              disabled={enriching}
            >
              <StarIcon className={enriching ? 'spin' : ''} />
            </button>
            <button
              type="button"
              className="work-action"
              data-tip={`刮削来源：${SCRAPE_SOURCE_LABEL[scrapeSource]}（点击切换）`}
              aria-label={`刮削来源：${SCRAPE_SOURCE_LABEL[scrapeSource]}`}
              onClick={() =>
                setScrapeSource((current) =>
                  current === 'auto' ? 'dlsite' : current === 'dlsite' ? 'asmrone' : 'auto',
                )
              }
              disabled={scraping}
            >
              <GlobeIcon />
            </button>
            <button
              type="button"
              className="work-action"
              data-tip={
                scraping
                  ? '刮削中…'
                  : work.metadataStatus === 'local'
                    ? '刮削元数据'
                    : '重新刮削'
              }
              aria-label={
                scraping
                  ? '刮削中'
                  : work.metadataStatus === 'local'
                    ? '刮削元数据'
                    : '重新刮削'
              }
              onClick={() => void rerunScrape()}
              disabled={scraping}
            >
              <ScanIcon className={scraping ? 'spin' : ''} />
            </button>
          </div>
          {scrapeNote ? (
            <p className="work-scrape-note" role="status">
              {scrapeNote}
            </p>
          ) : null}
          {folderNote ? (
            <p className="work-scrape-note" role="status">
              {folderNote}
            </p>
          ) : null}
          {enrichNote ? (
            <p className="work-scrape-note" role="status">
              {enrichNote}
            </p>
          ) : null}
        </div>
      </section>

      <div className="work-body">
        <WorkFilesPanel code={work.code} work={work} player={player} />
      </div>

      <EditWorkDialog
        open={editOpen}
        work={work}
        onClose={() => setEditOpen(false)}
        onSaved={(next) => {
          setWork(next);
          onFavoriteChanged();
        }}
      />
    </div>
  );
}
