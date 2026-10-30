import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayWorkType,
  normalizeCoverUrl,
  parseDlsiteProductPayload,
  parseDlsiteWorkHtml,
} from '../src/providers/dlsite.js';

test('解析 DLsite product.json：标题、社团、发售日、翻译原番号', () => {
  const payload = {
    data: {
      product: {
        product_name: '测试音声',
        maker_name: '测试社团',
        work_type: 'SOU',
        regist_date: '2024-02-03 00:00:00',
        image_main: '//img.dlsite.jp/modpub/images2/work/doujin/RJ123456_img_main.jpg',
        translation_info: { original_workno: 'RJ123456' },
        rate_average_2dp: 4.82,
        price: 2750,
      },
    },
  };
  const info = parseDlsiteProductPayload(payload, 'RJ654321');
  assert.equal(info.title, '测试音声');
  assert.equal(info.circle, '测试社团');
  assert.equal(info.workType, 'SOU');
  assert.equal(info.releaseDate, '2024-02-03 00:00:00');
  assert.equal(info.translationOriginalCode, 'RJ123456');
  assert.equal(info.rating, 4.82);
  assert.equal(info.priceYen, 2750);
  assert.match(info.coverUrl, /RJ123456_img_main\.jpg$/);
});

test('解析 info/ajax 的 work_image 分桶封面路径', () => {
  const payload = {
    RJ01657170: {
      work_name: '特典作品',
      maker_name: '',
      work_image: '//img.dlsite.jp/modpub/images2/work/doujin/RJ01658000/RJ01657170_img_main.jpg',
    },
  };
  const info = parseDlsiteProductPayload(payload, 'RJ01657170');
  assert.equal(info.title, '特典作品');
  assert.equal(
    info.coverUrl,
    '//img.dlsite.jp/modpub/images2/work/doujin/RJ01658000/RJ01657170_img_main.jpg',
  );
});

test('作品形式代码转可读文案', () => {
  assert.equal(displayWorkType('SOU'), 'ボイス・ASMR');
  assert.equal(displayWorkType('icg'), 'イラスト・CG');
  assert.equal(displayWorkType('ボイス・ASMR'), 'ボイス・ASMR');
  assert.equal(displayWorkType(''), '');
});

test('解析 DLsite 作品页：标题、社团、作品形式、标签与封面', () => {
  const html = `<!doctype html><html><head>
    <meta property="og:image" content="//img.dlsite.jp/modpub/images2/work/doujin/RJ123456_img_main.jpg">
    <meta name="product_id" content="RJ123456">
  </head><body>
    <h1 id="work_name">  测试 音声&nbsp;作品 </h1>
    <div id="work_maker"><span class="maker_name"><a>测试社团</a></span></div>
    <table id="work_outline">
      <tr><th>作品形式</th><td>音声作品</td></tr>
      <tr><th>販売日</th><td>2024年02月03日</td></tr>
      <tr><th>声優</th><td>声优A / 声优B</td></tr>
    </table>
    <div id="work_genre"><a>癒し</a><a>ささやき</a><a>癒し</a></div>
  </body></html>`;
  const page = parseDlsiteWorkHtml(html, 'https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html');
  assert.equal(page.title, '测试 音声 作品');
  assert.equal(page.circle, '测试社团');
  assert.equal(page.workType, '音声作品');
  assert.equal(page.releaseDate, '2024年02月03日');
  assert.deepEqual(page.tags, ['癒し', 'ささやき']);
  assert.deepEqual(page.vas, ['声优A', '声优B']);
  assert.equal(page.productId, 'RJ123456');
  assert.equal(page.ageGate, false);
});

test('识别年龄确认页并拒绝占位封面', () => {
  const page = parseDlsiteWorkHtml(
    '<html><body>年齢確認 18歳以上ですか？ <a href="/age_check/">adult</a></body></html>',
    'https://www.dlsite.com/maniax/age_check/',
  );
  assert.equal(page.ageGate, true);
  assert.equal(page.title, '');
  assert.equal(normalizeCoverUrl('https://img.dlsite.jp/nowprinting.gif', 'https://dlsite.com'), '');
  assert.equal(normalizeCoverUrl('//img.dlsite.jp/a.jpg', 'https://dlsite.com'), 'https://img.dlsite.jp/a.jpg');
});
