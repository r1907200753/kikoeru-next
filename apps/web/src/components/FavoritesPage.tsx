import { useEffect, useState } from 'react';
import { listWorks, type WorkSort, type WorkSummary } from '../api';
import { HeartIcon } from '../icons';
import { WorkCard } from './WorkCard';

const PAGE_SIZE = 60;

export function FavoritesPage({
  reloadKey,
  sort,
  onToggleFavorite,
}: {
  reloadKey: number;
  sort: WorkSort;
  onToggleFavorite: (code: string, favorite: boolean) => void;
}) {
  const [items, setItems] = useState<WorkSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    listWorks({ limit: PAGE_SIZE, offset: 0, sort, favoriteOnly: true })
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
  }, [sort, reloadKey, retryKey]);

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
        favoriteOnly: true,
      });
      setItems((previous) => [...previous, ...page.items]);
      setTotal(page.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="page favorites-page">
      <div className="section-head section-head--page">
        <div>
          <p className="eyebrow">FAVORITES</p>
          <h2>收藏的作品</h2>
        </div>
        <span className="section-hint">{loading ? '读取中…' : `${total} 部`}</span>
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
        <div className="work-grid">
          {Array.from({ length: 8 }, (_, index) => (
            <div className="work-card skeleton" key={index}>
              <div className="skeleton-cover" />
              <div className="skeleton-line" />
              <div className="skeleton-line skeleton-line--short" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <section className="empty-card">
          <div className="empty-icon">
            <HeartIcon />
          </div>
          <h2>还没有收藏</h2>
          <p>在作品卡片或详情页点击心形，就会收进这里。收藏只保存在本机，不上传云端。</p>
          <a className="btn btn-primary" href="#/">
            去曲库看看
          </a>
        </section>
      ) : (
        <>
          <div className="work-grid">
            {items.map((work) => (
              <WorkCard key={work.id} work={work} onToggleFavorite={onToggleFavorite} />
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
    </div>
  );
}
