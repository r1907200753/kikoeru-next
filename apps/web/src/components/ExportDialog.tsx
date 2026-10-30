import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  cancelExportJob,
  createExportJob,
  getExportJob,
  getSettings,
  listExportJobs,
  pauseExportJob,
  resumeExportJob,
  retryExportJob,
  type ExportJob,
  type ExportJobStatus,
  type ExportPhase,
  type ExportTrack,
  type OnlineFileType,
  type OnlineTrack,
  type OnlineTrackNode,
  type OnlineWork,
} from '../api';
import { formatBytes, formatTime } from '../format';
import {
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  DownloadIcon,
  FileIcon,
  FolderIcon,
  ImageIcon,
  MusicIcon,
  SubtitleIcon,
  VideoIcon,
} from '../icons';

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

const TRACK_STATUS_LABEL: Record<ExportTrack['status'], string> = {
  pending: '等待',
  downloading: '下载中',
  done: '完成',
  failed: '失败',
};

interface LocalWorkHint {
  code: string;
  title: string;
  trackCount: number;
}

type ExportAction = 'pause' | 'resume' | 'retry' | 'cancel';

interface ExportTreeLeaf {
  hash: string;
  title: string;
  type: OnlineFileType;
  size: number;
  durationMs: number | null;
}

interface ExportTreeEntry {
  key: string;
  title: string;
  type: 'folder' | OnlineFileType;
  hash?: string;
  size: number;
  durationMs: number | null;
  children: ExportTreeEntry[];
  leaves: ExportTreeLeaf[];
}

function fileExtension(title: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(title.trim());
  return match?.[1]?.toLowerCase() ?? '';
}

function fileTypeLabel(type: 'folder' | OnlineFileType): string {
  if (type === 'audio') {
    return '音频';
  }
  if (type === 'video') {
    return '视频';
  }
  if (type === 'image') {
    return '图片';
  }
  if (type === 'text') {
    return '文本';
  }
  if (type === 'other') {
    return '其他';
  }
  return '文件夹';
}

function buildTreeEntries(nodes: OnlineTrackNode[], prefix = ''): ExportTreeEntry[] {
  return nodes.map((node, index) => {
    const key = `${prefix}/${index}:${node.title}`;
    if (node.type === 'folder') {
      const children = buildTreeEntries(node.children ?? [], key);
      const leaves = children.flatMap((child) => child.leaves);
      return {
        key,
        title: node.title,
        type: 'folder',
        size: leaves.reduce((sum, leaf) => sum + leaf.size, 0),
        durationMs: null,
        children,
        leaves,
      };
    }
    const leaf: ExportTreeLeaf = {
      hash: node.hash ?? '',
      title: node.title,
      type: node.type,
      size: node.size ?? 0,
      durationMs: node.durationMs ?? null,
    };
    return {
      key,
      title: node.title,
      type: node.type,
      hash: leaf.hash,
      size: leaf.size,
      durationMs: leaf.durationMs,
      children: [],
      leaves: leaf.hash ? [leaf] : [],
    };
  });
}

function collectLeaves(entries: ExportTreeEntry[]): ExportTreeLeaf[] {
  return entries.flatMap((entry) => entry.leaves);
}

function fallbackTree(tracks: OnlineTrack[]): OnlineTrackNode[] {
  return tracks.map((track) => ({
    type: 'audio',
    title: track.title,
    hash: track.hash,
    size: track.size,
    durationMs: track.durationMs,
  }));
}

function TreeCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={onChange}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

function FileTreeIcon({ type }: { type: 'folder' | OnlineFileType }) {
  if (type === 'folder') {
    return <FolderIcon />;
  }
  if (type === 'audio') {
    return <MusicIcon />;
  }
  if (type === 'video') {
    return <VideoIcon />;
  }
  if (type === 'image') {
    return <ImageIcon />;
  }
  if (type === 'text') {
    return <SubtitleIcon />;
  }
  return <FileIcon />;
}

function isActive(status: ExportJobStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'paused';
}

