import { useEffect, useState } from 'react';
import {
  listOnlineWorks,
  searchOnline,
  type OnlineListOrder,
  type OnlineWork,
} from '../api';
import { GlobeIcon, SearchIcon } from '../icons';
import { usePreferences } from '../preferences';
import { GridDensityToggle } from './GridDensityToggle';
import { OnlineCard } from './OnlineCard';
import { Pagination } from './Pagination';

const PAGE_SIZE = 20;
const ONLINE_SEARCH_STORAGE_KEY = 'kikoeru.onlineSearch';

type OnlineSearchSnapshot = {
  input: string;
  term: string;
  page: number;
};

function readOnlineSearchSnapshot(): OnlineSearchSnapshot | null {
  try {
    const raw = sessionStorage.getItem(ONLINE_SEARCH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const value = JSON.parse(raw) as Partial<OnlineSearchSnapshot>;
    if (
      typeof value.input === 'string' &&
      typeof value.term === 'string' &&
      Number.isInteger(value.page) &&
      (value.page ?? 0) > 0
    ) {
      return { input: value.input, term: value.term, page: value.page as number };
    }
  } catch {
    // 隐私模式下忽略。
  }
  return null;
}

const ORDER_OPTIONS: Array<{ value: OnlineListOrder; label: string }> = [
  { value: 'create_date', label: '最新收录' },
  { value: 'release', label: '发售日期' },
  { value: 'dl_count', label: '销量最高' },
  { value: 'rate_average_2dp', label: '评价最高' },
];

export function OnlineHomePage() {
  const [order, setOrder] = useState<OnlineListOrder>('create_date');
  const [page, setPage] = useState(1);
  const [initialSearch] = useState(readOnlineSearchSnapshot);
  const [searchInput, setSearchInput] = useState(initialSearch?.input ?? '');
  const [searchTerm, setSearchTerm] = useState(initialSearch?.term ?? '');
  const [searchPage, setSearchPage] = useState(initialSearch?.page ?? 1);
  const [preferences] = usePreferences();
  const gridClass = `work-grid online-grid${
    preferences.onlineHomeGrid === 'four'
      ? ' work-grid--four'
      : preferences.onlineHomeGrid === 'three'
        ? ' work-grid--three'
        : ''
  }`;
  const [items, setItems] = useState<OnlineWork[]>([]);
  const [total, setTotal] = useState(0);
  const [hot, setHot] = useState<OnlineWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [hotLoading, setHotLoading] = useState(true);
  const [error, setError] = useState('');
  const [hotError, setHotError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        ONLINE_SEARCH_STORAGE_KEY,
        JSON.stringify({ input: searchInput, term: searchTerm, page: searchPage }),
      );
    } catch {
      // 隐私模式下忽略。
    }
  }, [searchInput, searchTerm, searchPage]);

  useEffect(() => {
    let cancelled = false;
    setHotLoading(true);
    setHotError('');
    listOnlineWorks('dl_count', 1, 10)
      .then((data) => {
        if (!cancelled) {
          setHot(data.items);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setHotError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHotLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const request = searchTerm
      ? searchOnline(searchTerm, searchPage, PAGE_SIZE)
      : listOnlineWorks(order, page, PAGE_SIZE);
    request
      .then((data) => {
        if (!cancelled) {
          setItems(data.items);
          setTotal(data.total);
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
  }, [order, page, searchPage, searchTerm, retryKey]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const changeOrder = (value: OnlineListOrder) => {
    setOrder(value);
    setPage(1);
  };

  const submitSearch = () => {
    const term = searchInput.trim();
    setSearchTerm(term);
    setSearchPage(1);
    if (!term) {
      setPage(1);
    }
  };

  const clearSearch = () => {
    setSearchInput('');
    setSearchTerm('');
    setSearchPage(1);
    setPage(1);
  };

  return (
    <div className="page online-home-page">
      <section className="online-home-intro">
        <div>
          <p className="eyebrow">ONLINE LIBRARY</p>
          <h1>
            <GlobeIcon /> asmr.one 在线曲库
          </h1>
          <p className="page-sub">
            直接浏览 asmr.one 的公开作品，支持热门排行、分类排序与翻页。播放与封面都经本机后端代理。
          </p>
        </div>
        <div className="online-home-side">
          <form
            className="online-search"
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <SearchIcon />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜索 asmr.one 作品"
              aria-label="搜索在线作品"
            />
            {searchInput ? (
              <button
                type="button"
                className="online-search-clear"
                onClick={clearSearch}
                aria-label="清空在线搜索"
              >
                ×
              </button>
            ) : null}
            <button type="submit" className="btn btn-primary btn-compact">
              搜索
            </button>
          </form>
          <div className="online-home-stats">
            <span className="mini-chip">
              {searchTerm
                ? total > 0
                  ? `${total.toLocaleString()} 条搜索结果`
                  : '搜索中…'
                : total > 0
                  ? `${total.toLocaleString()} 部在线作品`
                  : '连接中…'}
            </span>
            <span className="mini-chip mini-chip--muted">无需登录也能浏览</span>
          </div>
        </div>
      </section>

      {!searchTerm ? (
      <section className="online-hot-section">
        <div className="section-head">
          <h2>🔥 热门作品</h2>
          <span className="section-hint">按累计销量</span>
        </div>
        {hotError ? (
          <div className="notice notice--error" role="alert">
            <span>热门作品加载失败：{hotError}</span>
            <button
              type="button"
              className="notice-link"
              onClick={() => setRetryKey((value) => value + 1)}
            >
              重试
            </button>
          </div>
        ) : null}
        {hotLoading && hot.length === 0 ? (
          <div className="online-hot-row">
            {Array.from({ length: 5 }, (_, index) => (
              <div className="work-card skeleton" key={index}>
                <div className="skeleton-cover" />
                <div className="skeleton-line" />
                <div className="skeleton-line skeleton-line--short" />
              </div>
            ))}
          </div>
        ) : hot.length > 0 ? (
          <div className="online-hot-row">
            {hot.map((work) => (
              <OnlineCard key={`hot-${work.id}`} work={work} />
            ))}
          </div>
        ) : null}
      </section>
      ) : null}

      <section className="online-all-section">
        <div className="online-all-head">
          <div>
            <h2>{searchTerm ? `搜索 “${searchTerm}”` : '全部作品'}</h2>
            <p className="online-all-count">
              {total > 0 ? total.toLocaleString() : '—'} {searchTerm ? '条结果' : '部'}
            </p>
          </div>
          <div className="online-all-tools">
            <GridDensityToggle scope="online" />
            {searchTerm ? (
              <button type="button" className="btn btn-ghost btn-compact" onClick={clearSearch}>
                清除搜索
              </button>
            ) : (
              <label className="online-sort">
                <span>排序</span>
                <select
                  value={order}
                  onChange={(event) => changeOrder(event.target.value as OnlineListOrder)}
                  aria-label="在线作品排序"
                >
                  {ORDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
          <div className={gridClass}>
            {Array.from({ length: 10 }, (_, index) => (
              <div className="work-card skeleton" key={index}>
                <div className="skeleton-cover" />
                <div className="skeleton-line" />
                <div className="skeleton-line skeleton-line--short" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="empty-inline">
            <p>
              {searchTerm
                ? `asmr.one 没有匹配 “${searchTerm}” 的作品，换个关键词试试。`
                : 'asmr.one 没有返回作品，稍后再试。'}
            </p>
          </div>
        ) : (
          <div className={gridClass}>
            {items.map((work) => (
              <OnlineCard key={`${work.id}-${work.code}`} work={work} />
            ))}
          </div>
        )}

        {!loading && items.length > 0 ? (
          <Pagination
            page={searchTerm ? searchPage : page}
            totalPages={totalPages}
            onChange={(next) => {
              if (searchTerm) {
                setSearchPage(next);
              } else {
                setPage(next);
              }
            }}
            label={searchTerm ? '在线搜索结果分页' : '在线作品分页'}
          />
        ) : null}
      </section>
    </div>
  );
}
