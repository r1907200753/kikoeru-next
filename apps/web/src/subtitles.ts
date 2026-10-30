export type SubtitleFormat = 'vtt' | 'srt' | 'lrc' | 'ass' | 'sbv' | 'smi' | 'text';

export interface SubtitleCue {
  startMs: number;
  endMs: number | null;
  text: string;
}

export interface ParsedSubtitle {
  format: SubtitleFormat;
  cues: SubtitleCue[];
  notes: string[];
  plain: string;
}

const FORMAT_LABEL: Record<SubtitleFormat, string> = {
  vtt: 'WebVTT',
  srt: 'SubRip',
  lrc: 'LRC',
  ass: 'ASS/SSA',
  sbv: 'YouTube SBV',
  smi: 'SAMI',
  text: '纯文本',
};

export function subtitleFormatLabel(format: SubtitleFormat): string {
  return FORMAT_LABEL[format];
}

export function decodeSubtitleBuffer(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('gb18030').decode(buffer);
  }
}

const TIME_TOKEN = /(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?/;

export function parseSubtitleTime(token: string): number | null {
  const match = TIME_TOKEN.exec(token.trim());
  if (!match) {
    return null;
  }
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = Number((match[4] ?? '0').padEnd(3, '0').slice(0, 3));
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + fraction;
}

export function formatCueTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function normalizeContent(content: string): string {
  return content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function cleanCueText(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function sortCues(cues: SubtitleCue[]): SubtitleCue[] {
  return cues.sort((a, b) => a.startMs - b.startMs);
}

function finishCues(cues: SubtitleCue[]): SubtitleCue[] {
  const sorted = sortCues(cues);
  for (const cue of sorted) {
    if (cue.endMs !== null && cue.endMs <= cue.startMs) {
      cue.endMs = null;
    }
  }
  return sorted;
}

function parseTimedText(content: string): SubtitleCue[] {
  const blocks = normalizeContent(content).split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trimEnd());
    const head = lines[0]?.trim() ?? '';
    if (!head || /^WEBVTT/i.test(head) || /^NOTE\b/i.test(head)) {
      continue;
    }
    const timeIndex = lines.findIndex((line) => line.includes('-->'));
    if (timeIndex < 0) {
      continue;
    }
    const timeLine = lines[timeIndex] ?? '';
    const parts = timeLine.split('-->');
    const startMs = parseSubtitleTime(parts[0] ?? '');
    if (startMs === null) {
      continue;
    }
    const endText = parts[1];
    const endMs = endText ? parseSubtitleTime(endText) : null;
    const text = cleanCueText(lines.slice(timeIndex + 1).join('\n'));
    if (!text) {
      continue;
    }
    cues.push({ startMs, endMs, text });
  }
  return finishCues(cues);
}

function parseLrc(content: string): { cues: SubtitleCue[]; notes: string[] } {
  const cues: SubtitleCue[] = [];
  const notes: string[] = [];
  const tagPattern = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const metaPattern = /^\[([a-zA-Z#]+):(.*)\]$/;
  const skippedMeta = new Set(['offset', 'by', 're', 've', 'length']);
  for (const raw of normalizeContent(content).split('\n')) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    const times: number[] = [];
    tagPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(line))) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = Number((match[3] ?? '0').padEnd(3, '0').slice(0, 3));
      times.push(((minutes * 60) + seconds) * 1000 + fraction);
    }
    if (times.length > 0) {
      const text = cleanCueText(line.replace(tagPattern, '').replace(/\[[^\]]*\]/g, ''));
      for (const startMs of times) {
        cues.push({ startMs, endMs: null, text });
      }
      continue;
    }
    const meta = metaPattern.exec(line);
    if (meta) {
      const key = (meta[1] ?? '').toLowerCase();
      const value = (meta[2] ?? '').trim();
      if (value && !skippedMeta.has(key)) {
        notes.push(`${key}: ${value}`);
      }
    }
  }
  const sorted = finishCues(cues);
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const cue = sorted[index];
    const next = sorted[index + 1];
    if (cue && next) {
      cue.endMs = next.startMs;
    }
  }
  return { cues: sorted, notes };
}

function splitLimited(value: string, count: number): string[] {
  if (count <= 1) {
    return [value];
  }
  const parts: string[] = [];
  let rest = value;
  for (let index = 0; index < count - 1; index += 1) {
    const comma = rest.indexOf(',');
    if (comma < 0) {
      break;
    }
    parts.push(rest.slice(0, comma));
    rest = rest.slice(comma + 1);
  }
  parts.push(rest);
  return parts;
}

