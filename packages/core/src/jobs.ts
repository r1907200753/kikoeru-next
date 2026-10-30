import type { DatabaseSync } from 'node:sqlite';

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
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface JobRecord {
  id: number;
  type: string;
  status: string;
  payloadJson: string;
  progress: number;
  lastError: string;
  resultJson: string;
  createdAt: string;
  updatedAt: string;
}

function toJob(row: Row): JobRecord {
  return {
    id: num(row, 'id'),
    type: text(row, 'type'),
    status: text(row, 'status'),
    payloadJson: text(row, 'payload_json'),
    progress: num(row, 'progress'),
    lastError: text(row, 'last_error'),
    resultJson: text(row, 'result_json'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

export function createJob(db: DatabaseSync, type: string, payload: unknown): number {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO jobs (type, status, payload_json, progress, last_error, result_json, created_at, updated_at)
       VALUES (?, 'queued', ?, 0, '', '{}', ?, ?)`,
    )
    .run(type, JSON.stringify(payload), now, now);
  return Number(result.lastInsertRowid);
}

export function updateJob(
  db: DatabaseSync,
  jobId: number,
  patch: {
    status?: JobStatus;
    progress?: number;
    lastError?: string;
    result?: unknown;
    payload?: unknown;
  },
): void {
  const job = getJob(db, jobId);
  if (!job) {
    return;
  }
  const status = patch.status ?? job.status;
  const progress = patch.progress ?? job.progress;
  const lastError = patch.lastError ?? job.lastError;
  const resultJson = patch.result === undefined ? job.resultJson : JSON.stringify(patch.result);
  const payloadJson = patch.payload === undefined ? job.payloadJson : JSON.stringify(patch.payload);
  db.prepare(
    `UPDATE jobs SET status = ?, progress = ?, last_error = ?, result_json = ?, payload_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run(status, progress, lastError, resultJson, payloadJson, new Date().toISOString(), jobId);
}

export function getJob(db: DatabaseSync, jobId: number): JobRecord | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Row | undefined;
  return row ? toJob(row) : null;
}

export function listJobs(db: DatabaseSync, limit: number, type?: string): JobRecord[] {
  const rows = type
    ? (db
        .prepare('SELECT * FROM jobs WHERE type = ? ORDER BY id DESC LIMIT ?')
        .all(type, limit) as Row[])
    : (db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ?').all(limit) as Row[]);
  return rows.map(toJob);
}

export function failInterruptedJobs(db: DatabaseSync): number {
  const result = db
    .prepare(
      `UPDATE jobs SET status = 'failed', last_error = '服务重启，任务中断', updated_at = ?
       WHERE status IN ('queued', 'running')`,
    )
    .run(new Date().toISOString());
  return Number(result.changes);
}
