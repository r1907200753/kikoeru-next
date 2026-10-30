import {
  HttpClient,
  responseHeader,
  type HttpResponse,
  type HttpStreamResponse,
} from '../http.js';
import { localizeTags } from '@kikoeru-next/shared';

const ASMR_SITE = 'https://www.asmr.one';
const KNOWN_API_BASES = [
  'https://api.asmr-200.com',
  'https://api.asmr.one',
  'https://api.asmr-100.com',
  'https://api.asmr-300.com',
];
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DEFAULT_MIN_INTERVAL_MS = 250;
const BASE_TTL_MS = 60 * 60 * 1000;
const TRACKS_TTL_MS = 10 * 60 * 1000;

const baseCache = new Map<string, { baseUrl: string; expiresAt: number }>();

export type AsmrOneErrorKind =
  | 'network'
  | 'not_found'
  | 'unauthorized'
  | 'http'
  | 'parse'
  | 'blocked';

export class AsmrOneError extends Error {
  readonly kind: AsmrOneErrorKind;
  readonly status: number;

  constructor(kind: AsmrOneErrorKind, message: string, status = 0) {
    super(message);
    this.name = 'AsmrOneError';
    this.kind = kind;
    this.status = status;
  }
}

export interface AsmrOneWork {
  id: number;
  code: string;
  title: string;
  circle: string;
  releaseDate: string;
  rating: number | null;
  priceYen: number | null;
  reviewCount: number;
  dlCount: number;
  tags: string[];
  vas: string[];
  durationMs: number | null;
  languageEditions?: AsmrOneLanguageEdition[];
}

export interface AsmrOneLanguageEdition {
  code: string;
  label: string;
  lang: string;
  title: string;
  isOriginal: boolean;
}

export interface AsmrOneSearchResult {
  items: AsmrOneWork[];
  total: number;
  page: number;
  pageSize: number;
}

export type AsmrOneReviewProgress =
  | 'marked'
  | 'listening'
  | 'listened'
  | 'replay'
  | 'postponed';

export type AsmrOneReviewOrder =
  | 'updated_at'
  | 'userRating'
  | 'release'
  | 'review_count'
  | 'dl_count';

export interface AsmrOneReviewWork extends AsmrOneWork {
  userRating: number | null;
  reviewText: string;
  progress: AsmrOneReviewProgress | '';
  updatedAt: string;
  userName: string;
}

export interface AsmrOneReviewPage {
  items: AsmrOneReviewWork[];
  total: number;
  page: number;
  pageSize: number;
}

export type AsmrOnePlaylistFilter = 'all' | 'owned' | 'liked';

export interface AsmrOnePlaylist {
  id: string;
  name: string;
  description: string;
  privacy: number;
  locale: string;
  userName: string;
  worksCount: number;
  likedCount: number;
  playbackCount: number;
  createdAt: string;
  updatedAt: string;
  latestWorkId: number;
  systemKind: 'liked' | 'marked' | '';
}

export interface AsmrOnePlaylistPage {
  items: AsmrOnePlaylist[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AsmrOnePlaylistWorkPage {
  items: AsmrOneWork[];
  total: number;
  page: number;
  pageSize: number;
}

export type AsmrOneListOrder = 'create_date' | 'release' | 'dl_count' | 'rate_average_2dp';

export interface AsmrOneTrack {
  hash: string;
  title: string;
  disc: number;
  groupTitle: string;
  durationMs: number | null;
  size: number;
  streamUrl: string;
}

export type AsmrOneFileType = 'audio' | 'video' | 'image' | 'text' | 'other';

export interface AsmrOneFile {
  hash: string;
  title: string;
  type: AsmrOneFileType;
  relativePath: string;
  disc: number;
  groupTitle: string;
  durationMs: number | null;
  size: number;
  streamUrl: string;
  downloadUrl: string;
}

export interface AsmrOneTracks {
  items: AsmrOneTrack[];
  files: AsmrOneFile[];
  tree: AsmrOneTrackNode[];
  groupCount: number;
}

export interface AsmrOneTrackNode {
  type: 'folder' | AsmrOneFileType;
  title: string;
  hash?: string;
  durationMs?: number | null;
  size?: number;
  children?: AsmrOneTrackNode[];
}

export interface AsmrOneProviderOptions {
  proxyUrl?: string;
  baseUrl?: string;
  timeoutMs?: number;
  minIntervalMs?: number;
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

function pickNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function pickNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const names: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      names.push(item.trim());
    } else if (isRecord(item)) {
      const name =
        (isRecord(item.i18n) && isRecord(item.i18n['zh-cn'])
          ? pickString(item.i18n['zh-cn'], ['name'])
          : '') || pickString(item, ['name', 'title', 'value']);
      if (name) {
        names.push(name);
      }
    }
  }
  return [...new Set(names)];
}

