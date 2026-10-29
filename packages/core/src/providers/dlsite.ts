import { load as loadHtml, type CheerioAPI } from 'cheerio';
import { localizeTags } from '@kikoeru-next/shared';
import { HttpClient, redactUrl, responseHeader, type HttpResponse } from '../http.js';

const DL_BASE = 'https://www.dlsite.com/maniax';
const DL_IMAGE_BASE = 'https://img.dlsite.jp';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DEFAULT_MIN_INTERVAL_MS = 600;

export type ScrapeErrorKind =
  | 'not_found'
  | 'age_gate'
  | 'http_error'
  | 'rate_limited'
  | 'parse_changed'
  | 'network';

export interface DlsiteProductInfo {
  title: string;
  circle: string;
  workType: string;
  releaseDate: string;
  coverUrl: string;
  translationOriginalCode: string;
  rating: number | null;
  priceYen: number | null;
}

export interface DlsiteWorkPageInfo {
  title: string;
  circle: string;
  workType: string;
  releaseDate: string;
  tags: string[];
  vas: string[];
  coverUrl: string;
  ageGate: boolean;
  productId: string;
}

export interface DlsiteWorkData {
  code: string;
  title: string;
  circle: string;
  workType: string;
  releaseDate: string;
  tags: string[];
  vas: string[];
  coverUrls: string[];
  rating: number | null;
  priceYen: number | null;
  sourceUrl: string;
  productId: string;
  translationOriginalCode: string;
  raw: {
    product: DlsiteProductInfo | null;
    info: DlsiteProductInfo | null;
    page: Omit<DlsiteWorkPageInfo, 'ageGate'> | null;
  };
}

export type DlsiteFetchResult =
  | { status: 'ok'; message: string; data: DlsiteWorkData }
  | { status: ScrapeErrorKind; message: string; httpStatus: number };

