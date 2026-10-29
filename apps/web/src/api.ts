export interface WorkSummary {
  id: number;
  code: string;
  codeType: string;
  title: string;
  circle: string;
  releaseDate: string;
  workType: string;
  tags: string[];
  vas: string[];
  rating: number | null;
  priceYen: number | null;
  favoriteAt: string;
  metadataStatus: string;
  coverAssetId: number | null;
  relativePath: string;
  rootId: number;
  trackCount: number;
  updatedAt: string;
}

export interface TrackSummary {
  id: number;
  workId: number;
  title: string;
  disc: number;
  idx: number;
  durationMs: number | null;
  fileName: string;
  relativePath: string;
  size: number;
  /** 由作品目录下的子文件夹推导出的变体标签，仅用于展示与筛选。 */
  variants: string[];
}

export interface PlaybackState {
  workId: number;
  trackId: number | null;
  positionMs: number;
  updatedAt: string;
}

export interface WorkDetail extends WorkSummary {
  tracks: TrackSummary[];
  playback: PlaybackState | null;
}

export interface RecentPlayback {
  workId: number;
  code: string;
  title: string;
  trackId: number | null;
  trackTitle: string;
  positionMs: number;
  updatedAt: string;
  coverAssetId: number | null;
}

export interface WorksPage {
  items: WorkSummary[];
  total: number;
  limit: number;
  offset: number;
  sort?: WorkSort;
  favoriteOnly?: boolean;
}

export type WorkSort = 'updated' | 'popular' | 'rating' | 'released' | 'title';

export interface ScanResult {
  rootId: number;
  rootPath: string;
  worksFound: number;
  worksAdded: number;
  worksUpdated: number;
  tracksFound: number;
  skippedDuplicates: number;
  duplicates: Array<{ code: string; path: string; keptPath: string }>;
  errors: string[];
  durationMs: number;
}

export interface Health {
  ok: boolean;
  version: string;
  libraryPath: string;
  libraryPaths: string[];
  workCount: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(message: string, status: number, data: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

let authRequiredListener: (() => void) | null = null;

export function setAuthRequiredListener(listener: (() => void) | null): void {
  authRequiredListener = listener;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('无法连接本地服务，请确认后端已启动', 0);
  }
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    if (
      response.status === 401 &&
      data &&
      typeof data === 'object' &&
      'code' in data &&
      data.code === 'AUTH_REQUIRED'
    ) {
      authRequiredListener?.();
    }
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `请求失败（HTTP ${response.status}）`;
    throw new ApiError(message, response.status, data);
  }
  return data as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export interface PingInfo {
  ok: boolean;
  name: string;
  version: string;
  serverTime: string;
}

export function pingServer(): Promise<PingInfo> {
  return request<PingInfo>('/api/ping');
}

export function getHealth(): Promise<Health> {
  return request<Health>('/api/health');
}

export function listWorks(options: {
  query?: string;
  tag?: string;
  circle?: string;
  va?: string;
  limit: number;
  offset: number;
  sort?: WorkSort;
  favoriteOnly?: boolean;
}): Promise<WorksPage> {
  const params = new URLSearchParams({
    limit: String(options.limit),
    offset: String(options.offset),
  });
  if (options.query) {
    params.set('q', options.query);
  }
  if (options.tag) {
    params.set('tag', options.tag);
  }
  if (options.circle) {
    params.set('circle', options.circle);
  }
  if (options.va) {
    params.set('va', options.va);
  }
  if (options.sort) {
    params.set('sort', options.sort);
  }
  if (options.favoriteOnly) {
    params.set('favorite', '1');
  }
  return request<WorksPage>(`/api/works?${params.toString()}`);
}

export function getRandomWork(): Promise<{
  id: number;
  code: string;
  title: string;
  trackCount: number;
}> {
  return request<{ id: number; code: string; title: string; trackCount: number }>(
    '/api/works/random',
  );
}

export interface WorkMetadataInput {
  title?: string;
  circle?: string;
  releaseDate?: string;
  workType?: string;
  tags?: string[];
  vas?: string[];
  rating?: number | null;
  priceYen?: number | null;
}

export function updateWorkMetadata(
  code: string,
  input: WorkMetadataInput,
): Promise<WorkDetail> {
  return request<WorkDetail>(
    `/api/works/${encodeURIComponent(code)}`,
    jsonInit('PATCH', input),
  );
}

export function setWorkFavorite(
  code: string,
  favorite: boolean,
): Promise<{ code: string; favoriteAt: string }> {
  return request<{ code: string; favoriteAt: string }>(
    `/api/works/${encodeURIComponent(code)}/favorite`,
    jsonInit('PUT', { favorite }),
  );
}

export function enrichWork(code: string): Promise<{ work: WorkDetail }> {
  return request<{ work: WorkDetail }>(
    `/api/works/${encodeURIComponent(code)}/enrich`,
    jsonInit('POST', {}),
  );
}

export function getWork(code: string): Promise<WorkDetail> {
  return request<WorkDetail>(`/api/works/${encodeURIComponent(code)}`);
}

export type WorkFileKind = 'audio' | 'video' | 'image' | 'subtitle' | 'other';

export interface WorkFileEntry {
  /** 相对作品目录的 posix 路径。 */
  path: string;
  name: string;
  kind: WorkFileKind;
  size: number;
  mtimeMs: number;
  durationMs: number | null;
  trackId: number | null;
}

export interface WorkFilesResult {
  code: string;
  workPath: string;
  files: WorkFileEntry[];
  warnings: string[];
  truncated: boolean;
}

export function listWorkFiles(code: string): Promise<WorkFilesResult> {
  return request<WorkFilesResult>(`/api/works/${encodeURIComponent(code)}/files`);
}

export function workFileUrl(code: string, path: string): string {
  return `/api/works/${encodeURIComponent(code)}/file?path=${encodeURIComponent(path)}`;
}

export function openWorkFolder(code: string): Promise<{ opened: boolean }> {
  return request<{ opened: boolean }>(
    `/api/works/${encodeURIComponent(code)}/open-folder`,
    { method: 'POST' },
  );
}

export function scanLibrary(rootPath: string): Promise<ScanResult> {
  return request<ScanResult>('/api/scan', jsonInit('POST', { rootPath }));
}

export function scanAllLibraries(): Promise<{ results: ScanResult[] }> {
  return request<{ results: ScanResult[] }>('/api/scan', jsonInit('POST', {}));
}

export function getRecentPlayback(limit = 12): Promise<{ items: RecentPlayback[] }> {
  return request<{ items: RecentPlayback[] }>(`/api/playback/recent?limit=${limit}`);
}

export function savePlayback(input: {
  workId: number;
  trackId: number | null;
  positionMs: number;
}): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/playback', jsonInit('PUT', input));
}

