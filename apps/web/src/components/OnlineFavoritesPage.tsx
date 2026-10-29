import { useEffect, useState } from 'react';
import {
  ApiError,
  listOnlineFavorites,
  type OnlineReviewOrder,
  type OnlineReviewPage,
  type OnlineReviewProgress,
} from '../api';
import { HeartIcon } from '../icons';
import { ONLINE_PROGRESS_OPTIONS, ONLINE_REVIEW_ORDER_OPTIONS } from '../online';
import { OnlineCard } from './OnlineCard';
import { OnlineLoginHint } from './OnlineLoginHint';
import { Pagination } from './Pagination';

const PAGE_SIZE = 20;

export function OnlineFavoritesPage({
  accountKey,
  onOpenSettings,
}: {
  accountKey: string;
  onOpenSettings: () => void;
}) {
  const [tab, setTab] = useState<'review' | 'progress'>('review');
  const [progress, setProgress] = useState<OnlineReviewProgress>('marked');
  const [order, setOrder] = useState<OnlineReviewOrder>('updated_at');
  const [sort, setSort] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OnlineReviewPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setUnauthorized(false);
    listOnlineFavorites({
      tab,
      progress: tab === 'progress' ? progress : '',
      page,
      pageSize: PAGE_SIZE,
      order,
      sort,
    })
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
  }, [tab, progress, order, sort, page, retryKey, accountKey]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const changeTab = (value: 'review' | 'progress') => {
    if (value !== tab) {
      setTab(value);
      setPage(1);
    }
  };

  return (
    <div className="page online-home-page online-favorites-page">
      <section className="online-home-intro">
        <div>
          <p className="eyebrow">MY ASMR.ONE</p>
          <h1>
            <HeartIcon /> 我的收藏
          </h1>
          <p className="page-sub">
            读取你 asmr.one 账号里的评价与收听进度，可按评分、发售日期等重新排序。
          </p>
        </div>
        <div className="online-home-stats">
          <span className="mini-chip">
            {unauthorized ? '未登录' : data ? `${total.toLocaleString()} 部作品` : '连接中…'}
          </span>
          <span className="mini-chip mini-chip--muted">数据来自 asmr.one 账号</span>
        </div>
      </section>

      {unauthorized ? (
        <OnlineLoginHint onOpenSettings={onOpenSettings} />
      ) : (
        <>
          <div className="online-tabs" role="tablist" aria-label="收藏视图">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'review'}
              className={`online-tab${tab === 'review' ? ' is-active' : ''}`}
              onClick={() => changeTab('review')}
            >
              我的评价
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'progress'}
              className={`online-tab${tab === 'progress' ? ' is-active' : ''}`}
              onClick={() => changeTab('progress')}
            >
              我的进度
            </button>
          </div>

          {tab === 'progress' ? (
            <div className="chips online-progress-chips" aria-label="收听进度筛选">
              {ONLINE_PROGRESS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`chip chip--filter${progress === option.value ? ' is-active' : ''}`}
                  onClick={() => {
                    setProgress(option.value);
                    setPage(1);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}

          <section className="online-all-section">
            <div className="online-all-head">
              <div>
                <h2>{tab === 'review' ? '我的评价' : '我的进度'}</h2>
                <p className="online-all-count">
                  {data ? `${total.toLocaleString()} 部` : loading ? '加载中…' : '—'}
                </p>
              </div>
              <div className="online-sort-group">
                <label className="online-sort">
                  <span>排序</span>
                  <select
                    value={order}
                    onChange={(event) => {
                      setOrder(event.target.value as OnlineReviewOrder);
                      setPage(1);
                    }}
                    aria-label="收藏排序"
                  >
                    {ONLINE_REVIEW_ORDER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="online-sort-direction"
                  onClick={() => {
                    setSort((value) => (value === 'desc' ? 'asc' : 'desc'));
                    setPage(1);
                  }}
                  title={sort === 'desc' ? '当前降序，点击切换升序' : '当前升序，点击切换降序'}
                >
                  {sort === 'desc' ? '降序 ↓' : '升序 ↑'}
                </button>
              </div>
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
              <div className="work-grid online-grid">
                {Array.from({ length: 10 }, (_, index) => (
                  <div className="work-card skeleton" key={index}>
                    <div className="skeleton-cover" />
                    <div className="skeleton-line" />
                    <div className="skeleton-line skeleton-line--short" />
                  </div>
                ))}
              </div>
            ) : !data || data.items.length === 0 ? (
              <div className="empty-inline">
                <p>
                  {tab === 'review'
                    ? '这个账号还没有留下评价。'
                    : '这个进度下还没有作品，换个筛选看看。'}
                </p>
              </div>
            ) : (
              <div className="work-grid online-grid">
                {data.items.map((work) => (
                  <OnlineCard
                    key={`${work.id}-${work.code}`}
                    work={work}
                    review={work}
                  />
                ))}
              </div>
            )}

            {!loading && data && data.items.length > 0 ? (
              <Pagination
                page={page}
                totalPages={totalPages}
                onChange={setPage}
                label="我的收藏分页"
              />
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
