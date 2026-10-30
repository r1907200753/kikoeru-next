import type {
  OnlineReviewOrder,
  OnlineReviewProgress,
  OnlineTrack,
} from './api';
import type { AudioPriority } from './preferences';

export const ONLINE_PROGRESS_LABELS: Record<OnlineReviewProgress, string> = {
  marked: '想听',
  listening: '在听',
  listened: '听过',
  replay: '重听',
  postponed: '搁置',
};

export const ONLINE_PROGRESS_OPTIONS: Array<{
  value: OnlineReviewProgress;
  label: string;
}> = [
  { value: 'marked', label: '想听' },
  { value: 'listening', label: '在听' },
  { value: 'listened', label: '听过' },
  { value: 'replay', label: '重听' },
  { value: 'postponed', label: '搁置' },
];

export const ONLINE_REVIEW_ORDER_OPTIONS: Array<{
  value: OnlineReviewOrder;
  label: string;
}> = [
  { value: 'updated_at', label: '最近更新' },
  { value: 'userRating', label: '我的评分' },
  { value: 'release', label: '发售日期' },
  { value: 'review_count', label: '评论数' },
  { value: 'dl_count', label: '销量' },
];

export function onlineProgressLabel(value: OnlineReviewProgress | ''): string {
  return value ? ONLINE_PROGRESS_LABELS[value] : '';
}

export function preferredOnlineTrackIndex(
  tracks: OnlineTrack[],
  priority: AudioPriority,
): number {
  if (tracks.length === 0) {
    return -1;
  }
  const extension = new RegExp(`\\.${priority}(?:$|\\b)`, 'i');
  const word = new RegExp(`(^|[^a-z])${priority}([^a-z]|$)`, 'i');
  const index = tracks.findIndex(
    (track) =>
      extension.test(track.title) ||
      word.test(track.groupTitle) ||
      word.test(track.title),
  );
  return index >= 0 ? index : 0;
}
