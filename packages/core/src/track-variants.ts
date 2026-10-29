const INDEX_PREFIX = /^(?:(?:disc|cd|ディスク)\s*\d{1,3}|\d{1,3})[\s._-]+/i;
const DISC_SEGMENT = /^(?:disc|cd|ディスク)\s*\d{1,3}$/i;
const GENERIC_SEGMENTS = new Set(['track', 'tracks', 'audio', 'sound', '音声']);

function normalize(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function segmentsUnderWork(relativePath: string, workPath: string): string[] {
  const filePath = normalize(relativePath);
  const root = normalize(workPath);
  const subPath =
    root && (filePath === root || filePath.startsWith(`${root}/`))
      ? filePath.slice(root.length).replace(/^\/+/, '')
      : filePath;
  const segments = subPath.split('/').filter(Boolean);
  segments.pop();
  return segments;
}

/**
 * 从作品目录下的文件夹名生成轨道变体标签。
 * 例如 `1.本編/2.SEなし` → `['本編', 'SEなし']`，`mp3` → `['mp3']`。
 * 只用于展示与筛选，不写入数据库。
 */
export function trackVariants(relativePath: string, workPath: string): string[] {
  const variants: string[] = [];
  const seen = new Set<string>();
  for (const raw of segmentsUnderWork(relativePath, workPath)) {
    const segment = raw.trim();
    if (!segment || DISC_SEGMENT.test(segment)) {
      continue;
    }
    const label = segment.replace(INDEX_PREFIX, '').trim();
    if (!label || /^\d+$/.test(label)) {
      continue;
    }
    const key = label.toLowerCase();
    if (GENERIC_SEGMENTS.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    variants.push(label);
    if (variants.length >= 4) {
      break;
    }
  }
  return variants;
}