export interface DlsiteProviderOptions {
  proxyUrl?: string;
  timeoutMs?: number;
  minIntervalMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const WORK_TYPE_LABELS: Record<string, string> = {
  SOU: 'ボイス・ASMR',
  ICG: 'イラスト・CG',
  MNG: 'マンガ',
  MOV: '動画',
  NOV: 'ノベル',
};

export function displayWorkType(value: string): string {
  return WORK_TYPE_LABELS[value.trim().toUpperCase()] ?? value;
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
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function unwrapProduct(payload: unknown, workno: string): Record<string, unknown> {
  if (!isRecord(payload)) {
    return {};
  }
  if (isRecord(payload.data)) {
    return unwrapProduct(payload.data, workno);
  }
  if (isRecord(payload.product)) {
    return payload.product;
  }
  const keyed =
    payload[workno] ?? payload[workno.toUpperCase()] ?? payload[workno.toLowerCase()];
  if (isRecord(keyed)) {
    return keyed;
  }
  return payload;
}

export function parseDlsiteProductPayload(
  payload: unknown,
  workno: string,
): DlsiteProductInfo {
  const record = unwrapProduct(payload, workno);
  const translation = isRecord(record.translation_info) ? record.translation_info : undefined;

  return {
    title: pickString(record, ['product_name', 'work_name', 'title', 'name']),
    circle: pickString(record, ['maker_name', 'circle_name', 'brand_name', 'circle']),
    workType: pickString(record, ['work_type', 'workType', 'type', 'product_type']),
    releaseDate: pickString(record, [
      'regist_date',
      'release_date',
      'releaseDate',
      'sales_date',
    ]),
    coverUrl: pickString(record, [
      'image_main',
      'imageMain',
      'work_image',
      'image_thum',
      'image_thumb',
      'cover',
      'thumbnail',
      'image',
    ]),
    translationOriginalCode: translation
      ? pickString(translation, ['original_workno', 'original_work_no', 'originalWorkno'])
      : '',
    rating: (() => {
      const rating = pickNumber(record, [
        'rate_average_2dp',
        'rate_average',
        'rating',
        'rate',
      ]);
      return rating !== null && rating > 0 ? rating : null;
    })(),
    priceYen: pickNumber(record, ['price', 'price_yen', 'official_price']),
  };
}

function outlineValue($: CheerioAPI, label: string): string {
  let result = '';
  $('#work_outline tr').each((_, row) => {
    const heading = $(row).find('th').first().text().replace(/\s+/g, '');
    if (heading.includes(label)) {
      result = $(row).find('td').first().text().replace(/\s+/g, ' ').trim();
    }
  });
  return result;
}

function collectUnique($: CheerioAPI, selector: string): string[] {
  const values = new Set<string>();
  $(selector).each((_, element) => {
    const text = $(element).text().replace(/\s+/g, ' ').trim();
    if (text) {
      values.add(text);
    }
  });
  return [...values].slice(0, 20);
}

function splitNames(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[/／、,，\n]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

export function parseDlsiteWorkHtml(html: string, pageUrl: string): DlsiteWorkPageInfo {
  const $ = loadHtml(html);
  const title = $('h1#work_name').first().text().replace(/\s+/g, ' ').trim();
  const ageGate =
    !title &&
    /年齢確認|18歳以上|adult\s*check/i.test(html) &&
    /age_check|adult/i.test(pageUrl + html.slice(0, 4000));

  const coverAttr =
    $('meta[property="og:image"]').attr('content') ??
    $('meta[name="twitter:image"]').attr('content') ??
    '';

  return {
    title,
    circle:
      $('#work_maker .maker_name a').first().text().replace(/\s+/g, ' ').trim() ||
      $('.maker_name a').first().text().replace(/\s+/g, ' ').trim() ||
      outlineValue($, 'サークル名'),
    workType: outlineValue($, '作品形式'),
    releaseDate:
      outlineValue($, '販売日') ||
      $('meta[property="product:release_date"]').attr('content')?.trim() ||
      '',
    tags: collectUnique($, '#work_genre a, .main_genre a'),
    vas: splitNames(outlineValue($, '声優') || outlineValue($, '声优')),
    coverUrl: coverAttr,
    ageGate,
    productId:
      $('meta[name="product_id"]').attr('content')?.trim() ??
      $('[data-product_id]').first().attr('data-product_id')?.trim() ??
      '',
  };
}

export function normalizeCoverUrl(raw: string, baseUrl: string): string {
  const value = raw.trim();
  if (!value || /nowprinting|blank\.(?:gif|png)|noimage/i.test(value)) {
    return '';
  }
  try {
    if (value.startsWith('//')) {
      return `https:${value}`;
    }
    return new URL(value, baseUrl).toString();
  } catch {
    return '';
  }
}

function headersFor(referer: string, accept: string): Record<string, string> {
  return {
    'user-agent': BROWSER_UA,
    accept,
    'accept-language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7',
    cookie: 'adultchecked=1; locale=zh-cn',
    referer,
  };
}

export function productJsonUrl(workno: string): string {
  return `${DL_BASE}/api/2/product.json?workno=${encodeURIComponent(workno)}`;
}

export function infoAjaxUrl(workno: string): string {
  return `${DL_BASE}/product/info/ajax?product_id=${encodeURIComponent(workno)}`;
}

export function workPageUrl(workno: string): string {
  return `${DL_BASE}/work/=/product_id/${encodeURIComponent(workno)}.html`;
}

function constructedCoverUrls(workno: string): string[] {
  return [
    `${DL_IMAGE_BASE}/modpub/images2/work/doujin/${workno}_img_main.jpg`,
    `${DL_IMAGE_BASE}/modpub/images2/work/doujin/${workno}_img_main.webp`,
  ];
}

function coverCandidates(
  code: string,
  translationCode: string,
  product: DlsiteProductInfo | null,
  info: DlsiteProductInfo | null,
  page: DlsiteWorkPageInfo | null,
): string[] {
  const candidates = [
    product?.coverUrl ?? '',
    info?.coverUrl ?? '',
    page?.coverUrl ?? '',
    ...constructedCoverUrls(code),
    ...(translationCode && translationCode !== code ? constructedCoverUrls(translationCode) : []),
  ]
    .map((url) => normalizeCoverUrl(url, DL_BASE))
    .filter(Boolean);
  return [...new Set(candidates)].slice(0, 6);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseRetryAfter(response: HttpResponse): number {
  const value = responseHeader(response, 'retry-after');
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 15_000);
  }
  return 3_000;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'TimeoutError' ? '请求超时' : error.message;
  }
  return String(error);
}

export class DlsiteProvider {
  private readonly client: HttpClient;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;

