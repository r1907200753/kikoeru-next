import type { AsmrOneConfig, ProbeResult } from './types.js';
import { HttpClient, redactText, redactUrl, responseHeader } from './http.js';
import { captureProbe, ProbeFailure, skipped } from './result.js';

const ASMR_SITE = 'https://www.asmr.one';
const KNOWN_API_BASES = [
  'https://api.asmr-200.com',
  'https://api.asmr.one',
  'https://api.asmr-100.com',
  'https://api.asmr-300.com',
];
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface AsmrOneWorkSample {
  id: string;
  workno: string;
  title: string;
  circle: string;
}

export interface AsmrOneWorkInfo {
  id: string;
  workno: string;
  title: string;
  circle: string;
  tags: string[];
  vas: string[];
  releaseDate: string;
  rate: string;
  coverUrl: string;
  keys: string[];
}

export interface AsmrOneTracks {
  count: number;
  groupCount: number;
  formats: string[];
  firstHash: string;
  firstTitle: string;
  firstStreamUrl: string;
  firstDownloadUrl: string;
  firstDuration: string;
  firstSize: string;
  firstKeys: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return '';
}

function pickName(record: Record<string, unknown>, keys: string[]): string {
  const direct = pickString(record, keys);
  if (direct) {
    return direct;
  }
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) {
      const nested = pickString(value, ['name', 'title', 'display_name']);
      if (nested) {
        return nested;
      }
    }
  }
  return '';
}

function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      result.push(item.trim());
    } else if (isRecord(item)) {
      const name = pickString(item, ['name', 'title', 'value']);
      if (name) {
        result.push(name);
      }
    }
  }
  return [...new Set(result)].slice(0, 30);
}

function unwrapRecord(payload: unknown): Record<string, unknown> {
  if (Array.isArray(payload)) {
    return unwrapRecord(payload[0]);
  }
  if (!isRecord(payload)) {
    return {};
  }
  if (isRecord(payload.data) && !Array.isArray(payload.data)) {
    return unwrapRecord(payload.data);
  }
  if (isRecord(payload.work)) {
    return payload.work;
  }
  return payload;
}

function extractArray(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (isRecord(payload)) {
    for (const key of keys) {
      const value = payload[key];
      if (Array.isArray(value)) {
        return value;
      }
    }
    if (isRecord(payload.data)) {
      return extractArray(payload.data, keys);
    }
  }
  return [];
}

export function parsePreconnectOrigins(html: string): string[] {
  const origins = new Set<string>();
  const linkPattern = /<link[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(linkPattern)) {
    const href = match[1];
    if (!href) {
      continue;
    }
    try {
      const url = new URL(href);
      if (/^api\./i.test(url.hostname)) {
        origins.add(url.origin);
      }
    } catch {
      // 忽略非法 URL
    }
  }
  const apiPattern = /https?:\/\/api\.[a-z0-9.-]+/gi;
  for (const match of html.matchAll(apiPattern)) {
    try {
      origins.add(new URL(match[0]).origin);
    } catch {
      // 忽略非法 URL
    }
  }
  return [...origins];
}

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return '';
  }
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).origin;
  } catch {
    return '';
  }
}

export function parseWorksPayload(payload: unknown): {
  count: number;
  sample: AsmrOneWorkSample;
} {
  const works = extractArray(payload, ['works', 'items', 'list', 'results']);
  const first = isRecord(works[0]) ? works[0] : {};
  return {
    count: works.length,
    sample: {
      id: pickString(first, ['id', 'work_id']),
      workno: pickString(first, [
        'source_id',
        'sourceId',
        'workno',
        'work_no',
        'rj_id',
        'number',
      ]).toUpperCase(),
      title: pickString(first, ['title', 'name', 'work_name']),
      circle: pickName(first, ['circle', 'circle_name', 'maker_name', 'maker']),
    },
  };
}

