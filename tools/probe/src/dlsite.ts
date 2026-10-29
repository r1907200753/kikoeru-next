import { load, type CheerioAPI } from 'cheerio';
import type { DlsiteConfig, ProbeResult } from './types.js';
import { HttpClient, redactUrl, responseHeader } from './http.js';
import { captureProbe } from './result.js';

const DL_BASE = 'https://www.dlsite.com/maniax';
const DL_IMAGE_BASE = 'https://img.dlsite.jp';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface DlsiteProductInfo {
  title: string;
  circle: string;
  workType: string;
  releaseDate: string;
  coverUrl: string;
  translationOriginalWorkno: string;
  keys: string[];
}

export interface DlsiteWorkPageInfo {
  title: string;
  circle: string;
  workType: string;
  releaseDate: string;
  tags: string[];
  coverUrl: string;
  ageGate: boolean;
  productId: string;
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
    coverUrl: pickString(record, ['image_main', 'imageMain', 'cover', 'thumbnail', 'image']),
    translationOriginalWorkno: translation
      ? pickString(translation, ['original_workno', 'original_work_no', 'originalWorkno'])
      : '',
    keys: Object.keys(record).slice(0, 40),
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

export function parseDlsiteWorkHtml(html: string, pageUrl: string): DlsiteWorkPageInfo {
  const $ = load(html);
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

export function imageMagic(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  if (buffer.length >= 6 && buffer.toString('ascii', 0, 6).startsWith('GIF8')) {
    return 'gif';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 12).includes('ftypavif')) {
    return 'avif';
  }
  return '';
}

function headersFor(referer: string, accept: string): Record<string, string> {
  return {
    'user-agent': BROWSER_UA,
    accept,
    'accept-language': 'ja-JP,ja;q=0.9,zh-CN;q=0.8,en;q=0.7',
    cookie: 'adultchecked=1; locale=ja-jp',
    referer,
  };
}

function productJsonUrl(workno: string): string {
  return `${DL_BASE}/api/2/product.json?workno=${encodeURIComponent(workno)}`;
}

function infoAjaxUrl(workno: string): string {
  return `${DL_BASE}/product/info/ajax?product_id=${encodeURIComponent(workno)}`;
}

function workPageUrl(workno: string): string {
  return `${DL_BASE}/work/=/product_id/${encodeURIComponent(workno)}.html`;
}

function coverCandidates(
  workno: string,
  product: DlsiteProductInfo | undefined,
  page: DlsiteWorkPageInfo | undefined,
): string[] {
  const candidates = [
    product?.coverUrl ?? '',
    page?.coverUrl ?? '',
    `${DL_IMAGE_BASE}/modpub/images2/work/doujin/${workno}_img_main.jpg`,
    `${DL_IMAGE_BASE}/modpub/images2/work/doujin/${workno}_img_main.webp`,
  ]
    .map((url) => normalizeCoverUrl(url, DL_BASE))
    .filter(Boolean);

  return [...new Set(candidates)].slice(0, 4);
}

export async function runDlsiteProbes(
  client: HttpClient,
  config: DlsiteConfig,
): Promise<ProbeResult[]> {
  const workno = config.workno;
  const timeoutMs = config.timeoutMs;
  const pageUrl = workPageUrl(workno);
  const results: ProbeResult[] = [];
  let product: DlsiteProductInfo | undefined;
  let page: DlsiteWorkPageInfo | undefined;

  results.push(
    await captureProbe('dlsite.product_json', async () => {
      const url = productJsonUrl(workno);
      const response = await client.request(url, {
        headers: headersFor(`${DL_BASE}/`, 'application/json,text/plain,*/*'),
        timeoutMs,
        maxBytes: 1024 * 1024,
      });
      const baseDetails = {
        url: redactUrl(url),
        status: response.status,
        contentType: responseHeader(response, 'content-type'),
        bytes: response.body.length,
      };

      if (response.status === 404 || response.status === 405) {
        return {
          status: 'skip',
          summary: `product.json 接口不可用（HTTP ${response.status}），继续尝试 info/ajax 与页面`,
          details: baseDetails,
        };
      }
      if (response.status !== 200) {
        return {
          status: 'fail',
          summary: `product.json 返回 HTTP ${response.status}`,
          details: baseDetails,
        };
      }

      let payload: unknown;
      try {
        payload = JSON.parse(response.text);
      } catch {
        return {
          status: 'fail',
          summary: 'product.json 返回的不是 JSON（可能被年龄确认或 WAF 拦截）',
          details: { ...baseDetails, bodyPreview: response.text.slice(0, 160) },
        };
      }

      product = parseDlsiteProductPayload(payload, workno);
      return {
        status: product.title ? 'pass' : 'fail',
        summary: product.title
          ? `标题：${product.title}｜サークル：${product.circle || '未知'}`
          : 'JSON 可解析，但未提取到标题',
        details: {
          ...baseDetails,
          title: product.title,
          circle: product.circle,
          workType: product.workType,
          releaseDate: product.releaseDate,
          hasCover: Boolean(product.coverUrl),
          translationOriginalWorkno: product.translationOriginalWorkno,
          keys: product.keys,
        },
      };
    }),
  );

  results.push(
    await captureProbe('dlsite.info_ajax', async () => {
      const url = infoAjaxUrl(workno);
      const response = await client.request(url, {
        headers: headersFor(pageUrl, 'application/json,text/plain,*/*'),
        timeoutMs,
        maxBytes: 1024 * 1024,
      });
      const baseDetails = {
        url: redactUrl(url),
        status: response.status,
        contentType: responseHeader(response, 'content-type'),
        bytes: response.body.length,
      };

      if (response.status === 404 || response.status === 405) {
        return {
          status: 'skip',
          summary: `info/ajax 接口不可用（HTTP ${response.status}）`,
          details: baseDetails,
        };
      }
      if (response.status !== 200) {
        return {
          status: 'fail',
          summary: `info/ajax 返回 HTTP ${response.status}`,
          details: baseDetails,
        };
      }

      let payload: unknown;
      try {
        payload = JSON.parse(response.text);
      } catch {
        return {
          status: 'fail',
          summary: 'info/ajax 返回的不是 JSON',
          details: { ...baseDetails, bodyPreview: response.text.slice(0, 160) },
        };
      }

      const info = parseDlsiteProductPayload(payload, workno);
      product ??= info;
      return {
        status: info.title ? 'pass' : 'skip',
        summary: info.title
          ? `标题：${info.title}｜フィールド数：${info.keys.length}`
          : 'JSON 可解析，但字段结构与预期不同（不阻断页面解析）',
        details: {
          ...baseDetails,
          title: info.title,
          circle: info.circle,
          workType: info.workType,
          hasCover: Boolean(info.coverUrl),
          keys: info.keys,
        },
      };
    }),
  );

  results.push(
    await captureProbe('dlsite.work_page', async () => {
      const response = await client.request(pageUrl, {
        headers: headersFor(`${DL_BASE}/`, 'text/html,application/xhtml+xml,*/*;q=0.8'),
        timeoutMs,
        maxBytes: 3 * 1024 * 1024,
      });
      const finalUrl = response.url;
      page = parseDlsiteWorkHtml(response.text, finalUrl);
      const details = {
        url: redactUrl(pageUrl),
        finalUrl: redactUrl(finalUrl),
        status: response.status,
        redirected: response.redirected,
        bytes: response.body.length,
        title: page.title,
        circle: page.circle,
        workType: page.workType,
        releaseDate: page.releaseDate,
        tags: page.tags,
        coverUrl: redactUrl(normalizeCoverUrl(page.coverUrl, finalUrl) || page.coverUrl),
        productId: page.productId,
        ageGate: page.ageGate,
      };

      if (page.ageGate) {
        return {
          status: 'fail',
          summary: '页面被年龄确认拦截，Cookie adultchecked 未生效',
          details,
        };
      }
      if (response.status !== 200) {
        return {
          status: 'fail',
          summary: `作品页返回 HTTP ${response.status}`,
          details,
        };
      }
      if (!page.title) {
        return {
          status: 'fail',
          summary: '作品页可访问，但未找到 h1#work_name（页面结构可能变化）',
          details,
        };
      }
      return {
        status: 'pass',
        summary: `标题：${page.title}｜タグ：${page.tags.length}｜作品形式：${page.workType || '未知'}`,
        details,
      };
    }),
  );

  results.push(
    await captureProbe('dlsite.cover', async () => {
      const candidates = coverCandidates(workno, product, page);
      const attempts: Array<Record<string, unknown>> = [];
      let lastFailure = '没有可尝试的封面 URL';

      for (const candidate of candidates) {
        const response = await client.getPrefix(candidate, 2048, {
          headers: headersFor(pageUrl, 'image/avif,image/webp,image/*,*/*;q=0.8'),
          timeoutMs: Math.min(timeoutMs, 15_000),
        });
        const contentType = responseHeader(response, 'content-type');
        const magic = imageMagic(response.body);
        const accepted =
          (response.status === 200 || response.status === 206) &&
          (contentType.startsWith('image/') || Boolean(magic));

        attempts.push({
          url: redactUrl(candidate),
          status: response.status,
          contentType,
          bytes: response.body.length,
          magic,
          rangeHonored: response.rangeHonored,
        });

        if (accepted) {
          return {
            status: 'pass',
            summary: `封面可访问（${magic || contentType}，${response.body.length} 字节，Range：${response.rangeHonored ? '支持' : '未验证'}）`,
            details: {
              chosenUrl: redactUrl(candidate),
              referer: pageUrl,
              attempts,
            },
          };
        }
        lastFailure = `HTTP ${response.status}，Content-Type：${contentType || '空'}`;
      }

      return {
        status: 'fail',
        summary: `封面全部不可用：${lastFailure}`,
        details: { attempts },
      };
    }),
  );

  return results;
}
