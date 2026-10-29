import type { OperationLogCategory, OperationLogEntry, OperationLogLevel } from './api';

export const LOG_CATEGORY_LABELS: Record<string, string> = {
  system: '系统',
  desktop: '桌面端',
  scan: '扫描',
  scrape: '刮削',
  export: '导出',
  library: '曲库',
  settings: '设置',
  auth: '访问',
  online: '在线',
  api: '请求',
};

export const LOG_LEVEL_LABELS: Record<OperationLogLevel, string> = {
  info: '信息',
  success: '完成',
  warn: '警告',
  error: '错误',
};

export interface LogFilter {
  category: 'all' | OperationLogCategory;
  onlyProblems: boolean;
}

export function logCategoryLabel(category: string): string {
  return LOG_CATEGORY_LABELS[category] ?? category;
}

export function matchesLogFilter(entry: OperationLogEntry, filter: LogFilter): boolean {
  if (filter.category !== 'all' && entry.category !== filter.category) {
    return false;
  }
  if (filter.onlyProblems && entry.level !== 'warn' && entry.level !== 'error') {
    return false;
  }
  return true;
}

function entryKey(entry: OperationLogEntry): string {
  return entry.id > 0
    ? `id:${entry.id}`
    : `fallback:${entry.createdAt}:${entry.action}:${entry.message}`;
}

export function mergeLogEntries(
  current: OperationLogEntry[],
  incoming: OperationLogEntry[],
  max = 500,
): OperationLogEntry[] {
  const merged = new Map<string, OperationLogEntry>();
  for (const entry of current) {
    merged.set(entryKey(entry), entry);
  }
  for (const entry of incoming) {
    merged.set(entryKey(entry), entry);
  }
  const items = [...merged.values()].sort((left, right) => {
    if (left.id !== right.id) {
      return left.id - right.id;
    }
    return left.createdAt.localeCompare(right.createdAt);
  });
  return items.slice(Math.max(0, items.length - max));
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatLogTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return time;
  }
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}

export function formatLogEntry(entry: OperationLogEntry, now = new Date()): string {
  return `[${formatLogTime(entry.createdAt, now)}] [${LOG_LEVEL_LABELS[entry.level]}] [${
    LOG_CATEGORY_LABELS[entry.category] ?? entry.category
  }] ${entry.message}`;
}

export function serializeLogEntries(
  entries: OperationLogEntry[],
  now = new Date(),
): string {
  return entries.map((entry) => formatLogEntry(entry, now)).join('\n');
}