function parseAss(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let inEvents = false;
  let fields: string[] = [];
  for (const raw of normalizeContent(content).split('\n')) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith('[')) {
      inEvents = line.toLowerCase() === '[events]';
      continue;
    }
    if (!inEvents) {
      continue;
    }
    if (/^format\s*:/i.test(line)) {
      fields = line
        .slice(line.indexOf(':') + 1)
        .split(',')
        .map((field) => field.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue\s*:/i.test(line)) {
      continue;
    }
    const payload = line.slice(line.indexOf(':') + 1).trim();
    const defaultFields = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    const order = fields.length > 0 ? fields : defaultFields;
    const values = splitLimited(payload, order.length);
    const valueOf = (name: string) => values[order.indexOf(name)] ?? '';
    const startMs = parseSubtitleTime(valueOf('start'));
    const endMs = parseSubtitleTime(valueOf('end'));
    const text = cleanCueText(valueOf('text').replace(/\\N/gi, '\n').replace(/\\h/gi, ' '));
    if (startMs === null || !text) {
      continue;
    }
    cues.push({ startMs, endMs, text });
  }
  return finishCues(cues);
}

function parseSbv(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const block of normalizeContent(content).split(/\n{2,}/)) {
    const lines = block.split('\n');
    const timeLine = lines[0]?.trim() ?? '';
    const match = /^(\d{1,3}:\d{1,2}:\d{1,2}[.,]\d{1,3})\s*,\s*(\d{1,3}:\d{1,2}:\d{1,2}[.,]\d{1,3})/.exec(timeLine);
    if (!match) {
      continue;
    }
    const startMs = parseSubtitleTime(match[1] ?? '');
    const endMs = parseSubtitleTime(match[2] ?? '');
    const text = cleanCueText(lines.slice(1).join('\n'));
    if (startMs === null || !text) {
      continue;
    }
    cues.push({ startMs, endMs, text });
  }
  return finishCues(cues);
}

function parseSmi(content: string): SubtitleCue[] {
  const source = normalizeContent(content);
  const pattern = /<sync[^>]*\bstart\s*=\s*"?(\d+)"?[^>]*>/gi;
  const marks: Array<{ startMs: number; from: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    marks.push({ startMs: Number(match[1]), from: pattern.lastIndex });
  }
  const cues: SubtitleCue[] = [];
  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index];
    if (!mark) {
      continue;
    }
    const next = marks[index + 1];
    const until = next ? next.from : source.length;
    let slice = source.slice(mark.from, until);
    const nextSync = slice.toLowerCase().indexOf('<sync');
    if (nextSync >= 0) {
      slice = slice.slice(0, nextSync);
    }
    const text = cleanCueText(slice);
    if (!text || !Number.isFinite(mark.startMs)) {
      continue;
    }
    cues.push({
      startMs: mark.startMs,
      endMs: next ? next.startMs : null,
      text,
    });
  }
  return finishCues(cues);
}

function sniffFormat(content: string, extension: string): SubtitleFormat {
  switch (extension) {
    case '.vtt':
      return 'vtt';
    case '.srt':
      return 'srt';
    case '.lrc':
      return 'lrc';
    case '.ass':
    case '.ssa':
      return 'ass';
    case '.sbv':
      return 'sbv';
    case '.smi':
      return 'smi';
    default:
      break;
  }
  const head = normalizeContent(content).trimStart().slice(0, 64).toUpperCase();
  if (head.startsWith('WEBVTT')) {
    return 'vtt';
  }
  if (/^\s*\[events\]/im.test(content)) {
    return 'ass';
  }
  if (/-->/.test(content)) {
    return 'srt';
  }
  if (/^\s*\[\d{1,3}:\d{2}/m.test(content)) {
    return 'lrc';
  }
  if (/^\s*<sync\b/i.test(content)) {
    return 'smi';
  }
  return 'text';
}

export function parseSubtitle(content: string, fileName: string): ParsedSubtitle {
  const extension =
    fileName.lastIndexOf('.') >= 0 ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';
  const format = sniffFormat(content, extension);
  const plain = normalizeContent(content).trim();
  if (format === 'text') {
    return { format, cues: [], notes: [], plain };
  }
  if (format === 'lrc') {
    const lrc = parseLrc(content);
    return { format, cues: lrc.cues, notes: lrc.notes, plain };
  }
  let cues: SubtitleCue[] = [];
  if (format === 'vtt' || format === 'srt') {
    cues = parseTimedText(content);
  } else if (format === 'ass') {
    cues = parseAss(content);
  } else if (format === 'sbv') {
    cues = parseSbv(content);
  } else if (format === 'smi') {
    cues = parseSmi(content);
  }
  return { format, cues, notes: [], plain };
}

export async function fetchSubtitle(url: string, fileName: string): Promise<ParsedSubtitle> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`字幕加载失败（HTTP ${response.status}）`);
  }
  const buffer = await response.arrayBuffer();
  return parseSubtitle(decodeSubtitleBuffer(buffer), fileName);
}

export function findActiveCueIndex(cues: SubtitleCue[], positionMs: number): number {
  let active = -1;
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    if (!cue) {
      break;
    }
    if (cue.startMs > positionMs) {
      break;
    }
    if (cue.endMs === null || positionMs <= cue.endMs + 250) {
      active = index;
    }
  }
  return active;
}
