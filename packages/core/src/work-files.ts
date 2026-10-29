import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileKindForName, naturalCompare, type MediaFileKind } from '@kikoeru-next/shared';
import { isIgnoredName, toPosixRelative } from './paths.js';

const DEFAULT_MAX_FILE_DEPTH = 10;
const MAX_FILES = 5000;

export interface WorkFileEntry {
  /** 相对作品目录的 posix 路径。 */
  path: string;
  name: string;
  kind: MediaFileKind;
  size: number;
  mtimeMs: number;
  durationMs: number | null;
  trackId: number | null;
}

export interface WorkFilesResult {
  files: WorkFileEntry[];
  warnings: string[];
  truncated: boolean;
}

interface TrackPathRow {
  id: number;
  duration_ms: number | null;
  path: string;
}

function trackIndexForPath(
  db: DatabaseSync,
  workId: number,
  workRelativePath: string,
): Map<string, { trackId: number; durationMs: number | null }> {
  const rows = db
    .prepare(
      `SELECT t.id AS id, t.duration_ms AS duration_ms, f.path AS path
       FROM tracks t
       JOIN storage_files f ON f.id = t.storage_file_id
       WHERE t.work_id = ?`,
    )
    .all(workId) as unknown as TrackPathRow[];
  const prefix = workRelativePath.replace(/^\/+|\/+$/g, '');
  const index = new Map<string, { trackId: number; durationMs: number | null }>();
  for (const row of rows) {
    let relative = String(row.path ?? '').replace(/\\/g, '/');
    if (prefix && (relative === prefix || relative.startsWith(`${prefix}/`))) {
      relative = relative.slice(prefix.length).replace(/^\/+/, '');
    }
    if (relative) {
      index.set(relative, {
        trackId: Number(row.id),
        durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      });
    }
  }
  return index;
}

export async function listWorkFiles(options: {
  db: DatabaseSync;
  rootPath: string;
  workPath: string;
  workId: number;
  maxDepth?: number;
}): Promise<WorkFilesResult> {
  const rootPath = path.resolve(options.rootPath);
  const workPath = options.workPath
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  const workDir = path.resolve(rootPath, ...workPath.split('/').filter(Boolean));
  const trackIndex = trackIndexForPath(options.db, options.workId, workPath);
  const warnings: string[] = [];
  const files: WorkFileEntry[] = [];
  let truncated = false;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_FILE_DEPTH;

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth || truncated) {
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      warnings.push(
        `读取目录失败 ${toPosixRelative(rootPath, directory) || '.'}：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    for (const entry of entries) {
      if (truncated) {
        return;
      }
      if (isIgnoredName(entry.name)) {
        continue;
      }
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (files.length >= MAX_FILES) {
        truncated = true;
        warnings.push(`文件数量超过 ${MAX_FILES} 个，仅显示前 ${MAX_FILES} 个`);
        return;
      }
      try {
        const stat = await fs.stat(absolute);
        const relative = toPosixRelative(workDir, absolute);
        const track = trackIndex.get(relative);
        files.push({
          path: relative,
          name: entry.name,
          kind: fileKindForName(entry.name),
          size: stat.size,
          mtimeMs: Math.round(stat.mtimeMs),
          durationMs: track?.durationMs ?? null,
          trackId: track?.trackId ?? null,
        });
      } catch (error) {
        warnings.push(
          `读取文件失败 ${toPosixRelative(workDir, absolute)}：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  await walk(workDir, 0);
  files.sort((a, b) => naturalCompare(a.path, b.path));
  return { files, warnings, truncated };
}
