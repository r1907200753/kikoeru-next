import { useEffect, useRef, useState } from 'react';
import {
  OPERATION_LOG_STREAM_URL,
  clearOperationLogs,
  listOperationLogs,
  type OperationLogCategory,
  type OperationLogEntry,
} from '../api';
import { CheckIcon, CloseIcon, CopyIcon, PauseIcon, PlayIcon, TrashIcon } from '../icons';
import {
  LOG_LEVEL_LABELS,
  formatLogTime,
  logCategoryLabel,
  matchesLogFilter,
  mergeLogEntries,
  serializeLogEntries,
  type LogFilter,
} from '../logs';

const MAX_VISIBLE_LOGS = 500;

const CATEGORY_OPTIONS: Array<{ value: 'all' | OperationLogCategory; label: string }> = [
  { value: 'all', label: '全部类别' },
  { value: 'system', label: '系统' },
  { value: 'desktop', label: '桌面端' },
  { value: 'scan', label: '扫描' },
  { value: 'scrape', label: '刮削' },
  { value: 'export', label: '导出' },
  { value: 'auth', label: '访问' },
  { value: 'settings', label: '设置' },
  { value: 'library', label: '曲库' },
  { value: 'online', label: '在线' },
  { value: 'api', label: '请求' },
];

function detailText(detail: unknown): string {
  if (detail === null || detail === undefined) {
    return '';
  }
  if (typeof detail === 'string') {
    return detail;
  }
  if (typeof detail === 'object' && Object.keys(detail as Record<string, unknown>).length === 0) {
    return '';
  }
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
}

function entryKey(entry: OperationLogEntry): string {
  return entry.id > 0
    ? String(entry.id)
    : `${entry.createdAt}:${entry.action}:${entry.message}`;
}

