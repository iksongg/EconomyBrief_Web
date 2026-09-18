// Verifies that /api/news's underlying fetchNewsData() (server.js) returns
// as soon as Google RSS/NAVER/sourceLogo are ready, WITHOUT waiting for
// Gemini - the point of this turn's fix. Uses a mocked global.fetch (no
// real network calls, no real credentials used) with an artificially slow
// Gemini response, so if fetchNewsData ever regresses back to awaiting
// Gemini, this test's timing assertion fails loudly instead of silently
// passing.
//
// NAVER is mocked too (not skipped) because Gemini only ever runs on a
// REAL description - see gemini-summary.js's looksLikeRealDescription() -
// and the only thing that upgrades a Google RSS article's description away
// from the synthetic "{source} 보도" placeholder is a successful NAVER
// match. Mocking a real match here is what makes this an honest end-to-end
// rehearsal of the actual RSS -> NAVER -> (cache+respond) -> [background]
// Gemini pipeline, not just a synthetic timing trick.
const assert = require('assert');

const originalFetch = global.fetch;

const NOW = new Date();
const SAMPLE_RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss><channel>
<item>
  <title>인공지능 기업 투자 확대 - 테스트뉴스</title>
  <link>https://news.google.com/rss/articles/GEMINIBGTEST1?oc=5</link>
  <pubDate>${NOW.toUTCString()}</pubDate>
  <source url="https://test-news.example.com">테스트뉴스</source>
</item>
</channel></rss>`;

const GEMINI_DELAY_MS = 400;

function interactionsBody(bullets) {
  return { steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ bullets }) }] }] };
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// server.js's loadDotEnv() only fills in an env var that ISN'T already set
// (`!process.env[key]`) - it never overwrites one that's already present.
// So credentials must be overridden AFTER require('../server') runs (which
// is when loadDotEnv() executes), not before, or the real .env values win.
const { fetchNewsData } = require('../server');
process.env.NAVER_CLIENT_ID = 'test-naver-id-not-real';
process.env.NAVER_CLIENT_SECRET = 'test-naver-secret-not-real';
process.env.GEMINI_API_KEY = 'test-gemini-key-not-real';
process.env.GEMINI_CONCURRENCY = '2';

global.fetch = async (url) => {
  const urlStr = String(url);
  if (urlStr.includes('news.google.com/rss/search')) {
    return { ok: true, status: 200, text: async () => SAMPLE_RSS_XML };
  }
  if (urlStr.includes('naverapihub.apigw.ntruss.com')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: [{
          title: '인공지능 기업 투자 확대', // matches the RSS item's title after its " - 테스트뉴스" suffix is stripped
          originallink: 'https://test-news.example.com/real-article-1',
          link: 'https://n.news.naver.com/mnews/article/001/0000001',
          description: '테스트뉴스가 인공지능 기업들의 데이터센터 투자 확대 계획을 실제로 보도한 상세 내용입니다.',
          pubDate: NOW.toUTCString()
        }]
      })
    };
  }
  if (urlStr.includes('generativelanguage.googleapis.com')) {
    await sleep(GEMINI_DELAY_MS); // simulates a slow real LLM call
    return { ok: true, status: 200, json: async () => interactionsBody(['테스트뉴스가 인공지능 기업의 데이터센터 투자 확대 계획을 보도했습니다.']) };
  }
  // sourceLogo homepage fetch (article-enrichment.js) or anything else -
  // fail harmlessly, exactly like a real publisher homepage with no
  // reachable favicon would.
  return { ok: false, status: 404 };
};

(async () => {
  const startedAt = Date.now();
  const value = await fetchNewsData('AI');
  const elapsedMs = Date.now() - startedAt;

  assert.ok(value.articles.length >= 1, '테스트 RSS 기사 하나는 필터를 통과해 반환되어야 한다');
  const article = value.articles[0];

  // The whole point of this fix: the response must come back well before
  // Gemini's artificially slow call would have resolved.
  assert.ok(elapsedMs < GEMINI_DELAY_MS, 'fetchNewsData()는 Gemini 응답을 기다리지 않고 즉시 반환되어야 한다 (elapsed=' + elapsedMs + 'ms, GEMINI_DELAY_MS=' + GEMINI_DELAY_MS + 'ms)');

  // NAVER (not backgrounded - runs before the response) already upgraded
  // the description by the time of the immediate response.
  assert.notStrictEqual(article.description, '테스트뉴스 보도', 'NAVER 매칭은 응답 전에 완료되어 description이 이미 실제 내용이어야 한다');

  // At the moment of the immediate response, Gemini hasn't run yet - the
  // article must still carry normalizeArticle()'s untouched defaults, not
  // a half-finished state.
  assert.strictEqual(article.summaryStatus, 'not_requested', '즉시 응답 시점에는 아직 Gemini 결과가 없어야 한다');
  assert.strictEqual(article.aiSummary, null);

  // Now wait past the mocked Gemini delay and confirm the SAME cached
  // article object (not a new fetch/response) was updated in place by the
  // background job - this is what lets the next request/60s poll pick up
  // the summary with no extra cache-write step.
  await sleep(GEMINI_DELAY_MS + 300);
  assert.strictEqual(article.summaryStatus, 'generated', '백그라운드 Gemini 작업이 끝나면 이미 캐시에 있던 동일 article 객체가 업데이트되어야 한다');
  assert.deepStrictEqual(article.aiSummary, ['테스트뉴스가 인공지능 기업의 데이터센터 투자 확대 계획을 보도했습니다.']);

  // A second call for the same (now-cached) category must return instantly
  // and already reflect the completed Gemini summary - no re-fetch, no
  // re-await of Gemini.
  const secondStartedAt = Date.now();
  const secondValue = await fetchNewsData('AI');
  const secondElapsedMs = Date.now() - secondStartedAt;
  assert.ok(secondElapsedMs < 50, '캐시된 카테고리 재요청은 즉시 반환되어야 한다');
  assert.strictEqual(secondValue.articles[0].summaryStatus, 'generated');

  global.fetch = originalFetch;
  console.log('gemini-background.test.js: all assertions passed');
})().catch((err) => { global.fetch = originalFetch; console.error(err); process.exit(1); });
