import type { DatabaseSync } from 'node:sqlite';

export type OperationLogLevel = 'info' | 'success' | 'warn' | 'error';

export type OperationLogCategory =
  | 'system'
  | 'desktop'
  | 'scan'
  | 'scrape'
  | 'export'
  | 'library'
  | 'settings'
  | 'auth'
  | 'online'
  | 'api';

export interface OperationLogInput {
  level?: OperationLogLevel;
  category: OperationLogCategory | string;
  action: string;
  message: string;
  detail?: unknown;
  clientIp?: string;
}

export interface OperationLogEntry {
  id: number;
  level: OperationLogLevel;
  category: string;
  action: string;
  message: string;
  detail: unknown;
  clientIp: string;
  createdAt: string;
}

export interface OperationLogQuery {
  limit?: number;
  afterId?: number;
  beforeId?: number;
  level?: string;
  category?: string;
}

export interface OperationLogPage {
  items: OperationLogEntry[];
  latestId: number;
  hasMore: boolean;
}

export const MAX_OPERATION_LOGS = 2000;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const MAX_MESSAGE_LENGTH = 500;
const MAX_ACTION_LENGTH = 80;
const MAX_DETAIL_ITEMS = 20;
const MAX_DETAIL_DEPTH = 3;
const MAX_DETAIL_JSON = 4000;

type Row = Record<string, unknown>;

const LEVELS = new Set<OperationLogLevel>(['info', 'success', 'warn', 'error']);

function text(row: Row, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function num(row: Row, key: string): number {
  const value = row[key];
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function redactText(value: string): string {
  return value
    .replace(/\/\/[^/@\s]+@/g, '//***@')
    .replace(
      /((?:password|passwd|pwd|token|secret|authorization|cookie)\s*[=:]\s*)([^\s&,;]+)/gi,
      '$1***',
    );
}

function sanitizeDetail(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return redactText(value.slice(0, MAX_MESSAGE_LENGTH));
  }
  if (value === undefined) {
    return undefined;
  }
  if (depth >= MAX_DETAIL_DEPTH) {
    return '[…]';
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_DETAIL_ITEMS).map((item) => sanitizeDetail(item, depth + 1));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_DETAIL_ITEMS)) {
      if (/password|token|secret|cookie|authorization/i.test(key)) {
        result[key] = '***';
      } else {
        result[key] = sanitizeDetail(item, depth + 1);
      }
    }
    return result;
  }
  return String(value);
}

function detailJson(detail: unknown): string {
  if (detail === undefined) {
    return '{}';
  }
  try {
    const json = JSON.stringify(sanitizeDetail(detail));
    if (!json) {
      return '{}';
    }
    if (json.length > MAX_DETAIL_JSON) {
      return JSON.stringify({
        truncated: true,
        preview: json.slice(0, MAX_DETAIL_JSON - 100),
      });
    }
    return json;
  } catch {
    return '{}';
  }
}

function parseDetail(raw: string): unknown {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function toEntry(row: Row): OperationLogEntry {
  const level = text(row, 'level') as OperationLogLevel;
  return {
    id: num(row, 'id'),
    level: LEVELS.has(level) ? level : 'info',
    category: text(row, 'category'),
    action: text(row, 'action'),
    message: text(row, 'message'),
    detail: parseDetail(text(row, 'detail_json')),
    clientIp: text(row, 'client_ip'),
    createdAt: text(row, 'created_at'),
  };
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(value as number)));
}

export class OperationLogger {
  private readonly listeners = new Set<(entry: OperationLogEntry) => void>();

  constructor(private readonly db: DatabaseSync) {}

  private latestId(): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(id), 0) AS id FROM operation_logs')
      .get() as Row | undefined;
    return row ? num(row, 'id') : 0;
  }

  record(input: OperationLogInput): OperationLogEntry {
    const level = input.level && LEVELS.has(input.level) ? input.level : 'info';
    const entry: OperationLogEntry = {
      id: 0,
      level,
      category: input.category.slice(0, 32),
      action: input.action.slice(0, MAX_ACTION_LENGTH),
      message: redactText(input.message).slice(0, MAX_MESSAGE_LENGTH),
      detail: sanitizeDetail(input.detail) ?? null,
      clientIp: (input.clientIp ?? '').slice(0, 64),
      createdAt: new Date().toISOString(),
    };
    try {
      const result = this.db
        .prepare(
          `INSERT INTO operation_logs
             (level, category, action, message, detail_json, client_ip, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.level,
          entry.category,
          entry.action,
          entry.message,
          detailJson(input.detail),
          entry.clientIp,
          entry.createdAt,
        );
      entry.id = Number(result.lastInsertRowid);
      if (entry.id > MAX_OPERATION_LOGS) {
        this.db
          .prepare('DELETE FROM operation_logs WHERE id <= ?')
          .run(entry.id - MAX_OPERATION_LOGS);
      }
    } catch {
      // 日志写入失败不能影响主操作，仍然广播给在线窗口。
    }
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // 单个订阅者异常不影响其他订阅者。
      }
    }
    return entry;
  }

  list(query: OperationLogQuery = {}): OperationLogPage {
    const limit = clampLimit(query.limit);
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    const afterId =
      query.afterId !== undefined && Number.isFinite(query.afterId) && query.afterId > 0
        ? Math.trunc(query.afterId)
        : 0;
    if (afterId > 0) {
      conditions.push('id > ?');
      values.push(afterId);
    } else if (
      query.beforeId !== undefined &&
      Number.isFinite(query.beforeId) &&
      query.beforeId > 0
    ) {
      conditions.push('id < ?');
      values.push(Math.trunc(query.beforeId));
    }
    if (query.level && LEVELS.has(query.level as OperationLogLevel)) {
      conditions.push('level = ?');
      values.push(query.level);
    }
    if (query.category) {
      conditions.push('category = ?');
      values.push(query.category);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = afterId > 0 ? 'ASC' : 'DESC';
    const rows = this.db
      .prepare(`SELECT * FROM operation_logs ${where} ORDER BY id ${order} LIMIT ?`)
      .all(...values, limit + 1) as Row[];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(toEntry);
    return { items, latestId: this.latestId(), hasMore };
  }

  clear(): void {
    this.db.prepare('DELETE FROM operation_logs').run();
  }

  subscribe(listener: (entry: OperationLogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