export function parseSearchPayload(payload: unknown): {
  count: number;
  firstWorkno: string;
  firstTitle: string;
} {
  const works = extractArray(payload, ['works', 'items', 'list', 'results']);
  const first = isRecord(works[0]) ? works[0] : {};
  return {
    count: works.length,
    firstWorkno: pickString(first, [
      'source_id',
      'sourceId',
      'workno',
      'work_no',
      'rj_id',
      'number',
    ]).toUpperCase(),
    firstTitle: pickString(first, ['title', 'name', 'work_name']),
  };
}

export function parseWorkInfoPayload(payload: unknown): AsmrOneWorkInfo {
  const record = unwrapRecord(payload);
  const cover = record.cover;
  const coverUrl =
    pickString(record, ['mainCoverUrl', 'samCoverUrl', 'thumbnailCoverUrl', 'coverUrl']) ||
    (typeof cover === 'string'
      ? cover.trim()
      : isRecord(cover)
        ? pickString(cover, ['url', 'main', 'path'])
        : '');
  return {
    id: pickString(record, ['id', 'work_id']),
    workno: pickString(record, [
      'source_id',
      'sourceId',
      'workno',
      'work_no',
      'rj_id',
      'number',
    ]).toUpperCase(),
    title: pickString(record, ['title', 'name', 'work_name']),
    circle: pickName(record, ['circle', 'circle_name', 'maker_name', 'maker']),
    tags: pickStringArray(record.tags ?? record.tag),
    vas: pickStringArray(record.vas ?? record.va),
    releaseDate: pickString(record, ['release', 'release_date', 'date', 'regist_date']),
    rate: pickString(record, [
      'rate_average_2dp',
      'rate_average',
      'rate',
      'rating',
      'score',
    ]),
    coverUrl,
    keys: Object.keys(record).slice(0, 40),
  };
}

function collectTrackLeaves(
  value: unknown,
  leaves: Record<string, unknown>[],
  formats: string[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTrackLeaves(item, leaves, formats);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  const children = Array.isArray(value.children) ? value.children : null;
  if (children) {
    const title = pickString(value, ['title']);
    if (title) {
      formats.push(title);
    }
    collectTrackLeaves(children, leaves, formats);
    return;
  }
  leaves.push(value);
}

export function parseTracksPayload(payload: unknown): AsmrOneTracks {
  const groups = extractArray(payload, ['tracks', 'items', 'list']);
  const leaves: Record<string, unknown>[] = [];
  const formats: string[] = [];
  collectTrackLeaves(groups, leaves, formats);

  const first = leaves[0] ?? {};
  const media = isRecord(first.media) ? first.media : {};
  return {
    count: leaves.length,
    groupCount: groups.length,
    formats: [...new Set(formats)].slice(0, 10),
    firstHash:
      pickString(first, ['hash', 'media_hash', 'mediaHash']) ||
      pickString(media, ['hash', 'media_hash']),
    firstTitle: pickString(first, ['title', 'name']),
    firstStreamUrl:
      pickString(first, [
        'mediaStreamUrl',
        'streamUrl',
        'stream_url',
        'mediaDownloadUrl',
        'url',
      ]) || pickString(media, ['streamUrl', 'stream_url', 'url']),
    firstDownloadUrl:
      pickString(first, ['mediaDownloadUrl', 'downloadUrl', 'download_url']) ||
      pickString(media, ['downloadUrl', 'download_url']),
    firstDuration: pickString(first, ['duration', 'length']),
    firstSize: pickString(first, ['size', 'file_size']),
    firstKeys: Object.keys(first).slice(0, 40),
  };
}

export function parseAuthPayload(payload: unknown): { token: string; name: string } {
  const record = unwrapRecord(payload);
  const user = isRecord(record.user) ? record.user : {};
  return {
    token: pickString(record, ['token', 'accessToken', 'access_token']),
    name: pickString(user, ['name', 'username']) || pickString(record, ['name', 'username']),
  };
}

export function audioMagic(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer.toString('ascii', 0, 3) === 'ID3') {
    return 'mp3-id3';
  }
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'fLaC') {
    return 'flac';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE'
  ) {
    return 'wav';
  }
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS') {
    return 'ogg';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    return 'mp4';
  }
  return '';
}

