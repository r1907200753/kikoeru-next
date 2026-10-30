import { useEffect, useState } from 'react';
import { listWorks, searchOnline, type OnlineWork, type WorkSummary } from '../api';
import { GlobeIcon, SearchIcon } from '../icons';
import { OnlineCard } from './OnlineCard';
import { WorkCard } from './WorkCard';

const SEARCH_STORAGE_KEY = 'kikoeru.searchState';

type SearchSnapshot = {
  input: string;
  term: string;
};

function readSearchSnapshot(): SearchSnapshot | null {
  try {
    const raw = sessionStorage.getItem(SEARCH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const value = JSON.parse(raw) as Partial<SearchSnapshot>;
    if (typeof value.input === 'string' && typeof value.term === 'string') {
      return { input: value.input, term: value.term };
    }
  } catch {
    // 隐私模式下忽略。
  }
  return null;
}

export function SearchPage({
  reloadKey,
  onToggleFavorite,
}: {
  reloadKey: number;
  onToggleFavorite: (code: string, favorite: boolean) => void;
}) {
  const [initialSearch] = useState(readSearchSnapshot);
  const [input, setInput] = useState(initialSearch?.input ?? '');
  const [term, setTerm] = useState(initialSearch?.term ?? '');
  const [localItems, setLocalItems] = useState<WorkSummary[]>([]);
  const [localTotal, setLocalTotal] = useState(0);
  const [localLoading, setLocalLoading] = useState(false);
  const [onlineItems, setOnlineItems] = useState<OnlineWork[]>([]);
  const [onlineTotal, setOnlineTotal] = useState(0);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineError, setOnlineError] = useState('');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    try {
      sessionStorage.setItem(SEARCH_STORAGE_KEY, JSON.stringify({ input, term }));
    } catch {
      // 隐私模式下忽略。
    }
  }, [input, term]);

  useEffect(() => {
    if (!term) {
      setLocalItems([]);
      setLocalTotal(0);
      return;
    }
    let cancelled = false;
    setLocalLoading(true);
    setLocalError('');
    listWorks({ query: term, limit: 24, offset: 0 })
      .then((page) => {
        if (!cancelled) {
          setLocalItems(page.items);
          setLocalTotal(page.total);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLocalError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLocalLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [term, reloadKey]);

  useEffect(() => {
    if (!term) {
      setOnlineItems([]);
      setOnlineTotal(0);
      setOnlineError('');
      return;
    }
    let cancelled = false;
    setOnlineLoading(true);
    setOnlineError('');
    searchOnline(term, 1, 24)
      .then((page) => {
        if (!cancelled) {
          setOnlineItems(page.items);
          setOnlineTotal(page.total);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setOnlineError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOnlineLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [term]);

  const submit = () => {
    setTerm(input.trim());
  };

  return (
    <div className="page search-page">
      <form
        className="search-hero"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="eyebrow">SEARCH</p>
        <h2>搜索本地与 asmr.one</h2>
        <div className="search-field search-field--large">
          <SearchIcon />
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="输入RJ号、标题、社团或声优，例如 RJ01426915"
            aria-label="搜索作品"
            autoFocus
          />
          {input ? (
            <button
              type="button"
              className="search-clear"
              onClick={() => {
                setInput('');
                setTerm('');
              }}
              aria-label="清空搜索"
            >
              ×
            </button>
          ) : null}
          <button type="submit" className="btn btn-primary btn-compact">
            搜索
          </button>
        </div>
        <p className="search-hint">
          本地搜索即时完成；在线搜索经本机后端代理到 asmr.one，未登录也可以搜索公开作品。
        </p>
      </form>

      {!term ? (
        <div className="search-empty">
          <GlobeIcon />
          <p>试试搜索RJ号，或输入「耳かき」「癒し」这类关键词。</p>
        </div>
      ) : (
        <>
          <section className="section">
            <div className="section-head">
              <h2>本地作品</h2>
              <span className="section-hint">
                {localLoading ? '读取中…' : `${localTotal} 部`}
              </span>
            </div>
            {localError ? (
              <div className="notice notice--error" role="alert">
                <span>{localError}</span>
              </div>
            ) : null}
            {!localLoading && localItems.length === 0 && !localError ? (
              <p className="muted-note">本地没有匹配 “{term}” 的作品，可以看看下面的在线结果。</p>
            ) : (
              <div className="work-grid">
                {localItems.map((work) => (
                  <WorkCard key={work.id} work={work} onToggleFavorite={onToggleFavorite} />
                ))}
              </div>
            )}
          </section>

          <section className="section">
            <div className="section-head">
              <h2>
                <GlobeIcon className="section-icon" /> 在线作品
              </h2>
              <span className="section-hint">
                {onlineLoading ? '连接 asmr.one…' : `${onlineTotal} 部`}
              </span>
            </div>
            {onlineError ? (
              <div className="notice notice--error" role="alert">
                <span>{onlineError}</span>
              </div>
            ) : null}
            {onlineLoading && onlineItems.length === 0 ? (
              <div className="work-grid">
                {Array.from({ length: 8 }, (_, index) => (
                  <div className="work-card skeleton" key={index}>
                    <div className="skeleton-cover" />
                    <div className="skeleton-line" />
                    <div className="skeleton-line skeleton-line--short" />
                  </div>
                ))}
              </div>
            ) : onlineItems.length === 0 && !onlineError && !onlineLoading ? (
              <p className="muted-note">asmr.one 没有返回结果，换个关键词试试。</p>
            ) : (
              <div className="work-grid online-grid">
                {onlineItems.map((work) => (
                  <OnlineCard key={`${work.id}-${work.code}`} work={work} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
