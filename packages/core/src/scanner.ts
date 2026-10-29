import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  isAudioFileName,
  naturalCompare,
  parseWorkno,
  parseWorkTitle,
  type WorkCodeType,
} from '@kikoeru-next/shared';
import { isIgnoredName, isPathInside, toPosixRelative, EXPORT_INCOMPLETE_MARKER } from './paths.js';
import {
  getWorkLocationByCode,
  syncWorkMedia,
  upsertRoot,
  upsertWork,
  type ScannedAudioFile,
} from './repository.js';

export interface ScanOptions {
  db: DatabaseSync;
  rootPath: string;
  maxDepth?: number;
  maxFileDepth?: number;
}

export interface ScanDuplicate {
  code: string;
  path: string;
  keptPath: string;
}

export interface ScanResult {
  rootId: number;
  rootPath: string;
  worksFound: number;
  worksAdded: number;
  worksUpdated: number;
  tracksFound: number;
  skippedDuplicates: number;
  skippedIncomplete: number;
  duplicates: ScanDuplicate[];
  errors: string[];
  durationMs: number;
}

interface WorkDir {
  dirPath: string;
  relativePath: string;
  code: string;
  codeType: WorkCodeType;
  title: string;
}

const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_FILE_DEPTH = 8;
const MAX_REPORTED_ERRORS = 50;
const MAX_REPORTED_DUPLICATES = 20;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function hasIncompleteMarker(directory: string): Promise<boolean> {
  try {
    await fs.access(path.join(directory, EXPORT_INCOMPLETE_MARKER));
    return true;
  } catch {
    return false;
  }
}

async function findWorkDirs(
  root: string,
  maxDepth: number,
  errors: string[],
  duplicates: ScanDuplicate[],
): Promise<{ works: WorkDir[]; skippedIncomplete: number }> {
  const works: WorkDir[] = [];
  const seen = new Map<string, string>();
  let skippedIncomplete = 0;

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      errors.push(`读取目录失败 ${toPosixRelative(root, directory) || '.'}：${describeError(error)}`);
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || isIgnoredName(entry.name)) {
        continue;
      }
      const child = path.join(directory, entry.name);
      const match = parseWorkno(entry.name);
      if (match) {
        if (await hasIncompleteMarker(child)) {
          skippedIncomplete += 1;
          continue;
        }
        const relativePath = toPosixRelative(root, child);
        const keptPath = seen.get(match.code);
        if (keptPath) {
          duplicates.push({ code: match.code, path: relativePath, keptPath });
          continue;
        }
        seen.set(match.code, relativePath);
        works.push({
          dirPath: child,
          relativePath,
          code: match.code,
          codeType: match.type,
          title: parseWorkTitle(entry.name, match.code),
        });
        continue;
      }
      await walk(child, depth + 1);
    }
  }

  await walk(root, 0);
  return { works, skippedIncomplete };
}

function buildAudioFile(
  fileName: string,
  relativePath: string,
  size: number,
  mtimeMs: number,
): ScannedAudioFile {
  const extension = path.extname(fileName);
  const base = path.basename(fileName, extension);
  const indexMatch = /^(?:track\s*)?(\d{1,3})(?:[\s._-]|$)/i.exec(base);
  const idx = indexMatch?.[1] ? Number.parseInt(indexMatch[1], 10) : 0;
  const discMatch = /(?:disc|cd|ディスク)\s*(\d{1,2})/i.exec(relativePath);
  const disc = discMatch?.[1] ? Number.parseInt(discMatch[1], 10) : 1;
  const title =
    base.replace(/^(?:track\s*)?\d{1,3}(?:[\s._-]+|$)/i, '').trim() || base || fileName;
  return { relativePath, size, mtimeMs, title, disc, idx, sortKey: relativePath };
}

async function collectAudioFiles(
  root: string,
  workDir: string,
  maxDepth: number,
  errors: string[],
): Promise<ScannedAudioFile[]> {
  const files: ScannedAudioFile[] = [];

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      errors.push(
        `读取作品目录失败 ${toPosixRelative(root, directory)}：${describeError(error)}`,
      );
      return;
    }
    for (const entry of entries) {
      if (isIgnoredName(entry.name)) {
        continue;
      }
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(child, depth + 1);
        continue;
      }
      if (!entry.isFile() || !isAudioFileName(entry.name)) {
        continue;
      }
      try {
        const stat = await fs.stat(child);
        files.push(
          buildAudioFile(
            entry.name,
            toPosixRelative(root, child),
            stat.size,
            Math.round(stat.mtimeMs),
          ),
        );
      } catch (error) {
        errors.push(`读取文件失败 ${toPosixRelative(root, child)}：${describeError(error)}`);
      }
    }
  }

  await walk(workDir, 0);
  files.sort((a, b) => naturalCompare(a.sortKey, b.sortKey));
  return files;
}

