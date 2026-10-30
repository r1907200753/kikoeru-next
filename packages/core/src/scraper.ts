import type { DatabaseSync } from 'node:sqlite';
import { localizeTags } from '@kikoeru-next/shared';
import { storeWorkCover } from './assets.js';
import type { DlsiteProvider } from './providers/dlsite.js';
import { AsmrOneError, type AsmrOneProvider, type AsmrOneWork } from './providers/asmrone.js';
import {
  clearScrapeCache,
  getScrapeCache,
  putScrapeCache,
  updateWorkMetadata,
  updateWorkOnlineMetadata,
  updateWorkOnlineStats,
  upsertWorkSource,
  type ScrapeWorkItem,
} from './repository.js';

const PROVIDER = 'dlsite';
const ASMRONE_PROVIDER = 'asmrone';

export type ScrapeSource = 'dlsite' | 'asmrone';

const CACHE_TTL_MS: Record<string, number> = {
  not_found: 24 * 60 * 60 * 1000,
  age_gate: 24 * 60 * 60 * 1000,
  parse_changed: 24 * 60 * 60 * 1000,
  http_error: 6 * 60 * 60 * 1000,
  rate_limited: 10 * 60 * 1000,
  network: 10 * 60 * 1000,
};

export type ScrapeWorkStatus =
  | 'ok'
  | 'partial'
  | 'cached'
  | 'not_found'
  | 'age_gate'
  | 'http_error'
  | 'rate_limited'
  | 'parse_changed'
  | 'network';

export interface ScrapeWorkResult {
  workId: number;
  code: string;
  status: ScrapeWorkStatus;
  message: string;
  cover: 'ok' | 'failed' | 'none';
  title: string;
  source: ScrapeSource;
}

export interface ScrapeOptions {
  assetsDir: string;
  ffmpegPath: string;
  force?: boolean;
}

export async function scrapeWork(
  db: DatabaseSync,
  provider: DlsiteProvider,
  work: ScrapeWorkItem,
  options: ScrapeOptions,
): Promise<ScrapeWorkResult> {
  if (!options.force) {
    const cached = getScrapeCache(db, PROVIDER, work.code);
    if (cached) {
      return {
        workId: work.id,
        code: work.code,
        status: 'cached',
        message: `负缓存命中（${cached.status}）：${cached.error || '跳过'}`,
        cover: 'none',
        title: work.title,
        source: 'dlsite',
      };
    }
  }

  const fetched = await provider.fetchWork(work.code);
  if (fetched.status !== 'ok') {
    const status = fetched.status;
    putScrapeCache(db, {
      provider: PROVIDER,
      key: work.code,
      status,
      error: fetched.message,
      ttlMs: CACHE_TTL_MS[status] ?? 10 * 60 * 1000,
    });
    return {
      workId: work.id,
      code: work.code,
      status,
      message: fetched.message,
      cover: 'none',
      title: work.title,
      source: 'dlsite',
    };
  }

  clearScrapeCache(db, PROVIDER, work.code);
  const data = fetched.data;
  let cover: 'ok' | 'failed' | 'none' = data.coverUrls.length > 0 ? 'failed' : 'none';
  let coverError = '';

  for (const url of data.coverUrls) {
    const image = await provider.fetchImage(url, data.sourceUrl);
    if (!image.ok) {
      coverError = image.message;
      continue;
    }
    try {
      await storeWorkCover({
        db,
        assetsDir: options.assetsDir,
        workId: work.id,
        buffer: image.buffer,
        contentType: image.contentType,
        originUrl: url,
        source: PROVIDER,
        ffmpegPath: options.ffmpegPath,
      });
      cover = 'ok';
      coverError = '';
      break;
    } catch (error) {
      coverError = error instanceof Error ? error.message : String(error);
    }
  }

  const manual = work.metadataStatus === 'manual';
  const sidecar = work.metadataStatus === 'sidecar';
  if (!manual) {
    // sidecar 与手动编辑一样优先：已有字段不被 DLsite 覆盖，只补空值。
    const tags =
      sidecar && work.tags.length > 0
        ? work.tags
        : data.tags.length > 0
          ? data.tags
          : work.tags;
    updateWorkMetadata(db, work.id, {
      title: (sidecar && work.title) || data.title || work.title,
      circle: (sidecar && work.circle) || data.circle || work.circle,
      releaseDate: (sidecar && work.releaseDate) || data.releaseDate || work.releaseDate,
      workType: (sidecar && work.workType) || data.workType || work.workType,
      tags: localizeTags(tags),
      metadataStatus: sidecar ? 'sidecar' : cover === 'failed' ? 'partial' : 'scraped',
    });
  }
  updateWorkOnlineStats(db, work.id, {
    rating: data.rating,
    priceYen: data.priceYen,
    vas: data.vas,
  });
  upsertWorkSource(db, {
    workId: work.id,
    provider: PROVIDER,
    sourceId: data.productId || data.code,
    sourceUrl: data.sourceUrl,
    raw: data.raw,
  });

  const coverNote =
    cover === 'ok' ? '，封面已缓存' : cover === 'failed' ? `，封面失败：${coverError}` : '，无封面';
  return {
    workId: work.id,
    code: work.code,
    status: cover === 'failed' ? 'partial' : 'ok',
    message: manual ? `已保留手动编辑的信息${coverNote}` : `已更新元数据${coverNote}`,
    cover,
    title: manual ? work.title : data.title || work.title,
    source: 'dlsite',
  };
}

