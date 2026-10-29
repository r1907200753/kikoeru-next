import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  applySidecarMetadata,
  listWorkTrackFileNames,
  setTrackDuration,
} from './repository.js';

export const SIDECAR_FILE = 'metadata.json';

export interface ExportSidecarTrack {
  index: number;
  disc: number;
  groupTitle: string;
  title: string;
  file: string;
  durationMs: number | null;
  size: number;
}

export interface ExportSidecar {
  schema: number;
  exportedAt: string;
  source: {
    provider: string;
    workId: number;
    code: string;
    url: string;
  };
  work: {
    code: string;
    title: string;
    circle: string;
    releaseDate: string;
    workType: string;
    tags: string[];
    vas: string[];
    rating: number | null;
    priceYen: number | null;
    durationMs: number | null;
    cover: string;
  };
  tracks: ExportSidecarTrack[];
}

function pickString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pickStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

function normalizeSidecar(value: unknown): ExportSidecar | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const work = record.work;
  if (!work || typeof work !== 'object' || Array.isArray(work)) {
    return null;
  }
  const workRecord = work as Record<string, unknown>;
  const tracks = Array.isArray(record.tracks)
    ? record.tracks
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => ({
          index: Math.trunc(pickNumber(item.index) ?? 0),
          disc: Math.max(1, Math.trunc(pickNumber(item.disc) ?? 1)),
          groupTitle: pickString(item.groupTitle),
          title: pickString(item.title),
          file: pickString(item.file),
          durationMs: pickNumber(item.durationMs),
          size: Math.trunc(pickNumber(item.size) ?? 0),
        }))
    : [];
  return {
    schema: Math.trunc(pickNumber(record.schema) ?? 1),
    exportedAt: pickString(record.exportedAt),
    source: {
      provider: pickString((record.source as Record<string, unknown> | undefined)?.provider),
      workId: Math.trunc(
        pickNumber((record.source as Record<string, unknown> | undefined)?.workId) ?? 0,
      ),
      code: pickString((record.source as Record<string, unknown> | undefined)?.code),
      url: pickString((record.source as Record<string, unknown> | undefined)?.url),
    },
    work: {
      code: pickString(workRecord.code),
      title: pickString(workRecord.title),
      circle: pickString(workRecord.circle),
      releaseDate: pickString(workRecord.releaseDate),
      workType: pickString(workRecord.workType),
      tags: pickStringList(workRecord.tags),
      vas: pickStringList(workRecord.vas),
      rating: pickNumber(workRecord.rating),
      priceYen: pickNumber(workRecord.priceYen),
      durationMs: pickNumber(workRecord.durationMs),
      cover: pickString(workRecord.cover),
    },
    tracks,
  };
}

export async function readExportSidecar(workDir: string): Promise<ExportSidecar | null> {
  try {
    const raw = await fs.readFile(path.join(workDir, SIDECAR_FILE), 'utf8');
    return normalizeSidecar(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function applySidecarToWork(
  db: DatabaseSync,
  workId: number,
  sidecar: ExportSidecar,
): void {
  applySidecarMetadata(db, workId, {
    title: sidecar.work.title,
    circle: sidecar.work.circle,
    releaseDate: sidecar.work.releaseDate,
    workType: sidecar.work.workType,
    tags: sidecar.work.tags,
    vas: sidecar.work.vas,
    rating: sidecar.work.rating,
    priceYen: sidecar.work.priceYen,
  });

  const trackIds = new Map(
    listWorkTrackFileNames(db, workId).map((row) => [row.fileName, row.trackId]),
  );
  for (const track of sidecar.tracks) {
    if (!track.file || track.durationMs === null || track.durationMs <= 0) {
      continue;
    }
    const trackId = trackIds.get(track.file);
    if (trackId) {
      setTrackDuration(db, trackId, track.durationMs);
    }
  }
}
