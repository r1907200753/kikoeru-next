import { useEffect, useRef, useState } from 'react';
import {
  cancelExportJob,
  deleteExportJob,
  listExportJobs,
  pauseExportJob,
  resumeExportJob,
  retryExportJob,
  type ExportJob,
  type ExportJobStatus,
  type ExportPhase,
} from '../api';
import { formatBytes, formatRelative } from '../format';
import { DownloadIcon, FolderIcon, GlobeIcon } from '../icons';
import { WorkCover } from './WorkCard';

const STATUS_LABEL: Record<ExportJobStatus, string> = {
  queued: '排队中',
  running: '下载中',
  paused: '已暂停',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const PHASE_LABEL: Record<ExportPhase, string> = {
  download: '下载文件',
  finalize: '整理文件',
  scan: '写入曲库',
  done: '完成',
};

type ExportAction = 'pause' | 'resume' | 'retry' | 'cancel';

function isActive(status: ExportJobStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'paused';
}

export function ExportPage({
  reloadKey,
  onLibraryChanged,
}: {
  reloadKey: number;
  onLibraryChanged: () => void;
}) {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');
  const [pollTick, setPollTick] = useState(0);
  const previousActiveRef = useRef<Set<number>>(new Set());
  const notifiedRef = useRef<Set<number>>(new Set());
  const onLibraryChangedRef = useRef(onLibraryChanged);
  onLibraryChangedRef.current = onLibraryChanged;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listExportJobs({ limit: 60 })
      .then(({ items }) => {
        if (cancelled) {
          return;
        }
        setJobs(items);
        setError('');
        const activeIds = new Set(items.filter((job) => isActive(job.status)).map((job) => job.id));
        let finished = false;
        for (const id of previousActiveRef.current) {
          if (activeIds.has(id)) {
            continue;
          }
          const job = items.find((item) => item.id === id);
          if (job?.status === 'done' && !notifiedRef.current.has(id)) {
            notifiedRef.current.add(id);
            finished = true;
          }
        }
        previousActiveRef.current = activeIds;
        if (finished) {
          onLibraryChangedRef.current();
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
  }, [reloadKey, pollTick]);

  const hasActive = jobs.some((job) => job.status === 'queued' || job.status === 'running');
  useEffect(() => {
    if (!hasActive) {
      return;
    }
    const timer = window.setTimeout(() => setPollTick((value) => value + 1), 1500);
    return () => window.clearTimeout(timer);
  }, [hasActive, jobs]);

  const act = async (job: ExportJob, action: ExportAction) => {
    if (busyId !== null) {
      return;
    }
    setBusyId(job.id);
    setActionError('');
    try {
      const next =
        action === 'pause'
          ? await pauseExportJob(job.id)
          : action === 'resume'
            ? await resumeExportJob(job.id)
            : action === 'retry'
              ? await retryExportJob(job.id)
              : await cancelExportJob(job.id);
      setJobs((previous) => previous.map((item) => (item.id === next.id ? next : item)));
      if (next.status === 'done') {
        onLibraryChangedRef.current();
      }
      setPollTick((value) => value + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const activeCount = jobs.filter((job) => isActive(job.status)).length;
  const doneCount = jobs.filter((job) => job.status === 'done').length;

  const remove = async (job: ExportJob) => {
    if (busyId !== null) {
      return;
    }
    if (!window.confirm(`删除导出任务 ${job.code}？已下载到本地库的文件不会被删除。`)) {
      return;
    }
    setBusyId(job.id);
    setActionError('');
    try {
      await deleteExportJob(job.id);
      setJobs((previous) => previous.filter((item) => item.id !== job.id));
      setPollTick((value) => value + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page export-page">
      <div className="page-intro">
        <div>
          <p className="eyebrow">EXPORT QUEUE</p>
          <h1>导出队列</h1>
          <p className="page-sub">
            从 asmr.one 下载音轨到本地曲库。可以暂停、续传与重试，任务完成后自动扫描入库。
          </p>
        </div>
        <span className="page-count">
          进行中 {activeCount} · 已完成 {doneCount}
        </span>
      </div>

      {error ? (
        <div className="notice notice--error notice--inline" role="alert">
          <span>{error}</span>
        </div>
      ) : null}
      {actionError ? (
        <div className="notice notice--error notice--inline" role="alert">
          <span>{actionError}</span>
        </div>
      ) : null}

      {loading && jobs.length === 0 ? (
        <div className="export-list">
          {[0, 1].map((index) => (
            <div className="export-job-card export-job-card--skeleton" key={index}>
              <div className="skeleton-line skeleton-line--short" />
              <div className="skeleton-line skeleton-line--title" />
              <div className="skeleton-line" />
            </div>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="empty-card">
          <div className="empty-icon">
            <DownloadIcon />
          </div>
          <h2>还没有导出任务</h2>
          <p>
            打开 asmr.one 的作品详情，选择音轨后就能导出到本地库。任务会先在临时目录下载，
            完成前不会出现在曲库里。
          </p>
          <div className="empty-actions">
            <a className="btn btn-primary" href="#/online">
              <GlobeIcon /> 去在线曲库
            </a>
            <a className="btn btn-ghost" href="#/">
              回到主页
            </a>
          </div>
        </div>
      ) : (
        <div className="export-list">
          {jobs.map((job) => {
            const progressPct = Math.round(
              Math.max(0, Math.min(1, job.progress)) * 100,
            );
            const canPause = job.status === 'queued' || job.status === 'running';
            const canResume = job.status === 'paused';
            const canCancel = canPause || canResume;
            const canRetry = job.status === 'failed' || job.status === 'cancelled';
            const downloadedBytes = job.tracks.reduce((sum, track) => sum + track.bytes, 0);
            const totalBytes = job.tracks.reduce((sum, track) => sum + track.size, 0);
            const path = job.result?.relativePath || job.targetRelativePath;
            return (
              <article className="export-job-card" key={job.id}>
                <div className="export-job-main">
                  <WorkCover code={job.code} size="mini" src={job.coverUrl} />
                  <div className="export-job-body">
                    <div className="export-job-top">
                      <div className="export-job-ident">
                        <span className="chip chip--accent">{job.code}</span>
                        <strong title={job.title}>{job.title || job.code}</strong>
                      </div>
                      <span className={`export-status export-status--${job.status}`}>
                        {STATUS_LABEL[job.status]}
                      </span>
                    </div>

                    <div className="export-progress" aria-hidden="true">
                      <span style={{ width: `${progressPct}%` }} />
                    </div>

                    <div className="export-job-meta">
                      <span>
                        {job.trackCompleted}/{job.trackTotal || '—'} 项
                        {job.status === 'queued' ? ' · 等待前面的任务' : ` · ${PHASE_LABEL[job.phase]}`}
                      </span>
                      {totalBytes > 0 ? (
                        <span>
                          {formatBytes(downloadedBytes)} / {formatBytes(totalBytes)}
                        </span>
                      ) : null}
                      <span>{progressPct}%</span>
                      <span>创建于 {formatRelative(job.createdAt)}</span>
                    </div>

                    {path ? <p className="export-job-path">{path}</p> : null}
                    {job.error ? (
                      <p
                        className={`export-job-error${
                          job.status === 'paused' ? ' is-muted' : ''
                        }`}
                      >
                        {job.error}
                      </p>
                    ) : null}

                    <div className="export-job-actions">
                      {canPause ? (
                        <button
                          type="button"
                          className="btn btn-tonal btn-compact"
                          onClick={() => void act(job, 'pause')}
                          disabled={busyId !== null}
                        >
                          {busyId === job.id ? '处理中…' : '暂停'}
                        </button>
                      ) : null}
                      {canResume ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-compact"
                          onClick={() => void act(job, 'resume')}
                          disabled={busyId !== null}
                        >
                          {busyId === job.id ? '处理中…' : '继续'}
                        </button>
                      ) : null}
                      {canRetry ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-compact"
                          onClick={() => void act(job, 'retry')}
                          disabled={busyId !== null}
                        >
                          {busyId === job.id ? '处理中…' : '重试'}
                        </button>
                      ) : null}
                      {canCancel ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-compact"
                          onClick={() => void act(job, 'cancel')}
                          disabled={busyId !== null}
                        >
                          取消
                        </button>
                      ) : null}
                      {job.status === 'done' ? (
                        <a
                          className="btn btn-primary btn-compact"
                          href={`#/work/${encodeURIComponent(job.code)}`}
                        >
                          <FolderIcon /> 打开本地作品
                        </a>
                      ) : null}
                      <a className="btn btn-ghost btn-compact" href={`#/online/${encodeURIComponent(job.code)}`}>
                        在线详情
                      </a>
                      {!isActive(job.status) ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-compact export-delete"
                          onClick={() => void remove(job)}
                          disabled={busyId !== null}
                        >
                          删除
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