  constructor(options: DlsiteProviderOptions = {}) {
    this.client = new HttpClient(options.proxyUrl ? { proxyUrl: options.proxyUrl } : {});
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  }

  private async throttledRequest(
    url: string,
    options: Parameters<HttpClient['request']>[1],
  ): Promise<HttpResponse> {
    const wait = this.minIntervalMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) {
      await sleep(wait);
    }
    this.lastRequestAt = Date.now();
    let response = await this.client.request(url, options);
    for (let retry = 0; retry < 2 && response.status === 429; retry += 1) {
      await sleep(parseRetryAfter(response));
      this.lastRequestAt = Date.now();
      response = await this.client.request(url, options);
    }
    return response;
  }

  async fetchImage(
    url: string,
    referer: string,
  ): Promise<{ ok: boolean; status: number; buffer: Buffer; contentType: string; message: string }> {
    try {
      const response = await this.throttledRequest(url, {
        headers: headersFor(referer, 'image/avif,image/webp,image/*,*/*;q=0.8'),
        timeoutMs: Math.min(this.timeoutMs, 20_000),
        maxBytes: 12 * 1024 * 1024,
      });
      return {
        ok: response.status === 200,
        status: response.status,
        buffer: response.body,
        contentType: responseHeader(response, 'content-type'),
        message: response.status === 200 ? '' : `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        buffer: Buffer.alloc(0),
        contentType: '',
        message: describeError(error),
      };
    }
  }

  async fetchWork(code: string): Promise<DlsiteFetchResult> {
    const pageUrl = workPageUrl(code);
    const issues: string[] = [];
    let lastHttpStatus = 0;
    let sawResponse = false;
    let networkError = '';
    let rateLimited = false;

    const attempt = async (
      url: string,
      headers: Record<string, string>,
      maxBytes: number,
    ): Promise<HttpResponse | null> => {
      try {
        const response = await this.throttledRequest(url, {
          headers,
          timeoutMs: this.timeoutMs,
          maxBytes,
        });
        sawResponse = true;
        lastHttpStatus = response.status;
        if (response.status === 429) {
          rateLimited = true;
        }
        return response;
      } catch (error) {
        networkError = describeError(error);
        return null;
      }
    };

    let product: DlsiteProductInfo | null = null;
    const productResponse = await attempt(
      productJsonUrl(code),
      headersFor(`${DL_BASE}/`, 'application/json,text/plain,*/*'),
      1024 * 1024,
    );
    if (productResponse && productResponse.status === 200) {
      try {
        product = parseDlsiteProductPayload(JSON.parse(productResponse.text), code);
      } catch {
        issues.push('product.json 不是合法 JSON');
      }
    } else if (productResponse && productResponse.status !== 404 && productResponse.status !== 405) {
      issues.push(`product.json HTTP ${productResponse.status}`);
    }

    let info: DlsiteProductInfo | null = null;
    const infoResponse = await attempt(
      infoAjaxUrl(code),
      headersFor(pageUrl, 'application/json,text/plain,*/*'),
      1024 * 1024,
    );
    if (infoResponse && infoResponse.status === 200) {
      try {
        info = parseDlsiteProductPayload(JSON.parse(infoResponse.text), code);
      } catch {
        issues.push('info/ajax 不是合法 JSON');
      }
    } else if (infoResponse && infoResponse.status !== 404 && infoResponse.status !== 405) {
      issues.push(`info/ajax HTTP ${infoResponse.status}`);
    }

    let page: DlsiteWorkPageInfo | null = null;
    const pageResponse = await attempt(
      pageUrl,
      headersFor(`${DL_BASE}/`, 'text/html,application/xhtml+xml,*/*;q=0.8'),
      3 * 1024 * 1024,
    );
    if (pageResponse && pageResponse.status === 200) {
      page = parseDlsiteWorkHtml(pageResponse.text, pageResponse.url);
    } else if (pageResponse) {
      issues.push(`作品页 HTTP ${pageResponse.status}`);
    }

    if (rateLimited) {
      return {
        status: 'rate_limited',
        message: 'DLsite 限流（HTTP 429），已退避重试仍失败，请稍后再试',
        httpStatus: 429,
      };
    }

    const title = product?.title || info?.title || page?.title || '';
    if (title) {
      const translationOriginalCode =
        product?.translationOriginalCode || info?.translationOriginalCode || '';
      let rating = info?.rating ?? product?.rating ?? null;
      let circle = product?.circle || info?.circle || page?.circle || '';
      if (translationOriginalCode && translationOriginalCode.toUpperCase() !== code) {
        if (rating === null) {
          const originalInfoResponse = await attempt(
            infoAjaxUrl(translationOriginalCode),
            headersFor(pageUrl, 'application/json,text/plain,*/*'),
            1024 * 1024,
          );
          if (originalInfoResponse && originalInfoResponse.status === 200) {
            try {
              rating = parseDlsiteProductPayload(
                JSON.parse(originalInfoResponse.text),
                translationOriginalCode,
              ).rating;
            } catch {
              issues.push('日文原版 info/ajax 不是合法 JSON');
            }
          } else if (
            originalInfoResponse &&
            originalInfoResponse.status !== 404 &&
            originalInfoResponse.status !== 405
          ) {
            issues.push(`日文原版 info/ajax HTTP ${originalInfoResponse.status}`);
          }
        }
        const originalPageResponse = await attempt(
          workPageUrl(translationOriginalCode),
          headersFor(`${DL_BASE}/`, 'text/html,application/xhtml+xml,*/*;q=0.8'),
          3 * 1024 * 1024,
        );
        if (originalPageResponse && originalPageResponse.status === 200) {
          const originalPage = parseDlsiteWorkHtml(
            originalPageResponse.text,
            originalPageResponse.url,
          );
          if (originalPage.circle) {
            circle = originalPage.circle;
          }
        } else if (
          originalPageResponse &&
          originalPageResponse.status !== 404 &&
          originalPageResponse.status !== 405
        ) {
          issues.push(`日文原版作品页 HTTP ${originalPageResponse.status}`);
        }
      }
      return {
        status: 'ok',
        message: `已获取：${title}${issues.length > 0 ? `（${issues.join('；')}）` : ''}`,
        data: {
          code,
          title,
          circle,
          // 页面上的「作品形式」是可读文案，JSON 里常是 SOU 这类代码。
          workType: displayWorkType(
            page?.workType || product?.workType || info?.workType || '',
          ),
          releaseDate: (
            product?.releaseDate ||
            info?.releaseDate ||
            page?.releaseDate ||
            ''
          ).slice(0, 10),
          tags: localizeTags(page?.tags ?? []),
          vas: page?.vas ?? [],
          rating,
          priceYen: info?.priceYen ?? product?.priceYen ?? null,
          coverUrls: coverCandidates(code, translationOriginalCode, product, info, page),
          sourceUrl: pageUrl,
          productId: page?.productId || code,
          translationOriginalCode,
          raw: {
            product,
            info,
            page: page
              ? {
                  title: page.title,
                  circle: page.circle,
                  workType: page.workType,
                  releaseDate: page.releaseDate,
                  tags: page.tags,
                  vas: page.vas,
                  coverUrl: page.coverUrl ? redactUrl(page.coverUrl) : '',
                  productId: page.productId,
                }
              : null,
          },
        },
      };
    }

    if (page?.ageGate) {
      return {
        status: 'age_gate',
        message: '被 DLsite 年龄确认拦截（Cookie adultchecked 未生效）',
        httpStatus: lastHttpStatus,
      };
    }
    if (lastHttpStatus === 404 || lastHttpStatus === 410) {
      return {
        status: 'not_found',
        message: 'DLsite 上不存在该作品（404）',
        httpStatus: lastHttpStatus,
      };
    }
    if (lastHttpStatus === 403) {
      return {
        status: 'http_error',
        message: 'DLsite 拒绝访问（HTTP 403，可能被地区限制或 WAF 拦截）',
        httpStatus: lastHttpStatus,
      };
    }
    if (!sawResponse) {
      return {
        status: 'network',
        message: `无法连接 DLsite：${networkError || '未知网络错误'}`,
        httpStatus: 0,
      };
    }
    return {
      status: 'parse_changed',
      message: `DLsite 返回了内容但未能解析元数据（${issues.join('；') || '页面结构可能变化'}）`,
      httpStatus: lastHttpStatus,
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
