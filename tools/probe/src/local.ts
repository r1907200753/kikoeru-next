import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { LocalConfig, ProbeResult } from './types.js';
import { captureProbe, skipped } from './result.js';

const execFileAsync = promisify(execFile);
const AUDIO_PATTERN = /\.(mp3|wav|flac|m4a|aac|ogg|opus|wma|ape|aiff?|wv)$/i;
const WORK_PATTERN = /([RBV]J\d{6,8})(?!\d)/i;

interface WorkDirInfo {
  name: string;
  dirPath: string;
  code: string;
  audioFiles: string[];
  totalFiles: number;
}

interface WorkScan {
  works: WorkDirInfo[];
  discovered: number;
}

const MAX_SCANNED_WORKS = 20;

async function findWorkDirs(root: string): Promise<WorkScan> {
  const topEntries = await fs.readdir(root, { withFileTypes: true });
  const directories = topEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, dirPath: path.join(root, entry.name) }));

  const direct = directories
    .map((entry) => ({ ...entry, match: WORK_PATTERN.exec(entry.name) }))
    .filter((entry) => entry.match)
    .map((entry) => ({
      name: entry.name,
      dirPath: entry.dirPath,
      code: (entry.match?.[1] ?? '').toUpperCase(),
    }));

  if (direct.length > 0) {
    return {
      works: await collectWorkDirs(direct.slice(0, MAX_SCANNED_WORKS)),
      discovered: direct.length,
    };
  }

  const nested: Array<{ name: string; dirPath: string; code: string }> = [];
  for (const top of directories.slice(0, 50)) {
    let children;
    try {
      children = await fs.readdir(top.dirPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (!child.isDirectory()) {
        continue;
      }
      const match = WORK_PATTERN.exec(child.name);
      if (match) {
        nested.push({
          name: `${top.name}/${child.name}`,
          dirPath: path.join(top.dirPath, child.name),
          code: (match[1] ?? '').toUpperCase(),
        });
      }
    }
  }
  return {
    works: await collectWorkDirs(nested.slice(0, MAX_SCANNED_WORKS)),
    discovered: nested.length,
  };
}

async function collectWorkDirs(
  candidates: Array<{ name: string; dirPath: string; code: string }>,
): Promise<WorkDirInfo[]> {
  const results: WorkDirInfo[] = [];
  for (const candidate of candidates) {
    const audioFiles: string[] = [];
    let totalFiles = 0;

    async function walk(directory: string, depth: number): Promise<void> {
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (depth > 0) {
            await walk(path.join(directory, entry.name), depth - 1);
          }
          continue;
        }
        totalFiles += 1;
        const absolute = path.join(directory, entry.name);
        if (AUDIO_PATTERN.test(entry.name) && audioFiles.length < 500) {
          audioFiles.push(absolute);
        }
      }
    }

    await walk(candidate.dirPath, 2);
    results.push({ ...candidate, audioFiles, totalFiles });
  }
  return results;
}

interface FfprobeSummary {
  codec: string;
  durationSeconds: string;
  sampleRate: string;
  channels: string;
  bitRate: string;
  formatName: string;
}

async function ffprobeVersion(ffprobePath: string): Promise<string> {
  const { stdout } = await execFileAsync(ffprobePath, ['-version'], {
    timeout: 15_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return (stdout.split(/\r?\n/)[0] ?? '').trim();
}

async function ffprobeFile(ffprobePath: string, filePath: string): Promise<FfprobeSummary> {
  const { stdout } = await execFileAsync(
    ffprobePath,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration,size,bit_rate,format_name:stream=codec_name,sample_rate,channels',
      '-of',
      'json',
      filePath,
    ],
    { timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 },
  );

  const parsed = JSON.parse(stdout) as {
    format?: Record<string, unknown>;
    streams?: Array<Record<string, unknown>>;
  };
  const format = parsed.format ?? {};
  const stream = parsed.streams?.[0] ?? {};
  const stringOf = (value: unknown): string =>
    typeof value === 'string' || typeof value === 'number' ? String(value) : '';

  return {
    codec: stringOf(stream.codec_name),
    durationSeconds: stringOf(format.duration),
    sampleRate: stringOf(stream.sample_rate),
    channels: stringOf(stream.channels),
    bitRate: stringOf(format.bit_rate),
    formatName: stringOf(format.format_name),
  };
}

function describeFfprobeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return '未找到 ffprobe，请把 ffmpeg 的 bin 目录加入 PATH，或配置 local.ffprobePath';
    }
    if (code === 'ETIMEDOUT' || /timed out/i.test(error.message)) {
      return 'ffprobe 超时（CloudDrive2 挂载盘首次读取可能较慢）';
    }
    return error.message;
  }
  return String(error);
}

