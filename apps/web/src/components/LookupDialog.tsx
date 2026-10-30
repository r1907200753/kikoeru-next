import { useEffect, useRef, useState } from 'react';
import { ApiError, getOnlineWork, getWork } from '../api';
import { CloseIcon, HashIcon, SearchIcon } from '../icons';

export function LookupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setValue('');
    setError('');
    setBusy(false);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const submit = async () => {
    const code = value.trim().toUpperCase();
    if (!code || busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await getWork(code);
      window.location.hash = `#/work/${encodeURIComponent(code)}`;
      onClose();
      return;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
        return;
      }
    }
    try {
      const online = await getOnlineWork(code);
      window.location.hash = `#/online/${encodeURIComponent(online.work.code || code)}`;
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-card lookup-card" role="dialog" aria-modal="true" aria-labelledby="lookup-title">
        <header className="modal-head">
          <h2 id="lookup-title">
            <HashIcon /> RJ号直达
          </h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
            <CloseIcon />
          </button>
        </header>
        <p className="settings-hint">本地优先；找不到时自动到 asmr.one 查询。</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="settings-field">
            <span>作品RJ号</span>
            <input
              ref={inputRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="RJ01426915"
              className="mono"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          {error ? (
            <div className="notice notice--error notice--inline" role="alert">
              <span>{error}</span>
            </div>
          ) : null}
          <div className="lookup-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
              <SearchIcon className={busy ? 'spin' : ''} />
              {busy ? '查找中…' : '打开作品'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
