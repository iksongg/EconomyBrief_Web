const assert = require('assert');
const {
  CATEGORIES, isKoreanTitle, isKoreanPublisher, isDirectEconomic,
  normalizeArticle, filterAndNormalize, validHttpUrl, assignCategory, providerError
} = require('../server');
const fs = require('fs');
const path = require('path');

function article(overrides = {}) {
  return Object.assign({
    article_id: 'test-1',
    title: '삼성전자 반도체 투자 확대',
    description: '삼성전자가 반도체 생산과 설비 투자를 확대한다는 경제 뉴스입니다.',
    link: 'https://www.etnews.com/test-1',
    source_name: '전자신문',
    source_url: 'https://www.etnews.com',
    source_icon: 'https://www.etnews.com/favicon.ico',
    image_url: 'https://www.etnews.com/image.jpg',
    pubDate: '2026-09-01 01:00:00',
    language: 'korean',
    country: ['south korea'],
    category: ['business'],
    keywords: ['반도체'],
    duplicate: false
  }, overrides);
}

assert.strictEqual(isKoreanTitle('삼성전자 반도체 투자 확대'), true);
assert.strictEqual(isKoreanTitle('Samsung semiconductor investment'), false);
assert.strictEqual(isKoreanPublisher({ url: 'https://www.etnews.com/test' }), true);
assert.strictEqual(isKoreanPublisher({ url: 'https://example.com/test' }), false);
assert.strictEqual(isDirectEconomic(article(), '반도체'), true);
assert.strictEqual(isDirectEconomic(article({ title: 'AI가 바꾼 여행 이야기', description: '여행 콘텐츠입니다.' }), 'AI'), false);
assert.strictEqual(validHttpUrl('https://example.com/a'), true);
assert.strictEqual(validHttpUrl('not-a-url'), false);

const normalized = normalizeArticle(article(), '반도체');
assert.deepStrictEqual(Object.keys(normalized).includes('url'), true);
assert.strictEqual(normalized.source, '전자신문');
assert.strictEqual(normalized.category, '반도체');
assert.strictEqual(normalized.summaryStatus, 'not_requested');

const filtered = filterAndNormalize([article(), article({ article_id: 'test-2', link: 'https://www.etnews.com/test-2', title: 'SK하이닉스 HBM 공급 확대' }), article({ article_id: 'bad', title: '오늘의 스포츠 경기 결과', description: '스포츠 소식입니다.', link: 'https://example.com/sports' })], '반도체');
assert.strictEqual(filtered.length, 2);
assert.strictEqual(filterAndNormalize([article({ link: '' })], '반도체').length, 0);
assert.strictEqual(filterAndNormalize([article({ title: 'Samsung semiconductor investment' })], '반도체').length, 0);
assert.strictEqual(filterAndNormalize([article({ description: '' })], '반도체').length, 0);
assert.strictEqual(filterAndNormalize([], '반도체').length, 0);
assert.strictEqual(filterAndNormalize([article(), article({ article_id: 'dupe', link: 'https://www.etnews.com/dupe' })], '반도체').length, 1);
assert.strictEqual(assignCategory(article({ title: '한국은행 기준금리 동결', description: '금리 시장 뉴스' }), 'all'), '금리');
assert.strictEqual(providerError(401).statusCode, 401);
assert.match(providerError(401).message, /인증/);
assert.strictEqual(providerError(429).statusCode, 429);
assert.match(providerError(429).message, /호출 한도/);
assert.match(providerError(500).message, /서버 오류/);

// EconomyBrief_API_Final splits Manus's live-news.js into two files:
// api-news-client.js (fetch + fallback-image constant) and
// live-feed-inject.js (onerror wiring on the actual <img> elements).
const clientSource = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'api-news-client.js'), 'utf8');
assert.match(clientSource, /FALLBACK_IMAGE/);
const injectSource = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'live-feed-inject.js'), 'utf8');
assert.match(injectSource, /onerror/);

assert.strictEqual(Object.keys(CATEGORIES).length, 9);
console.log('news-api.test.js: all assertions passed');