export async function detectFfprobe(ffprobePath: string): Promise<string> {
  try {
    return await ffprobeVersion(ffprobePath);
  } catch {
    return '';
  }
}

export async function runLocalProbes(config: LocalConfig): Promise<ProbeResult[]> {
  if (!config.libraryPath) {
    return [skipped('local.library', '未配置 local.libraryPath，跳过挂载盘验证')];
  }

  const root = path.resolve(config.libraryPath);
  const results: ProbeResult[] = [];
  let sampleAudio = '';
  let sampleWork: WorkDirInfo | undefined;

  results.push(
    await captureProbe('local.library', async () => {
      let stats;
      try {
        stats = await fs.stat(root);
      } catch (error) {
        return {
          status: 'fail',
          summary: `无法访问库目录：${error instanceof Error ? error.message : String(error)}`,
          details: { libraryPath: root },
        };
      }
      if (!stats.isDirectory()) {
        return {
          status: 'fail',
          summary: 'local.libraryPath 不是目录',
          details: { libraryPath: root },
        };
      }

      const topEntries = await fs.readdir(root, { withFileTypes: true });
      const scan = await findWorkDirs(root);
      sampleWork = scan.works.slice().sort((a, b) => a.name.localeCompare(b.name))[0];

      const details: Record<string, unknown> = {
        libraryPath: root,
        topLevelEntries: topEntries.length,
        workCount: scan.discovered,
        scannedWorkCount: scan.works.length,
        works: scan.works.slice(0, 10).map((work) => ({
          code: work.code,
          name: work.name,
          totalFiles: work.totalFiles,
          audioFiles: work.audioFiles.length,
        })),
      };

      if (!sampleWork) {
        return {
          status: 'skip',
          summary: `目录可访问，但未发现 RJ/BJ/VJ 作品目录（顶层 ${topEntries.length} 项）`,
          details,
        };
      }

      sampleAudio = sampleWork.audioFiles[0] ?? '';
      details.sampleWork = {
        code: sampleWork.code,
        name: sampleWork.name,
        totalFiles: sampleWork.totalFiles,
        audioFiles: sampleWork.audioFiles.length,
        sampleAudio: sampleAudio ? path.relative(root, sampleAudio) : '',
      };

      if (!sampleAudio) {
        return {
          status: 'skip',
          summary: `发现作品目录 ${sampleWork.name}，但其中没有可识别的音频文件`,
          details,
        };
      }

      const handle = await fs.open(sampleAudio, 'r');
      const startedAt = performance.now();
      try {
        const buffer = Buffer.alloc(64 * 1024);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const elapsedMs = Math.max(1, performance.now() - startedAt);
        details.read = {
          bytes: bytesRead,
          ms: Math.round(elapsedMs),
          mbPerSecond: Number(((bytesRead / 1024 / 1024 / elapsedMs) * 1000).toFixed(2)),
        };
        if (bytesRead === 0) {
          return {
            status: 'fail',
            summary: `样例音频为空文件：${path.relative(root, sampleAudio)}`,
            details,
          };
        }
      } finally {
        await handle.close();
      }

      return {
        status: 'pass',
        summary: `共发现 ${scan.discovered} 个作品目录（抽查 ${scan.works.length} 个）；样例 ${sampleWork.name}（${sampleWork.audioFiles.length} 个音频）可读`,
        details,
      };
    }),
  );

  results.push(
    await captureProbe('local.ffprobe', async () => {
      if (!config.probeFfprobe) {
        return { status: 'skip', summary: 'local.probeFfprobe=false，跳过 ffprobe' };
      }
      if (!sampleAudio) {
        return { status: 'skip', summary: '没有可探测的样例音频' };
      }

      try {
        const version = await ffprobeVersion(config.ffprobePath);
        const summary = await ffprobeFile(config.ffprobePath, sampleAudio);
        return {
          status: summary.codec || summary.durationSeconds ? 'pass' : 'fail',
          summary: `${version || 'ffprobe'}｜${summary.codec || '未知编码'}｜${Number(summary.durationSeconds || 0).toFixed(1)} 秒｜${summary.sampleRate || '?'} Hz｜${summary.channels || '?'} ch`,
          details: {
            ffprobe: config.ffprobePath,
            version,
            file: sampleAudio,
            ...summary,
          },
        };
      } catch (error) {
        return {
          status: 'fail',
          summary: describeFfprobeError(error),
          details: { ffprobe: config.ffprobePath, file: sampleAudio },
        };
      }
    }),
  );

  return results;
}