function pickCode(record: Record<string, unknown>): string {
  return pickString(record, [
    'source_id',
    'sourceId',
    'workno',
    'work_no',
    'rj_id',
    'number',
    'code',
  ]).toUpperCase();
}

function parseWorkPage(
  payload: unknown,
  fallbackPage: number,
  fallbackPageSize: number,
): AsmrOneSearchResult {
  const works = isRecord(payload) && Array.isArray(payload.works) ? payload.works : [];
  const pagination = isRecord(payload) && isRecord(payload.pagination) ? payload.pagination : {};
  return {
    items: works.filter(isRecord).map(normalizeWork),
    total: Math.trunc(pickNumber(pagination, ['totalCount']) ?? works.length),
    page: Math.trunc(pickNumber(pagination, ['currentPage']) ?? fallbackPage),
    pageSize: Math.trunc(pickNumber(pagination, ['pageSize']) ?? fallbackPageSize),
  };
}

function languageLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (normalized === 'jpn' || normalized === 'ja' || normalized === '日本語') {
    return '日本語';
  }
  if (
    normalized === 'chi_hans' ||
    normalized === 'zh-cn' ||
    normalized === 'zh_cn' ||
    normalized === '简体中文'
  ) {
    return '简体中文';
  }
  if (
    normalized === 'chi_hant' ||
    normalized === 'zh-tw' ||
    normalized === 'zh_tw' ||
    normalized === '繁體中文' ||
    normalized === '繁体中文'
  ) {
    return '繁体中文';
  }
  if (normalized === 'eng' || normalized === 'en' || normalized === 'english') {
    return 'English';
  }
  return value.trim();
}

function parseLanguageEditions(
  record: Record<string, unknown>,
  currentCode: string,
  currentTitle: string,
): AsmrOneLanguageEdition[] {
  const editions = new Map<string, AsmrOneLanguageEdition>();
  const translation = isRecord(record.translation_info) ? record.translation_info : {};
  const translationLang = pickString(translation, ['lang']);
  const isOriginal =
    Boolean(translation.is_original) ||
    (!translation.is_child && !translation.parent_workno && !translation.original_workno);

  const add = (code: string, label: string, title: string, original: boolean) => {
    const normalized = code.trim().toUpperCase();
    if (!normalized) {
      return;
    }
    const next: AsmrOneLanguageEdition = {
      code: normalized,
      label: label.trim() || normalized,
      lang: label.trim(),
      title: title.trim(),
      isOriginal: original,
    };
    const existing = editions.get(normalized);
    if (!existing) {
      editions.set(normalized, next);
      return;
    }
    if (!existing.label && next.label) {
      existing.label = next.label;
    }
    if (!existing.title && next.title) {
      existing.title = next.title;
    }
    existing.isOriginal = existing.isOriginal || original;
  };

  add(
    currentCode,
    languageLabel(translationLang) || (isOriginal ? '日本語' : '当前版本'),
    currentTitle,
    isOriginal,
  );
  if (Array.isArray(record.language_editions)) {
    for (const item of record.language_editions) {
      if (!isRecord(item)) {
        continue;
      }
      add(
        pickString(item, ['workno', 'code']),
        pickString(item, ['label', 'lang']),
        '',
        false,
      );
    }
  }
  if (Array.isArray(record.other_language_editions_in_db)) {
    for (const item of record.other_language_editions_in_db) {
      if (!isRecord(item)) {
        continue;
      }
      add(
        pickString(item, ['source_id', 'workno', 'code']),
        languageLabel(pickString(item, ['lang'])),
        pickString(item, ['title']),
        Boolean(item.is_original),
      );
    }
  }
  return [...editions.values()].sort(
    (a, b) =>
      Number(b.isOriginal) - Number(a.isOriginal) ||
      (a.code === currentCode ? -1 : b.code === currentCode ? 1 : 0),
  );
}

