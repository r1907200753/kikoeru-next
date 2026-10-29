export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0:00';
  }
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '—';
  }
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatRelative(iso: string): string {
  if (!iso) {
    return '';
  }
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) {
    return '';
  }
  const diff = Date.now() - time;
  if (diff < 60_000) {
    return '刚刚';
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)} 分钟前`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)} 小时前`;
  }
  if (diff < 7 * 86_400_000) {
    return `${Math.floor(diff / 86_400_000)} 天前`;
  }
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

export function coverPalette(code: string): { from: string; to: string; ink: string } {
  let hash = 0;
  for (const char of code) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return {
    from: `hsl(${hash} 76% 90%)`,
    to: `hsl(${(hash + 46) % 360} 60% 73%)`,
    ink: `hsl(${hash} 44% 25%)`,
  };
}