export function ExportDialog({
  open,
  work,
  tree,
  tracks,
  onClose,
  onLibraryChanged,
}: {
  open: boolean;
  work: OnlineWork;
  tree: OnlineTrackNode[];
  tracks: OnlineTrack[];
  onClose: () => void;
  onLibraryChanged: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [concurrency, setConcurrency] = useState(2);
  const [libraryPaths, setLibraryPaths] = useState<string[]>([]);
  const [targetRoot, setTargetRoot] = useState('');
  const [job, setJob] = useState<ExportJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [busyAction, setBusyAction] = useState<ExportAction | ''>('');
  const [error, setError] = useState('');
  const [localWork, setLocalWork] = useState<LocalWorkHint | null>(null);
  const onLibraryChangedRef = useRef(onLibraryChanged);
  onLibraryChangedRef.current = onLibraryChanged;

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setJob(null);
    setError('');
    setLocalWork(null);
    setStarting(false);
    setBusyAction('');
    const initialEntries = buildTreeEntries(tree.length > 0 ? tree : fallbackTree(tracks));
    setSelected(
      new Set(
        collectLeaves(initialEntries)
          .filter((leaf) => leaf.hash)
          .map((leaf) => leaf.hash),
      ),
    );
    setCollapsed(new Set());
    getSettings()
      .then((data) => {
        if (!cancelled) {
          const paths =
            data.libraryPaths.length > 0
              ? data.libraryPaths
              : data.libraryPath
                ? [data.libraryPath]
                : [];
          setLibraryPaths(paths);
          setTargetRoot(paths[0] ?? '');
          setConcurrency(data.exportConcurrency || 2);
        }
      })
      .catch(() => undefined);
    listExportJobs({ limit: 80 })
      .then(({ items }) => {
        if (cancelled) {
          return;
        }
        const active = items.find((item) => item.code === work.code && isActive(item.status));
        if (active) {
          setJob(active);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // 文件树在弹窗打开期间不会变化；避免详情刷新重置正在展示的任务。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, work.code]);

  useEffect(() => {
    if (!open || !job || (job.status !== 'queued' && job.status !== 'running')) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      getExportJob(job.id)
        .then((next) => {
          if (cancelled) {
            return;
          }
          setJob(next);
          if (next.status === 'done') {
            onLibraryChangedRef.current();
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
          }
        });
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, job]);

  if (!open) {
    return null;
  }

  const entries = buildTreeEntries(tree.length > 0 ? tree : fallbackTree(tracks));
  const leaves = collectLeaves(entries).filter((leaf) => leaf.hash);
  const selectedLeaves = leaves.filter((leaf) => selected.has(leaf.hash));
  const allSelected = leaves.length > 0 && selectedLeaves.length === leaves.length;
  const selectedBytes = selectedLeaves.reduce((sum, leaf) => sum + leaf.size, 0);
  const totalBytes = leaves.reduce((sum, leaf) => sum + leaf.size, 0);
  const audioCount = leaves.filter((leaf) => leaf.type === 'audio').length;
  const typeChips = [...leaves.reduce((counts, leaf) => {
    const label = fileExtension(leaf.title) || fileTypeLabel(leaf.type);
    counts.set(label, (counts.get(label) ?? 0) + 1);
    return counts;
  }, new Map<string, number>())]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10);
  const started = job !== null;

  const toggleLeaf = (hash: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(hash)) {
        next.delete(hash);
      } else {
        next.add(hash);
      }
      return next;
    });
  };

  const toggleFolder = (entry: ExportTreeEntry) => {
    const hashes = entry.leaves.map((leaf) => leaf.hash).filter(Boolean);
    if (hashes.length === 0) {
      return;
    }
    const selectedCount = hashes.filter((hash) => selected.has(hash)).length;
    setSelected((previous) => {
      const next = new Set(previous);
      if (selectedCount === hashes.length) {
        hashes.forEach((hash) => next.delete(hash));
      } else {
        hashes.forEach((hash) => next.add(hash));
      }
      return next;
    });
  };

  const toggleCollapsed = (key: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(leaves.map((leaf) => leaf.hash)));
  };

  const folderSelection = (entry: ExportTreeEntry) => {
    const hashes = entry.leaves.map((leaf) => leaf.hash).filter(Boolean);
    const selectedCount = hashes.filter((hash) => selected.has(hash)).length;
    return {
      selectedCount,
      total: hashes.length,
      checked: hashes.length > 0 && selectedCount === hashes.length,
      indeterminate: selectedCount > 0 && selectedCount < hashes.length,
    };
  };

  const renderEntry = (entry: ExportTreeEntry, depth: number) => {
    if (entry.type === 'folder') {
      const state = folderSelection(entry);
      const expanded = !collapsed.has(entry.key);
      return (
        <li key={entry.key} className="export-tree-item">
          <div
            className="export-tree-row export-tree-row--folder"
            style={{ paddingLeft: `${10 + depth * 18}px` }}
          >
            <button
              type="button"
              className={`export-tree-toggle${expanded ? '' : ' is-collapsed'}`}
              onClick={() => toggleCollapsed(entry.key)}
              aria-label={expanded ? `收起 ${entry.title}` : `展开 ${entry.title}`}
            >
              <ChevronDownIcon />
            </button>
            <TreeCheckbox
              checked={state.checked}
              indeterminate={state.indeterminate}
              disabled={state.total === 0}
              label={`选择文件夹 ${entry.title}`}
              onChange={() => toggleFolder(entry)}
            />
            <span className="export-tree-icon export-tree-icon--folder">
              <FolderIcon />
            </span>
            <span className="export-tree-name" title={entry.title}>
              {entry.title}
            </span>
            <span className="export-tree-meta">
              {state.selectedCount}/{state.total} 项 · {formatBytes(entry.size)}
            </span>
          </div>
          {expanded && entry.children.length > 0 ? (
            <ul className="export-tree-children">
              {entry.children.map((child) => renderEntry(child, depth + 1))}
            </ul>
          ) : null}
        </li>
      );
    }

    const checked = entry.hash ? selected.has(entry.hash) : false;
    const extension = fileExtension(entry.title);
    const meta = [
      entry.type === 'audio' && entry.durationMs ? formatTime(entry.durationMs) : '',
      entry.size ? formatBytes(entry.size) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <li key={entry.key} className="export-tree-item">
        <label
          className={`export-tree-row export-tree-row--file${checked ? ' is-checked' : ''}`}
          style={{ paddingLeft: `${10 + depth * 18}px` }}
        >
          <span className="export-tree-toggle export-tree-toggle--spacer" />
          <TreeCheckbox
            checked={checked}
            disabled={!entry.hash}
            label={`选择文件 ${entry.title}`}
            onChange={() => {
              if (entry.hash) {
                toggleLeaf(entry.hash);
              }
            }}
          />
          <span className={`export-tree-icon export-tree-icon--${entry.type}`}>
            <FileTreeIcon type={entry.type} />
          </span>
          <span className="export-tree-name" title={entry.title}>
            {entry.title}
          </span>
          <span className="export-tree-type">
            {extension || fileTypeLabel(entry.type)}
          </span>
          <span className="export-tree-meta">{meta}</span>
        </label>
      </li>
    );
  };

  const start = async () => {
    if (starting || selectedLeaves.length === 0 || !targetRoot) {
      return;
    }
    setStarting(true);
    setError('');
    setLocalWork(null);
    try {
      const { job: created } = await createExportJob({
        code: work.code,
        hashes: selectedLeaves.map((leaf) => leaf.hash),
        concurrency,
        rootPath: targetRoot,
      });
      if (created) {
        setJob(created);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const data = (err.data ?? {}) as { localWork?: LocalWorkHint; jobId?: number };
        if (data.localWork) {
          setLocalWork(data.localWork);
        }
        if (typeof data.jobId === 'number') {
          getExportJob(data.jobId)
            .then(setJob)
            .catch(() => undefined);
        }
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const act = async (action: ExportAction) => {
    if (!job || busyAction) {
      return;
    }
    setBusyAction(action);
    setError('');
    try {
      const next =
        action === 'pause'
          ? await pauseExportJob(job.id)
          : action === 'resume'
            ? await resumeExportJob(job.id)
            : action === 'retry'
              ? await retryExportJob(job.id)
              : await cancelExportJob(job.id);
      setJob(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction('');
    }
  };

  const progressPct = job
    ? Math.round(Math.max(0, Math.min(1, job.progress)) * 100)
    : 0;
  const downloadedBytes = job
    ? job.tracks.reduce((sum, track) => sum + track.bytes, 0)
    : 0;
  const totalTrackBytes = job
    ? job.tracks.reduce((sum, track) => sum + track.size, 0)
    : 0;

  return (
    <div
      className="modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="modal-card export-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
      >
        <header className="modal-head">
          <div>
            <p className="eyebrow">EXPORT TO LIBRARY</p>
            <h2 id="export-title">导出到本地库</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭导出">
            <CloseIcon />
          </button>
        </header>

        <div className="export-work">
          <span className="chip chip--accent">{work.code}</span>
          <div className="export-work-text">
            <strong>{work.title || work.code}</strong>
            <span>
              {work.circle || '未知社团'} · {leaves.length} 个文件 · {formatBytes(totalBytes)}
            </span>
          </div>
        </div>

        {!started ? (
          <>
            <div className="export-root">
              <FolderIcon />
              <div>
                <span>目标库根</span>
                {libraryPaths.length > 1 ? (
                  <select
                    value={targetRoot}
                    onChange={(event) => setTargetRoot(event.target.value)}
                    disabled={starting}
                    aria-label="导出目标库根"
                  >
                    {libraryPaths.map((rootPath) => (
                      <option key={rootPath} value={rootPath}>
                        {rootPath}
                      </option>
                    ))}
                  </select>
                ) : (
                  <strong>
                    {targetRoot || '尚未配置库根，请先在设置中选择目录'}
                  </strong>
                )}
              </div>
            </div>

            <div className="export-select-head">
              <div>
                <strong>选择文件</strong>
                <span className="export-select-hint">
                  默认全选全部文件；可展开文件夹只导出需要的部分
                </span>
              </div>
              <label className="export-check-all">
                <TreeCheckbox
                  checked={allSelected}
                  indeterminate={selectedLeaves.length > 0 && !allSelected}
                  label="全选文件"
                  onChange={toggleAll}
                />
                <span>全选</span>
              </label>
            </div>

            {typeChips.length > 0 ? (
              <div className="export-type-chips" aria-label="文件类型概览">
                {typeChips.map(([label, count]) => (
                  <span className="export-type-chip" key={label}>
                    {label}
                    <em>{count}</em>
                  </span>
                ))}
              </div>
            ) : null}

            {leaves.length === 0 ? (
              <div className="notice notice--error notice--inline" role="alert">
                <span>没有可导出的文件，可能需要登录或该作品没有文件。</span>
              </div>
            ) : (
              <ul className="export-file-tree">
                {entries.map((entry) => renderEntry(entry, 0))}
              </ul>
            )}

            <div className="export-options">
              <label className="export-concurrency">
                <span>并发下载</span>
                <select
                  value={concurrency}
                  onChange={(event) => setConcurrency(Number(event.target.value))}
                  disabled={starting}
                >
                  <option value={1}>1 个</option>
                  <option value={2}>2 个</option>
                  <option value={3}>3 个</option>
                </select>
              </label>
              <span className="export-summary">
                已选 {selectedLeaves.length} 个文件
                {selectedLeaves.length > 0 && audioCount > 0
                  ? `（含 ${selectedLeaves.filter((leaf) => leaf.type === 'audio').length} 条音轨）`
                  : ''}
                {selectedBytes > 0 ? ` · ${formatBytes(selectedBytes)}` : ''}
              </span>
            </div>

            {localWork ? (
              <div className="notice notice--inline" role="status">
                <CheckIcon />
                <span>
                  本地库已有 {localWork.title || localWork.code}（{localWork.trackCount} 条音轨）。
                </span>
                <a
                  className="notice-link"
                  href={`#/work/${encodeURIComponent(localWork.code)}`}
                  onClick={onClose}
                >
                  打开本地版本
                </a>
              </div>
            ) : null}

            {error ? (
              <div className="notice notice--error notice--inline" role="alert">
                <span>{error}</span>
              </div>
            ) : null}

            <div className="export-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void start()}
                disabled={starting || selectedLeaves.length === 0 || !targetRoot}
              >
                <DownloadIcon />
                {starting ? '正在创建任务…' : '开始导出'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                取消
              </button>
            </div>
            <p className="settings-hint">
              文件会先下载到库根的 .kikoeru-tmp，并保留在线目录结构；全部完成并写入元数据后才会原子移动到曲库目录；
              重复RJ号默认跳过。关闭弹窗不会中断任务，可在「导出」页查看进度。
            </p>
          </>
        ) : (
          <>
            <div className="export-job-head">
              <span className={`export-status export-status--${job.status}`}>
                {STATUS_LABEL[job.status]}
              </span>
              <span className="export-phase">
                {job.status === 'queued' ? '等待前面的任务' : PHASE_LABEL[job.phase]}
              </span>
              <strong className="export-job-percent">{progressPct}%</strong>
            </div>
            <div className="export-progress" aria-hidden="true">
              <span style={{ width: `${progressPct}%` }} />
            </div>
            <p className="export-job-summary">
              {job.trackCompleted}/{job.trackTotal || '—'} 项
              {totalTrackBytes > 0
                ? ` · ${formatBytes(downloadedBytes)} / ${formatBytes(totalTrackBytes)}`
                : ''}
            </p>

            {job.tracks.length > 0 ? (
              <ul className="export-track-list export-track-list--live">
                {job.tracks.map((track) => {
                  const pct =
                    track.size > 0
                      ? Math.min(100, Math.round((track.bytes / track.size) * 100))
                      : 0;
                  return (
                    <li key={track.hash} className={`export-live-track is-${track.status}`}>
                      <span className="export-live-title" title={track.title}>
                        {track.groupTitle ? <em>{track.groupTitle} · </em> : null}
                        {track.title}
                      </span>
                      <span className="export-live-bar">
                        <i style={{ width: `${track.status === 'done' ? 100 : pct}%` }} />
                      </span>
                      <span className="export-live-state">
                        {TRACK_STATUS_LABEL[track.status]}
                        {track.status === 'downloading' && pct > 0 ? ` ${pct}%` : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {job.status === 'queued' ? (
              <p className="settings-hint">同一时间只运行一个导出任务，前面的任务完成后会自动开始。</p>
            ) : null}

            {job.error ? (
              <div className="notice notice--error notice--inline" role="alert">
                <span>{job.error}</span>
              </div>
            ) : null}

            {error ? (
              <div className="notice notice--error notice--inline" role="alert">
                <span>{error}</span>
              </div>
            ) : null}

            {job.result ? (
              <div className="export-result">
                <CheckIcon />
                <div>
                  <strong>已写入本地曲库</strong>
                  <span className="export-result-path">{job.result.relativePath}</span>
                  <span>
                    共 {job.result.trackCount} 个文件
                    {job.result.audioCount ? ` · ${job.result.audioCount} 条音轨` : ''} ·{' '}
                    {formatBytes(job.result.bytes)}
                    {job.result.cover === 'failed' ? ' · 封面生成失败' : ''}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="export-actions">
              {job.status === 'queued' || job.status === 'running' ? (
                <>
                  <button
                    type="button"
                    className="btn btn-tonal"
                    onClick={() => void act('pause')}
                    disabled={Boolean(busyAction)}
                  >
                    {busyAction === 'pause' ? '暂停中…' : '暂停'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void act('cancel')}
                    disabled={Boolean(busyAction)}
                  >
                    {busyAction === 'cancel' ? '取消中…' : '取消任务'}
                  </button>
                </>
              ) : null}
              {job.status === 'paused' ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void act('resume')}
                    disabled={Boolean(busyAction)}
                  >
                    {busyAction === 'resume' ? '继续中…' : '继续导出'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void act('cancel')}
                    disabled={Boolean(busyAction)}
                  >
                    取消任务
                  </button>
                </>
              ) : null}
              {job.status === 'failed' || job.status === 'cancelled' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void act('retry')}
                  disabled={Boolean(busyAction)}
                >
                  {busyAction === 'retry' ? '重试中…' : '重试导出'}
                </button>
              ) : null}
              {job.status === 'done' ? (
                <>
                  <a
                    className="btn btn-primary"
                    href={`#/work/${encodeURIComponent(job.code)}`}
                    onClick={onClose}
                  >
                    <FolderIcon /> 打开本地作品
                  </a>
                  <a className="btn btn-ghost" href="#/exports" onClick={onClose}>
                    查看导出队列
                  </a>
                </>
              ) : (
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  后台运行
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