function normalizeFileType(value: string): AsmrOneFileType {
  const type = value.trim().toLowerCase();
  if (type === 'audio' || type === 'video' || type === 'image' || type === 'text') {
    return type;
  }
  return 'other';
}

function buildTrackTree(
  value: unknown,
  pathParts: string[] = [],
  files: AsmrOneFile[] = [],
): AsmrOneTrackNode[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => buildTrackTree(item, pathParts, files));
  }
  if (!isRecord(value)) {
    return [];
  }
  const children = Array.isArray(value.children) ? value.children : null;
  const title = pickString(value, ['title', 'name']) || '未命名';
  if (children) {
    return [
      {
        type: 'folder',
        title,
        children: buildTrackTree(children, [...pathParts, title], files),
      },
    ];
  }
  const streamUrl = pickString(value, ['mediaStreamUrl', 'streamUrl', 'stream_url']);
  const hash = pickString(value, ['hash', 'media_hash', 'mediaHash']);
  if (!streamUrl || !hash) {
    return [];
  }
  const type = normalizeFileType(pickString(value, ['type']));
  const durationSeconds = pickNumber(value, ['duration', 'length']);
  const durationMs = durationSeconds !== null ? Math.round(durationSeconds * 1000) : null;
  const size = Math.trunc(pickNumber(value, ['size', 'file_size']) ?? 0);
  const downloadUrl =
    pickString(value, ['mediaDownloadUrl', 'downloadUrl', 'download_url']) || streamUrl;
  files.push({
    hash,
    title,
    type,
    relativePath: [...pathParts, title].join('/'),
    disc: 1,
    groupTitle: pathParts[pathParts.length - 1] ?? '',
    durationMs,
    size,
    streamUrl,
    downloadUrl,
  });
  return [{ type, title, hash, durationMs, size }];
}

function normalizeWork(record: Record<string, unknown>): AsmrOneWork {
  const durationSeconds = pickNumber(record, ['duration']);
  const code = pickCode(record);
  const title = pickString(record, ['title', 'name', 'work_name']);
  return {
    id: Math.trunc(pickNumber(record, ['id', 'work_id']) ?? 0),
    code,
    title,
    circle:
      pickString(record, ['circle_name', 'maker_name']) ||
      pickString(record, ['name']) ||
      (isRecord(record.circle) ? pickString(record.circle, ['name', 'title']) : ''),
    releaseDate: pickString(record, ['release', 'release_date', 'date', 'regist_date']).slice(0, 10),
    rating: pickNumber(record, ['rate_average_2dp', 'rate_average', 'rate', 'rating', 'score']),
    priceYen: pickNumber(record, ['price', 'price_yen']),
    reviewCount: Math.trunc(pickNumber(record, ['review_count']) ?? 0),
    dlCount: Math.trunc(pickNumber(record, ['dl_count']) ?? 0),
    tags: localizeTags(pickNames(record.tags ?? record.tag)).slice(0, 20),
    vas: pickNames(record.vas ?? record.va).slice(0, 12),
    durationMs: durationSeconds !== null ? Math.round(durationSeconds * 1000) : null,
    languageEditions: parseLanguageEditions(record, code, title),
  };
}

function collectTracks(
  value: unknown,
  groupTitle: string,
  disc: number,
  output: AsmrOneTrack[],
): number {
  let groupCount = 0;
  if (Array.isArray(value)) {
    for (const item of value) {
      groupCount += collectTracks(item, groupTitle, disc, output);
    }
    return groupCount;
  }
  if (!isRecord(value)) {
    return 0;
  }
  const children = Array.isArray(value.children) ? value.children : null;
  if (children) {
    const title = pickString(value, ['title']) || groupTitle;
    const nextDisc = disc > 0 ? disc : 1;
    const childGroups = collectTracks(children, title, nextDisc, output);
    return Math.max(1, childGroups);
  }
  const streamUrl = pickString(value, ['mediaStreamUrl', 'streamUrl', 'stream_url']);
  if (!streamUrl) {
    return 0;
  }
  const mediaType = pickString(value, ['type']);
  if (mediaType && mediaType !== 'audio') {
    return 0;
  }
  const hash = pickString(value, ['hash', 'media_hash', 'mediaHash']);
  const durationSeconds = pickNumber(value, ['duration', 'length']);
  output.push({
    hash,
    title: pickString(value, ['title', 'name']) || `音轨 ${output.length + 1}`,
    disc: Math.max(1, disc),
    groupTitle,
    durationMs: durationSeconds !== null ? Math.round(durationSeconds * 1000) : null,
    size: Math.trunc(pickNumber(value, ['size', 'file_size']) ?? 0),
    streamUrl,
  });
  return 1;
}

