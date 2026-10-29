import { useEffect, useState } from 'react';
import { listWorks, type WorkSort, type WorkSummary } from '../api';
import { FolderIcon, TagIcon, UserIcon } from '../icons';
import { WorkCard } from './WorkCard';

const PAGE_SIZE = 60;

type CollectionKind = 'tag' | 'circle' | 'va';

const KIND_META: Record<
  CollectionKind,
  { eyebrow: string; emptyTitle: string; emptyHint: string }
> = {
  tag: {
    eyebrow: 'TAG',
    emptyTitle: '没有这个标签的作品',
    emptyHint: '标签来自本地元数据，可能尚未刮削；换个标签或重新刮削后再试。',
  },
  circle: {
    eyebrow: 'CIRCLE',
    emptyTitle: '这个社团还没有作品',
    emptyHint: '社团信息来自本地元数据，可能尚未刮削；重新刮削后再试。',
  },
  va: {
    eyebrow: 'VOICE ACTOR',
    emptyTitle: '这个声优还没有作品',
    emptyHint: '声优信息来自本地元数据，可能尚未刮削；重新刮削后再试。',
  },
};

function filterFor(kind: CollectionKind, value: string) {
  if (kind === 'circle') {
    return { circle: value };
  }
  if (kind === 'va') {
    return { va: value };
  }
  return { tag: value };
}

function CollectionIcon({ kind }: { kind: CollectionKind }) {
  if (kind === 'circle') {
    return <FolderIcon />;
  }
  if (kind === 'va') {
    return <UserIcon />;
  }
  return <TagIcon />;
}

export function TagPage({
  tag,
  kind = 'tag',
  sort,
  reloadKey,
  onToggleFavorite,
}: {
  tag: string;
  kind?: CollectionKind;
  sort: WorkSort;
  reloadKey: number;
  onToggleFavorite: (code: string, favorite: boolean) => void;
}) {
  const [items, setItems] = useState<WorkSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const meta = KIND_META[kind];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setItems([]);
    listWorks({ ...filterFor(kind, tag), limit: PAGE_SIZE, offset: 0, sort })
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
  }, [tag, kind, sort, reloadKey, retryKey]);

  const loadMore = async () => {
    if (loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await listWorks({
        ...filterFor(kind, tag),
        limit: PAGE_SIZE,
        offset: items.length,
        sort,
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
    <div className="page tag-page">
      <div className="section-head section-head--page">
        <div>
          <p className="eyebrow">{meta.eyebrow}</p>
          <h2 className="tag-page-title">
            <CollectionIcon kind={kind} />
            {tag}
          </h2>
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
          {Array.from({ length: 10 }, (_, index) => (
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
            <CollectionIcon kind={kind} />
          </div>
          <h2>{meta.emptyTitle}</h2>
          <p>{meta.emptyHint}</p>
          <a className="btn btn-primary" href="#/">
            回到曲库
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
