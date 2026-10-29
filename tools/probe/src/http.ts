import { ProxyAgent, request, type Dispatcher } from 'undici';

export interface HttpClientOptions {
  proxy: string;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
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

export interface PrefixResponse extends HttpResponse {
  rangeHonored: boolean;
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

export function redactText(input: string): string {
  return input
    .replace(/(\/\/)([^/@\s]+)@/g, '$1***@')
    .replace(/([?&](?:token|key|pass(?:word)?|auth|secret|sig)=)[^&\s"']+/gi, '$1***');
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
    return redactText(url.toString());
  } catch {
    return redactText(raw);
  }
}

export function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

export class HttpClient {
  private readonly dispatcher: ProxyAgent | undefined;

  constructor(options: HttpClientOptions) {
    this.dispatcher = options.proxy ? new ProxyAgent(options.proxy) : undefined;
  }

  async request(url: string, options: RequestOptions = {}): Promise<HttpResponse> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    const headers: Record<string, string> = { ...(options.headers ?? {}) };

    let currentUrl = url;
    let currentMethod = (options.method ?? 'GET').toUpperCase();
    let currentBody: string | Buffer | undefined = options.body;
    let redirected = false;

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const requestOptions: UndiciRequestOptions = {
        method: currentMethod as Dispatcher.HttpMethod,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        maxRedirections: 0,
      };
      if (currentBody !== undefined) {
        requestOptions.body = currentBody;
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
        const shouldSwitchToGet =
          response.statusCode === 303 ||
          ((response.statusCode === 301 || response.statusCode === 302) &&
            currentMethod === 'POST');
        if (shouldSwitchToGet) {
          currentMethod = 'GET';
          currentBody = undefined;
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

  async getPrefix(
    url: string,
    bytes = 2048,
    options: Omit<RequestOptions, 'maxBytes'> = {},
  ): Promise<PrefixResponse> {
    const response = await this.request(url, {
      ...options,
      headers: {
        range: `bytes=0-${Math.max(0, bytes - 1)}`,
        ...(options.headers ?? {}),
      },
      maxBytes: bytes + 1,
    });

    return {
      ...response,
      rangeHonored: response.status === 206 || response.headers['content-range'] !== undefined,
    };
  }

  async close(): Promise<void> {
    await this.dispatcher?.close();
  }
}

export function responseHeader(response: HttpResponse, name: string): string {
  return headerValue(response.headers, name);
}
