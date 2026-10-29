import { promises as fs } from 'node:fs';
import path from 'node:path';

const IGNORED_NAMES = new Set([
  '__macosx',
  '.ds_store',
  'thumbs.db',
  'desktop.ini',
  '$recycle.bin',
  'system volume information',
  '.kikoeru-tmp',
]);

export const EXPORT_TMP_DIR = '.kikoeru-tmp';
export const EXPORT_COMPLETE_MARKER = '.kikoeru-export-complete';
export const EXPORT_INCOMPLETE_MARKER = '.kikoeru-export-incomplete';

export function isIgnoredName(name: string): boolean {
  return name.startsWith('.') || IGNORED_NAMES.has(name.toLowerCase());
}

export function toPosixRelative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

export function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export interface ResolvedLibraryFile {
  absolutePath: string;
  size: number;
}

export async function resolveLibraryFile(
  root: string,
  relativePath: string,
): Promise<ResolvedLibraryFile | null> {
  if (!relativePath || relativePath.includes('\0')) {
    return null;
  }
  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, ...relativePath.split('/'));
  if (!isPathInside(rootResolved, candidate)) {
    return null;
  }
  try {
    const realRoot = await fs.realpath(rootResolved);
    const realTarget = await fs.realpath(candidate);
    if (!isPathInside(realRoot, realTarget)) {
      return null;
    }
    const stat = await fs.stat(realTarget);
    if (!stat.isFile()) {
      return null;
    }
    return { absolutePath: realTarget, size: stat.size };
  } catch {
    return null;
  }
}
