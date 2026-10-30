import type { DatabaseSync } from 'node:sqlite';
import { deleteSetting, getSetting, setSetting } from './repository.js';

const KEY_LIBRARY_PATHS = 'library.paths';
const KEY_LIBRARY_PATH_LEGACY = 'library.path';
const KEY_PROXY_URL = 'network.proxyUrl';
const KEY_FFPROBE_PATH = 'media.ffprobePath';
const KEY_FFMPEG_PATH = 'media.ffmpegPath';
const KEY_ASMRONE_BASE_URL = 'online.asmroneBaseUrl';
const KEY_EXPORT_CONCURRENCY = 'export.concurrency';
const KEY_LAN_ENABLED = 'access.lanEnabled';

const DEFAULT_EXPORT_CONCURRENCY = 2;

export const MAX_LIBRARY_ROOTS = 8;

function clampConcurrency(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_EXPORT_CONCURRENCY;
  }
  return Math.min(3, Math.max(1, Math.trunc(parsed)));
}

function rootKey(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function normalizeLibraryPaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    const key = rootKey(trimmed);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    paths.push(trimmed);
    if (paths.length >= MAX_LIBRARY_ROOTS) {
      break;
    }
  }
  return paths;
}

export interface AppSettings {
  libraryPaths: string[];
  /** 主库根，等价于 libraryPaths[0]，保留给旧界面与导出默认值。 */
  libraryPath: string;
  proxyUrl: string;
  ffprobePath: string;
  ffmpegPath: string;
  asmroneBaseUrl: string;
  exportConcurrency: number;
  lanEnabled: boolean;
}

export interface SettingsDefaults {
  libraryPaths?: string[];
  libraryPath?: string;
  proxyUrl?: string;
  ffprobePath?: string;
  ffmpegPath?: string;
  asmroneBaseUrl?: string;
  exportConcurrency?: number;
  lanEnabled?: boolean;
}

export interface SettingsPatch {
  libraryPaths?: string[];
  libraryPath?: string;
  proxyUrl?: string;
  ffprobePath?: string;
  ffmpegPath?: string;
  asmroneBaseUrl?: string;
  exportConcurrency?: number;
  lanEnabled?: boolean;
}

function siblingBinary(binaryPath: string, name: string): string {
  const trimmed = binaryPath.trim();
  if (!trimmed) {
    return name;
  }
  const separator = trimmed.includes('\\') ? '\\' : '/';
  const parts = trimmed.split(separator);
  const base = parts[parts.length - 1] ?? '';
  if (!/^ffprobe(?:\.exe)?$/i.test(base)) {
    return name;
  }
  parts[parts.length - 1] = base.replace(/ffprobe/i, name);
  return parts.join(separator);
}

export function readSettings(db: DatabaseSync, defaults: SettingsDefaults = {}): AppSettings {
  const ffprobePath = getSetting(db, KEY_FFPROBE_PATH, defaults.ffprobePath ?? 'ffprobe');
  const fallbackPaths = normalizeLibraryPaths([
    ...(defaults.libraryPaths ?? []),
    ...(defaults.libraryPath ? [defaults.libraryPath] : []),
  ]);
  const storedPaths = getSetting<unknown>(db, KEY_LIBRARY_PATHS, null);
  const legacyPath = getSetting(db, KEY_LIBRARY_PATH_LEGACY, '');
  const libraryPaths = Array.isArray(storedPaths)
    ? normalizeLibraryPaths(storedPaths)
    : legacyPath.trim()
      ? normalizeLibraryPaths([legacyPath, ...fallbackPaths])
      : fallbackPaths;
  return {
    libraryPaths,
    libraryPath: libraryPaths[0] ?? '',
    proxyUrl: getSetting(db, KEY_PROXY_URL, defaults.proxyUrl ?? ''),
    ffprobePath,
    ffmpegPath: getSetting(
      db,
      KEY_FFMPEG_PATH,
      defaults.ffmpegPath || siblingBinary(ffprobePath, 'ffmpeg'),
    ),
    asmroneBaseUrl: getSetting(
      db,
      KEY_ASMRONE_BASE_URL,
      defaults.asmroneBaseUrl ?? '',
    ),
    exportConcurrency: clampConcurrency(
      getSetting(db, KEY_EXPORT_CONCURRENCY, defaults.exportConcurrency ?? DEFAULT_EXPORT_CONCURRENCY),
    ),
    lanEnabled: Boolean(getSetting(db, KEY_LAN_ENABLED, defaults.lanEnabled ?? false)),
  };
}

export function writeSettings(db: DatabaseSync, patch: SettingsPatch): AppSettings {
  if (patch.libraryPaths !== undefined) {
    setSetting(db, KEY_LIBRARY_PATHS, normalizeLibraryPaths(patch.libraryPaths));
    deleteSetting(db, KEY_LIBRARY_PATH_LEGACY);
  } else if (patch.libraryPath !== undefined) {
    const current = readSettings(db);
    const primary = patch.libraryPath.trim();
    setSetting(
      db,
      KEY_LIBRARY_PATHS,
      normalizeLibraryPaths(primary ? [primary, ...current.libraryPaths.slice(1)] : current.libraryPaths.slice(1)),
    );
    deleteSetting(db, KEY_LIBRARY_PATH_LEGACY);
  }
  if (patch.proxyUrl !== undefined) {
    setSetting(db, KEY_PROXY_URL, patch.proxyUrl.trim());
  }
  if (patch.ffprobePath !== undefined) {
    setSetting(db, KEY_FFPROBE_PATH, patch.ffprobePath.trim() || 'ffprobe');
  }
  if (patch.ffmpegPath !== undefined) {
    setSetting(db, KEY_FFMPEG_PATH, patch.ffmpegPath.trim() || 'ffmpeg');
  }
  if (patch.asmroneBaseUrl !== undefined) {
    setSetting(db, KEY_ASMRONE_BASE_URL, patch.asmroneBaseUrl.trim());
  }
  if (patch.exportConcurrency !== undefined) {
    setSetting(db, KEY_EXPORT_CONCURRENCY, clampConcurrency(patch.exportConcurrency));
  }
  if (patch.lanEnabled !== undefined) {
    setSetting(db, KEY_LAN_ENABLED, Boolean(patch.lanEnabled));
  }
  return readSettings(db);
}
