import {
  onlineFileUrl,
  type OnlineWorkDetail,
  type OnlineTrackNode,
  type TrackSummary,
  type WorkDetail,
  type WorkFileEntry,
} from './api';
import type { PlayerContext } from './player';

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

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index).toLowerCase();
}

function fileKindForNode(
  node: OnlineTrackNode,
): WorkFileEntry['kind'] {
  if (node.type === 'audio' || node.type === 'video' || node.type === 'image') {
    return node.type;
  }
  if (node.type === 'text') {
    return SUBTITLE_EXTENSIONS.has(extensionOf(node.title)) ? 'subtitle' : 'other';
  }
  return 'other';
}

function collectOnlinePaths(
  nodes: OnlineTrackNode[],
  folders: string[],
  paths: Map<string, string>,
): void {
  for (const node of nodes) {
    if (node.type === 'folder') {
      collectOnlinePaths(node.children ?? [], [...folders, node.title], paths);
      continue;
    }
    if (node.hash) {
      paths.set(node.hash, [...folders, node.title].join('/'));
    }
  }
}

function collectOnlineFiles(
  nodes: OnlineTrackNode[],
  workId: number,
  folders: string[],
  trackIdByHash: Map<string, number>,
  files: WorkFileEntry[],
): void {
  for (const node of nodes) {
    if (node.type === 'folder') {
      collectOnlineFiles(node.children ?? [], workId, [...folders, node.title], trackIdByHash, files);
      continue;
    }
    if (!node.hash) {
      continue;
    }
    files.push({
      path: [...folders, node.title].join('/'),
      name: node.title,
      kind: fileKindForNode(node),
      size: node.size ?? 0,
      mtimeMs: 0,
      durationMs: node.durationMs ?? null,
      trackId: trackIdByHash.get(node.hash) ?? null,
      url: onlineFileUrl(workId, node.hash),
    });
  }
}

export interface OnlinePlayerData {
  tracks: TrackSummary[];
  files: WorkFileEntry[];
  work: WorkDetail;
  context: PlayerContext;
}

export function buildOnlinePlayerData(detail: OnlineWorkDetail): OnlinePlayerData {
  const paths = new Map<string, string>();
  collectOnlinePaths(detail.trackTree ?? [], [], paths);
  const tracks: TrackSummary[] = detail.tracks.map((track, index) => ({
    id: -(index + 1),
    workId: detail.work.id,
    title: track.title,
    disc: track.disc,
    idx: index,
    durationMs: track.durationMs,
    fileName: track.title,
    relativePath: paths.get(track.hash) ?? track.title,
    size: track.size,
    variants: [],
    source: 'online',
    hash: track.hash,
    streamUrl: track.streamUrl,
    onlineWorkId: detail.work.id,
    onlineIndex: index,
    groupTitle: track.groupTitle,
  }));
  const trackIdByHash = new Map(tracks.map((track) => [track.hash ?? '', track.id] as const));
  const files: WorkFileEntry[] = [];
  collectOnlineFiles(
    detail.trackTree ?? [],
    detail.work.id,
    [],
    trackIdByHash,
    files,
  );
  if (files.length === 0) {
    for (const track of tracks) {
      files.push({
        path: track.relativePath,
        name: track.fileName,
        kind: 'audio',
        size: track.size,
        mtimeMs: 0,
        durationMs: track.durationMs,
        trackId: track.id,
        ...(track.streamUrl ? { url: track.streamUrl } : {}),
      });
    }
  }

  const work: WorkDetail = {
    id: detail.work.id,
    code: detail.work.code,
    codeType: 'RJ',
    title: detail.work.title,
    circle: detail.work.circle,
    releaseDate: detail.work.releaseDate,
    workType: '',
    tags: detail.work.tags,
    vas: detail.work.vas,
    rating: detail.work.rating,
    priceYen: detail.work.priceYen,
    favoriteAt: detail.work.favoriteAt,
    metadataStatus: 'online',
    coverAssetId: null,
    relativePath: '',
    rootId: 0,
    trackCount: tracks.length,
    updatedAt: '',
    tracks,
    playback: null,
  };

  return {
    tracks,
    files,
    work,
    context: {
      workId: detail.work.id,
      workCode: detail.work.code,
      workTitle: detail.work.title,
      coverAssetId: null,
      coverUrl: detail.work.coverUrl,
      workPath: '',
      tracks,
      workTracks: tracks,
      source: 'online',
    },
  };
}
