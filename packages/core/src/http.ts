import { Readable } from 'node:stream';
import { ProxyAgent, request, type Dispatcher } from 'undici';

export interface HttpClientOptions {
  proxyUrl?: string;
  defaultTimeoutMs?: number;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface HttpStreamResponse {
  status: number;
  headers: Record<string, string>;
  url: string;
  body: Readable;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  url: string;
  body: Buffer;
  text: string;
  truncated: boolean;
  redirected: boolean;
}

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

type UndiciRequestOptions = NonNullable<Parameters<typeof request>[1]>;

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return value ?? '';
}

function normalizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return normalized;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function readBody(
  body: Dispatcher.ResponseData['body'],
  maxBytes: number,
): Promise<{ body: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;

  for await (const chunk of body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    total += buffer.length;
    if (total >= maxBytes) {
      truncated = total > maxBytes;
      body.destroy();
      break;
    }
  }

  return { body: Buffer.concat(chunks).subarray(0, maxBytes), truncated };
}

export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.username) {
      url.username = '***';
    }
    if (url.password) {
      url.password = '***';
    }
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|pass|auth|secret|sig/i.test(key)) {
        url.searchParams.set(key, '***');
      }
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export class HttpClient {
  private readonly dispatcher: ProxyAgent | undefined;
  private readonly defaultTimeoutMs: number;

  constructor(options: HttpClientOptions = {}) {
    const proxyUrl = options.proxyUrl?.trim() ?? '';
    const normalizedProxy =
      proxyUrl && !/^[a-z][a-z0-9+.-]*:\/\//i.test(proxyUrl) ? `http://${proxyUrl}` : proxyUrl;
    this.dispatcher = normalizedProxy ? new ProxyAgent(normalizedProxy) : undefined;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async request(url: string, options: RequestOptions = {}): Promise<HttpResponse> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    const headers: Record<string, string> = { ...(options.headers ?? {}) };

    let currentUrl = url;
    let currentMethod = (options.method ?? 'GET').toUpperCase();
    let redirected = false;

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const requestOptions: UndiciRequestOptions = {
        method: currentMethod as Dispatcher.HttpMethod,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        maxRedirections: 0,
      };
      if (options.body !== undefined) {
        requestOptions.body = options.body;
      }
      if (this.dispatcher) {
        requestOptions.dispatcher = this.dispatcher;
      }

      const response = await request(currentUrl, requestOptions);
      const responseHeaders = normalizeHeaders(response.headers);
      const location = responseHeaders.location ?? '';

      if (isRedirect(response.statusCode) && location && hop < maxRedirects) {
        await response.body.dump();
        const nextUrl = new URL(location, currentUrl);
        if (nextUrl.origin !== new URL(currentUrl).origin) {
          delete headers.authorization;
        }
        if (response.statusCode === 303) {
          currentMethod = 'GET';
          delete headers['content-type'];
          delete headers['content-length'];
        }
        currentUrl = nextUrl.toString();
        redirected = true;
        continue;
      }

      const { body, truncated } = await readBody(response.body, maxBytes);
      return {
        status: response.statusCode,
        headers: responseHeaders,
        url: currentUrl,
        body,
        text: body.toString('utf8').replace(/^\uFEFF/, ''),
        truncated,
        redirected,
      };
    }

    throw new Error(`重定向次数超过上限（${maxRedirects}）：${redactUrl(url)}`);
  }

  async stream(
    url: string,
    options: RequestOptions & { signal?: AbortSignal } = {},
  ): Promise<HttpStreamResponse> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    let requestBody = options.body;
    let currentUrl = url;
    let currentMethod = (options.method ?? 'GET').toUpperCase();

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const requestOptions: UndiciRequestOptions = {
        method: currentMethod as Dispatcher.HttpMethod,
        headers,
        signal: options.signal ?? AbortSignal.timeout(timeoutMs),
        maxRedirections: 0,
      };
      if (requestBody !== undefined) {
        requestOptions.body = requestBody;
      }
      if (this.dispatcher) {
        requestOptions.dispatcher = this.dispatcher;
      }

      const response = await request(currentUrl, requestOptions);
      const responseHeaders = normalizeHeaders(response.headers);
      const location = responseHeaders.location ?? '';
      if (isRedirect(response.statusCode) && location && hop < maxRedirects) {
        await response.body.dump();
        const nextUrl = new URL(location, currentUrl);
        if (nextUrl.origin !== new URL(currentUrl).origin) {
          delete headers.authorization;
        }
        if (response.statusCode === 303) {
          currentMethod = 'GET';
          delete headers['content-type'];
          delete headers['content-length'];
          requestBody = undefined;
        }
        currentUrl = nextUrl.toString();
        continue;
      }

      return {
        status: response.statusCode,
        headers: responseHeaders,
        url: currentUrl,
        body: Readable.from(response.body),
      };
    }

    throw new Error(`重定向次数超过上限（${maxRedirects}）：${redactUrl(url)}`);
  }

  async getPrefix(
    url: string,
    bytes = 2048,
    options: Omit<RequestOptions, 'maxBytes'> = {},
  ): Promise<HttpResponse> {
    return this.request(url, {
      ...options,
      headers: {
        range: `bytes=0-${Math.max(0, bytes - 1)}`,
        ...(options.headers ?? {}),
      },
      maxBytes: bytes + 1,
    });
  }

  async close(): Promise<void> {
    await this.dispatcher?.close();
  }
}

export function responseHeader(response: HttpResponse, name: string): string {
  return headerValue(response.headers, name);
}