function asmrOneFailure(error: unknown, work: ScrapeWorkItem): ScrapeWorkResult {
  let status: ScrapeWorkStatus = 'network';
  if (error instanceof AsmrOneError) {
    if (error.kind === 'not_found') {
      status = 'not_found';
    } else if (error.kind === 'parse') {
      status = 'parse_changed';
    } else if (error.kind === 'network' || error.kind === 'blocked') {
      status = 'network';
    } else if (error.status === 429) {
      status = 'rate_limited';
    } else {
      status = 'http_error';
    }
  }
  return {
    workId: work.id,
    code: work.code,
    status,
    message: error instanceof Error ? error.message : String(error),
    cover: 'none',
    title: work.title,
    source: 'asmrone',
  };
}

export async function scrapeWorkFromAsmrOne(
  db: DatabaseSync,
  provider: AsmrOneProvider,
  work: ScrapeWorkItem,
  options: ScrapeOptions,
): Promise<ScrapeWorkResult> {
  let info: AsmrOneWork;
  try {
    info = await provider.fetchWorkInfo(work.code);
  } catch (error) {
    return asmrOneFailure(error, work);
  }
  if (!info.id || !info.title) {
    return {
      workId: work.id,
      code: work.code,
      status: 'not_found',
      message: 'asmr.one 上没有该作品',
      cover: 'none',
      title: work.title,
      source: 'asmrone',
    };
  }

  let cover: 'ok' | 'failed' | 'none' = 'none';
  let coverError = '';
  try {
    const image = await provider.fetchCover(info.id, 'main');
    await storeWorkCover({
      db,
      assetsDir: options.assetsDir,
      workId: work.id,
      buffer: image.buffer,
      contentType: image.contentType,
      originUrl: `https://www.asmr.one/work/${encodeURIComponent(work.code)}`,
      source: ASMRONE_PROVIDER,
      ffmpegPath: options.ffmpegPath,
    });
    cover = 'ok';
  } catch (error) {
    cover = 'failed';
    coverError = error instanceof Error ? error.message : String(error);
  }

  const manual = work.metadataStatus === 'manual';
  const sidecar = work.metadataStatus === 'sidecar';
  if (!manual) {
    const tags =
      sidecar && work.tags.length > 0
        ? work.tags
        : info.tags.length > 0
          ? info.tags
          : work.tags;
    updateWorkMetadata(db, work.id, {
      title: (sidecar && work.title) || info.title || work.title,
      circle: (sidecar && work.circle) || info.circle || work.circle,
      releaseDate: (sidecar && work.releaseDate) || info.releaseDate || work.releaseDate,
      workType: work.workType,
      tags: localizeTags(tags),
      metadataStatus: sidecar ? 'sidecar' : cover === 'failed' ? 'partial' : 'scraped',
    });
  }
  updateWorkOnlineMetadata(db, work.id, {
    rating: info.rating,
    priceYen: info.priceYen,
    vas: info.vas,
  });
  upsertWorkSource(db, {
    workId: work.id,
    provider: ASMRONE_PROVIDER,
    sourceId: String(info.id),
    sourceUrl: `https://www.asmr.one/work/${encodeURIComponent(work.code)}`,
    raw: info,
  });

  const coverNote =
    cover === 'ok' ? '，封面已缓存' : cover === 'failed' ? `，封面失败：${coverError}` : '，无封面';
  return {
    workId: work.id,
    code: work.code,
    status: cover === 'failed' ? 'partial' : 'ok',
    message: manual
      ? `已保留手动编辑的信息${coverNote}`
      : `已从 asmr.one 更新元数据${coverNote}`,
    cover,
    title: manual ? work.title : info.title || work.title,
    source: 'asmrone',
  };
}

export interface ScrapeBatchOptions extends ScrapeOptions {
  onProgress?: (done: number, total: number, result: ScrapeWorkResult) => void;
}

export async function scrapeWorks(
  db: DatabaseSync,
  provider: DlsiteProvider,
  works: ScrapeWorkItem[],
  options: ScrapeBatchOptions,
): Promise<ScrapeWorkResult[]> {
  const results: ScrapeWorkResult[] = [];
  for (const work of works) {
    const result = await scrapeWork(db, provider, work, options);
    results.push(result);
    options.onProgress?.(results.length, works.length, result);
  }
  return results;
}