function normalizeReviewWork(record: Record<string, unknown>): AsmrOneReviewWork {
  const progress = pickString(record, ['progress']);
  const rating = pickNumber(record, ['userRating', 'user_rating']);
  return {
    ...normalizeWork(record),
    userRating: rating !== null && rating > 0 ? rating : null,
    reviewText: pickString(record, ['review_text', 'reviewText']),
    progress:
      progress === 'marked' ||
      progress === 'listening' ||
      progress === 'listened' ||
      progress === 'replay' ||
      progress === 'postponed'
        ? progress
        : '',
    updatedAt: pickString(record, ['updated_at', 'updatedAt']).slice(0, 19),
    userName: pickString(record, ['user_name', 'userName']),
  };
}

function normalizePlaylist(record: Record<string, unknown>): AsmrOnePlaylist {
  const name = pickString(record, ['name', 'title']);
  return {
    id: pickString(record, ['id', 'playlist_id', 'playlistId']),
    name,
    description: pickString(record, ['description', 'desc']),
    privacy: Math.trunc(pickNumber(record, ['privacy']) ?? 0),
    locale: pickString(record, ['locale']),
    userName: pickString(record, ['user_name', 'userName']),
    worksCount: Math.trunc(pickNumber(record, ['works_count', 'worksCount']) ?? 0),
    likedCount: Math.trunc(pickNumber(record, ['liked_count', 'likedCount']) ?? 0),
    playbackCount: Math.trunc(pickNumber(record, ['playback_count', 'playbackCount']) ?? 0),
    createdAt: pickString(record, ['created_at', 'createdAt']).slice(0, 19),
    updatedAt: pickString(record, ['updated_at', 'updatedAt']).slice(0, 19),
    latestWorkId: Math.trunc(pickNumber(record, ['latestWorkID', 'latestWorkId']) ?? 0),
    systemKind:
      name === '__SYS_PLAYLIST_LIKED' ? 'liked' : name === '__SYS_PLAYLIST_MARKED' ? 'marked' : '',
  };
}

function parseReviewPage(
  payload: unknown,
  fallbackPage: number,
  fallbackPageSize: number,
): AsmrOneReviewPage {
  const works = isRecord(payload) && Array.isArray(payload.works) ? payload.works : [];
  const pagination = isRecord(payload) && isRecord(payload.pagination) ? payload.pagination : {};
  return {
    items: works.filter(isRecord).map(normalizeReviewWork),
    total: Math.trunc(pickNumber(pagination, ['totalCount']) ?? works.length),
    page: Math.trunc(pickNumber(pagination, ['currentPage', 'page']) ?? fallbackPage),
    pageSize: Math.trunc(pickNumber(pagination, ['pageSize']) ?? fallbackPageSize),
  };
}

function parsePlaylistPage(
  payload: unknown,
  fallbackPage: number,
  fallbackPageSize: number,
): AsmrOnePlaylistPage {
  const playlists =
    isRecord(payload) && Array.isArray(payload.playlists) ? payload.playlists : [];
  const pagination = isRecord(payload) && isRecord(payload.pagination) ? payload.pagination : {};
  return {
    items: playlists.filter(isRecord).map(normalizePlaylist),
    total: Math.trunc(pickNumber(pagination, ['totalCount']) ?? playlists.length),
    page: Math.trunc(pickNumber(pagination, ['currentPage', 'page']) ?? fallbackPage),
    pageSize: Math.trunc(pickNumber(pagination, ['pageSize']) ?? fallbackPageSize),
  };
}

