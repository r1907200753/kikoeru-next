import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { localizeTags, naturalCompare, tagFilterVariants } from '@kikoeru-next/shared';
import { trackVariants } from './track-variants.js';

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

function nullableNum(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export interface WorkSummary {
  id: number;
  code: string;
  codeType: string;
  title: string;
  circle: string;
  releaseDate: string;
  workType: string;
  tags: string[];
  vas: string[];
  rating: number | null;
  priceYen: number | null;
  favoriteAt: string;
  metadataStatus: string;
  coverAssetId: number | null;
  relativePath: string;
  rootId: number;
  trackCount: number;
  updatedAt: string;
}

export interface TrackSummary {
  id: number;
  workId: number;
  title: string;
  disc: number;
  idx: number;
  durationMs: number | null;
  fileName: string;
  relativePath: string;
  size: number;
  variants: string[];
}

export interface WorkDetail extends WorkSummary {
  tracks: TrackSummary[];
}

export interface TrackFileRecord {
  trackId: number;
  title: string;
  relativePath: string;
  rootPath: string;
  size: number;
}

export interface PlaybackStateRecord {
  workId: number;
  trackId: number | null;
  positionMs: number;
  updatedAt: string;
}

export interface UpsertWorkInput {
  rootId: number;
  code: string;
  codeType: string;
  title: string;
  relativePath: string;
}

export interface ScannedAudioFile {
  relativePath: string;
  size: number;
  mtimeMs: number;
  title: string;
  disc: number;
  idx: number;
  sortKey: string;
}

function parseTags(value: string): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
  } catch {
    return [];
  }
}

function toWork(row: Row, trackCount: number): WorkSummary {
  return {
    id: num(row, 'id'),
    code: text(row, 'code'),
    codeType: text(row, 'code_type'),
    title: text(row, 'title'),
    circle: text(row, 'circle'),
    releaseDate: text(row, 'release_date'),
    workType: text(row, 'work_type'),
    tags: localizeTags(parseTags(text(row, 'tags_json'))),
    vas: parseTags(text(row, 'vas_json')),
    rating: nullableNum(row, 'rating'),
    priceYen: nullableNum(row, 'price_yen'),
    favoriteAt: text(row, 'favorite_at'),
    metadataStatus: text(row, 'metadata_status') || 'local',
    coverAssetId: nullableNum(row, 'cover_asset_id'),
    relativePath: text(row, 'relative_path'),
    rootId: num(row, 'root_id'),
    trackCount,
    updatedAt: text(row, 'updated_at'),
  };
}

function toTrack(row: Row, workPath: string): TrackSummary {
  const relativePath = text(row, 'path').replace(/\\/g, '/');
  return {
    id: num(row, 'id'),
    workId: num(row, 'work_id'),
    title: text(row, 'title'),
    disc: num(row, 'disc'),
    idx: num(row, 'idx'),
    durationMs: nullableNum(row, 'duration_ms'),
    fileName: path.posix.basename(relativePath),
    relativePath,
    size: num(row, 'size'),
    variants: trackVariants(relativePath, workPath),
  };
}

function folderPathOf(track: TrackSummary): string {
  return track.relativePath.slice(0, track.relativePath.length - track.fileName.length);
}

export function upsertRoot(db: DatabaseSync, kind: string, rootPath: string): number {
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT id FROM storage_roots WHERE kind = ? AND path = ?')
    .get(kind, rootPath) as Row | undefined;
  if (existing) {
    db.prepare('UPDATE storage_roots SET enabled = 1 WHERE id = ?').run(num(existing, 'id'));
    return num(existing, 'id');
  }
  const result = db
    .prepare('INSERT INTO storage_roots (kind, path, enabled, created_at) VALUES (?, ?, 1, ?)')
    .run(kind, rootPath, now);
  return Number(result.lastInsertRowid);
}

export interface WorkLocation {
  id: number;
  rootId: number;
  relativePath: string;
}

export function getWorkLocationByCode(
  db: DatabaseSync,
  code: string,
): WorkLocation | null {
  const row = db
    .prepare('SELECT id, root_id, relative_path FROM works WHERE code = ?')
    .get(code) as Row | undefined;
  if (!row) {
    return null;
  }
  return {
    id: num(row, 'id'),
    rootId: num(row, 'root_id'),
    relativePath: text(row, 'relative_path'),
  };
}

export interface WorkRootLocation {
  id: number;
  relativePath: string;
  rootPath: string;
}

export function getWorkRootLocation(
  db: DatabaseSync,
  code: string,
): WorkRootLocation | null {
  const row = db
    .prepare(
      `SELECT w.id, w.relative_path, r.path AS root_path
       FROM works w
       JOIN storage_roots r ON r.id = w.root_id
       WHERE w.code = ?`,
    )
    .get(code) as Row | undefined;
  if (!row) {
    return null;
  }
  return {
    id: num(row, 'id'),
    relativePath: text(row, 'relative_path'),
    rootPath: text(row, 'root_path'),
  };
}