function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'user-agent': BROWSER_UA,
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7',
    origin: ASMR_SITE,
    referer: `${ASMR_SITE}/`,
    ...extra,
  };
}

interface DomainAttempt {
  baseUrl: string;
  status: number;
  contentType: string;
  ok: boolean;
  error: string;
}

export async function discoverAsmrOneBase(
  client: HttpClient,
  configuredBase: string,
  timeoutMs: number,
): Promise<{ baseUrl: string; source: string; attempts: DomainAttempt[] }> {
  const attempts: DomainAttempt[] = [];
  const configured = normalizeBaseUrl(configuredBase);
  const candidates: Array<{ baseUrl: string; source: string }> = [];

  if (configured) {
    candidates.push({ baseUrl: configured, source: 'config' });
  }

  const siteUrl = configured && /^https?:\/\/www\./i.test(configured) ? configured : ASMR_SITE;
  try {
    const site = await client.request(`${siteUrl}/`, {
      headers: apiHeaders({ accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }),
      timeoutMs: Math.min(timeoutMs, 12_000),
      maxBytes: 2 * 1024 * 1024,
    });
    for (const origin of parsePreconnectOrigins(site.text)) {
      candidates.push({ baseUrl: origin, source: 'preconnect' });
    }
  } catch (error) {
    attempts.push({
      baseUrl: siteUrl,
      status: 0,
      contentType: '',
      ok: false,
      error: error instanceof Error ? redactText(error.message) : redactText(String(error)),
    });
  }
  for (const baseUrl of KNOWN_API_BASES) {
    candidates.push({ baseUrl, source: 'known' });
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.baseUrl || seen.has(candidate.baseUrl)) {
      continue;
    }
    seen.add(candidate.baseUrl);

    const url = `${candidate.baseUrl}/api/works?page=1&pageSize=1`;
    try {
      const response = await client.request(url, {
        headers: apiHeaders(),
        timeoutMs: Math.min(timeoutMs, 10_000),
        maxBytes: 512 * 1024,
      });
      const contentType = responseHeader(response, 'content-type');
      const looksLikeJson =
        contentType.includes('json') || /^\s*[[{]/.test(response.text.slice(0, 32));
      const ok = response.status === 200 && looksLikeJson;
      attempts.push({
        baseUrl: candidate.baseUrl,
        status: response.status,
        contentType,
        ok,
        error: '',
      });
      if (ok) {
        return { baseUrl: candidate.baseUrl, source: candidate.source, attempts };
      }
    } catch (error) {
      attempts.push({
        baseUrl: candidate.baseUrl,
        status: 0,
        contentType: '',
        ok: false,
        error: error instanceof Error ? redactText(error.message) : redactText(String(error)),
      });
    }
  }

  throw new ProbeFailure(
    `无法发现可用的 ASMR.one API 域名（已尝试 ${attempts.length} 个，检查代理或手动填写 asmrone.baseUrl）`,
    { attempts },
  );
}

export async function runAsmrOneProbes(
  client: HttpClient,
  config: AsmrOneConfig,
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const timeoutMs = config.timeoutMs;
  let baseUrl = '';
  let sample: AsmrOneWorkSample = { id: '', workno: '', title: '', circle: '' };
  let workInfo: AsmrOneWorkInfo | undefined;
  let tracks: AsmrOneTracks | undefined;
  let authToken = '';

  results.push(
    await captureProbe('asmrone.domain', async () => {
      const discovery = await discoverAsmrOneBase(client, config.baseUrl, timeoutMs);
      baseUrl = discovery.baseUrl;
      return {
        status: 'pass',
        summary: `API 域名可用：${discovery.baseUrl}（来源：${discovery.source}）`,
        details: {
          baseUrl: discovery.baseUrl,
          source: discovery.source,
          attempts: discovery.attempts,
        },
      };
    }),
  );

  if (!baseUrl) {
    results.push(
      skipped('asmrone.works', '域名发现失败，跳过后续在线探针'),
      skipped('asmrone.work_info', '域名发现失败，跳过后续在线探针'),
    );
    return results;
  }

  results.push(
    await captureProbe('asmrone.works', async () => {
      const url = `${baseUrl}/api/works?page=1&pageSize=5`;
      const response = await client.request(url, {
        headers: apiHeaders(),
        timeoutMs,
        maxBytes: 2 * 1024 * 1024,
      });
      const details = {
        url: redactUrl(url),
        status: response.status,
        contentType: responseHeader(response, 'content-type'),
        bytes: response.body.length,
      };
      if (response.status !== 200) {
        return { status: 'fail', summary: `works 返回 HTTP ${response.status}`, details };
      }
      let payload: unknown;
      try {
        payload = JSON.parse(response.text);
      } catch {
        return { status: 'fail', summary: 'works 返回的不是 JSON', details };
      }
      const parsed = parseWorksPayload(payload);
      sample = parsed.sample;
      return {
        status: parsed.count > 0 ? 'pass' : 'fail',
        summary:
          parsed.count > 0
            ? `列表可用，本次取到 ${parsed.count} 条；样例：${parsed.sample.title || '无标题'}`
            : '请求成功但未解析到作品列表',
        details: {
          ...details,
          count: parsed.count,
          sample,
        },
      };
    }),
  );

  const searchWorkno = config.workno || sample.workno;
  if (searchWorkno) {
    results.push(
      await captureProbe('asmrone.search', async () => {
        const url = `${baseUrl}/api/search/${encodeURIComponent(searchWorkno)}`;
        const response = await client.request(url, {
          headers: apiHeaders(),
          timeoutMs,
          maxBytes: 2 * 1024 * 1024,
        });
        const details = {
          url: redactUrl(url),
          workno: searchWorkno,
          status: response.status,
          contentType: responseHeader(response, 'content-type'),
        };
        if (response.status === 404) {
          return {
            status: 'skip',
            summary: 'search 接口不存在（HTTP 404），由 workInfo 兜底',
            details,
          };
        }
        if (response.status !== 200) {
          return { status: 'fail', summary: `search 返回 HTTP ${response.status}`, details };
        }
        let payload: unknown;
        try {
          payload = JSON.parse(response.text);
        } catch {
          return { status: 'fail', summary: 'search 返回的不是 JSON', details };
        }
        const parsed = parseSearchPayload(payload);
        return {
          status: 'pass',
          summary: `搜索 ${searchWorkno} 返回 ${parsed.count} 条`,
          details: { ...details, ...parsed },
        };
      }),
    );
  } else {
    results.push(skipped('asmrone.search', '未配置 asmrone.workno，且列表没有可用番号'));
  }

  const infoWorkno = config.workno || sample.workno;
  if (infoWorkno) {
    results.push(
      await captureProbe('asmrone.work_info', async () => {
        const url = `${baseUrl}/api/workInfo/${encodeURIComponent(infoWorkno)}`;
        const response = await client.request(url, {
          headers: apiHeaders(),
          timeoutMs,
          maxBytes: 2 * 1024 * 1024,
        });
        const details = {
          url: redactUrl(url),
          workno: infoWorkno,
          status: response.status,
          contentType: responseHeader(response, 'content-type'),
        };
        if (response.status !== 200) {
          return {
            status: response.status === 404 ? 'skip' : 'fail',
            summary: `workInfo 返回 HTTP ${response.status}`,
            details,
          };
        }
        let payload: unknown;
        try {
          payload = JSON.parse(response.text);
        } catch {
          return { status: 'fail', summary: 'workInfo 返回的不是 JSON', details };
        }
        workInfo = parseWorkInfoPayload(payload);
        const hasIdentity = Boolean(workInfo.id || workInfo.title);
        return {
          status: hasIdentity ? 'pass' : 'fail',
          summary: hasIdentity
            ? `标题：${workInfo.title || '未知'}｜サークル：${workInfo.circle || '未知'}｜タグ：${workInfo.tags.length}`
            : 'workInfo 可解析，但缺少 id/title',
          details: {
            ...details,
            id: workInfo.id,
            title: workInfo.title,
            circle: workInfo.circle,
            tags: workInfo.tags,
            vas: workInfo.vas,
            releaseDate: workInfo.releaseDate,
            rate: workInfo.rate,
            hasCover: Boolean(workInfo.coverUrl),
            keys: workInfo.keys,
          },
        };
      }),
    );
  } else {
    results.push(skipped('asmrone.work_info', '没有可用于 workInfo 的番号'));
  }

  const detailId = workInfo?.id || sample.id;
  if (detailId) {
    results.push(
      await captureProbe('asmrone.work', async () => {
        const url = `${baseUrl}/api/work/${encodeURIComponent(detailId)}`;
        const response = await client.request(url, {
          headers: apiHeaders(),
          timeoutMs,
          maxBytes: 2 * 1024 * 1024,
        });
        const details = {
          url: redactUrl(url),
          id: detailId,
          status: response.status,
          contentType: responseHeader(response, 'content-type'),
        };
        if (response.status !== 200) {
          return {
            status: response.status === 404 ? 'skip' : 'fail',
            summary: `work 详情返回 HTTP ${response.status}`,
            details,
          };
        }
        try {
          const parsed = parseWorkInfoPayload(JSON.parse(response.text));
          return {
            status: 'pass',
            summary: `详情可用：${parsed.title || '未知标题'}`,
            details: { ...details, title: parsed.title, circle: parsed.circle },
          };
        } catch {
          return { status: 'fail', summary: 'work 详情返回的不是 JSON', details };
        }
      }),
    );
  } else {
    results.push(skipped('asmrone.work', '缺少数值型作品 id，无法测试详情接口'));
  }

  if (detailId) {
    results.push(
      await captureProbe('asmrone.tracks', async () => {
        const url = `${baseUrl}/api/tracks/${encodeURIComponent(detailId)}?v=2`;
        const response = await client.request(url, {
          headers: apiHeaders(),
          timeoutMs,
          maxBytes: 4 * 1024 * 1024,
        });
        const details = {
          url: redactUrl(url),
          id: detailId,
          status: response.status,
          contentType: responseHeader(response, 'content-type'),
        };
        if (response.status !== 200) {
          return {
            status: response.status === 404 ? 'skip' : 'fail',
            summary: `tracks 返回 HTTP ${response.status}`,
            details,
          };
        }
        let payload: unknown;
        try {
          payload = JSON.parse(response.text);
        } catch {
          return { status: 'fail', summary: 'tracks 返回的不是 JSON', details };
        }
        tracks = parseTracksPayload(payload);
        return {
          status: tracks.count > 0 ? 'pass' : 'fail',
          summary:
            tracks.count > 0
              ? `音轨列表可用，顶层 ${tracks.groupCount} 项 / ${tracks.count} 个音频；首条：${tracks.firstTitle || '无标题'}`
              : 'tracks 请求成功但未解析到音轨',
          details: {
            ...details,
            count: tracks.count,
            groupCount: tracks.groupCount,
            formats: tracks.formats,
            firstHash: tracks.firstHash ? `${tracks.firstHash.slice(0, 12)}…` : '',
            firstTitle: tracks.firstTitle,
            firstDuration: tracks.firstDuration,
            firstSize: tracks.firstSize,
            hasStreamUrl: Boolean(tracks.firstStreamUrl),
            hasDownloadUrl: Boolean(tracks.firstDownloadUrl),
            firstKeys: tracks.firstKeys,
          },
        };
      }),
    );
  } else {
    results.push(skipped('asmrone.tracks', '缺少数值型作品 id，无法测试音轨接口'));
  }

  if (config.username && config.password) {
    results.push(
      await captureProbe('asmrone.auth', async () => {
        const url = `${baseUrl}/api/auth/me`;
        const response = await client.request(url, {
          method: 'POST',
          headers: apiHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify({ name: config.username, password: config.password }),
          timeoutMs,
          maxBytes: 512 * 1024,
        });
        const details = {
          url: redactUrl(url),
          status: response.status,
          contentType: responseHeader(response, 'content-type'),
        };
        if (response.status !== 200) {
          return {
            status: 'fail',
            summary: `登录返回 HTTP ${response.status}（检查账号密码或接口路径）`,
            details,
          };
        }
        let payload: unknown;
        try {
          payload = JSON.parse(response.text);
        } catch {
          return { status: 'fail', summary: '登录返回的不是 JSON', details };
        }
        const auth = parseAuthPayload(payload);
        authToken = auth.token;
        const maskedName = auth.name ? `${auth.name.slice(0, 2)}***` : '';
        return {
          status: auth.token ? 'pass' : 'fail',
          summary: auth.token
            ? `登录成功${maskedName ? `：${maskedName}` : ''}（已取得 token，未写入报告）`
            : '登录 HTTP 200，但未解析到 token',
          details: { ...details, tokenReceived: Boolean(auth.token), userNameMasked: maskedName },
        };
      }),
    );
  } else {
    results.push(skipped('asmrone.auth', '未配置 asmrone.username/password'));
  }

  if (tracks && (authToken || tracks.firstStreamUrl)) {
    const token = authToken;
    const trackInfo = tracks;
    results.push(
      await captureProbe('asmrone.media_stream', async () => {
        const rawUrl = trackInfo.firstStreamUrl
          ? trackInfo.firstStreamUrl.startsWith('http')
            ? trackInfo.firstStreamUrl
            : `${baseUrl}${trackInfo.firstStreamUrl.startsWith('/') ? '' : '/'}${trackInfo.firstStreamUrl}`
          : `${baseUrl}/api/media/stream/${encodeURIComponent(trackInfo.firstHash)}?token=${encodeURIComponent(token)}`;
        const response = await client.getPrefix(rawUrl, 2048, {
          headers: token ? apiHeaders({ authorization: `Bearer ${token}` }) : apiHeaders(),
          timeoutMs: Math.min(timeoutMs, 15_000),
        });
        const contentType = responseHeader(response, 'content-type');
        const magic = audioMagic(response.body);
        const details = {
          url: redactUrl(rawUrl),
          status: response.status,
          contentType,
          contentRange: responseHeader(response, 'content-range'),
          bytes: response.body.length,
          magic,
          rangeHonored: response.rangeHonored,
        };

        if (response.status === 401 || response.status === 403) {
          return {
            status: 'skip',
            summary: `媒体流拒绝访问（HTTP ${response.status}）；可能需要单独的媒体 token，M1 再接`,
            details,
          };
        }
        const acceptableType =
          /^(audio|video)\//i.test(contentType) ||
          /octet-stream/i.test(contentType) ||
          Boolean(magic);
        const ok =
          (response.status === 200 || response.status === 206) && acceptableType;
        return {
          status: ok ? 'pass' : 'fail',
          summary: ok
            ? `媒体流可用（${magic || contentType}，Range：${response.rangeHonored ? '支持' : '未验证'}）`
            : `媒体流返回 HTTP ${response.status}`,
          details,
        };
      }),
    );
  } else {
    results.push(
      skipped(
        'asmrone.media_stream',
        tracks ? '音轨没有可用的 streamUrl/hash，且未登录' : '没有音轨信息或未登录',
      ),
    );
  }

  return results;
}