function normalizeBaseUrl(raw: string): string {
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

function parsePreconnectOrigins(html: string): string[] {
  const origins = new Set<string>();
  const pattern = /https?:\/\/api\.[a-z0-9.-]+/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      origins.add(new URL(match[0]).origin);
    } catch {
      // 忽略非法 URL
    }
  }
  return [...origins];
}

function isAllowedMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') {
      return false;
    }
    const host = url.hostname.toLowerCase();
    return (
      host.includes('.') &&
      host !== 'localhost' &&
      !host.endsWith('.local') &&
      !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) &&
      !host.startsWith('[')
    );
  } catch {
    return false;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AsmrOneProvider {
  private readonly client: HttpClient;
  private readonly configuredBase: string;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private readonly cacheKey: string;
  private lastRequestAt = 0;
  private token = '';
  private basePromise: Promise<string> | null = null;
  private readonly tracksCache = new Map<number, { expiresAt: number; value: AsmrOneTracks }>();

  constructor(options: AsmrOneProviderOptions = {}) {
    this.client = new HttpClient(options.proxyUrl ? { proxyUrl: options.proxyUrl } : {});
    this.configuredBase = normalizeBaseUrl(options.baseUrl ?? '');
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.cacheKey = `${options.proxyUrl ?? ''}|${this.configuredBase}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'user-agent': BROWSER_UA,
      accept: 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7',
      origin: ASMR_SITE,
      referer: `${ASMR_SITE}/`,
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    };
  }

  setToken(token: string | null): void {
    this.token = token?.trim() ?? '';
  }

  private async throttle(): Promise<void> {
    const wait = this.minIntervalMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastRequestAt = Date.now();
  }

  private async verifyBase(baseUrl: string): Promise<boolean> {
    try {
      const response = await this.client.request(
        `${baseUrl}/api/works?page=1&pageSize=1`,
        {
          headers: this.headers(),
          timeoutMs: Math.min(this.timeoutMs, 12_000),
          maxBytes: 512 * 1024,
        },
      );
      if (response.status !== 200) {
        return false;
      }
      const payload: unknown = JSON.parse(response.text);
      return isRecord(payload) && Array.isArray(payload.works);
    } catch {
      return false;
    }
  }

  private async discoverBase(): Promise<string> {
    const cached = baseCache.get(this.cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.baseUrl;
    }
    const candidates: string[] = [];
    if (this.configuredBase && !/^https?:\/\/www\./i.test(this.configuredBase)) {
      candidates.push(this.configuredBase);
    }
    candidates.push(...KNOWN_API_BASES);
    for (const baseUrl of [...new Set(candidates)]) {
      if (await this.verifyBase(baseUrl)) {
        baseCache.set(this.cacheKey, { baseUrl, expiresAt: Date.now() + BASE_TTL_MS });
        return baseUrl;
      }
    }
    try {
      const site = await this.client.request(`${ASMR_SITE}/`, {
        headers: this.headers({ accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }),
        timeoutMs: Math.min(this.timeoutMs, 12_000),
        maxBytes: 2 * 1024 * 1024,
      });
      for (const baseUrl of parsePreconnectOrigins(site.text)) {
        if (await this.verifyBase(baseUrl)) {
          baseCache.set(this.cacheKey, { baseUrl, expiresAt: Date.now() + BASE_TTL_MS });
          return baseUrl;
        }
      }
    } catch {
      // 域名发现失败时统一抛出下一条错误
    }
    throw new AsmrOneError(
      'network',
      '无法连接 asmr.one API，请检查代理与网络后重试',
    );
  }

  private baseUrl(): Promise<string> {
    this.basePromise ??= this.discoverBase().catch((error: unknown) => {
      this.basePromise = null;
      throw error;
    });
    return this.basePromise;
  }

  private async requestJson<T>(
    path: string,
    options: { method?: string; body?: string } = {},
  ): Promise<T> {
    let baseUrl: string;
    try {
      baseUrl = await this.baseUrl();
    } catch (error) {
      if (error instanceof AsmrOneError) {
        throw error;
      }
      throw new AsmrOneError('network', describeError(error));
    }
    await this.throttle();
    let response: HttpResponse;
    try {
      const requestOptions: {
        method?: string;
        body?: string;
        headers: Record<string, string>;
        timeoutMs: number;
        maxBytes: number;
      } = {
        headers: this.headers(options.body ? { 'content-type': 'application/json' } : {}),
        timeoutMs: this.timeoutMs,
        maxBytes: 4 * 1024 * 1024,
      };
      if (options.method) {
        requestOptions.method = options.method;
      }
      if (options.body) {
        requestOptions.body = options.body;
      }
      response = await this.client.request(`${baseUrl}${path}`, requestOptions);
    } catch (error) {
      throw new AsmrOneError('network', `请求 asmr.one 失败：${describeError(error)}`);
    }
    if (response.status === 404) {
      throw new AsmrOneError('not_found', 'asmr.one 上不存在该资源', 404);
    }
    if (response.status === 401 || response.status === 403) {
      throw new AsmrOneError('unauthorized', 'asmr.one 要求登录或拒绝访问', response.status);
    }
    if (response.status < 200 || response.status >= 300) {
      const payload: unknown = (() => {
        try {
          return JSON.parse(response.text);
        } catch {
          return null;
        }
      })();
      const message =
        isRecord(payload) && typeof payload.error === 'string'
          ? payload.error
          : `asmr.one 返回 HTTP ${response.status}`;
      throw new AsmrOneError('http', message, response.status);
    }
    try {
      return JSON.parse(response.text) as T;
    } catch {
      throw new AsmrOneError('parse', 'asmr.one 返回的不是合法 JSON');
    }
  }

  async search(keyword: string, page = 1, pageSize = 24): Promise<AsmrOneSearchResult> {
    const trimmed = keyword.trim();
    if (!trimmed) {
      return { items: [], total: 0, page, pageSize };
    }
    const payload = await this.requestJson<unknown>(
      `/api/search/${encodeURIComponent(trimmed)}?page=${page}&pageSize=${pageSize}`,
    );
    return parseWorkPage(payload, page, pageSize);
  }

  async listWorks(
    order: AsmrOneListOrder,
    page = 1,
    pageSize = 20,
  ): Promise<AsmrOneSearchResult> {
    const payload = await this.requestJson<unknown>(
      `/api/works?order=${order}&sort=desc&page=${page}&pageSize=${pageSize}`,
    );
    return parseWorkPage(payload, page, pageSize);
  }

  async fetchWorkInfo(code: string): Promise<AsmrOneWork> {
    const payload = await this.requestJson<unknown>(
      `/api/workInfo/${encodeURIComponent(code)}`,
    );
    if (!isRecord(payload)) {
      throw new AsmrOneError('parse', 'asmr.one 作品详情格式不正确');
    }
    return normalizeWork(payload);
  }

  async listReviews(
    options: {
      page?: number;
      pageSize?: number;
      progress?: AsmrOneReviewProgress | null;
      order?: AsmrOneReviewOrder;
      sort?: 'asc' | 'desc';
    } = {},
  ): Promise<AsmrOneReviewPage> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      order: options.order ?? 'updated_at',
      sort: options.sort ?? 'desc',
    });
    if (options.progress) {
      params.set('filter', options.progress);
    }
    const payload = await this.requestJson<unknown>(`/api/review?${params.toString()}`);
    return parseReviewPage(payload, page, pageSize);
  }

  async listPlaylists(
    options: {
      page?: number;
      pageSize?: number;
      filterBy?: AsmrOnePlaylistFilter;
    } = {},
  ): Promise<AsmrOnePlaylistPage> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      filterBy: options.filterBy ?? 'all',
    });
    const payload = await this.requestJson<unknown>(
      `/api/playlist/get-playlists?${params.toString()}`,
    );
    return parsePlaylistPage(payload, page, pageSize);
  }

  async fetchPlaylistMetadata(id: string): Promise<AsmrOnePlaylist> {
    const payload = await this.requestJson<unknown>(
      `/api/playlist/get-playlist-metadata?id=${encodeURIComponent(id)}`,
    );
    if (!isRecord(payload)) {
      throw new AsmrOneError('parse', 'asmr.one 播放列表详情格式不正确');
    }
    return normalizePlaylist(payload);
  }

  async fetchPlaylistWorks(
    id: string,
    page = 1,
    pageSize = 20,
  ): Promise<AsmrOnePlaylistWorkPage> {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(50, Math.max(1, pageSize));
    const params = new URLSearchParams({
      id,
      page: String(safePage),
      pageSize: String(safePageSize),
    });
    const payload = await this.requestJson<unknown>(
      `/api/playlist/get-playlist-works?${params.toString()}`,
    );
    const works = isRecord(payload) && Array.isArray(payload.works) ? payload.works : [];
    const pagination = isRecord(payload) && isRecord(payload.pagination) ? payload.pagination : {};
    return {
      items: works.filter(isRecord).map(normalizeWork),
      total: Math.trunc(pickNumber(pagination, ['totalCount']) ?? works.length),
      page: Math.trunc(pickNumber(pagination, ['currentPage', 'page']) ?? safePage),
      pageSize: Math.trunc(pickNumber(pagination, ['pageSize']) ?? safePageSize),
    };
  }

  async fetchTracks(
    workId: number,
    options: { force?: boolean } = {},
  ): Promise<AsmrOneTracks> {
    if (!options.force) {
      const cached = this.tracksCache.get(workId);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
      }
    }
    const payload = await this.requestJson<unknown>(`/api/tracks/${workId}?v=2`);
    const items: AsmrOneTrack[] = [];
    const files: AsmrOneFile[] = [];
    const groupCount = collectTracks(payload, '', 1, items);
    const tree = buildTrackTree(payload, [], files);
    const value: AsmrOneTracks = {
      items: items.filter((track) => track.hash && track.streamUrl),
      files,
      tree,
      groupCount: Math.max(groupCount, 1),
    };
    this.tracksCache.set(workId, { expiresAt: Date.now() + TRACKS_TTL_MS, value });
    if (this.tracksCache.size > 20) {
      const oldest = this.tracksCache.keys().next().value;
      if (oldest !== undefined) {
        this.tracksCache.delete(oldest);
      }
    }
    return value;
  }

  async login(username: string, password: string): Promise<{ token: string; name: string }> {
    const payload = await this.requestJson<unknown>('/api/auth/me', {
      method: 'POST',
      body: JSON.stringify({ name: username, password }),
    });
    if (!isRecord(payload)) {
      throw new AsmrOneError('parse', 'asmr.one 登录返回格式不正确');
    }
    const token = pickString(payload, ['token', 'accessToken', 'access_token']);
    const user = isRecord(payload.user) ? payload.user : {};
    const name = pickString(user, ['name', 'username']) || pickString(payload, ['name', 'username']);
    if (!token) {
      throw new AsmrOneError('parse', 'asmr.one 登录成功但未返回 token');
    }
    return { token, name: name || username };
  }

  async fetchCover(
    workId: number,
    type: 'main' | 'sam',
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const baseUrl = await this.baseUrl();
    await this.throttle();
    try {
      const response = await this.client.request(
        `${baseUrl}/api/cover/${workId}.jpg?type=${type}`,
        {
          headers: this.headers({ accept: 'image/avif,image/webp,image/*,*/*;q=0.8' }),
          timeoutMs: Math.min(this.timeoutMs, 20_000),
          maxBytes: 12 * 1024 * 1024,
        },
      );
      if (response.status === 404) {
        throw new AsmrOneError('not_found', 'asmr.one 没有这张封面', 404);
      }
      if (response.status !== 200) {
        throw new AsmrOneError('http', `封面请求返回 HTTP ${response.status}`, response.status);
      }
      const contentType = responseHeader(response, 'content-type') || 'image/jpeg';
      return { buffer: response.body, contentType };
    } catch (error) {
      if (error instanceof AsmrOneError) {
        throw error;
      }
      throw new AsmrOneError('network', `获取在线封面失败：${describeError(error)}`);
    }
  }

  async openTrackStream(
    trackUrl: string,
    range: string | undefined,
    signal?: AbortSignal,
  ): Promise<HttpStreamResponse> {
    if (!isAllowedMediaUrl(trackUrl)) {
      throw new AsmrOneError('blocked', '在线媒体地址不在允许范围内');
    }
    try {
      return await this.client.stream(trackUrl, {
        headers: this.headers({
          accept: 'audio/*,application/octet-stream,*/*;q=0.8',
          ...(range ? { range } : {}),
        }),
        timeoutMs: 30_000,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      throw new AsmrOneError('network', `在线试听失败：${describeError(error)}`);
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
