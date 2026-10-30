import type { RecentPlayback, TrackSummary } from './api';
import type { PlayerApi } from './player';

export function resumeRecent(player: PlayerApi, item: RecentPlayback): boolean {
  if (!item.trackId) {
    return false;
  }
  const track: TrackSummary = {
    id: item.trackId,
    workId: item.workId,
    title: item.trackTitle || item.title,
    disc: 1,
    idx: 0,
    durationMs: null,
    fileName: '',
    relativePath: '',
    size: 0,
    variants: [],
  };
  player.play(
    track,
    {
      workId: item.workId,
      workCode: item.code,
      workTitle: item.title,
      coverAssetId: item.coverAssetId,
      tracks: [track],
    },
    item.positionMs,
  );
  return true;
}
