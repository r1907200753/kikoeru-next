export interface DlsiteConfig {
  workno: string;
  timeoutMs: number;
}

export interface AsmrOneConfig {
  baseUrl: string;
  workno: string;
  username: string;
  password: string;
  timeoutMs: number;
}

export interface WebDavConfig {
  baseUrl: string;
  username: string;
  password: string;
  rootPath: string;
  timeoutMs: number;
  writeTest: boolean;
}

export interface LocalConfig {
  libraryPath: string;
  probeFfprobe: boolean;
  ffprobePath: string;
}

export interface ProbeConfig {
  proxy: string;
  dlsite: DlsiteConfig;
  asmrone: AsmrOneConfig;
  webdav: WebDavConfig;
  local: LocalConfig;
}

export type ProbeStatus = 'pass' | 'fail' | 'skip';

export interface ProbeResult {
  name: string;
  status: ProbeStatus;
  summary: string;
  ms: number;
  error: string;
  details: Record<string, unknown>;
}

export interface ProbeEnvironment {
  node: string;
  platform: string;
  arch: string;
  cwd: string;
  ffprobe: string;
}

export interface ProbeConfigSummary {
  proxyConfigured: boolean;
  dlsiteWorkno: string;
  asmrBaseUrl: string;
  asmrLoginConfigured: boolean;
  webdavBaseUrl: string;
  webdavLoginConfigured: boolean;
  localLibraryPath: string;
}

export interface ProbeReport {
  generatedAt: string;
  environment: ProbeEnvironment;
  config: ProbeConfigSummary;
  results: ProbeResult[];
}

export interface LoadedConfig {
  config: ProbeConfig;
  source: string;
  warnings: string[];
}
