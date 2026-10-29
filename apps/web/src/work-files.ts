import type { TrackSummary, WorkFileEntry } from './api';
import type { AudioPriority } from './preferences';

export interface FolderEntry {
  name: string;
  path: string;
  fileCount: number;
}

const collator = new Intl.Collator(['ja', 'zh', 'en'], { numeric: true, sensitivity: 'base' });
const SUBTITLE_FORMAT_ORDER = ['.vtt', '.srt', '.lrc', '.ass', '.ssa', '.sbv', '.smi', '.txt'];
const AUDIO_PRIORITY_ORDER: AudioPriority[] = ['mp3', 'flac', 'wav', 'opus', 'm4a', 'aac'];

export function normalizeFolder(folder: string): string {
  return folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

export function dirnameOf(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index < 0 ? '' : filePath.slice(0, index);
}

export function filesInFolder(files: WorkFileEntry[], folder: string): WorkFileEntry[] {
  const target = normalizeFolder(folder);
  return files.filter((file) => dirnameOf(file.path) === target);
}

export function foldersIn(files: WorkFileEntry[], folder: string): FolderEntry[] {
  const target = normalizeFolder(folder);
  const prefix = target ? `${target}/` : '';
  const counts = new Map<string, number>();
  for (const file of files) {
    if (target && !file.path.startsWith(prefix)) {
      continue;
    }
    const rest = target ? file.path.slice(prefix.length) : file.path;
    const slash = rest.indexOf('/');
    if (slash <= 0) {
      continue;
    }
    const name = rest.slice(0, slash);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, fileCount]) => ({
      name,
      path: target ? `${target}/${name}` : name,
      fileCount,
    }))
    .sort((a, b) => collator.compare(a.name, b.name));
}

export function breadcrumbTrail(folder: string): Array<{ name: string; path: string }> {
  const segments = normalizeFolder(folder).split('/').filter(Boolean);
  const trail: Array<{ name: string; path: string }> = [];
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    trail.push({ name: segment, path: current });
  }
  return trail;
}

export function audioFilesOf(files: WorkFileEntry[]): WorkFileEntry[] {
  return files.filter((file) => file.kind === 'audio' && file.trackId !== null);
}

function baseNameOf(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index < 0 ? filePath : filePath.slice(index + 1);
}

function stripExtension(name: string): string {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(0, index) : name;
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index).toLowerCase() : '';
}

export function relativeToWork(filePath: string, workPath: string): string {
  const path = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const root = normalizeFolder(workPath);
  if (root && (path === root || path.startsWith(`${root}/`))) {
    return path.slice(root.length).replace(/^\/+/, '');
  }
  return path;
}

export function audioRelativePath(
  track: Pick<TrackSummary, 'relativePath' | 'fileName'>,
  workPath: string,
): string {
  return relativeToWork(track.relativePath || track.fileName, workPath);
}

export function subtitlesForAudio(
  files: WorkFileEntry[],
  audioPath: string,
): WorkFileEntry[] {
  const target = normalizeFolder(audioPath);
  if (!target) {
    return [];
  }
  const folder = dirnameOf(target);
  const fileName = baseNameOf(target);
  const stem = stripExtension(fileName);
  const scored: Array<{ file: WorkFileEntry; score: number }> = [];
  for (const file of files) {
    if (file.kind !== 'subtitle') {
      continue;
    }
    const fileFolder = dirnameOf(file.path);
    const name = baseNameOf(file.path);
    const sameFolder = fileFolder === folder;
    const nameBase = stripExtension(name);
    const nameStem = stripExtension(nameBase);
    const exactName = nameBase === fileName;
    const stemName = nameBase === stem || nameStem === stem;
    let score = 99;
    if (sameFolder && exactName) {
      // 01 开场.wav.vtt 与当前音频同目录
      score = file.path === `${target}${extensionOf(name)}` ? 0 : 1;
    } else if (sameFolder && stemName) {
      // 01 开场.vtt 或不同音频格式的 01 开场.wav.vtt
      score = 2;
    } else if (!sameFolder && exactName) {
      // 同作品其他目录（如 WAV 目录）下的 01 开场.wav.vtt
      score = 3;
    } else if (!sameFolder && stemName) {
      // 同作品其他目录下的 01 开场.vtt / 01 开场.wav.vtt
      score = 4;
    }
    if (score < 99) {
      scored.push({ file, score });
    }
  }
  return scored
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      const leftFormat = SUBTITLE_FORMAT_ORDER.indexOf(extensionOf(left.file.name));
      const rightFormat = SUBTITLE_FORMAT_ORDER.indexOf(extensionOf(right.file.name));
      if (leftFormat !== rightFormat) {
        return (leftFormat < 0 ? 99 : leftFormat) - (rightFormat < 0 ? 99 : rightFormat);
      }
      return collator.compare(left.file.path, right.file.path);
    })
    .map((item) => item.file);
}

export function folderSubtitles(files: WorkFileEntry[], audioPath: string): WorkFileEntry[] {
  const target = normalizeFolder(audioPath);
  const folder = dirnameOf(target);
  const fileName = baseNameOf(target);
  const stem = stripExtension(fileName);
  const matched: WorkFileEntry[] = [];
  for (const file of files) {
    if (file.kind !== 'subtitle') {
      continue;
    }
    const name = baseNameOf(file.path);
    const sameFolder = dirnameOf(file.path) === folder;
    const nameBase = stripExtension(name);
    const nameStem = stripExtension(nameBase);
    if (
      sameFolder ||
      nameBase === fileName ||
      nameBase === stem ||
      nameStem === stem
    ) {
      matched.push(file);
    }
  }
  return matched.sort((left, right) => {
    const leftSame = dirnameOf(left.path) === folder ? 0 : 1;
    const rightSame = dirnameOf(right.path) === folder ? 0 : 1;
    if (leftSame !== rightSame) {
      return leftSame - rightSame;
    }
    return collator.compare(left.path, right.path);
  });
}

export interface FolderPreference {
  smartPath: boolean;
  preferEffectSound: boolean;
  audioPriority: AudioPriority;
}

export function choosePreferredFolder(
  files: WorkFileEntry[],
  preference: FolderPreference,
): string {
  if (!preference.smartPath) {
    return '';
  }
  const audio = files.filter((file) => file.kind === 'audio');
  const folders = [...new Set(audio.map((file) => dirnameOf(file.path)))];
  if (folders.length === 0) {
    return '';
  }
  if (folders.length === 1) {
    return folders[0] ?? '';
  }
  const priority = [
    preference.audioPriority,
    ...AUDIO_PRIORITY_ORDER.filter((item) => item !== preference.audioPriority),
  ];
  const scoreFor = (folder: string): number => {
    const folderAudio = audio.filter((file) => dirnameOf(file.path) === folder);
    let score = folder ? 1 : 0;
    for (let index = 0; index < priority.length; index += 1) {
      const extension = `.${priority[index]}`;
      if (folderAudio.some((file) => extensionOf(file.name) === extension)) {
        score += (priority.length - index) * 10;
        break;
      }
    }
    if (preference.preferEffectSound) {
      if (/seあり|効果音|效果音|effect/i.test(folder)) {
        score += 6;
      } else if (/seなし|効果音なし|效果音なし|no.?se/i.test(folder)) {
        score -= 3;
      }
    }
    score += Math.min(folderAudio.length, 5);
    return score;
  };
  return (
    [...folders].sort(
      (left, right) => scoreFor(right) - scoreFor(left) || collator.compare(left, right),
    )[0] ?? ''
  );
}
