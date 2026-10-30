import type { DatabaseSync } from 'node:sqlite';
import type { AsmrOneFileType, AsmrOneWork } from './providers/asmrone.js';

type Row = Record<string, unknown>;

function text(row: Row, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function num(row: Row, key: string): number {
  const value = row[key];
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type ExportJobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled';

export const ACTIVE_EXPORT_STATUSES: ExportJobStatus[] = ['queued', 'running', 'paused'];

export interface ExportJobPayload {
  work: AsmrOneWork;
  hashes: string[] | null;
  concurrency: number;
}

export interface ExportTrackState {
  hash: string;
  order: number;
  index: number;
  title: string;
  groupTitle: string;
  disc: number;
  type?: AsmrOneFileType;
  relativePath?: string;
  size: number;
  durationMs: number | null;
  bytes: number;
  ext: string;
  partFile: string;
  file: string;
  status: 'pending' | 'downloading' | 'done' | 'failed';
  error: string;
}

export interface ExportJobState {
  phase: 'download' | 'finalize' | 'scan' | 'done';
  tracks: Record<string, ExportTrackState>;
}

export interface ExportJobResult {
  relativePath: string;
  absolutePath: string;
  trackCount: number;
  audioCount: number;
  bytes: number;
  cover: 'ok' | 'failed' | 'none';
  scan?: unknown;
}

export interface ExportJobRecord {
  id: number;
  remoteWorkId: number;
  code: string;
  title: string;
  targetRootPath: string;
  targetRelativePath: string;
  status: ExportJobStatus;
  progress: number;
  trackTotal: number;
  trackCompleted: number;
  payloadJson: string;
  stateJson: string;
  resultJson: string;
  error: string;
  createdAt: string;
  updatedAt: string;
}

function toRecord(row: Row): ExportJobRecord {
  return {
    id: num(row, 'id'),
    remoteWorkId: num(row, 'remote_work_id'),
    code: text(row, 'code'),
    title: text(row, 'title'),
    targetRootPath: text(row, 'target_root_path'),
    targetRelativePath: text(row, 'target_relative_path'),
    status: text(row, 'status') as ExportJobStatus,
    progress: num(row, 'progress'),
    trackTotal: num(row, 'track_total'),
    trackCompleted: num(row, 'track_completed'),
    payloadJson: text(row, 'payload_json'),
    stateJson: text(row, 'state_json'),
    resultJson: text(row, 'result_json'),
    error: text(row, 'error'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

export function parseExportPayload(job: ExportJobRecord): ExportJobPayload | null {
  try {
    const value: unknown = JSON.parse(job.payloadJson);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as ExportJobPayload;
  } catch {
    return null;
  }
}

export function parseExportState(job: ExportJobRecord): ExportJobState {
  try {
    const value: unknown = JSON.parse(job.stateJson);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { phase: 'download', tracks: {} };
    }
    const state = value as Partial<ExportJobState>;
    return {
      phase: state.phase ?? 'download',
      tracks: state.tracks && typeof state.tracks === 'object' ? state.tracks : {},
    };
  } catch {
    return { phase: 'download', tracks: {} };
  }
}

export function parseExportResult(job: ExportJobRecord): ExportJobResult | null {
  try {
    const value: unknown = JSON.parse(job.resultJson);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as ExportJobResult;
  } catch {
    return null;
  }
}

export interface CreateExportJobInput {
  remoteWorkId: number;
  code: string;
  title: string;
  targetRootPath: string;
  concurrency: number;
  hashes: string[] | null;
  work: AsmrOneWork;
}

export function createExportJob(db: DatabaseSync, input: CreateExportJobInput): number {
  const now = new Date().toISOString();
  const payload: ExportJobPayload = {
    work: input.work,
    hashes: input.hashes,
    concurrency: input.concurrency,
  };
  const result = db
    .prepare(
      `INSERT INTO export_jobs
         (remote_work_id, code, title, target_root_path, status, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`,
    )
    .run(
      input.remoteWorkId,
      input.code,
      input.title,
      input.targetRootPath,
      JSON.stringify(payload),
      now,
      now,
    );
  return Number(result.lastInsertRowid);
}

export interface UpdateExportJobPatch {
  status?: ExportJobStatus;
  progress?: number;
  trackTotal?: number;
  trackCompleted?: number;
  targetRelativePath?: string;
  state?: ExportJobState;
  result?: ExportJobResult;
  error?: string;
}

export function updateExportJob(
  db: DatabaseSync,
  jobId: number,
  patch: UpdateExportJobPatch,
): void {
  const job = getExportJob(db, jobId);
  if (!job) {
    return;
  }
  db.prepare(
    `UPDATE export_jobs SET
       status = ?, progress = ?, track_total = ?, track_completed = ?,
       target_relative_path = ?, state_json = ?, result_json = ?, error = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.status ?? job.status,
    patch.progress ?? job.progress,
    patch.trackTotal ?? job.trackTotal,
    patch.trackCompleted ?? job.trackCompleted,
    patch.targetRelativePath ?? job.targetRelativePath,
    patch.state === undefined ? job.stateJson : JSON.stringify(patch.state),
    patch.result === undefined ? job.resultJson : JSON.stringify(patch.result),
    patch.error ?? job.error,
    new Date().toISOString(),
    jobId,
  );
}

export function getExportJob(db: DatabaseSync, jobId: number): ExportJobRecord | null {
  const row = db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(jobId) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function listExportJobs(
  db: DatabaseSync,
  limit: number,
  status?: ExportJobStatus,
): ExportJobRecord[] {
  const rows = status
    ? (db
        .prepare('SELECT * FROM export_jobs WHERE status = ? ORDER BY id DESC LIMIT ?')
        .all(status, limit) as Row[])
    : (db.prepare('SELECT * FROM export_jobs ORDER BY id DESC LIMIT ?').all(limit) as Row[]);
  return rows.map(toRecord);
}

export function findActiveExportJobForCode(
  db: DatabaseSync,
  code: string,
): ExportJobRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM export_jobs
       WHERE code = ? AND status IN ('queued', 'running', 'paused')
       ORDER BY id DESC LIMIT 1`,
    )
    .get(code) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function findNextQueuedExportJob(db: DatabaseSync): ExportJobRecord | null {
  const row = db
    .prepare("SELECT * FROM export_jobs WHERE status = 'queued' ORDER BY id ASC LIMIT 1")
    .get() as Row | undefined;
  return row ? toRecord(row) : null;
}

export function pauseInterruptedExports(db: DatabaseSync): number {
  const result = db
    .prepare(
      `UPDATE export_jobs
       SET status = 'paused', error = '服务重启，导出已暂停', updated_at = ?
       WHERE status = 'running'`,
    )
    .run(new Date().toISOString());
  return Number(result.changes);
}

export function cancelExportJob(db: DatabaseSync, jobId: number, error = '已取消'): void {
  updateExportJob(db, jobId, { status: 'cancelled', error });
}

export function deleteExportJob(db: DatabaseSync, jobId: number): boolean {
  const result = db.prepare('DELETE FROM export_jobs WHERE id = ?').run(jobId);
  return Number(result.changes) > 0;
}