export function LogWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [entries, setEntries] = useState<OperationLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [category, setCategory] = useState<'all' | OperationLogCategory>('all');
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [copied, setCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(false);
  const bufferRef = useRef<OperationLogEntry[]>([]);
  const copiedTimerRef = useRef<number | null>(null);

  const filter: LogFilter = { category, onlyProblems };
  const filtered = entries.filter((entry) => matchesLogFilter(entry, filter));

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let disposed = false;
    setLoading(true);
    setError('');

    const mergeRecent = (items: OperationLogEntry[]) => {
      if (disposed) {
        return;
      }
      setEntries((previous) => mergeLogEntries(previous, items, MAX_VISIBLE_LOGS));
    };

    const loadRecent = async () => {
      try {
        const page = await listOperationLogs({ limit: 200 });
        mergeRecent([...page.items].reverse());
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void loadRecent();
    const source = new EventSource(OPERATION_LOG_STREAM_URL);
    source.onopen = () => {
      if (disposed) {
        return;
      }
      setLive(true);
      setError('');
      void listOperationLogs({ limit: 200 })
        .then((page) => mergeRecent([...page.items].reverse()))
        .catch(() => undefined);
    };
    source.onerror = () => {
      if (!disposed) {
        setLive(false);
      }
    };
    source.onmessage = (event) => {
      let entry: OperationLogEntry;
      try {
        entry = JSON.parse(event.data) as OperationLogEntry;
      } catch {
        return;
      }
      if (!entry || typeof entry.message !== 'string') {
        return;
      }
      if (pausedRef.current) {
        bufferRef.current = mergeLogEntries(bufferRef.current, [entry], MAX_VISIBLE_LOGS);
        setPendingCount(bufferRef.current.length);
        return;
      }
      setEntries((previous) => mergeLogEntries(previous, [entry], MAX_VISIBLE_LOGS));
    };
    return () => {
      disposed = true;
      source.close();
    };
  }, [open]);

  useEffect(() => {
    if (!open || paused || !autoScroll) {
      return;
    }
    const list = listRef.current;
    if (list) {
      const frame = window.requestAnimationFrame(() => {
        list.scrollTop = list.scrollHeight;
      });
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [entries, open, paused, autoScroll, category, onlyProblems]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  if (!open) {
    return null;
  }

  const togglePause = () => {
    if (paused) {
      const buffered = bufferRef.current;
      bufferRef.current = [];
      pausedRef.current = false;
      setPaused(false);
      setPendingCount(0);
      if (buffered.length > 0) {
        setEntries((previous) => mergeLogEntries(previous, buffered, MAX_VISIBLE_LOGS));
      }
      return;
    }
    pausedRef.current = true;
    setPaused(true);
  };

  const handleScroll = () => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 36;
    setAutoScroll(atBottom);
  };

  const jumpToBottom = () => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
    setAutoScroll(true);
  };

  const copyLogs = async () => {
    const text = serializeLogEntries(filtered);
    if (!text) {
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('复制失败，请手动选择日志文本');
    }
  };

  const clearLogs = async () => {
    if (!window.confirm('清空全部运行日志？此操作不可撤销。')) {
      return;
    }
    setError('');
    try {
      const result = await clearOperationLogs();
      bufferRef.current = [];
      setPendingCount(0);
      setEntries(result.entry ? [result.entry] : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="log-window" role="dialog" aria-label="运行日志">
      <header className="log-head">
        <div>
          <p className="log-kicker">Kikoeru Next · 运行日志</p>
          <h2>
            日志窗口
            <span className={`log-live${live ? ' is-live' : ''}`}>
              {live ? '实时' : '重连中'}
            </span>
          </h2>
        </div>
        <button type="button" className="log-close" onClick={onClose} aria-label="关闭日志窗口">
          <CloseIcon />
        </button>
      </header>

      <div className="log-toolbar">
        <select
          className="log-select"
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as 'all' | OperationLogCategory)
          }
          aria-label="日志类别"
        >
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`log-chip${onlyProblems ? ' is-active' : ''}`}
          onClick={() => setOnlyProblems((value) => !value)}
          aria-pressed={onlyProblems}
        >
          只看问题
        </button>
        <button
          type="button"
          className={`log-chip${paused ? ' is-active' : ''}`}
          onClick={togglePause}
          aria-pressed={paused}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
          {paused ? `继续${pendingCount > 0 ? ` · ${pendingCount}` : ''}` : '暂停'}
        </button>
        <button type="button" className="log-chip" onClick={() => void copyLogs()}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? '已复制' : '复制'}
        </button>
        <button type="button" className="log-chip log-chip--danger" onClick={() => void clearLogs()}>
          <TrashIcon />
          清空
        </button>
      </div>

      {error ? (
        <div className="notice notice--error log-error" role="alert">
          <span>{error}</span>
        </div>
      ) : null}

      <div className="log-list" ref={listRef} onScroll={handleScroll}>
        {loading && entries.length === 0 ? (
          <p className="log-empty">正在读取日志…</p>
        ) : filtered.length === 0 ? (
          <p className="log-empty">
            {entries.length === 0 ? '还没有日志。操作应用后，这里会实时记录。' : '当前筛选没有匹配的日志。'}
          </p>
        ) : (
          filtered.map((entry) => {
            const detail = detailText(entry.detail);
            return (
              <article
                key={entryKey(entry)}
                className={`log-row log-row--${entry.level}`}
              >
                <div className="log-row-head">
                  <time className="log-time" dateTime={entry.createdAt}>
                    {formatLogTime(entry.createdAt)}
                  </time>
                  <span className={`log-level log-level--${entry.level}`}>
                    {LOG_LEVEL_LABELS[entry.level]}
                  </span>
                  <span className="log-category">{logCategoryLabel(entry.category)}</span>
                  {entry.clientIp && entry.clientIp !== '127.0.0.1' && entry.clientIp !== '::1' ? (
                    <span className="log-ip">{entry.clientIp}</span>
                  ) : null}
                </div>
                <p className="log-message">{entry.message}</p>
                {detail ? (
                  <details className="log-detail">
                    <summary>详情</summary>
                    <pre>{detail}</pre>
                  </details>
                ) : null}
              </article>
            );
          })
        )}
      </div>

      <footer className="log-foot">
        <span>
          {filtered.length === entries.length
            ? `${entries.length} 条`
            : `${filtered.length}/${entries.length} 条`}
          {pendingCount > 0 ? ` · ${pendingCount} 条待显示` : ''}
        </span>
        <span>显示最近 {MAX_VISIBLE_LOGS} 条 · 服务端保留 2000 条</span>
        {!autoScroll && !paused ? (
          <button type="button" className="log-jump" onClick={jumpToBottom}>
            回到底部
          </button>
        ) : null}
      </footer>
    </section>
  );
}
