import type { TrackSummary } from './api';

export interface TrackDirNode {
  name: string;
  path: string;
  dirs: TrackDirNode[];
  tracks: TrackSummary[];
}

function normalizeRelative(track: TrackSummary, workPath: string): string {
  const fromMessage = track.relativePath || track.fileName || track.title;
  const path = fromMessage.replace(/\\/g, '/').replace(/^\/+/, '');
  const root = workPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (root && (path === root || path.startsWith(`${root}/`))) {
    return path.slice(root.length).replace(/^\/+/, '');
  }
  return path;
}

function folderSegments(track: TrackSummary, workPath: string): string[] {
  const parts = normalizeRelative(track, workPath).split('/').filter(Boolean);
  parts.pop();
  return parts;
}

export function folderLabelFor(track: TrackSummary, workPath: string): string {
  const parts = folderSegments(track, workPath);
  return parts[parts.length - 1] ?? '';
}

export function folderQueueFor(
  tracks: TrackSummary[],
  workPath: string,
  track: TrackSummary,
): TrackSummary[] {
  const target = folderSegments(track, workPath).join('/');
  const queue = tracks.filter(
    (item) => folderSegments(item, workPath).join('/') === target,
  );
  return queue.length > 0 ? queue : [track];
}

export function buildTrackTree(tracks: TrackSummary[], workPath: string): TrackDirNode {
  const root: TrackDirNode = { name: '', path: '', dirs: [], tracks: [] };
  for (const track of tracks) {
    const parts = normalizeRelative(track, workPath).split('/').filter(Boolean);
    const fileName = parts.pop();
    let node = root;
    for (const part of parts) {
      let child = node.dirs.find((item) => item.name === part);
      if (!child) {
        child = { name: part, path: `${node.path}/${part}`, dirs: [], tracks: [] };
        node.dirs.push(child);
      }
      node = child;
    }
    if (fileName) {
      node.tracks.push(track);
    }
  }
  return root;
}

export function countTracks(node: TrackDirNode): number {
  return (
    node.tracks.length + node.dirs.reduce((sum, child) => sum + countTracks(child), 0)
  );
}

export function fileNameFor(track: TrackSummary): string {
  const raw = track.relativePath || track.fileName || track.title;
  const parts = raw.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || track.title;
}
