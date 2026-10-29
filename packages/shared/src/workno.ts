export type WorkCodeType = 'RJ' | 'BJ' | 'VJ';

export interface WorknoMatch {
  code: string;
  type: WorkCodeType;
  digits: string;
}

const WORKNO_PATTERN = /(?:^|[^A-Z0-9])([RBV]J)(\d{6,8})(?!\d)/i;

export function isWorkCodeType(value: string): value is WorkCodeType {
  return value === 'RJ' || value === 'BJ' || value === 'VJ';
}

export function parseWorkno(value: string): WorknoMatch | null {
  const match = WORKNO_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const prefix = (match[1] ?? '').toUpperCase();
  const digits = match[2] ?? '';
  if (!isWorkCodeType(prefix) || !digits) {
    return null;
  }
  return { code: `${prefix}${digits}`, type: prefix, digits };
}

export function normalizeWorkno(value: string): string {
  return parseWorkno(value)?.code ?? '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseWorkTitle(directoryName: string, code: string): string {
  const pattern = new RegExp(`[\\[【(（]?\\s*${escapeRegExp(code)}\\s*[\\]】)）]?`, 'i');
  const title = directoryName
    .replace(pattern, ' ')
    .replace(/^[\s._\-–—]+|[\s._\-–—]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return title || code;
}