export function streamUrl(trackId: number): string {
  return `/api/tracks/${trackId}/stream`;
}

export function coverUrl(
  assetId: number,
  size: '240' | '600' | 'original' = '240',
): string {
  return `/api/assets/${assetId}?size=${size}`;
}

export interface AppSettings {
  libraryPaths: string[];
  /** 主库根，等价于 libraryPaths[0]。 */
  libraryPath: string;
  proxyUrl: string;
  ffprobePath: string;
  ffmpegPath: string;
  asmroneBaseUrl: string;
  exportConcurrency: number;
  lanEnabled: boolean;
}

export interface SettingsUpdate extends Partial<AppSettings> {
  password?: string;
  currentPassword?: string;
}

export type SavedSettings = AppSettings & { restartRequired?: boolean };

export interface AuthStatus {
  required: boolean;
  authenticated: boolean;
  hasPassword: boolean;
}

export interface AccessAddress {
  name: string;
  address: string;
  url: string;
}

export interface AccessInfo {
  lanEnabled: boolean;
  hasPassword: boolean;
  boundToLan: boolean;
  restartRequired: boolean;
  port: number;
  addresses: AccessAddress[];
}

export function getAuthStatus(): Promise<AuthStatus> {
  return request<AuthStatus>('/api/auth/status');
}

export function loginWithPassword(
  password: string,
): Promise<{ ok: boolean; expiresAt: string }> {
  return request<{ ok: boolean; expiresAt: string }>(
    '/api/auth/login',
    jsonInit('POST', { password }),
  );
}

export function logoutSession(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/auth/logout', jsonInit('POST', {}));
}

export function getAccessInfo(): Promise<AccessInfo> {
  return request<AccessInfo>('/api/access');
}

export interface NetworkInterfaceInfo {
  name: string;
  address: string;
  mac: string;
}

export interface NetworkInfo {
  interfaces: NetworkInterfaceInfo[];
}

export function getNetworkInfo(): Promise<NetworkInfo> {
  return request<NetworkInfo>('/api/network');
}

export type LibraryKind = 'local' | 'mounted';

