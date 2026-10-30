import path from 'node:path';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus']);
const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.m4v',
  '.webm',
  '.mkv',
  '.mov',
  '.avi',
  '.wmv',
  '.flv',
  '.ogv',
  '.ts',
]);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);
const SUBTITLE_EXTENSIONS = new Set([
  '.vtt',
  '.srt',
  '.lrc',
  '.ass',
  '.ssa',
  '.sub',
  '.sbv',
  '.smi',
  '.txt',
]);

const MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.ogv': 'video/ogg',
  '.ts': 'video/mp2t',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.vtt': 'text/vtt; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.lrc': 'text/plain; charset=utf-8',
  '.ass': 'text/plain; charset=utf-8',
  '.ssa': 'text/plain; charset=utf-8',
  '.sub': 'text/plain; charset=utf-8',
  '.sbv': 'text/plain; charset=utf-8',
  '.smi': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export type MediaFileKind = 'audio' | 'video' | 'image' | 'subtitle' | 'other';

const collator = new Intl.Collator(['ja', 'zh', 'en'], { numeric: true, sensitivity: 'base' });

export function isAudioFileName(name: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase());
}

export function isVideoFileName(name: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase());
}

export function isImageFileName(name: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

export function isSubtitleFileName(name: string): boolean {
  return SUBTITLE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

export function fileKindForName(name: string): MediaFileKind {
  if (isAudioFileName(name)) {
    return 'audio';
  }
  if (isVideoFileName(name)) {
    return 'video';
  }
  if (isImageFileName(name)) {
    return 'image';
  }
  if (isSubtitleFileName(name)) {
    return 'subtitle';
  }
  return 'other';
}

export function mimeTypeForFileName(name: string): string {
  return MIME_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
}

export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}