export function upsertWork(
  db: DatabaseSync,
  input: UpsertWorkInput,
): { id: number; inserted: boolean } {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM works WHERE code = ?').get(input.code) as Row | undefined;
  if (existing) {
    const id = num(existing, 'id');
    // 已刮削的作品保留官方标题，避免重扫把元数据覆盖回目录名。
    db.prepare(
      `UPDATE works
       SET title = CASE WHEN metadata_status = 'local' THEN ? ELSE title END,
           relative_path = ?, root_id = ?, updated_at = ?
       WHERE id = ?`,
    ).run(input.title, input.relativePath, input.rootId, now, id);
    return { id, inserted: false };
  }
  const result = db
    .prepare(
      `INSERT INTO works (code, code_type, title, relative_path, root_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.code, input.codeType, input.title, input.relativePath, input.rootId, now, now);
  return { id: Number(result.lastInsertRowid), inserted: true };
}

export function syncWorkMedia(
  db: DatabaseSync,
  workId: number,
  rootId: number,
  files: ScannedAudioFile[],
): void {
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    const existingRows = db
      .prepare('SELECT id, path, size, mtime_ms FROM storage_files WHERE work_id = ?')
      .all(workId) as Row[];
    const existingByPath = new Map(
      existingRows.map((row) => [
        text(row, 'path'),
        { id: num(row, 'id'), size: num(row, 'size'), mtimeMs: num(row, 'mtime_ms') },
      ]),
    );
    const keptIds: number[] = [];

    for (const file of files) {
      const existing = existingByPath.get(file.relativePath);
      let fileId: number;
      if (existing) {
        fileId = existing.id;
        if (existing.size !== file.size || existing.mtimeMs !== file.mtimeMs) {
          // 文件已变化，旧的时长与探测错误不再可信。
          db.prepare(
            'UPDATE tracks SET duration_ms = NULL, probe_error = ? WHERE storage_file_id = ?',
          ).run('', existing.id);
        }
        db.prepare(
          'UPDATE storage_files SET size = ?, mtime_ms = ?, kind = ?, work_id = ? WHERE id = ?',
        ).run(file.size, file.mtimeMs, 'audio', workId, fileId);
      } else {
        const result = db
          .prepare(
            `INSERT INTO storage_files (root_id, work_id, path, size, mtime_ms, kind, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(rootId, workId, file.relativePath, file.size, file.mtimeMs, 'audio', now);
        fileId = Number(result.lastInsertRowid);
      }
      keptIds.push(fileId);
      db.prepare(
        `INSERT INTO tracks (work_id, storage_file_id, disc, idx, title, sort_key)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (work_id, storage_file_id) DO UPDATE SET
           disc = excluded.disc,
           idx = excluded.idx,
           title = excluded.title,
           sort_key = excluded.sort_key`,
      ).run(workId, fileId, file.disc, file.idx, file.title, file.sortKey);
    }

    if (keptIds.length > 0) {
      const placeholders = keptIds.map(() => '?').join(', ');
      db.prepare(
        `DELETE FROM tracks WHERE work_id = ? AND storage_file_id NOT IN (${placeholders})`,
      ).run(workId, ...keptIds);
      db.prepare(
        `DELETE FROM storage_files WHERE work_id = ? AND id NOT IN (${placeholders})`,
      ).run(workId, ...keptIds);
    } else {
      db.prepare('DELETE FROM tracks WHERE work_id = ?').run(workId);
      db.prepare('DELETE FROM storage_files WHERE work_id = ?').run(workId);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function countWorks(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM works').get() as Row | undefined;
  return row ? num(row, 'count') : 0;
}

export interface LibraryRootRecord {
  id: number;
  path: string;
  workCount: number;
}

export function listLibraryRoots(db: DatabaseSync): LibraryRootRecord[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.path, COUNT(w.id) AS work_count
       FROM storage_roots r
       LEFT JOIN works w ON w.root_id = r.id
       WHERE r.kind = 'local'
       GROUP BY r.id
       ORDER BY r.id`,
    )
    .all() as Row[];
  return rows.map((row) => ({
    id: num(row, 'id'),
    path: text(row, 'path'),
    workCount: num(row, 'work_count'),
  }));
}

export type WorkSort = 'updated' | 'popular' | 'rating' | 'released' | 'title';

export interface ListWorksOptions {
  query?: string;
  limit: number;
  offset: number;
  sort?: WorkSort;
  favoriteOnly?: boolean;
  tag?: string;
  circle?: string;
  va?: string;
}

const WORK_ORDER_BY: Record<WorkSort, string> = {
  updated: 'w.updated_at DESC, w.id DESC',
  popular:
    'CASE WHEN p.updated_at IS NULL THEN 1 ELSE 0 END, p.updated_at DESC, w.updated_at DESC, w.id DESC',
  rating:
    "CASE WHEN w.rating IS NULL THEN 1 ELSE 0 END, w.rating DESC, CASE WHEN w.release_date = '' THEN 1 ELSE 0 END, w.release_date DESC, w.id DESC",
  released:
    "CASE WHEN w.release_date = '' THEN 1 ELSE 0 END, w.release_date DESC, w.id DESC",
  title: 'w.title COLLATE NOCASE ASC, w.id ASC',
};

export function listWorks(db: DatabaseSync, options: ListWorksOptions): WorkSummary[] {
  const params: Array<string | number> = [];
  const clauses: string[] = [];
  const query = options.query?.trim() ?? '';
  if (query) {
    clauses.push(
      `(w.title LIKE ? ESCAPE '\\' OR w.code LIKE ? ESCAPE '\\' OR w.circle LIKE ? ESCAPE '\\')`,
    );
    const like = `%${escapeLike(query)}%`;
    params.push(like, like, like);
  }
  if (options.favoriteOnly) {
    clauses.push(`w.favorite_at <> ''`);
  }
  const tag = options.tag?.trim() ?? '';
  if (tag) {
    const variants = tagFilterVariants(tag);
    if (variants.length > 0) {
      clauses.push(
        `EXISTS (SELECT 1 FROM json_each(w.tags_json) WHERE json_each.value IN (${variants
          .map(() => '?')
          .join(', ')}))`,
      );
      params.push(...variants);
    }
  }
  const circle = options.circle?.trim() ?? '';
  if (circle) {
    clauses.push('w.circle = ?');
    params.push(circle);
  }
  const va = options.va?.trim() ?? '';
  if (va) {
    clauses.push('EXISTS (SELECT 1 FROM json_each(w.vas_json) WHERE json_each.value = ?)');
    params.push(va);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderBy = WORK_ORDER_BY[options.sort ?? 'updated'] ?? WORK_ORDER_BY.updated;
  const rows = db
    .prepare(
      `SELECT w.*, COUNT(t.id) AS track_count, wa.asset_id AS cover_asset_id
       FROM works w
       LEFT JOIN tracks t ON t.work_id = w.id
       LEFT JOIN work_assets wa ON wa.work_id = w.id AND wa.role = 'cover'
       LEFT JOIN playback_states p ON p.work_id = w.id
       ${where}
       GROUP BY w.id
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, options.limit, options.offset) as Row[];
  return rows.map((row) => toWork(row, num(row, 'track_count')));
}

export function listWorkTotal(
  db: DatabaseSync,
  options: { query?: string; favoriteOnly?: boolean; tag?: string; circle?: string; va?: string },
): number {
  const params: string[] = [];
  const clauses: string[] = [];
  const query = options.query?.trim() ?? '';
  if (query) {
    clauses.push(
      `(title LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR circle LIKE ? ESCAPE '\\')`,
    );
    const like = `%${escapeLike(query)}%`;
    params.push(like, like, like);
  }
  if (options.favoriteOnly) {
    clauses.push(`favorite_at <> ''`);
  }
  const tag = options.tag?.trim() ?? '';
  if (tag) {
    const variants = tagFilterVariants(tag);
    if (variants.length > 0) {
      clauses.push(
        `EXISTS (SELECT 1 FROM json_each(works.tags_json) WHERE json_each.value IN (${variants
          .map(() => '?')
          .join(', ')}))`,
      );
      params.push(...variants);
    }
  }
  const circle = options.circle?.trim() ?? '';
  if (circle) {
    clauses.push('works.circle = ?');
    params.push(circle);
  }
  const va = options.va?.trim() ?? '';
  if (va) {
    clauses.push('EXISTS (SELECT 1 FROM json_each(works.vas_json) WHERE json_each.value = ?)');
    params.push(va);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM works ${where}`)
    .get(...params) as Row | undefined;
  return row ? num(row, 'count') : 0;
}

export function getRandomWork(
  db: DatabaseSync,
): { id: number; code: string; title: string; trackCount: number } | null {
  const row = db
    .prepare(
      `SELECT w.id, w.code, w.title, COUNT(t.id) AS track_count
       FROM works w
       LEFT JOIN tracks t ON t.work_id = w.id
       GROUP BY w.id
       HAVING COUNT(t.id) > 0
       ORDER BY RANDOM()
       LIMIT 1`,
    )
    .get() as Row | undefined;
  if (!row) {
    return null;
  }
  return {
    id: num(row, 'id'),
    code: text(row, 'code'),
    title: text(row, 'title'),
    trackCount: num(row, 'track_count'),
  };
}

export function setWorkFavorite(
  db: DatabaseSync,
  code: string,
  favorite: boolean,
): { favoriteAt: string } | null {
  const row = db.prepare('SELECT id FROM works WHERE code = ?').get(code) as Row | undefined;
  if (!row) {
    return null;
  }
  const favoriteAt = favorite ? new Date().toISOString() : '';
  db.prepare('UPDATE works SET favorite_at = ? WHERE id = ?').run(favoriteAt, num(row, 'id'));
  return { favoriteAt };
}

export function updateWorkOnlineMetadata(
  db: DatabaseSync,
  workId: number,
  input: { rating: number | null; priceYen: number | null; vas: string[] },
): void {
  db.prepare('UPDATE works SET rating = ?, price_yen = ?, vas_json = ? WHERE id = ?').run(
    input.rating,
    input.priceYen,
    JSON.stringify(input.vas),
    workId,
  );
}

export function updateWorkOnlineStats(
  db: DatabaseSync,
  workId: number,
  input: { rating: number | null; priceYen: number | null; vas?: string[] },
): void {
  const vasJson = input.vas && input.vas.length > 0 ? JSON.stringify(input.vas) : null;
  db.prepare(
    `UPDATE works
     SET rating = COALESCE(?, rating),
         price_yen = COALESCE(?, price_yen),
         vas_json = CASE WHEN ? IS NULL THEN vas_json ELSE ? END
     WHERE id = ?`,
  ).run(input.rating, input.priceYen, vasJson, vasJson, workId);
}

export interface LocalWorkState {
  code: string;
  favoriteAt: string;
}

export function listLocalWorkStates(db: DatabaseSync, codes: string[]): LocalWorkState[] {
  const unique = [...new Set(codes.filter((code) => code.trim().length > 0))];
  if (unique.length === 0) {
    return [];
  }
  const placeholders = unique.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT code, favorite_at FROM works WHERE code IN (${placeholders})`)
    .all(...unique) as Row[];
  return rows.map((row) => ({
    code: text(row, 'code'),
    favoriteAt: text(row, 'favorite_at'),
  }));
}

function listTrackRows(db: DatabaseSync, workId: number): Row[] {
  return db
    .prepare(
      `SELECT t.id, t.work_id, t.title, t.disc, t.idx, t.duration_ms, t.sort_key,
              f.path, f.size
       FROM tracks t
       JOIN storage_files f ON f.id = t.storage_file_id
       WHERE t.work_id = ?`,
    )
    .all(workId) as Row[];
}

export function getWorkByCode(db: DatabaseSync, code: string): WorkDetail | null {
  const row = db
    .prepare(
      `SELECT w.*, wa.asset_id AS cover_asset_id
       FROM works w
       LEFT JOIN work_assets wa ON wa.work_id = w.id AND wa.role = 'cover'
       WHERE w.code = ?`,
    )
    .get(code) as Row | undefined;
  if (!row) {
    return null;
  }
  const workPath = text(row, 'relative_path');
  const rows = listTrackRows(db, num(row, 'id'));
  const tracks = rows.map((trackRow) => toTrack(trackRow, workPath)).sort((a, b) => {
    if (a.disc !== b.disc) {
      return a.disc - b.disc;
    }
    const aFolder = folderPathOf(a);
    const bFolder = folderPathOf(b);
    if (aFolder !== bFolder) {
      return naturalCompare(aFolder, bFolder);
    }
    const aIdx = a.idx > 0 ? a.idx : Number.MAX_SAFE_INTEGER;
    const bIdx = b.idx > 0 ? b.idx : Number.MAX_SAFE_INTEGER;
    if (aIdx !== bIdx) {
      return aIdx - bIdx;
    }
    return naturalCompare(a.fileName, b.fileName);
  });
  return { ...toWork(row, tracks.length), tracks };
}

export function getTrackFile(db: DatabaseSync, trackId: number): TrackFileRecord | null {
  const row = db
    .prepare(
      `SELECT t.id AS track_id, t.title, f.path, f.size, r.path AS root_path
       FROM tracks t
       JOIN storage_files f ON f.id = t.storage_file_id
       JOIN storage_roots r ON r.id = f.root_id
       WHERE t.id = ?`,
    )
    .get(trackId) as Row | undefined;
  if (!row) {
    return null;
  }
  return {
    trackId: num(row, 'track_id'),
    title: text(row, 'title'),
    relativePath: text(row, 'path'),
    rootPath: text(row, 'root_path'),
    size: num(row, 'size'),
  };
}

export function savePlayback(
  db: DatabaseSync,
  input: { workId: number; trackId?: number | null; positionMs: number },
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO playback_states (work_id, track_id, position_ms, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (work_id) DO UPDATE SET
       track_id = excluded.track_id,
       position_ms = excluded.position_ms,
       updated_at = excluded.updated_at`,
  ).run(input.workId, input.trackId ?? null, Math.max(0, Math.round(input.positionMs)), now);
}

export function getPlayback(db: DatabaseSync, workId: number): PlaybackStateRecord | null {
  const row = db
    .prepare('SELECT work_id, track_id, position_ms, updated_at FROM playback_states WHERE work_id = ?')
    .get(workId) as Row | undefined;
  if (!row) {
    return null;
  }
  return {
    workId: num(row, 'work_id'),
    trackId: nullableNum(row, 'track_id'),
    positionMs: num(row, 'position_ms'),
    updatedAt: text(row, 'updated_at'),
  };
}

export interface RecentPlayback {
  workId: number;
  code: string;
  title: string;
  trackId: number | null;
  trackTitle: string;
  positionMs: number;
  updatedAt: string;
  coverAssetId: number | null;
}

export function listRecentPlayback(db: DatabaseSync, limit: number): RecentPlayback[] {
  const rows = db
    .prepare(
      `SELECT p.work_id, p.track_id, p.position_ms, p.updated_at,
              w.code, w.title, COALESCE(t.title, '') AS track_title,
              wa.asset_id AS cover_asset_id
       FROM playback_states p
       JOIN works w ON w.id = p.work_id
       LEFT JOIN tracks t ON t.id = p.track_id
       LEFT JOIN work_assets wa ON wa.work_id = w.id AND wa.role = 'cover'
       ORDER BY p.updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as Row[];
  return rows.map((row) => ({
    workId: num(row, 'work_id'),
    code: text(row, 'code'),
    title: text(row, 'title'),
    trackId: nullableNum(row, 'track_id'),
    trackTitle: text(row, 'track_title'),
    positionMs: num(row, 'position_ms'),
    updatedAt: text(row, 'updated_at'),
    coverAssetId: nullableNum(row, 'cover_asset_id'),
  }));
}

export interface OnlinePlaybackState {
  remoteWorkId: number;
  code: string;
  trackHash: string;
  trackIndex: number;
  positionMs: number;
  updatedAt: string;
}

export function saveOnlinePlayback(
  db: DatabaseSync,
  input: {
    provider: string;
    remoteWorkId: number;
    code: string;
    trackHash: string;
    trackIndex: number;
    positionMs: number;
  },
): OnlinePlaybackState {
  const now = new Date().toISOString();
  const positionMs = Math.max(0, Math.round(input.positionMs));
  db.prepare(
    `INSERT INTO online_playback_states
       (provider, remote_work_id, code, track_hash, track_index, position_ms, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider, remote_work_id) DO UPDATE SET
       code = excluded.code,
       track_hash = excluded.track_hash,
       track_index = excluded.track_index,
       position_ms = excluded.position_ms,
       updated_at = excluded.updated_at`,
  ).run(
    input.provider,
    input.remoteWorkId,
    input.code,
    input.trackHash,
    Math.max(0, Math.round(input.trackIndex)),
    positionMs,
    now,
  );
  return {
    remoteWorkId: input.remoteWorkId,
    code: input.code,
    trackHash: input.trackHash,
    trackIndex: Math.max(0, Math.round(input.trackIndex)),
    positionMs,
    updatedAt: now,
  };
}

export function getOnlinePlayback(
  db: DatabaseSync,
  provider: string,
  remoteWorkId: number,
): OnlinePlaybackState | null {
  const row = db
    .prepare(
      `SELECT remote_work_id, code, track_hash, track_index, position_ms, updated_at
       FROM online_playback_states
       WHERE provider = ? AND remote_work_id = ?`,
    )
    .get(provider, remoteWorkId) as Row | undefined;
  if (!row) {
    return null;
  }
  return {
    remoteWorkId: num(row, 'remote_work_id'),
    code: text(row, 'code'),
    trackHash: text(row, 'track_hash'),
    trackIndex: num(row, 'track_index'),
    positionMs: num(row, 'position_ms'),
    updatedAt: text(row, 'updated_at'),
  };
}

export function getSetting<T>(db: DatabaseSync, key: string, fallback: T): T {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as
    | Row
    | undefined;
  if (!row) {
    return fallback;
  }
  try {
    return JSON.parse(text(row, 'value_json')) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(db: DatabaseSync, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO settings (key, value_json) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
  ).run(key, JSON.stringify(value));
}

export function deleteSetting(db: DatabaseSync, key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

export interface OnlineAccountRecord {
  provider: string;
  username: string;
  tokenEnc: string;
  updatedAt: string;
}

export function getOnlineAccount(
  db: DatabaseSync,
  provider: string,
): OnlineAccountRecord | null {
  const row = db
    .prepare(
      'SELECT provider, username, token_enc, updated_at FROM online_accounts WHERE provider = ?',
    )
    .get(provider) as Row | undefined;
  if (!row) {
    return null;
  }
  return {
    provider: text(row, 'provider'),
    username: text(row, 'username'),
    tokenEnc: text(row, 'token_enc'),
    updatedAt: text(row, 'updated_at'),
  };
}

export function saveOnlineAccount(
  db: DatabaseSync,
  input: { provider: string; username: string; tokenEnc: string },
): void {
  db.prepare(
    `INSERT INTO online_accounts (provider, username, token_enc, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (provider) DO UPDATE SET
       username = excluded.username,
       token_enc = excluded.token_enc,
       updated_at = excluded.updated_at`,
  ).run(input.provider, input.username, input.tokenEnc, new Date().toISOString());
}

export function deleteOnlineAccount(db: DatabaseSync, provider: string): void {
  db.prepare('DELETE FROM online_accounts WHERE provider = ?').run(provider);
}

export interface UpdateWorkMetadataInput {
  title: string;
  circle: string;
  releaseDate: string;
  workType: string;
  tags: string[];
  metadataStatus: string;
}

export interface ManualWorkMetadataInput {
  title: string;
  circle: string;
  releaseDate: string;
  workType: string;
  tags: string[];
  vas: string[];
  rating: number | null;
  priceYen: number | null;
}

export function updateWorkManualMetadata(
  db: DatabaseSync,
  workId: number,
  input: ManualWorkMetadataInput,
): void {
  db.prepare(
    `UPDATE works
     SET title = ?, circle = ?, release_date = ?, work_type = ?, tags_json = ?,
         vas_json = ?, rating = ?, price_yen = ?, metadata_status = 'manual', updated_at = ?
     WHERE id = ?`,
  ).run(
    input.title,
    input.circle,
    input.releaseDate,
    input.workType,
    JSON.stringify(input.tags),
    JSON.stringify(input.vas),
    input.rating,
    input.priceYen,
    new Date().toISOString(),
    workId,
  );
}

export function updateWorkMetadata(
  db: DatabaseSync,
  workId: number,
  input: UpdateWorkMetadataInput,
): void {
  db.prepare(
    `UPDATE works
     SET title = ?, circle = ?, release_date = ?, work_type = ?, tags_json = ?,
         metadata_status = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.title,
    input.circle,
    input.releaseDate,
    input.workType,
    JSON.stringify(input.tags),
    input.metadataStatus,
    new Date().toISOString(),
    workId,
  );
}

export interface SidecarWorkMetadataInput {
  title: string;
  circle: string;
  releaseDate: string;
  workType: string;
  tags: string[];
  vas: string[];
  rating: number | null;
  priceYen: number | null;
}

// sidecar 只覆盖自己提供的非空字段，避免空值抹掉已有刮削结果。
export function applySidecarMetadata(
  db: DatabaseSync,
  workId: number,
  input: SidecarWorkMetadataInput,
): void {
  const tagsJson = JSON.stringify(input.tags);
  const vasJson = JSON.stringify(input.vas);
  db.prepare(
    `UPDATE works SET
       title = CASE WHEN ? <> '' THEN ? ELSE title END,
       circle = CASE WHEN ? <> '' THEN ? ELSE circle END,
       release_date = CASE WHEN ? <> '' THEN ? ELSE release_date END,
       work_type = CASE WHEN ? <> '' THEN ? ELSE work_type END,
       tags_json = CASE WHEN ? <> '[]' THEN ? ELSE tags_json END,
       vas_json = CASE WHEN ? <> '[]' THEN ? ELSE vas_json END,
       rating = COALESCE(?, rating),
       price_yen = COALESCE(?, price_yen),
       metadata_status = CASE WHEN metadata_status = 'manual' THEN 'manual' ELSE 'sidecar' END,
       updated_at = ?
     WHERE id = ?`,
  ).run(
    input.title,
    input.title,
    input.circle,
    input.circle,
    input.releaseDate,
    input.releaseDate,
    input.workType,
    input.workType,
    tagsJson,
    tagsJson,
    vasJson,
    vasJson,
    input.rating,
    input.priceYen,
    new Date().toISOString(),
    workId,
  );
}

export interface WorkTrackFileName {
  trackId: number;
  fileName: string;
}

export function listWorkTrackFileNames(db: DatabaseSync, workId: number): WorkTrackFileName[] {
  const rows = db
    .prepare(
      `SELECT t.id AS track_id, f.path
       FROM tracks t
       JOIN storage_files f ON f.id = t.storage_file_id
       WHERE t.work_id = ?`,
    )
    .all(workId) as Row[];
  return rows.map((row) => ({
    trackId: num(row, 'track_id'),
    fileName: text(row, 'path').split('/').pop() ?? '',
  }));
}

export interface WorkSourceRecord {
  provider: string;
  sourceId: string;
  sourceUrl: string;
  rawJson: string;
  fetchedAt: string;
}

export function upsertWorkSource(
  db: DatabaseSync,
  input: {
    workId: number;
    provider: string;
    sourceId: string;
    sourceUrl: string;
    raw: unknown;
  },
): void {
  db.prepare(
    `INSERT INTO work_sources (work_id, provider, source_id, source_url, raw_json, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (work_id, provider) DO UPDATE SET
       source_id = excluded.source_id,
       source_url = excluded.source_url,
       raw_json = excluded.raw_json,
       fetched_at = excluded.fetched_at`,
  ).run(
    input.workId,
    input.provider,
    input.sourceId,
    input.sourceUrl,
    JSON.stringify(input.raw),
    new Date().toISOString(),
  );
}

export function getWorkSource(
  db: DatabaseSync,
  workId: number,
  provider: string,
): WorkSourceRecord | null {
  const row = db
    .prepare(
      `SELECT provider, source_id, source_url, raw_json, fetched_at
       FROM work_sources WHERE work_id = ? AND provider = ?`,
    )
    .get(workId, provider) as Row | undefined;
  if (!row) {
    return null;
  }
  return {
    provider: text(row, 'provider'),
    sourceId: text(row, 'source_id'),
    sourceUrl: text(row, 'source_url'),
    rawJson: text(row, 'raw_json'),
    fetchedAt: text(row, 'fetched_at'),
  };
}

export interface ScrapeWorkItem {
  id: number;
  code: string;
  title: string;
  circle: string;
  releaseDate: string;
  workType: string;
  tags: string[];
  metadataStatus: string;
}

export function listWorksForScrape(
  db: DatabaseSync,
  rootPath = '',
): ScrapeWorkItem[] {
  const rows = (rootPath
    ? db
        .prepare(
          `SELECT w.id, w.code, w.title, w.circle, w.release_date, w.work_type,
                  w.tags_json, w.metadata_status
           FROM works w
           JOIN storage_roots r ON r.id = w.root_id
           WHERE lower(rtrim(replace(r.path, '\\', '/'), '/')) =
                 lower(rtrim(replace(?, '\\', '/'), '/'))
           ORDER BY w.id`,
        )
        .all(rootPath)
    : db
        .prepare(
          `SELECT id, code, title, circle, release_date, work_type, tags_json, metadata_status
           FROM works ORDER BY id`,
        )
        .all()) as Row[];
  return rows.map((row) => ({
    id: num(row, 'id'),
    code: text(row, 'code'),
    title: text(row, 'title'),
    circle: text(row, 'circle'),
    releaseDate: text(row, 'release_date'),
    workType: text(row, 'work_type'),
    tags: parseTags(text(row, 'tags_json')),
    metadataStatus: text(row, 'metadata_status') || 'local',
  }));
}

export interface AssetRecord {
  id: number;
  sha256: string;
  kind: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  path: string;
  createdAt: string;
}

export interface InsertAssetInput {
  sha256: string;
  kind: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  path: string;
}

export function upsertAsset(db: DatabaseSync, input: InsertAssetInput): number {
  const existing = db
    .prepare('SELECT id FROM assets WHERE sha256 = ?')
    .get(input.sha256) as Row | undefined;
  if (existing) {
    return num(existing, 'id');
  }
  const result = db
    .prepare(
      `INSERT INTO assets (sha256, kind, mime, bytes, width, height, path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.sha256,
      input.kind,
      input.mime,
      input.bytes,
      input.width,
      input.height,
      input.path,
      new Date().toISOString(),
    );
  return Number(result.lastInsertRowid);
}

export function getAsset(db: DatabaseSync, assetId: number): AssetRecord | null {
  const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as Row | undefined;
  if (!row) {
    return null;
  }
  return {
    id: num(row, 'id'),
    sha256: text(row, 'sha256'),
    kind: text(row, 'kind'),
    mime: text(row, 'mime'),
    bytes: num(row, 'bytes'),
    width: nullableNum(row, 'width'),
    height: nullableNum(row, 'height'),
    path: text(row, 'path'),
    createdAt: text(row, 'created_at'),
  };
}

export function linkWorkAsset(
  db: DatabaseSync,
  input: { workId: number; role: string; assetId: number; source: string; originUrl: string },
): void {
  db.prepare(
    `INSERT INTO work_assets (work_id, role, asset_id, source, origin_url, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (work_id, role) DO UPDATE SET
       asset_id = excluded.asset_id,
       source = excluded.source,
       origin_url = excluded.origin_url,
       updated_at = excluded.updated_at`,
  ).run(
    input.workId,
    input.role,
    input.assetId,
    input.source,
    input.originUrl,
    new Date().toISOString(),
  );
}

export function getWorkAsset(
  db: DatabaseSync,
  workId: number,
  role: string,
): (AssetRecord & { source: string; originUrl: string }) | null {
  const row = db
    .prepare(
      `SELECT a.*, wa.source, wa.origin_url
       FROM work_assets wa
       JOIN assets a ON a.id = wa.asset_id
       WHERE wa.work_id = ? AND wa.role = ?`,
    )
    .get(workId, role) as Row | undefined;
  if (!row) {
    return null;
  }
  const asset = getAssetRow(row);
  return { ...asset, source: text(row, 'source'), originUrl: text(row, 'origin_url') };
}

function getAssetRow(row: Row): AssetRecord {
  return {
    id: num(row, 'id'),
    sha256: text(row, 'sha256'),
    kind: text(row, 'kind'),
    mime: text(row, 'mime'),
    bytes: num(row, 'bytes'),
    width: nullableNum(row, 'width'),
    height: nullableNum(row, 'height'),
    path: text(row, 'path'),
    createdAt: text(row, 'created_at'),
  };
}

export interface ScrapeCacheRecord {
  provider: string;
  key: string;
  status: string;
  error: string;
  expiresAt: string;
  updatedAt: string;
}

export function getScrapeCache(
  db: DatabaseSync,
  provider: string,
  key: string,
): ScrapeCacheRecord | null {
  const row = db
    .prepare(
      `SELECT provider, cache_key, status, error, expires_at, updated_at
       FROM scrape_cache WHERE provider = ? AND cache_key = ?`,
    )
    .get(provider, key) as Row | undefined;
  if (!row) {
    return null;
  }
  const expiresAt = text(row, 'expires_at');
  if (expiresAt && expiresAt < new Date().toISOString()) {
    db.prepare('DELETE FROM scrape_cache WHERE provider = ? AND cache_key = ?').run(provider, key);
    return null;
  }
  return {
    provider: text(row, 'provider'),
    key: text(row, 'cache_key'),
    status: text(row, 'status'),
    error: text(row, 'error'),
    expiresAt,
    updatedAt: text(row, 'updated_at'),
  };
}

export function putScrapeCache(
  db: DatabaseSync,
  input: { provider: string; key: string; status: string; error?: string; ttlMs: number },
): void {
  const now = new Date();
  db.prepare(
    `INSERT INTO scrape_cache (provider, cache_key, status, error, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider, cache_key) DO UPDATE SET
       status = excluded.status,
       error = excluded.error,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`,
  ).run(
    input.provider,
    input.key,
    input.status,
    input.error ?? '',
    new Date(now.getTime() + input.ttlMs).toISOString(),
    now.toISOString(),
  );
}

export function clearScrapeCache(db: DatabaseSync, provider: string, key: string): void {
  db.prepare('DELETE FROM scrape_cache WHERE provider = ? AND cache_key = ?').run(provider, key);
}

export interface TrackProbeTarget {
  trackId: number;
  title: string;
  relativePath: string;
  rootPath: string;
  size: number;
  mtimeMs: number;
  durationMs: number | null;
  probeError: string;
}

export function listProbeTargets(db: DatabaseSync, workId: number): TrackProbeTarget[] {
  const rows = db
    .prepare(
      `SELECT t.id AS track_id, t.title, t.duration_ms, t.probe_error,
              f.path, f.size, f.mtime_ms, r.path AS root_path
       FROM tracks t
       JOIN storage_files f ON f.id = t.storage_file_id
       JOIN storage_roots r ON r.id = f.root_id
       WHERE t.work_id = ?
       ORDER BY t.disc, t.idx, t.id`,
    )
    .all(workId) as Row[];
  return rows.map((row) => ({
    trackId: num(row, 'track_id'),
    title: text(row, 'title'),
    relativePath: text(row, 'path'),
    rootPath: text(row, 'root_path'),
    size: num(row, 'size'),
    mtimeMs: num(row, 'mtime_ms'),
    durationMs: nullableNum(row, 'duration_ms'),
    probeError: text(row, 'probe_error'),
  }));
}

export function setTrackDuration(db: DatabaseSync, trackId: number, durationMs: number): void {
  db.prepare('UPDATE tracks SET duration_ms = ?, probe_error = ? WHERE id = ?').run(
    Math.max(0, Math.round(durationMs)),
    '',
    trackId,
  );
}

export function setTrackProbeError(db: DatabaseSync, trackId: number, error: string): void {
  db.prepare('UPDATE tracks SET probe_error = ? WHERE id = ?').run(error, trackId);
}