export interface LibraryRootStatus {
  path: string;
  rootId: number;
  workCount: number;
  kind: LibraryKind;
}

export function getLibraryRoots(): Promise<{ roots: LibraryRootStatus[] }> {
  return request<{ roots: LibraryRootStatus[] }>('/api/library/roots');
}

export function getSettings(): Promise<AppSettings> {
  return request<AppSettings>('/api/settings');
}

export function updateSettings(patch: SettingsUpdate): Promise<SavedSettings> {
  return request<SavedSettings>('/api/settings', jsonInit('PUT', patch));
}

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
  source: 'dlsite' | 'asmrone';
  work?: WorkDetail;
}

export interface ProbeResult {
  workId: number;
  total: number;
  updated: number;
  failed: number;
  skipped: number;
  work: WorkDetail;
}

export interface ScrapeJobResult {
  total: number;
  failed: number;
  cached: number;
  results: ScrapeWorkResult[];
}

export interface Job<TResult = unknown> {
  id: number;
  type: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: number;
  lastError: string;
  payload: unknown;
  result: TResult | null;
  createdAt: string;
  updatedAt: string;
}

export function scrapeWork(
  code: string,
  source: 'auto' | 'dlsite' | 'asmrone' = 'auto',
): Promise<ScrapeWorkResult> {
  return request<ScrapeWorkResult>(
    `/api/works/${encodeURIComponent(code)}/scrape`,
    jsonInit('POST', { source }),
  );
}

export function probeWork(code: string): Promise<ProbeResult> {
  return request<ProbeResult>(
    `/api/works/${encodeURIComponent(code)}/probe`,
    jsonInit('POST', {}),
  );
}

export function startScrape(input: {
  codes?: string[];
  force?: boolean;
  rootPath?: string;
}): Promise<{
  jobId: number;
  total: number;
}> {
  return request<{ jobId: number; total: number }>('/api/scrape', jsonInit('POST', input));
}

export function getJob<TResult = unknown>(jobId: number): Promise<Job<TResult>> {
  return request<Job<TResult>>(`/api/jobs/${jobId}`);
}

export function listJobs<TResult = unknown>(options?: {
  limit?: number;
  type?: string;
}): Promise<{ items: Array<Job<TResult>> }> {
  const params = new URLSearchParams();
  if (options?.limit) {
    params.set('limit', String(options.limit));
  }
  if (options?.type) {
    params.set('type', options.type);
  }
  const query = params.toString();
  return request<{ items: Array<Job<TResult>> }>(`/api/jobs${query ? `?${query}` : ''}`);
}

export interface OnlineLanguageEdition {
  code: string;
  label: string;
  lang: string;
  title: string;
  isOriginal: boolean;
}

export interface OnlineWork {
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
  languageEditions?: OnlineLanguageEdition[];
  coverUrl: string;
  thumbUrl: string;
  local: boolean;
  favoriteAt: string;
}

export type OnlineListOrder = 'create_date' | 'release' | 'dl_count' | 'rate_average_2dp';

export interface OnlineSearchPage {
  items: OnlineWork[];
  total: number;
  page: number;
  pageSize: number;
  order?: OnlineListOrder;
}

export interface OnlineTrack {
  index: number;
  hash: string;
  title: string;
  disc: number;
  groupTitle: string;
  durationMs: number | null;
  size: number;
  streamUrl: string;
}

export interface OnlineTrackNode {
  type: 'folder' | 'audio';
  title: string;
  hash?: string;
  durationMs?: number | null;
  size?: number;
  children?: OnlineTrackNode[];
}

export interface OnlinePlaybackState {
  remoteWorkId: number;
  code: string;
  trackHash: string;
  trackIndex: number;
  positionMs: number;
  updatedAt: string;
}

export interface OnlineWorkDetail {
  work: OnlineWork;
  tracks: OnlineTrack[];
  trackTree: OnlineTrackNode[];
  tracksError: string;
  playback: OnlinePlaybackState | null;
  localWork: {
    id: number;
    code: string;
    trackCount: number;
    favoriteAt: string;
    coverAssetId: number | null;
  } | null;
}

export interface OnlineAccount {
  connected: boolean;
  username: string;
  updatedAt: string;
}

export function searchOnline(
  keyword: string,
  page = 1,
  pageSize = 24,
): Promise<OnlineSearchPage> {
  const params = new URLSearchParams({
    q: keyword,
    page: String(page),
    pageSize: String(pageSize),
  });
  return request<OnlineSearchPage>(`/api/online/search?${params.toString()}`);
}

