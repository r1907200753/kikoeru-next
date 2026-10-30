import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS storage_roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (kind, path)
);

CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  code_type TEXT NOT NULL,
  title TEXT NOT NULL,
  circle TEXT NOT NULL DEFAULT '',
  release_date TEXT NOT NULL DEFAULT '',
  metadata_status TEXT NOT NULL DEFAULT 'local',
  relative_path TEXT NOT NULL,
  root_id INTEGER NOT NULL REFERENCES storage_roots(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_works_title ON works(title);
CREATE INDEX IF NOT EXISTS idx_works_root ON works(root_id);

CREATE TABLE IF NOT EXISTS storage_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id INTEGER NOT NULL REFERENCES storage_roots(id) ON DELETE CASCADE,
  work_id INTEGER REFERENCES works(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (root_id, path)
);

CREATE INDEX IF NOT EXISTS idx_storage_files_work ON storage_files(work_id);

CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  storage_file_id INTEGER NOT NULL REFERENCES storage_files(id) ON DELETE CASCADE,
  disc INTEGER NOT NULL DEFAULT 1,
  idx INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  duration_ms INTEGER,
  sort_key TEXT NOT NULL DEFAULT '',
  UNIQUE (work_id, storage_file_id)
);

CREATE INDEX IF NOT EXISTS idx_tracks_work ON tracks(work_id);

CREATE TABLE IF NOT EXISTS playback_states (
  work_id INTEGER PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
  track_id INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
  position_ms INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  progress REAL NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const SCHEMA_V2 = `
ALTER TABLE works ADD COLUMN work_type TEXT NOT NULL DEFAULT '';
ALTER TABLE works ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE tracks ADD COLUMN probe_error TEXT NOT NULL DEFAULT '';

ALTER TABLE jobs ADD COLUMN result_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS work_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  source_id TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '{}',
  fetched_at TEXT NOT NULL,
  UNIQUE (work_id, provider)
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sha256 TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_assets (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT '',
  origin_url TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (work_id, role)
);

CREATE INDEX IF NOT EXISTS idx_work_assets_asset ON work_assets(asset_id);

CREATE TABLE IF NOT EXISTS scrape_cache (
  provider TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, cache_key)
);
`;

const SCHEMA_V3 = `
ALTER TABLE works ADD COLUMN rating REAL;
ALTER TABLE works ADD COLUMN price_yen INTEGER;
ALTER TABLE works ADD COLUMN vas_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE works ADD COLUMN favorite_at TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_works_favorite ON works(favorite_at);

CREATE TABLE IF NOT EXISTS online_accounts (
  provider TEXT PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',
  token_enc TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
`;

const SCHEMA_V4 = `
CREATE TABLE IF NOT EXISTS export_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  remote_work_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  target_root_path TEXT NOT NULL,
  target_relative_path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  track_total INTEGER NOT NULL DEFAULT 0,
  track_completed INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  state_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs(status);
CREATE INDEX IF NOT EXISTS idx_export_jobs_code ON export_jobs(code);
`;

const SCHEMA_V5 = `
CREATE TABLE IF NOT EXISTS online_playback_states (
  provider TEXT NOT NULL,
  remote_work_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  track_hash TEXT NOT NULL,
  track_index INTEGER NOT NULL DEFAULT 0,
  position_ms INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, remote_work_id)
);

CREATE INDEX IF NOT EXISTS idx_online_playback_updated ON online_playback_states(updated_at);
`;

const SCHEMA_V6 = `
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
`;

const SCHEMA_V7 = `
CREATE TABLE IF NOT EXISTS operation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  message TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  client_ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operation_logs_created ON operation_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_operation_logs_category ON operation_logs(category);
`;

const LATEST_VERSION = 7;

function readSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: unknown } | undefined;
  return Number(row?.user_version ?? 0);
}

function migrate(db: DatabaseSync): void {
  let version = readSchemaVersion(db);
  if (version < 1) {
    db.exec(SCHEMA_V1);
    db.exec('PRAGMA user_version = 1');
    version = 1;
  }
  if (version < 2) {
    db.exec('BEGIN');
    try {
      db.exec(SCHEMA_V2);
      db.exec('PRAGMA user_version = 2');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    version = 2;
  }
  if (version < 3) {
    db.exec('BEGIN');
    try {
      db.exec(SCHEMA_V3);
      db.exec('PRAGMA user_version = 3');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    version = 3;
  }
  if (version < 4) {
    db.exec('BEGIN');
    try {
      db.exec(SCHEMA_V4);
      db.exec('PRAGMA user_version = 4');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    version = 4;
  }
  if (version < 5) {
    db.exec('BEGIN');
    try {
      db.exec(SCHEMA_V5);
      db.exec('PRAGMA user_version = 5');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    version = 5;
  }
  if (version < 6) {
    db.exec('BEGIN');
    try {
      db.exec(SCHEMA_V6);
      db.exec('PRAGMA user_version = 6');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    version = 6;
  }
  if (version < 7) {
    db.exec('BEGIN');
    try {
      db.exec(SCHEMA_V7);
      db.exec('PRAGMA user_version = 7');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    version = 7;
  }
  if (version > LATEST_VERSION) {
    throw new Error(`数据库版本 ${version} 高于当前程序支持的 ${LATEST_VERSION}`);
  }
}

export function openDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}
