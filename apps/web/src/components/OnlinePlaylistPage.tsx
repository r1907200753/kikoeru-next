import { useEffect, useState } from 'react';
import {
  ApiError,
  getOnlinePlaylist,
  type OnlinePlaylistDetail,
} from '../api';
import { ListIcon } from '../icons';
import { OnlineCard } from './OnlineCard';
import { OnlineLoginHint } from './OnlineLoginHint';
import { Pagination } from './Pagination';

const PAGE_SIZE = 20;

export function OnlinePlaylistPage({
  id,
  accountKey,
  onOpenSettings,
}: {
  id: string;
  accountKey: string;
  onOpenSettings: () => void;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OnlinePlaylistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setPage(1);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setUnauthorized(false);
    getOnlinePlaylist(id, page, PAGE_SIZE)
      .then((result) => {
        if (!cancelled) {
          setData(result);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          setUnauthorized(true);
          setData(null);
        } else {
          setError(err instanceof Error ? err.message : String(err));
          setData(null);
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
  }, [id, page, retryKey, accountKey]);

  const playlist = data?.playlist ?? null;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page online-home-page online-playlist-page">
      {unauthorized ? (
        <OnlineLoginHint onOpenSettings={onOpenSettings} />
      ) : error ? (
        <div className="online-login-hint">
          <span className="online-login-icon">
            <ListIcon />
          </span>
          <div>
            <h2>播放列表加载失败</h2>
            <p>{error}</p>
          </div>
          <span className="notice-actions">
            <button
              type="button"
              className="btn btn-tonal"
              onClick={() => setRetryKey((value) => value + 1)}
            >
              重试
            </button>
            <a className="btn btn-primary" href="#/online/playlists">
              返回播放列表
            </a>
          </span>
        </div>
      ) : (
        <>
          <section className="playlist-hero">
            <div className="playlist-hero-cover">
              {playlist?.coverUrl ? (
                <img src={playlist.coverUrl} alt="" />
              ) : (
                <span className="playlist-cover-empty">
                  <ListIcon />
                </span>
              )}
            </div>
            <div className="playlist-hero-info">
              <p className="eyebrow">PLAYLIST</p>
              <h1>{loading || !playlist ? '加载中…' : playlist.displayName}</h1>
              {playlist ? (
                <>
                  <p className="playlist-hero-meta">
                    {playlist.systemKind ? 'asmr.one 系统歌单' : playlist.userName || 'asmr.one'}
                    <span>· {playlist.worksCount.toLocaleString()} 部作品</span>
                    {playlist.likedCount > 0 ? (
                      <span>· {playlist.likedCount.toLocaleString()} 赞</span>
                    ) : null}
                    {playlist.updatedAt ? (
                      <span>· 更新于 {playlist.updatedAt.slice(0, 10)}</span>
                    ) : null}
                  </p>
                  {playlist.description ? (
                    <p className="page-sub">{playlist.description}</p>
                  ) : null}
                </>
              ) : null}
              <a className="btn btn-tonal playlist-hero-back" href="#/online/playlists">
                返回播放列表
              </a>
            </div>
          </section>

          <section className="online-all-section">
            {loading ? (
              <div className="work-grid online-grid">
                {Array.from({ length: 10 }, (_, index) => (
                  <div className="work-card skeleton" key={index}>
                    <div className="skeleton-cover" />
                    <div className="skeleton-line" />
                    <div className="skeleton-line skeleton-line--short" />
                  </div>
                ))}
              </div>
            ) : !data || data.works.length === 0 ? (
              <div className="empty-inline">
                <p>这个播放列表还没有作品。</p>
              </div>
            ) : (
              <div className="work-grid online-grid">
                {data.works.map((work) => (
                  <OnlineCard key={`${work.id}-${work.code}`} work={work} />
                ))}
              </div>
            )}

            {!loading && data && data.works.length > 0 ? (
              <Pagination
                page={page}
                totalPages={totalPages}
                onChange={setPage}
                label="播放列表作品分页"
              />
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