export function listOnlineWorks(
  order: OnlineListOrder,
  page = 1,
  pageSize = 20,
): Promise<OnlineSearchPage> {
  const params = new URLSearchParams({
    order,
    page: String(page),
    pageSize: String(pageSize),
  });
  return request<OnlineSearchPage>(`/api/online/works?${params.toString()}`);
}

export function getOnlineWork(code: string): Promise<OnlineWorkDetail> {
  return request<OnlineWorkDetail>(`/api/online/works/${encodeURIComponent(code)}`);
}

export function saveOnlinePlayback(input: {
  remoteWorkId: number;
  code: string;
  trackHash: string;
  trackIndex: number;
  positionMs: number;
}): Promise<OnlinePlaybackState> {
  return request<OnlinePlaybackState>('/api/online/playback', {
    ...jsonInit('PUT', input),
    keepalive: true,
  });
}

export function getOnlineAccount(): Promise<OnlineAccount> {
  return request<OnlineAccount>('/api/online/account');
}

export function loginOnline(
  username: string,
  password: string,
): Promise<{ connected: boolean; username: string }> {
  return request<{ connected: boolean; username: string }>(
    '/api/online/login',
    jsonInit('POST', { username, password }),
  );
}

export function logoutOnline(): Promise<{ connected: boolean }> {
  return request<{ connected: boolean }>('/api/online/logout', jsonInit('POST', {}));
}

export type OnlineReviewProgress =
  | 'marked'
  | 'listening'
  | 'listened'
  | 'replay'
  | 'postponed';

export type OnlineReviewOrder =
  | 'updated_at'
  | 'userRating'
  | 'release'
  | 'review_count'
  | 'dl_count';

export interface OnlineReviewWork extends OnlineWork {
  userRating: number | null;
  reviewText: string;
  progress: OnlineReviewProgress | '';
  updatedAt: string;
  userName: string;
}

export interface OnlineReviewPage {
  items: OnlineReviewWork[];
  total: number;
  page: number;
  pageSize: number;
  tab: 'review' | 'progress';
  progress: OnlineReviewProgress | '';
  order: OnlineReviewOrder;
  sort: 'asc' | 'desc';
}

export function getRandomOnlineWork(): Promise<{ work: OnlineWork }> {
  return request<{ work: OnlineWork }>('/api/online/random');
}

export function listOnlineFavorites(options: {
  tab?: 'review' | 'progress';
  progress?: OnlineReviewProgress | '';
  page?: number;
  pageSize?: number;
  order?: OnlineReviewOrder;
  sort?: 'asc' | 'desc';
} = {}): Promise<OnlineReviewPage> {
  const params = new URLSearchParams({
    tab: options.tab ?? 'review',
    page: String(options.page ?? 1),
    pageSize: String(options.pageSize ?? 20),
    order: options.order ?? 'updated_at',
    sort: options.sort ?? 'desc',
  });
  if (options.progress) {
    params.set('progress', options.progress);
  }
  return request<OnlineReviewPage>(`/api/online/favorites?${params.toString()}`);
}

export type OnlinePlaylistFilter = 'all' | 'owned' | 'liked';

export interface OnlinePlaylist {
  id: string;
  name: string;
  displayName: string;
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
  coverUrl: string;
}

export interface OnlinePlaylistPage {
  items: OnlinePlaylist[];
  total: number;
  page: number;
  pageSize: number;
  filterBy: OnlinePlaylistFilter;
}

export interface OnlinePlaylistDetail {
  playlist: OnlinePlaylist;
  works: OnlineWork[];
  total: number;
  page: number;
  pageSize: number;
}

export function listOnlinePlaylists(options: {
  filterBy?: OnlinePlaylistFilter;
  page?: number;
  pageSize?: number;
} = {}): Promise<OnlinePlaylistPage> {
  const params = new URLSearchParams({
    filterBy: options.filterBy ?? 'all',
    page: String(options.page ?? 1),
    pageSize: String(options.pageSize ?? 20),
  });
  return request<OnlinePlaylistPage>(`/api/online/playlists?${params.toString()}`);
}

export function getOnlinePlaylist(
  id: string,
  page = 1,
  pageSize = 20,
): Promise<OnlinePlaylistDetail> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  return request<OnlinePlaylistDetail>(
    `/api/online/playlists/${encodeURIComponent(id)}?${params.toString()}`,
  );
}

