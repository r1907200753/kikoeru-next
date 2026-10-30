import { XMLParser } from 'fast-xml-parser';
import type { ProbeResult, WebDavConfig } from './types.js';
import { HttpClient, basicAuth, redactUrl, responseHeader } from './http.js';
import { captureProbe, skipped } from './result.js';

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype/>
    <d:getcontentlength/>
    <d:getlastmodified/>
    <d:displayname/>
  </d:prop>
</d:propfind>`;

const AUDIO_PATTERN = /\.(mp3|wav|flac|m4a|aac|ogg|opus|wma|ape|aiff?|wv)$/i;
const WORK_PATTERN = /(?:^|\/)([RBV]J\d{6,8})(?:[^/]*)\/?$/i;

export interface WebDavEntry {
  href: string;
  name: string;
  isCollection: boolean;
  length: number;
  lastModified: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined || value === null ? [] : [value];
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

export function joinWebDavUrl(baseUrl: string, rootPath: string, name = ''): string {
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/^\/+|\/+$/g, '');
  const root = rootPath.replace(/^\/+|\/+$/g, '');
  const extra = name.replace(/^\/+/g, '');
  const segments = [basePath, root, extra].filter(Boolean);
  base.pathname = `/${segments.join('/')}`;
  base.search = '';
  base.hash = '';
  return base.toString();
}

function extractProp(response: unknown): Record<string, unknown> {
  if (!isRecord(response)) {
    return {};
  }
  for (const propstat of toArray(response.propstat)) {
    if (isRecord(propstat) && isRecord(propstat.prop)) {
      return propstat.prop;
    }
  }
  return {};
}

export function parseMultiStatus(xml: string): WebDavEntry[] {
  const parser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: true,
    trimValues: true,
    parseTagValue: false,
  });
  const document: unknown = parser.parse(xml);
  const root = isRecord(document) && isRecord(document.multistatus) ? document.multistatus : {};
  const responses = toArray(root.response);
  const entries: WebDavEntry[] = [];

  for (const response of responses) {
    if (!isRecord(response)) {
      continue;
    }
    const href = asString(response.href).trim();
    if (!href) {
      continue;
    }
    const prop = extractProp(response);
    const resourceType = prop.resourcetype;
    const isCollection =
      (isRecord(resourceType) && Object.prototype.hasOwnProperty.call(resourceType, 'collection')) ||
      safeDecode(href).endsWith('/');
    const pathPart = safeDecode(href).replace(/\/+$/, '');
    const derivedName = pathPart.slice(pathPart.lastIndexOf('/') + 1);
    entries.push({
      href,
      name: asString(prop.displayname).trim() || derivedName,
      isCollection,
      length: asNumber(prop.getcontentlength),
      lastModified: asString(prop.getlastmodified).trim(),
    });
  }

  return entries;
}

function authHeaders(config: WebDavConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'user-agent': 'kikoeru-next-probe/0.1',
  };
  if (config.username || config.password) {
    headers.authorization = basicAuth(config.username, config.password);
  }
  return headers;
}

function absoluteFromHref(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

export async function runWebDavProbes(
  client: HttpClient,
  config: WebDavConfig,
): Promise<ProbeResult[]> {
  if (!config.baseUrl) {
    return [skipped('webdav.propfind', '未配置 webdav.baseUrl，跳过 CloudDrive2/WebDAV 验证')];
  }

  const timeoutMs = config.timeoutMs;
  const rootUrl = joinWebDavUrl(config.baseUrl, config.rootPath);
  const headers = authHeaders(config);
  const results: ProbeResult[] = [];
  let entries: WebDavEntry[] = [];

  results.push(
    await captureProbe('webdav.propfind', async () => {
      const response = await client.request(rootUrl, {
        method: 'PROPFIND',
        headers: {
          ...headers,
          depth: '1',
          'content-type': 'application/xml; charset=utf-8',
        },
        body: PROPFIND_BODY,
        timeoutMs,
        maxBytes: 4 * 1024 * 1024,
      });
      const details = {
        url: redactUrl(rootUrl),
        status: response.status,
        contentType: responseHeader(response, 'content-type'),
        bytes: response.body.length,
      };

      if (response.status !== 207) {
        return {
          status: 'fail',
          summary: `PROPFIND 返回 HTTP ${response.status}（期望 207 Multi-Status）`,
          details,
        };
      }

      entries = parseMultiStatus(response.text);
      if (entries.length === 0) {
        return {
          status: 'fail',
          summary: 'PROPFIND 返回 207，但未解析到任何条目（检查 XML 命名空间）',
          details,
        };
      }

      const workDirs = entries
        .filter(
          (entry) =>
            entry.isCollection && WORK_PATTERN.test(safeDecode(entry.href).replace(/\/+$/, '')),
        )
        .map((entry) => entry.name)
        .slice(0, 10);
      const audioFiles = entries
        .filter((entry) => !entry.isCollection && AUDIO_PATTERN.test(entry.name))
        .map((entry) => entry.name)
        .slice(0, 10);

      return {
        status: 'pass',
        summary: `目录可读，共 ${entries.length} 个条目；作品目录 ${workDirs.length} 个，音频 ${audioFiles.length} 个`,
        details: {
          ...details,
          entryCount: entries.length,
          directoryCount: entries.filter((entry) => entry.isCollection).length,
          fileCount: entries.filter((entry) => !entry.isCollection).length,
          directories: entries
            .filter((entry) => entry.isCollection)
            .map((entry) => entry.name)
            .slice(0, 10),
          workDirs,
          audioFiles,
        },
      };
    }),
  );

  if (entries.length === 0) {
    results.push(
      skipped('webdav.range', 'PROPFIND 未成功，跳过 Range 读取'),
      skipped('webdav.write_test', 'PROPFIND 未成功，跳过写入测试（避免在未确认目录上写入）'),
    );
    return results;
  }

  let sampleAudio = entries.find(
    (entry) => !entry.isCollection && AUDIO_PATTERN.test(entry.name),
  );
  let audioScopeUrl = rootUrl;
  let audioScope = 'root';

  if (!sampleAudio) {
    const workDir = entries.find(
      (entry) =>
        entry.isCollection && WORK_PATTERN.test(safeDecode(entry.href).replace(/\/+$/, '')),
    );
    if (workDir) {
      const workUrl = absoluteFromHref(workDir.href, rootUrl);
      try {
        const subResponse = await client.request(workUrl, {
          method: 'PROPFIND',
          headers: {
            ...headers,
            depth: '1',
            'content-type': 'application/xml; charset=utf-8',
          },
          body: PROPFIND_BODY,
          timeoutMs,
          maxBytes: 4 * 1024 * 1024,
        });
        if (subResponse.status === 207) {
          const subEntries = parseMultiStatus(subResponse.text);
          sampleAudio = subEntries.find(
            (entry) => !entry.isCollection && AUDIO_PATTERN.test(entry.name),
          );
          audioScopeUrl = workUrl;
          audioScope = `work:${workDir.name}`;
        }
      } catch {
        // 取样失败不影响主流程，Range 探针会标记 skip
      }
    }
  }

  if (sampleAudio) {
    const audioEntry = sampleAudio;
    results.push(
      await captureProbe('webdav.range', async () => {
        const url = absoluteFromHref(audioEntry.href, audioScopeUrl);
        const response = await client.getPrefix(url, 2048, {
          headers,
          timeoutMs,
        });
        const contentType = responseHeader(response, 'content-type');
        const ok =
          (response.status === 200 || response.status === 206) && response.body.length > 0;
        return {
          status: ok ? 'pass' : 'fail',
          summary: ok
            ? `音频可读（HTTP ${response.status}，Range：${response.rangeHonored ? '支持' : '未验证'}，${response.body.length} 字节）`
            : `音频读取失败（HTTP ${response.status}）`,
          details: {
            url: redactUrl(url),
            scope: audioScope,
            status: response.status,
            contentType,
            bytes: response.body.length,
            contentRange: responseHeader(response, 'content-range'),
            rangeHonored: response.rangeHonored,
          },
        };
      }),
    );
  } else {
    results.push(skipped('webdav.range', '根目录及样例作品目录均未发现音频文件，跳过真实文件 Range 读取'));
  }

  if (!config.writeTest) {
    results.push(skipped('webdav.write_test', 'webdav.writeTest=false，跳过写入/MOVE/清理测试'));
    return results;
  }

  results.push(
    await captureProbe('webdav.write_test', async () => {
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const dirName = `kikoeru-next-probe-${stamp}`;
      const asciiName = `kikoeru-next-probe-${stamp}.tmp`;
      const chineseName = `kikoeru-next-探针-${stamp}.tmp`;
      const payload = Buffer.from(`kikoeru-next webdav probe ${stamp}\n`, 'utf8');
      const dirUrl = joinWebDavUrl(config.baseUrl, config.rootPath, dirName);
      const steps: Array<Record<string, unknown>> = [];
      let mode: 'subdir' | 'root' = 'subdir';
      let mkcolStatus = 0;
      let putStatus = 0;
      let written = false;
      let moved = false;
      let fileUrl = '';
      let movedUrl = '';
      let cleanupOk = true;
      let failure = '';
      let readonly = false;

      const fileUrls = (): { asciiUrl: string; chineseUrl: string } => {
        const prefix = mode === 'subdir' ? `${dirName}/` : '';
        return {
          asciiUrl: joinWebDavUrl(config.baseUrl, config.rootPath, `${prefix}${asciiName}`),
          chineseUrl: joinWebDavUrl(config.baseUrl, config.rootPath, `${prefix}${chineseName}`),
        };
      };

      try {
        const mkcol = await client.request(dirUrl, {
          method: 'MKCOL',
          headers,
          timeoutMs,
        });
        mkcolStatus = mkcol.status;
        steps.push({ step: 'MKCOL', url: redactUrl(dirUrl), status: mkcol.status });
        if (![200, 201, 204].includes(mkcol.status)) {
          mode = 'root';
          steps.push({
            step: 'MKCOL_FALLBACK',
            reason: `HTTP ${mkcol.status}，改为在根目录直接写入`,
          });
        }

        const { asciiUrl, chineseUrl } = fileUrls();
        const put = await client.request(asciiUrl, {
          method: 'PUT',
          headers: { ...headers, 'content-type': 'application/octet-stream' },
          body: payload,
          timeoutMs,
        });
        putStatus = put.status;
        steps.push({ step: 'PUT', url: redactUrl(asciiUrl), status: put.status, mode });

        if ([403, 405, 501].includes(put.status)) {
          readonly = true;
        } else if (!isSuccess(put.status)) {
          failure =
            put.status === 409
              ? 'PUT 返回 HTTP 409，目标父目录不可写或不存在；请把 webdav.rootPath 指向 WebDAV 中已存在的可写目录'
              : `PUT 返回 HTTP ${put.status}`;
        } else {
          written = true;
          fileUrl = asciiUrl;
          const move = await client.request(asciiUrl, {
            method: 'MOVE',
            headers: {
              ...headers,
              destination: chineseUrl,
              overwrite: 'F',
            },
            timeoutMs,
          });
          steps.push({
            step: 'MOVE',
            destination: redactUrl(chineseUrl),
            status: move.status,
          });
          if (![200, 201, 204].includes(move.status)) {
            failure = `MOVE 返回 HTTP ${move.status}（中文文件名可能不被支持）`;
          } else {
            moved = true;
            fileUrl = '';
            movedUrl = chineseUrl;
            const readBack = await client.getPrefix(chineseUrl, payload.length, {
              headers,
              timeoutMs,
            });
            const matches = readBack.body.subarray(0, payload.length).equals(payload);
            steps.push({
              step: 'GET_RANGE',
              url: redactUrl(chineseUrl),
              status: readBack.status,
              bytes: readBack.body.length,
              rangeHonored: readBack.rangeHonored,
              contentMatches: matches,
            });
            if (!(readBack.status === 200 || readBack.status === 206) || !matches) {
              failure = `移动后读取校验失败（HTTP ${readBack.status}，内容匹配：${matches}）`;
            }
          }
        }
      } finally {
        const cleanupTargets: string[] = [];
        if (moved) {
          cleanupTargets.push(movedUrl);
        } else if (written) {
          cleanupTargets.push(fileUrl);
        }
        if (mode === 'subdir') {
          cleanupTargets.push(dirUrl);
        }
        for (const target of cleanupTargets) {
          try {
            const response = await client.request(target, {
              method: 'DELETE',
              headers,
              timeoutMs,
            });
            const ok = isSuccess(response.status) || response.status === 404;
            cleanupOk = cleanupOk && ok;
            steps.push({ step: 'DELETE', url: redactUrl(target), status: response.status });
          } catch (error) {
            cleanupOk = false;
            steps.push({
              step: 'DELETE',
              url: redactUrl(target),
              status: 0,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      const details = {
        root: redactUrl(rootUrl),
        mode,
        mkcolStatus,
        putStatus,
        directory: mode === 'subdir' ? dirName : '',
        asciiName,
        chineseName,
        steps,
        cleanupOk,
      };

      if (readonly) {
        return {
          status: 'skip',
          summary: `WebDAV 不支持写入（MKCOL ${mkcolStatus}，PUT ${putStatus}），导出请使用本地挂载盘`,
          details,
        };
      }
      if (failure) {
        return {
          status: 'fail',
          summary: `${failure}${cleanupOk ? '；临时文件已清理' : '；临时文件清理失败，请手动删除'}`,
          details,
        };
      }
      if (!cleanupOk) {
        return {
          status: 'fail',
          summary: '写入/MOVE/中文名/读取均成功，但临时文件清理失败，请手动删除',
          details,
        };
      }
      return {
        status: 'pass',
        summary:
          mode === 'root'
            ? 'WebDAV 不支持 MKCOL，已在根目录完成 PUT、MOVE 中文名、Range 读取与清理'
            : '写入、MKCOL、MOVE 到中文文件名、Range 读取、清理全部成功',
        details,
      };
    }),
  );

  return results;
}
