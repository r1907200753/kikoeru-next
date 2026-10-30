import { spawn } from 'node:child_process';

export interface BinaryResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  error: string;
}

export function runBinary(
  binary: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<BinaryResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: BinaryResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let child;
    try {
      child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({
        ok: false,
        code: null,
        stdout: '',
        stderr: '',
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, code: null, stdout, stderr, error: '执行超时' });
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      finish({ ok: false, code: null, stdout, stderr, error: error.message });
    });
    child.on('close', (code) => {
      finish({ ok: code === 0, code, stdout, stderr, error: '' });
    });
  });
}

export interface ProbeDurationResult {
  durationMs: number | null;
  error: string;
}

export async function probeAudioDuration(
  ffprobePath: string,
  filePath: string,
): Promise<ProbeDurationResult> {
  const result = await runBinary(
    ffprobePath,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      filePath,
    ],
    20_000,
  );
  if (!result.ok) {
    return {
      durationMs: null,
      error: result.error || result.stderr.trim().slice(0, 300) || `ffprobe 退出码 ${result.code}`,
    };
  }
  try {
    const parsed = JSON.parse(result.stdout) as { format?: { duration?: unknown } };
    const seconds = Number(parsed.format?.duration);
    if (Number.isFinite(seconds) && seconds > 0) {
      return { durationMs: Math.round(seconds * 1000), error: '' };
    }
    return { durationMs: null, error: 'ffprobe 未返回有效时长' };
  } catch {
    return { durationMs: null, error: 'ffprobe 输出不是合法 JSON' };
  }
}

export async function generateWebpVariant(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  width: number,
): Promise<boolean> {
  const result = await runBinary(
    ffmpegPath,
    [
      '-y',
      '-v',
      'error',
      '-i',
      inputPath,
      '-vf',
      `scale=${width}:-2:flags=lanczos`,
      '-frames:v',
      '1',
      '-c:v',
      'libwebp',
      '-quality',
      '82',
      outputPath,
    ],
    30_000,
  );
  return result.ok;
}
