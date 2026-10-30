import { useEffect, useState } from 'react';
import {
  getLibraryRoots,
  getRecentPlayback,
  listWorks,
  type LibraryKind,
  type RecentPlayback,
  type WorkSort,
  type WorkSummary,
} from '../api';
import { formatRelative, formatTime } from '../format';
import { FolderIcon, PlayIcon, ScanIcon } from '../icons';
import type { PlayerApi } from '../player';
import { resumeRecent } from '../playback';
import { usePreferences } from '../preferences';
import { GridDensityToggle } from './GridDensityToggle';
import { WorkCard, WorkCover } from './WorkCard';

const PAGE_SIZE = 60;

interface LibraryPageProps {
  player: PlayerApi;
  reloadKey: number;
  sort: WorkSort;
  favoriteOnly: boolean;
  libraryPath: string;
  onOpenSettings: () => void;
  onToggleFavorite: (code: string, favorite: boolean) => void;
}

export function LibraryPage({
  player,
  reloadKey,
  sort,
  favoriteOnly,
  libraryPath,
  onOpenSettings,
  onToggleFavorite,
}: LibraryPageProps) {
  const [items, setItems] = useState<WorkSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState<RecentPlayback[]>([]);
  const [retryKey, setRetryKey] = useState(0);
  const [libraryKind, setLibraryKind] = useState<LibraryKind | ''>('');
  const [preferences] = usePreferences();
  const gridClass = `work-grid${
    preferences.localHomeGrid === 'four'
      ? ' work-grid--four'
      : preferences.localHomeGrid === 'three'
        ? ' work-grid--three'
        : ''
  }`;

  useEffect(() => {
    if (!libraryPath) {
      setLibraryKind('');
      return;
    }
    let cancelled = false;
    const normalize = (value: string) =>
      value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    getLibraryRoots()
      .then(({ roots }) => {
        if (cancelled) {
          return;
        }
        const target = roots.find((root) => normalize(root.path) === normalize(libraryPath));
        setLibraryKind(target?.kind ?? '');
      })
      .catch(() => {
        if (!cancelled) {
          setLibraryKind('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [libraryPath, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    listWorks({ limit: PAGE_SIZE, offset: 0, sort, favoriteOnly })
      .then((page) => {
        if (!cancelled) {
          setItems(page.items);
          setTotal(page.total);
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
  }, [sort, favoriteOnly, reloadKey, retryKey]);

  useEffect(() => {
    let cancelled = false;
    getRecentPlayback(8)
      .then((data) => {
        if (!cancelled) {
          setRecent(data.items);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reloadKey, retryKey]);

  const loadMore = async () => {
    if (loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await listWorks({
        limit: PAGE_SIZE,
        offset: items.length,
        sort,
        favoriteOnly,
      });
      setItems((previous) => [...previous, ...page.items]);
      setTotal(page.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const quickPlay = (item: RecentPlayback) => {
    if (!resumeRecent(player, item)) {
      window.location.hash = `#/work/${encodeURIComponent(item.code)}`;
    }
  };

  const showOnboarding = !loading && !error && !favoriteOnly && total === 0;
  const showRecent = !favoriteOnly && recent.length > 0;

  return (
    <div className="page library-page">
      <section className="library-strip">
        <div>
          <p className="library-path">
            <FolderIcon />
            <span className="mono">{libraryPath || '尚未配置曲库目录'}</span>
          </p>
        </div>
        <div className="library-strip-side">
          <span className="mini-chip">{total} 部作品</span>
          {libraryKind ? (
            <span className="mini-chip mini-chip--muted">
              {libraryKind === 'mounted' ? '挂载库' : '本地库'}
            </span>
          ) : null}
          <button type="button" className="btn btn-tonal btn-compact" onClick={onOpenSettings}>
            <ScanIcon /> 扫描曲库
          </button>
        </div>
      </section>

      {error ? (
        <div className="notice notice--error" role="alert">
          <span>{error}</span>
          <span className="notice-actions">
            <button
              type="button"
              className="notice-link"
              onClick={() => setRetryKey((value) => value + 1)}
            >
              重试
            </button>
            <button type="button" onClick={() => setError('')} aria-label="关闭提示">
              ×
            </button>
          </span>
        </div>
      ) : null}

      {showRecent ? (
        <section className="section recent-section">
          <div className="section-head">
            <h2>继续收听</h2>
            <span className="section-hint">{recent.length} 部最近播放</span>
          </div>
          <div className="recent-row">
            {recent.map((item) => (
              <div className="recent-card" key={item.workId}>
                <a
                  className="recent-open"
                  href={`#/work/${encodeURIComponent(item.code)}`}
                  aria-label={`打开 ${item.title}`}
                >
                  <WorkCover
                    code={item.code}
                    coverAssetId={item.coverAssetId}
                    size="mini"
                  />
                  <span className="recent-info">
                    <span className="recent-title">{item.title}</span>
                    <span className="recent-track">{item.trackTitle || '未知音轨'}</span>
                    <span className="recent-meta">
                      {item.positionMs > 0 ? `听到 ${formatTime(item.positionMs)}` : '已听完'} ·{' '}
                      {formatRelative(item.updatedAt)}
                    </span>
                  </span>
                </a>
                <button
                  type="button"
                  className="recent-play"
                  onClick={() => quickPlay(item)}
                  aria-label={`继续播放 ${item.title}`}
                >
                  <PlayIcon />
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {showOnboarding ? (
        <section className="empty-card">
          <div className="empty-icon">
            <FolderIcon />
          </div>
          <h2>曲库还是空的</h2>
          <p>
            把音声作品放进 CloudDrive2 挂载盘，再选择曲库根目录扫描。目录名里带 RJ / BJ / VJ
            号即可自动识别，不会移动或重命名你的文件。
          </p>
          {libraryPath ? <p className="empty-path mono">{libraryPath}</p> : null}
          <button type="button" className="btn btn-primary" onClick={onOpenSettings}>
            <ScanIcon />
            去扫描曲库
          </button>
        </section>
      ) : null}

      {!showOnboarding ? (
        <section className="section">
          <div className="section-head">
            <h2>{favoriteOnly ? '收藏作品' : '全部作品'}</h2>
            <div className="section-head-tools">
              <span className="section-hint">{loading ? '读取中…' : `${total} 部作品`}</span>
              <GridDensityToggle scope="local" />
            </div>
          </div>

          {loading ? (
            <div className={gridClass}>
              {Array.from({ length: 12 }, (_, index) => (
                <div className="work-card skeleton" key={index}>
                  <div className="skeleton-cover" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line skeleton-line--short" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="empty-inline">
              <p>{favoriteOnly ? '还没有收藏的作品，点作品封面右上角的心形即可收藏。' : '曲库中还没有作品。'}</p>
            </div>
          ) : (
            <>
              <div className={gridClass}>
                {items.map((work) => (
                  <WorkCard
                    key={work.id}
                    work={work}
                    onToggleFavorite={onToggleFavorite}
                  />
                ))}
              </div>
              {items.length < total ? (
                <div className="load-more">
                  <button
                    type="button"
                    className="btn btn-tonal"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                  >
                    {loadingMore ? '加载中…' : `加载更多（还有 ${total - items.length} 部）`}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
