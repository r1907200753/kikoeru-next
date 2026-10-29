import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { LoadedConfig, ProbeConfig } from './types.js';

const EXAMPLE_CONFIG_PATH = fileURLToPath(
  new URL('../probe.config.example.json', import.meta.url),
);

const DEFAULT_CONFIG: ProbeConfig = {
  proxy: '',
  dlsite: {
    workno: 'RJ01426915',
    timeoutMs: 25000,
  },
  asmrone: {
    baseUrl: '',
    workno: '',
    username: '',
    password: '',
    timeoutMs: 25000,
  },
  webdav: {
    baseUrl: '',
    username: '',
    password: '',
    rootPath: '/',
    timeoutMs: 25000,
    writeTest: true,
  },
  local: {
    libraryPath: '',
    probeFfprobe: true,
    ffprobePath: 'ffprobe',
  },
};

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function normalizeProxy(raw: string): string {
  const value = raw.trim();
  if (!value) {
    return '';
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return value;
  }
  return `http://${value}`;
}

function normalizeConfig(raw: unknown): ProbeConfig {
  const root = asRecord(raw);
  const dlsite = asRecord(root.dlsite);
  const asmrone = asRecord(root.asmrone);
  const webdav = asRecord(root.webdav);
  const local = asRecord(root.local);

  return {
    proxy: normalizeProxy(asString(root.proxy, DEFAULT_CONFIG.proxy)),
    dlsite: {
      workno: asString(dlsite.workno, DEFAULT_CONFIG.dlsite.workno).trim().toUpperCase(),
      timeoutMs: asNumber(dlsite.timeoutMs, DEFAULT_CONFIG.dlsite.timeoutMs),
    },
    asmrone: {
      baseUrl: asString(asmrone.baseUrl, DEFAULT_CONFIG.asmrone.baseUrl).trim(),
      workno: asString(asmrone.workno, DEFAULT_CONFIG.asmrone.workno).trim().toUpperCase(),
      username: asString(asmrone.username, DEFAULT_CONFIG.asmrone.username),
      password: asString(asmrone.password, DEFAULT_CONFIG.asmrone.password),
      timeoutMs: asNumber(asmrone.timeoutMs, DEFAULT_CONFIG.asmrone.timeoutMs),
    },
    webdav: {
      baseUrl: asString(webdav.baseUrl, DEFAULT_CONFIG.webdav.baseUrl).trim(),
      username: asString(webdav.username, DEFAULT_CONFIG.webdav.username),
      password: asString(webdav.password, DEFAULT_CONFIG.webdav.password),
      rootPath: asString(webdav.rootPath, DEFAULT_CONFIG.webdav.rootPath).trim() || '/',
      timeoutMs: asNumber(webdav.timeoutMs, DEFAULT_CONFIG.webdav.timeoutMs),
      writeTest: asBoolean(webdav.writeTest, DEFAULT_CONFIG.webdav.writeTest),
    },
    local: {
      libraryPath: asString(local.libraryPath, DEFAULT_CONFIG.local.libraryPath).trim(),
      probeFfprobe: asBoolean(local.probeFfprobe, DEFAULT_CONFIG.local.probeFfprobe),
      ffprobePath:
        asString(local.ffprobePath, DEFAULT_CONFIG.local.ffprobePath).trim() ||
        DEFAULT_CONFIG.local.ffprobePath,
    },
  };
}

export async function loadConfig(configPath: string): Promise<LoadedConfig> {
  const warnings: string[] = [];
  let rawText: string;
  let source = configPath;

  try {
    rawText = await readFile(configPath, 'utf8');
  } catch {
    source = EXAMPLE_CONFIG_PATH;
    try {
      rawText = await readFile(source, 'utf8');
      warnings.push(
        `未找到 ${configPath}，已回退到示例配置。请复制 probe.config.example.json 为 probe.config.json 并填写代理/路径。`,
      );
    } catch {
      source = '<内置默认配置>';
      rawText = JSON.stringify(DEFAULT_CONFIG);
      warnings.push(
        `未找到 ${configPath}，示例配置也不存在，已使用内置默认值运行；外部链路将因缺少代理而失败。`,
      );
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`配置文件不是合法 JSON：${source} (${error instanceof Error ? error.message : String(error)})`);
  }

  const config = normalizeConfig(parsed);

  if (config.proxy) {
    try {
      const proxyUrl = new URL(config.proxy);
      if (proxyUrl.protocol !== 'http:' && proxyUrl.protocol !== 'https:') {
        warnings.push(
          `代理协议 ${proxyUrl.protocol} 不受支持；undici 只支持 HTTP/HTTPS 代理，请换成本机 HTTP 代理端口。`,
        );
      }
    } catch {
      warnings.push('代理地址无法解析，请填写 http://host:port 或 https://host:port。');
    }
  } else {
    warnings.push('未配置代理。当前网络直连 DLsite/asmr.one 可能超时。');
  }

  if (!/^[RBV]J\d{6,8}$/.test(config.dlsite.workno)) {
    warnings.push(`dlsite.workno 看起来不是标准番号：${config.dlsite.workno}`);
  }

  return { config, source, warnings };
}

export function configSummary(config: ProbeConfig): {
  proxyConfigured: boolean;
  dlsiteWorkno: string;
  asmrBaseUrl: string;
  asmrLoginConfigured: boolean;
  webdavBaseUrl: string;
  webdavLoginConfigured: boolean;
  localLibraryPath: string;
} {
  return {
    proxyConfigured: config.proxy.length > 0,
    dlsiteWorkno: config.dlsite.workno,
    asmrBaseUrl: config.asmrone.baseUrl,
    asmrLoginConfigured: config.asmrone.username.length > 0 && config.asmrone.password.length > 0,
    webdavBaseUrl: config.webdav.baseUrl,
    webdavLoginConfigured: config.webdav.username.length > 0 && config.webdav.password.length > 0,
    localLibraryPath: config.local.libraryPath,
  };
}
