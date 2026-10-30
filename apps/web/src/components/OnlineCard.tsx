import { formatTime } from '../format';
import type { OnlineReviewProgress, OnlineWork } from '../api';
import { StarIcon } from '../icons';
import { onlineProgressLabel } from '../online';
import { WorkCover } from './WorkCard';

export interface OnlineCardReview {
  userRating: number | null;
  reviewText: string;
  progress: OnlineReviewProgress | '';
  updatedAt: string;
}

export function OnlineCard({
  work,
  review,
}: {
  work: OnlineWork;
  review?: OnlineCardReview;
}) {
  const href = `#/online/${encodeURIComponent(work.code)}`;
  const progressLabel = review ? onlineProgressLabel(review.progress) : '';
  return (
    <a className="online-card" href={href}>
      <div className="online-card-cover">
        <WorkCover code={work.code} size="card" src={work.coverUrl} />
        <span className="online-code-badge">{work.code || 'asmr.one'}</span>
        {work.releaseDate ? (
          <span className="online-date-badge">{work.releaseDate.slice(0, 10)}</span>
        ) : null}
        {work.rating !== null && work.rating > 0 ? (
          <span className="rating-badge">
            <StarIcon /> {work.rating.toFixed(2)}
          </span>
        ) : null}
        {work.local ? <span className="local-badge">已有本地</span> : null}
      </div>
      <div className="online-card-body">
        <span className="online-card-title">{work.title}</span>
        <span className="online-card-circle">
          {work.circle || '未知社团'}
          {work.vas.length > 0 ? ` · ${work.vas.slice(0, 2).join(' / ')}` : ''}
        </span>
        {review && (progressLabel || review.userRating !== null) ? (
          <span className="online-card-review">
            {progressLabel ? (
              <span className={`chip chip--tiny chip--progress chip--progress-${review.progress}`}>
                {progressLabel}
              </span>
            ) : null}
            {review.userRating !== null ? (
              <span className="online-card-user-rating">
                <StarIcon /> {review.userRating.toFixed(2)}
              </span>
            ) : null}
          </span>
        ) : null}
        {review?.reviewText ? (
          <span className="online-card-review-text">{review.reviewText}</span>
        ) : null}
        <span className="online-card-tags">
          {work.tags.slice(0, 3).map((tag) => (
            <span className="chip chip--tag chip--tiny" key={tag}>
              {tag}
            </span>
          ))}
        </span>
        <span className="online-card-foot">
          {review?.updatedAt ? <span>{review.updatedAt}</span> : null}
          {work.durationMs ? <span>{formatTime(work.durationMs)}</span> : null}
          {work.priceYen !== null ? <span>¥{work.priceYen.toLocaleString()}</span> : null}
          {work.dlCount > 0 ? <span>{work.dlCount.toLocaleString()} 下载</span> : null}
        </span>
      </div>
    </a>
  );
}
