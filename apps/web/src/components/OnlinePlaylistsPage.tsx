import { useEffect, useState } from 'react';
import {
  ApiError,
  listOnlinePlaylists,
  type OnlinePlaylist,
  type OnlinePlaylistFilter,
  type OnlinePlaylistPage,
} from '../api';
import { ListIcon } from '../icons';
import { OnlineLoginHint } from './OnlineLoginHint';
import { Pagination } from './Pagination';

const PAGE_SIZE = 20;

const FILTER_OPTIONS: Array<{ value: OnlinePlaylistFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'owned', label: '我创建的' },
  { value: 'liked', label: '我喜欢的' },
];

function PlaylistCard({ playlist }: { playlist: OnlinePlaylist }) {
  return (
    <a className="playlist-card" href={`#/online/playlists/${encodeURIComponent(playlist.id)}`}>
      <div className="playlist-cover">
        {playlist.coverUrl ? (
          <img src={playlist.coverUrl} alt="" loading="lazy" />
        ) : (
          <span className="playlist-cover-empty">
            <ListIcon />
          </span>
        )}
        {playlist.systemKind ? (
          <span className="playlist-system-badge">
            {playlist.systemKind === 'liked' ? '系统 · 喜欢' : '系统 · 标记'}
          </span>
        ) : null}
        <span className="playlist-count-badge">{playlist.worksCount} 部</span>
      </div>
      <div className="playlist-body">
        <strong className="playlist-name">{playlist.displayName}</strong>
        <span className="playlist-meta">
          {playlist.systemKind ? 'asmr.one 系统歌单' : playlist.userName || 'asmr.one'}
          {playlist.likedCount > 0 ? ` · ${playlist.likedCount} 赞` : ''}
        </span>
        {playlist.description ? (
          <span className="playlist-desc">{playlist.description}</span>
        ) : null}
      </div>
    </a>
  );
}

export function OnlinePlaylistsPage({
  accountKey,
  onOpenSettings,
}: {
  accountKey: string;
  onOpenSettings: () => void;
}) {
  const [filterBy, setFilterBy] = useState<OnlinePlaylistFilter>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OnlinePlaylistPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setUnauthorized(false);
    listOnlinePlaylists({ filterBy, page, pageSize: PAGE_SIZE })
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
  }, [filterBy, page, retryKey, accountKey]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page online-home-page online-playlists-page">
      <section className="online-home-intro">
        <div>
          <p className="eyebrow">MY ASMR.ONE</p>
          <h1>
            <ListIcon /> 播放列表
          </h1>
          <p className="page-sub">
            浏览你创建或喜欢的 asmr.one 播放列表，系统歌单「我喜欢的」「我标记的」也会同步出现。
          </p>
        </div>
        <div className="online-home-stats">
          <span className="mini-chip">
            {unauthorized ? '未登录' : data ? `${total.toLocaleString()} 个列表` : '连接中…'}
          </span>
          <span className="mini-chip mini-chip--muted">数据来自 asmr.one 账号</span>
        </div>
      </section>

      {unauthorized ? (
        <OnlineLoginHint onOpenSettings={onOpenSettings} />
      ) : (
        <section className="online-all-section">
          <div className="online-all-head">
            <div className="chips" aria-label="播放列表筛选">
              {FILTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`chip chip--filter${filterBy === option.value ? ' is-active' : ''}`}
                  onClick={() => {
                    setFilterBy(option.value);
                    setPage(1);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="online-all-count">
              {data ? `${total.toLocaleString()} 个列表` : loading ? '加载中…' : '—'}
            </p>
          </div>

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

          {loading ? (
            <div className="playlist-grid">
              {Array.from({ length: 8 }, (_, index) => (
                <div className="playlist-card skeleton" key={index}>
                  <div className="skeleton-cover" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line skeleton-line--short" />
                </div>
              ))}
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="empty-inline">
              <p>
                {filterBy === 'liked'
                  ? '还没有喜欢的播放列表。'
                  : filterBy === 'owned'
                    ? '这个账号还没有创建播放列表。'
                    : 'asmr.one 没有返回播放列表。'}
              </p>
            </div>
          ) : (
            <div className="playlist-grid">
              {data.items.map((playlist) => (
                <PlaylistCard key={playlist.id} playlist={playlist} />
              ))}
            </div>
          )}

          {!loading && data && data.items.length > 0 ? (
            <Pagination
              page={page}
              totalPages={totalPages}
              onChange={setPage}
              label="播放列表分页"
            />
          ) : null}
        </section>
      )}
    </div>
  );
}