export type ExportJobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled';

export type ExportPhase = 'download' | 'finalize' | 'scan' | 'done';

export interface ExportTrack {
  hash: string;
  order: number;
  index: number;
  title: string;
  groupTitle: string;
  disc: number;
  size: number;
  durationMs: number | null;
  bytes: number;
  file: string;
  status: 'pending' | 'downloading' | 'done' | 'failed';
  error: string;
}

export interface ExportJobResult {
  relativePath: string;
  absolutePath: string;
  trackCount: number;
  bytes: number;
  cover: 'ok' | 'failed' | 'none';
  scan?: unknown;
}

export interface ExportJob {
  id: number;
  code: string;
  title: string;
  remoteWorkId: number;
  status: ExportJobStatus;
  progress: number;
  phase: ExportPhase;
  trackTotal: number;
  trackCompleted: number;
  targetRelativePath: string;
  targetRootPath: string;
  error: string;
  tracks: ExportTrack[];
  result: ExportJobResult | null;
  coverUrl: string;
  createdAt: string;
  updatedAt: string;
}

export function createExportJob(input: {
  code: string;
  hashes?: string[];
  concurrency?: number;
  rootPath?: string;
}): Promise<{ job: ExportJob | null }> {
  return request<{ job: ExportJob | null }>('/api/export/jobs', jsonInit('POST', input));
}

export function listExportJobs(options?: {
  limit?: number;
  status?: ExportJobStatus;
}): Promise<{ items: ExportJob[] }> {
  const params = new URLSearchParams();
  if (options?.limit) {
    params.set('limit', String(options.limit));
  }
  if (options?.status) {
    params.set('status', options.status);
  }
  const query = params.toString();
  return request<{ items: ExportJob[] }>(`/api/export/jobs${query ? `?${query}` : ''}`);
}

export function getExportJob(jobId: number): Promise<ExportJob> {
  return request<ExportJob>(`/api/export/jobs/${jobId}`);
}

function exportAction(jobId: number, action: 'pause' | 'resume' | 'retry' | 'cancel') {
  return request<ExportJob>(
    `/api/export/jobs/${jobId}/${action}`,
    jsonInit('POST', {}),
  );
}

export function pauseExportJob(jobId: number): Promise<ExportJob> {
  return exportAction(jobId, 'pause');
}

export function resumeExportJob(jobId: number): Promise<ExportJob> {
  return exportAction(jobId, 'resume');
}

export function retryExportJob(jobId: number): Promise<ExportJob> {
  return exportAction(jobId, 'retry');
}

export function cancelExportJob(jobId: number): Promise<ExportJob> {
  return exportAction(jobId, 'cancel');
}

export function deleteExportJob(jobId: number): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/export/jobs/${jobId}`, { method: 'DELETE' });
}

export type OperationLogLevel = 'info' | 'success' | 'warn' | 'error';

export type OperationLogCategory =
  | 'system'
  | 'desktop'
  | 'scan'
  | 'scrape'
  | 'export'
  | 'library'
  | 'settings'
  | 'auth'
  | 'online'
  | 'api';

export interface OperationLogEntry {
  id: number;
  level: OperationLogLevel;
  category: string;
  action: string;
  message: string;
  detail: unknown;
  clientIp: string;
  createdAt: string;
}

export interface OperationLogPage {
  items: OperationLogEntry[];
  latestId: number;
  hasMore: boolean;
}

export function listOperationLogs(options?: {
  limit?: number;
  before?: number;
  after?: number;
  level?: OperationLogLevel;
  category?: OperationLogCategory;
}): Promise<OperationLogPage> {
  const params = new URLSearchParams();
  if (options?.limit) {
    params.set('limit', String(options.limit));
  }
  if (options?.before) {
    params.set('before', String(options.before));
  }
  if (options?.after) {
    params.set('after', String(options.after));
  }
  if (options?.level) {
    params.set('level', options.level);
  }
  if (options?.category) {
    params.set('category', options.category);
  }
  const query = params.toString();
  return request<OperationLogPage>(`/api/logs${query ? `?${query}` : ''}`);
}

export function clearOperationLogs(): Promise<{ ok: boolean; entry: OperationLogEntry }> {
  return request<{ ok: boolean; entry: OperationLogEntry }>('/api/logs', {
    method: 'DELETE',
  });
}

export const OPERATION_LOG_STREAM_URL = '/api/logs/stream';