export async function scanLibrary(options: ScanOptions): Promise<ScanResult> {
  const rootPath = path.resolve(options.rootPath);
  const stat = await fs.stat(rootPath);
  if (!stat.isDirectory()) {
    throw new Error(`库路径不是目录：${rootPath}`);
  }

  const startedAt = performance.now();
  const db = options.db;
  const rootId = upsertRoot(db, 'local', rootPath);
  const errors: string[] = [];
  const duplicates: ScanDuplicate[] = [];
  const { works, skippedIncomplete } = await findWorkDirs(
    rootPath,
    options.maxDepth ?? DEFAULT_MAX_DEPTH,
    errors,
    duplicates,
  );
  works.sort((a, b) => naturalCompare(a.relativePath, b.relativePath));

  let worksAdded = 0;
  let worksUpdated = 0;
  let tracksFound = 0;

  for (const work of works) {
    const existing = getWorkLocationByCode(db, work.code);
    if (existing && existing.rootId !== rootId) {
      // 同一RJ号只保留先入库的库根，避免多根扫描互相搬迁作品。
      duplicates.push({
        code: work.code,
        path: work.relativePath,
        keptPath: existing.relativePath,
      });
      continue;
    }
    try {
      const files = await collectAudioFiles(
        rootPath,
        work.dirPath,
        options.maxFileDepth ?? DEFAULT_MAX_FILE_DEPTH,
        errors,
      );
      const { id, inserted } = upsertWork(db, {
        rootId,
        code: work.code,
        codeType: work.codeType,
        title: work.title,
        relativePath: work.relativePath,
      });
      syncWorkMedia(db, id, rootId, files);
      if (inserted) {
        worksAdded += 1;
      } else {
        worksUpdated += 1;
      }
      tracksFound += files.length;
    } catch (error) {
      errors.push(`索引作品失败 ${work.code}：${describeError(error)}`);
    }
  }

  return {
    rootId,
    rootPath,
    worksFound: works.length,
    worksAdded,
    worksUpdated,
    tracksFound,
    skippedDuplicates: duplicates.length,
    skippedIncomplete,
    duplicates: duplicates.slice(0, MAX_REPORTED_DUPLICATES),
    errors: errors.slice(0, MAX_REPORTED_ERRORS),
    durationMs: Math.round(performance.now() - startedAt),
  };
}

export interface ScanWorkOptions {
  db: DatabaseSync;
  rootPath: string;
  relativePath: string;
  maxFileDepth?: number;
}

export async function scanWorkDir(options: ScanWorkOptions): Promise<ScanResult> {
  const startedAt = performance.now();
  const rootPath = path.resolve(options.rootPath);
  const rootStat = await fs.stat(rootPath);
  if (!rootStat.isDirectory()) {
    throw new Error(`库路径不是目录：${rootPath}`);
  }
  const relativePath = options.relativePath
    .split(path.sep)
    .join('/')
    .replace(/^\/+|\/+$/g, '');
  if (!relativePath) {
    throw new Error('作品目录不能为空');
  }
  const workDir = path.resolve(rootPath, ...relativePath.split('/'));
  if (!isPathInside(rootPath, workDir)) {
    throw new Error('作品目录不在库根内');
  }
  const stat = await fs.stat(workDir);
  if (!stat.isDirectory()) {
    throw new Error(`作品路径不是目录：${relativePath}`);
  }
  const match = parseWorkno(path.basename(workDir));
  if (!match) {
    throw new Error(`目录名不含有效RJ号：${relativePath}`);
  }

  const db = options.db;
  const rootId = upsertRoot(db, 'local', rootPath);
  const base = {
    rootId,
    rootPath,
    worksFound: 0,
    worksAdded: 0,
    worksUpdated: 0,
    tracksFound: 0,
    skippedDuplicates: 0,
    skippedIncomplete: 0,
    duplicates: [] as ScanDuplicate[],
    errors: [] as string[],
  };
  if (await hasIncompleteMarker(workDir)) {
    return {
      ...base,
      skippedIncomplete: 1,
      errors: [`导出目录尚未完成，已跳过：${relativePath}`],
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  const existing = getWorkLocationByCode(db, match.code);
  if (existing && existing.rootId !== rootId) {
    return {
      ...base,
      worksFound: 1,
      skippedDuplicates: 1,
      duplicates: [
        { code: match.code, path: relativePath, keptPath: existing.relativePath },
      ],
      errors: [`作品已在其他库根，已跳过：${relativePath}`],
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  const errors: string[] = [];
  const files = await collectAudioFiles(
    rootPath,
    workDir,
    options.maxFileDepth ?? DEFAULT_MAX_FILE_DEPTH,
    errors,
  );
  const { id, inserted } = upsertWork(db, {
    rootId,
    code: match.code,
    codeType: match.type,
    title: parseWorkTitle(path.basename(workDir), match.code),
    relativePath,
  });
  syncWorkMedia(db, id, rootId, files);

  return {
    ...base,
    worksFound: 1,
    worksAdded: inserted ? 1 : 0,
    worksUpdated: inserted ? 0 : 1,
    tracksFound: files.length,
    errors: errors.slice(0, MAX_REPORTED_ERRORS),
    durationMs: Math.round(performance.now() - startedAt),
  };
}
