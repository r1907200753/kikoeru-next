import { useEffect, useState, type CSSProperties } from 'react';
import { coverUrl, type WorkSummary } from '../api';
import { coverPalette } from '../format';
import { HeartIcon, MusicIcon, PlayIcon, StarIcon } from '../icons';
import { tagHref } from '../tags';

type CoverSize = 'card' | 'hero' | 'mini' | 'player';

const COVER_WIDTH: Record<CoverSize, '240' | '600' | 'original'> = {
  card: '600',
  hero: 'original',
  mini: '240',
  player: 'original',
};

export function WorkCover({
  code,
  coverAssetId,
  size = 'card',
  src,
}: {
  code: string;
  coverAssetId?: number | null | undefined;
  size?: CoverSize;
  src?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [coverAssetId, src]);

  const palette = coverPalette(code || 'RJ');
  const style = {
    '--cover-from': palette.from,
    '--cover-to': palette.to,
    '--cover-ink': palette.ink,
  } as CSSProperties;
  const resolvedSrc = src ?? (coverAssetId ? coverUrl(coverAssetId, COVER_WIDTH[size]) : '');
  const showImage = Boolean(resolvedSrc) && !failed;

  return (
    <div
      className={`cover cover--${size}${showImage ? ' cover--image' : ''}`}
      style={style}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          className="cover-image"
          src={resolvedSrc}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <span className="cover-ring" />
          <MusicIcon className="cover-glyph" />
        </>
      )}
      <span className="cover-code">{code || 'ASMR'}</span>
    </div>
  );
}

function ratingText(rating: number): string {
  return rating.toFixed(2);
}

export function WorkCard({
  work,
  onToggleFavorite,
}: {
  work: WorkSummary;
  onToggleFavorite?: (code: string, favorite: boolean) => void;
}) {
  const favorite = Boolean(work.favoriteAt);
  const tags = work.tags.slice(0, 2);
  const href = `#/work/${encodeURIComponent(work.code)}`;
  return (
    <article className={`work-card${favorite ? ' is-favorite' : ''}`}>
      <div className="work-card-link">
        <a className="work-card-cover-link" href={href} aria-label={`打开 ${work.title}`}>
          <div className="work-card-cover">
            <WorkCover code={work.code} coverAssetId={work.coverAssetId} size="card" />
            {work.rating !== null ? (
              <span className="rating-badge">
                <StarIcon /> {ratingText(work.rating)}
              </span>
            ) : null}
            <span className="card-play-hint" aria-hidden="true">
              <PlayIcon />
            </span>
          </div>
        </a>
        <div className="work-card-body">
          <a className="work-card-title" href={href}>
            {work.title}
          </a>
          <span className="work-card-circle">{work.circle || '未知社团'}</span>
          {tags.length > 0 ? (
            <span className="work-card-tags">
              {tags.map((tag) => (
                <a className="chip chip--tag chip--tiny" href={tagHref(tag)} key={tag}>
                  {tag}
                </a>
              ))}
            </span>
          ) : null}
          <span className="work-card-foot">
            <span>{work.trackCount} 轨</span>
            {work.releaseDate ? <span>{work.releaseDate.slice(0, 7)}</span> : null}
            {work.vas.length > 0 ? <span>{work.vas.slice(0, 2).join(' / ')}</span> : null}
          </span>
        </div>
      </div>
      {onToggleFavorite ? (
        <button
          type="button"
          className={`favorite-button${favorite ? ' is-active' : ''}`}
          onClick={() => onToggleFavorite(work.code, !favorite)}
          aria-label={favorite ? `取消收藏 ${work.title}` : `收藏 ${work.title}`}
          title={favorite ? '取消收藏' : '收藏'}
        >
          <HeartIcon filled={favorite} />
        </button>
      ) : null}
    </article>
  );
}
