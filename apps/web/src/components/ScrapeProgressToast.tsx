import { useEffect, useRef, useState } from 'react';
import {
  listJobs,
  type Job,
  type ScrapeJobResult,
} from '../api';
import { CheckIcon, CloseIcon, ScanIcon } from '../icons';

interface ScrapeJobPayload {
  total?: number;
  force?: boolean;
  current?: {
    code: string;
    title: string;
    status: string;
    cover: 'ok' | 'failed' | 'none';
    index: number;
    total: number;
  };
}

const COVER_LABEL: Record<'ok' | 'failed' | 'none', string> = {
  ok: '封面已缓存',
  failed: '封面失败',
  none: '无封面',
};

export function ScrapeProgressToast({ onOpenLogs }: { onOpenLogs: () => void }) {
  const [job, setJob] = useState<Job<ScrapeJobResult> | null>(null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const previousActiveRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let hideTimer: number | null = null;
    const tick = async () => {
      try {
        const { items } = await listJobs<ScrapeJobResult>({ type: 'scrape', limit: 1 });
        if (cancelled) {
          return;
        }
        const latest = items[0] ?? null;
        setJob(latest);
        const active = latest?.status === 'queued' || latest?.status === 'running';
        if (latest && active) {
          previousActiveRef.current = true;
          if (latest.id !== dismissed) {
            setVisible(true);
          }
          return;
        }
        if (latest && previousActiveRef.current) {
          previousActiveRef.current = false;
          if (hideTimer !== null) {
            window.clearTimeout(hideTimer);
          }
          if (latest.id !== dismissed) {
            setVisible(true);
            hideTimer = window.setTimeout(() => setVisible(false), 6000);
          }
        }
      } catch {
        // 后台轮询失败不打扰用户。
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
      }
    };
  }, [dismissed]);

  if (!visible || !job) {
    return null;
  }

  const payload = (job.payload ?? {}) as ScrapeJobPayload;
  const total = payload.total ?? job.result?.total ?? 0;
  const done = Math.min(total, payload.current?.index ?? Math.round(job.progress * total));
  const percent = Math.round(Math.max(0, Math.min(1, job.progress)) * 100);
  const okCount =
    job.result?.results.filter(
      (result) => result.status === 'ok' || result.status === 'partial',
    ).length ?? 0;
  const active = job.status === 'queued' || job.status === 'running';
  const failing = job.status === 'failed';
  const title = active ? '正在刮削' : failing ? '刮削失败' : '刮削完成';
  const current = payload.current;

  return (
    <div
      className={`scrape-toast${failing ? ' is-error' : job.status === 'done' ? ' is-done' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="scrape-toast-head">
        <strong>
          {job.status === 'done' ? <CheckIcon /> : <ScanIcon className={active ? 'spin' : ''} />}
          {title}
        </strong>
        <button
          type="button"
          className="scrape-toast-close"
          onClick={() => {
            setDismissed(job.id);
            setVisible(false);
          }}
          aria-label="关闭刮削进度"
        >
          <CloseIcon />
        </button>
      </div>
      <div className="scrape-toast-progress" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="scrape-toast-meta">
        <span>
          {active ? `${done} / ${total || '—'} 部` : `${total} 部已处理`}
        </span>
        <span>{percent}%</span>
      </div>
      {active && current ? (
        <p className="scrape-toast-current">
          <span className="mono">{current.code}</span>
          <span>{current.title || '—'}</span>
          <em className={`scrape-toast-cover is-${current.cover}`}>
            {COVER_LABEL[current.cover]}
          </em>
        </p>
      ) : null}
      {!active && job.status === 'done' ? (
        <p className="scrape-toast-current">
          成功 {okCount} 部
          {job.result?.failed ? ` · 失败 ${job.result.failed} 部` : ''}
          {job.result?.cached ? ` · 缓存跳过 ${job.result.cached} 部` : ''}
        </p>
      ) : null}
      {failing && job.lastError ? (
        <p className="scrape-toast-current">{job.lastError}</p>
      ) : null}
      <button type="button" className="scrape-toast-link" onClick={onOpenLogs}>
        查看详细日志
      </button>
    </div>
  );
}
