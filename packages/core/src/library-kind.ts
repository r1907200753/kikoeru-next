import { execFile } from 'node:child_process';

export type LibraryKind = 'local' | 'mounted';

const MOUNT_PREFIX = /^\/(?:mnt|media|Volumes)\//i;

export function classifyLibraryPath(
  value: string,
  platform: NodeJS.Platform = process.platform,
): LibraryKind {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'local';
  }
  if (trimmed.startsWith('\\\\') || trimmed.startsWith('//')) {
    return 'mounted';
  }
  if (platform === 'win32') {
    return /^[a-zA-Z]:/.test(trimmed) ? 'local' : 'mounted';
  }
  return MOUNT_PREFIX.test(trimmed) ? 'mounted' : 'local';
}

function systemDrive(): string {
  return (process.env.SystemDrive ?? 'C:').slice(0, 1).toUpperCase();
}

export function detectLibraryKind(
  rootPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<LibraryKind> {
  const base = classifyLibraryPath(rootPath, platform);
  if (base === 'mounted' || platform !== 'win32') {
    return Promise.resolve(base);
  }
  const drive = /^([a-zA-Z]):/.exec(rootPath.trim())?.[1]?.toUpperCase();
  if (!drive || drive === systemDrive()) {
    return Promise.resolve('local');
  }
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `if (Get-Partition -DriveLetter '${drive}' -ErrorAction SilentlyContinue) { 'local' } else { 'mounted' }`,
      ],
      { timeout: 3000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(base);
          return;
        }
        resolve(stdout.trim().toLowerCase() === 'local' ? 'local' : 'mounted');
      },
    );
  });
}
