import type { DatabaseSync } from 'node:sqlite';
import { probeAudioDuration } from './ffmpeg.js';
import { resolveLibraryFile } from './paths.js';
import { listProbeTargets, setTrackDuration, setTrackProbeError } from './repository.js';

export interface ProbeWorkResult {
  workId: number;
  total: number;
  updated: number;
  failed: number;
  skipped: number;
}

export interface ProbeWorkOptions {
  ffprobePath: string;
  concurrency?: number;
  force?: boolean;
}

export async function probeWorkDurations(
  db: DatabaseSync,
  workId: number,
  options: ProbeWorkOptions,
): Promise<ProbeWorkResult> {
  const targets = listProbeTargets(db, workId);
  const pending = targets.filter(
    (target) => options.force || target.durationMs === null || target.durationMs <= 0,
  );
  const skipped = targets.length - pending.length;
  if (pending.length === 0) {
    return { workId, total: targets.length, updated: 0, failed: 0, skipped };
  }

  const concurrency = Math.max(1, Math.min(4, options.concurrency ?? 2));
  let cursor = 0;
  let updated = 0;
  let failed = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const target = pending[index];
      if (!target) {
        return;
      }
      const resolved = await resolveLibraryFile(target.rootPath, target.relativePath);
      if (!resolved) {
        setTrackProbeError(db, target.trackId, '文件不存在或不可访问');
        failed += 1;
        continue;
      }
      const probed = await probeAudioDuration(options.ffprobePath, resolved.absolutePath);
      if (probed.durationMs && probed.durationMs > 0) {
        setTrackDuration(db, target.trackId, probed.durationMs);
        updated += 1;
      } else {
        setTrackProbeError(db, target.trackId, probed.error || '无法读取时长');
        failed += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
  return { workId, total: targets.length, updated, failed, skipped };
}
