import { useEffect, useState } from 'react';
import { getRecentPlayback, type RecentPlayback } from '../api';
import { formatRelative, formatTime } from '../format';
import { ClockIcon, PlayIcon } from '../icons';
import type { PlayerApi } from '../player';
import { resumeRecent } from '../playback';
import { WorkCover } from './WorkCard';

interface RecentPageProps {
  player: PlayerApi;
  reloadKey: number;
}

export function RecentPage({ player, reloadKey }: RecentPageProps) {
  const [items, setItems] = useState<RecentPlayback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getRecentPlayback(40)
      .then((data) => {
        if (!cancelled) {
          setItems(data.items);
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
  }, [reloadKey]);

  const quickPlay = (item: RecentPlayback) => {
    if (!resumeRecent(player, item)) {
      window.location.hash = `#/work/${encodeURIComponent(item.code)}`;
    }
  };

  return (
    <div className="page recent-page">
      <header className="page-intro">
        <div>
          <p className="eyebrow">LISTENING HISTORY</p>
          <h1>最近收听</h1>
          <p className="page-sub">从上次停下的地方接着听。</p>
        </div>
        <span className="page-count">{items.length} 条记录</span>
      </header>

      {error ? (
        <div className="notice notice--error" role="alert">
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="recent-list">
          {Array.from({ length: 5 }, (_, index) => (
            <div className="recent-row-card skeleton-row" key={index}>
              <div className="skeleton-cover skeleton-cover--mini" />
              <div className="skeleton-lines">
                <div className="skeleton-line" />
                <div className="skeleton-line skeleton-line--short" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <section className="empty-card">
          <div className="empty-icon">
            <ClockIcon />
          </div>
          <h2>还没有收听记录</h2>
          <p>播放任意音轨后，这里会记住你停下的位置。</p>
          <a className="btn btn-primary" href="#/">
            去曲库看看
          </a>
        </section>
      ) : (
        <div className="recent-list">
          {items.map((item) => (
            <div className="recent-row-card" key={item.workId}>
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
                    <span className="recent-time-pill">
                      {item.positionMs > 0 ? `听到 ${formatTime(item.positionMs)}` : '已听完'}
                    </span>
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
      )}
    </div>
  );
}
