import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  imageMagic,
  normalizeCoverUrl,
  parseDlsiteProductPayload,
  parseDlsiteWorkHtml,
} from '../src/dlsite.js';
import {
  audioMagic,
  normalizeBaseUrl,
  parseAuthPayload,
  parsePreconnectOrigins,
  parseSearchPayload,
  parseTracksPayload,
  parseWorkInfoPayload,
  parseWorksPayload,
} from '../src/asmrone.js';
import { joinWebDavUrl, parseMultiStatus } from '../src/webdav.js';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/probe/${name}`, import.meta.url));

const readFixture = (name: string): Promise<string> => readFile(fixture(name), 'utf8');

test('DLsite 作品页解析标题、社团、标签与封面', async () => {
  const html = await readFixture('dlsite-work.html');
  const page = parseDlsiteWorkHtml(html, 'https://www.dlsite.com/maniax/work/=/product_id/RJ01426915.html');
  assert.equal(page.title, '【テスト】耳元囁き');
  assert.equal(page.circle, 'テストサークル');
  assert.equal(page.workType, 'ボイス・ASMR');
  assert.equal(page.releaseDate, '2025年01月02日');
  assert.deepEqual(page.tags, ['ASMR', '癒し']);
  assert.equal(page.productId, 'RJ01426915');
  assert.equal(page.ageGate, false);
  assert.equal(
    normalizeCoverUrl(page.coverUrl, 'https://www.dlsite.com/maniax/'),
    'https://img.dlsite.jp/modpub/images2/work/doujin/RJ01426915/RJ01426915_img_main.jpg',
  );
});

test('DLsite product.json 解析并读取翻译原番号', async () => {
  const payload: unknown = JSON.parse(await readFixture('dlsite-product.json'));
  const product = parseDlsiteProductPayload(payload, 'RJ01426915');
  assert.equal(product.title, '【テスト】耳元囁き');
  assert.equal(product.circle, 'テストサークル');
  assert.equal(product.workType, 'ボイス・ASMR');
  assert.equal(product.translationOriginalWorkno, 'RJ00000000');
  assert.ok(product.coverUrl.startsWith('https://img.dlsite.jp/'));
});

test('封面与音频 magic 识别', () => {
  assert.equal(imageMagic(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  assert.equal(imageMagic(Buffer.from('RIFF0000WEBP', 'ascii')), 'webp');
  assert.equal(audioMagic(Buffer.from('ID3xxxx', 'ascii')), 'mp3-id3');
  assert.equal(audioMagic(Buffer.from('fLaC0000', 'ascii')), 'flac');
});

test('ASMR.one 域名发现只保留 API origin', async () => {
  const html = await readFixture('asmrone-site.html');
  const origins = parsePreconnectOrigins(html);
  assert.ok(origins.includes('https://api.asmr-200.com'));
  assert.ok(!origins.includes('https://www.asmr.one'));
  assert.equal(normalizeBaseUrl('api.asmr-200.com/'), 'https://api.asmr-200.com');
});

test('ASMR.one works/search 解析', () => {
  const works = parseWorksPayload({
    works: [
      {
        id: 123456,
        source_id: 'rj01426915',
        title: '测试作品',
        circle: { name: '测试社团' },
      },
    ],
  });
  assert.equal(works.count, 1);
  assert.equal(works.sample.id, '123456');
  assert.equal(works.sample.workno, 'RJ01426915');
  assert.equal(works.sample.circle, '测试社团');

  const search = parseSearchPayload([
    { source_id: 'RJ01426915', title: '测试作品' },
  ]);
  assert.equal(search.count, 1);
  assert.equal(search.firstWorkno, 'RJ01426915');
});

test('ASMR.one workInfo 解析嵌套 circle/tags/cover', async () => {
  const payload: unknown = JSON.parse(await readFixture('asmrone-workinfo.json'));
  const info = parseWorkInfoPayload(payload);
  assert.equal(info.id, '123456');
  assert.equal(info.workno, 'RJ01426915');
  assert.equal(info.title, '【テスト】耳元囁き');
  assert.equal(info.circle, 'テストサークル');
  assert.deepEqual(info.tags, ['ASMR', '癒し']);
  assert.deepEqual(info.vas, ['テスト声優']);
  assert.equal(info.coverUrl, 'https://img.example.test/cover.jpg');
});

test('ASMR.one tracks 展平分组并取首条音频', async () => {
  const tracks = parseTracksPayload(JSON.parse(await readFixture('asmrone-tracks.json')));
  assert.equal(tracks.groupCount, 2);
  assert.equal(tracks.count, 2);
  assert.deepEqual(tracks.formats, ['mp3']);
  assert.equal(tracks.firstHash, '1722913/1964679');
  assert.equal(tracks.firstTitle, '01_テスト.mp3');
  assert.equal(tracks.firstDuration, '832.656');
  assert.ok(tracks.firstStreamUrl.includes('/media/stream/'));
  assert.ok(tracks.firstDownloadUrl.includes('/media/download/'));

  const auth = parseAuthPayload(JSON.parse(await readFixture('asmrone-auth.json')));
  assert.equal(auth.token, 'example-token-value');
  assert.equal(auth.name, 'tester');
});

test('WebDAV multistatus 解析中文文件名', async () => {
  const xml = await readFixture('webdav-multistatus.xml');
  const entries = parseMultiStatus(xml);
  assert.equal(entries.length, 3);
  assert.equal(entries[0]?.isCollection, true);
  assert.equal(entries[1]?.name, 'RJ01426915');
  assert.equal(entries[2]?.name, '测试.mp3');
  assert.equal(entries[2]?.length, 12345);
});

test('WebDAV URL 拼接保留中文编码', () => {
  const url = joinWebDavUrl('https://host.test/dav', '/asmr', 'RJ01426915/测试 文件.mp3');
  assert.equal(
    decodeURIComponent(new URL(url).pathname),
    '/dav/asmr/RJ01426915/测试 文件.mp3',
  );
});
