const assert = require('assert');
const {
  enrichWithNaver, evaluateCandidates, titleSimilarity, buildFallbackQuery, cleanDescription, isValidHttpUrl, hostOf, hoursBetween,
  getPeakConcurrency, resetPeakConcurrency
} = require('../naver-enrichment');

function article(overrides) {
  return Object.assign({
    id: 'a1',
    title: '한은 "기준금리 추가 인상 검토"',
    source: '연합뉴스',
    sourceUrl: 'https://www.yna.co.kr',
    publishedAt: 'Thu, 10 Sep 2026 03:00:00 GMT',
    url: 'https://news.google.com/rss/articles/TESTID?oc=5',
    description: '연합뉴스 보도'
  }, overrides);
}
function naverItem(overrides) {
  return Object.assign({
    title: '한은 "기준금리 추가 인상 검토"',
    originallink: 'https://www.yna.co.kr/view/AKR001',
    link: 'https://n.news.naver.com/mnews/article/001/000001',
    description: '<b>한은</b>이 기준금리 추가 인상을 검토하고 있다고 10일 밝혔다.',
    pubDate: 'Thu, 10 Sep 2026 12:00:00 +0900'
  }, overrides);
}

// --- pure helpers ---
assert.strictEqual(isValidHttpUrl('https://x.test/a'), true);
assert.strictEqual(isValidHttpUrl('ftp://x.test'), false);
assert.strictEqual(isValidHttpUrl(''), false);
assert.strictEqual(hostOf('https://www.yna.co.kr/a'), 'yna.co.kr');
assert.strictEqual(hostOf('not a url'), null);
assert.strictEqual(cleanDescription('<b>가</b>  나\n다  '), '가 나 다');
assert.strictEqual(cleanDescription('A &amp; B &quot;C&quot;'), 'A & B "C"');
assert.strictEqual(cleanDescription(''), null);
assert.strictEqual(cleanDescription(null), null);
assert.ok(titleSimilarity('반도체 수출 호황', '반도체 수출 호황') === 1);
assert.ok(titleSimilarity('반도체 수출 호황', '전혀 다른 뉴스 제목') === 0);
assert.strictEqual(hoursBetween('Thu, 10 Sep 2026 00:00:00 GMT', 'Thu, 10 Sep 2026 02:00:00 GMT'), 2);
assert.strictEqual(hoursBetween('not a date', 'Thu, 10 Sep 2026 00:00:00 GMT'), null);

// buildFallbackQuery: pure title-cleaning transform, verified against the
// exact real-world patterns found in currently-unmatched production
// articles (trailing "- 언론사" suffix, ellipsis, bracket tags, quotes,
// trailing "By 기자명").
assert.strictEqual(buildFallbackQuery('코스피 발목 잡은 유가·금리 상승…FOMC 이후 달라질까? - 머니투데이'), '코스피 발목 잡은 유가·금리 상승 FOMC 이후 달라질까?');
assert.strictEqual(buildFallbackQuery('유가 뛰자 비트코인 흔들렸다... 美 CPI 발표 앞두고 시장 긴장'), '유가 뛰자 비트코인 흔들렸다 美 CPI 발표 앞두고 시장 긴장');
assert.strictEqual(buildFallbackQuery("[투데이's 금 시세] 하락세 지속하는 금값···美 PPI 반등에 금리인상 가능성 높아져 By 투데이코리아"), '하락세 지속하는 금값···美 PPI 반등에 금리인상 가능성 높아져');
assert.strictEqual(buildFallbackQuery('한은 "기준금리 추가 인상 검토"'), '한은 기준금리 추가 인상 검토');
// A title with no cleanable noise at all must come back byte-identical
// (enrichOne() relies on this to skip a pointless duplicate search).
assert.strictEqual(buildFallbackQuery('동시성 테스트 기사 0'), '동시성 테스트 기사 0');

// A. NAVER description 매칭 성공 (title exact, source matches -> lower threshold clears easily)
{
  const result = evaluateCandidates(article(), [naverItem()]);
  assert.strictEqual(result.matched, true);
  assert.strictEqual(result.description, '한은이 기준금리 추가 인상을 검토하고 있다고 10일 밝혔다.');
  assert.strictEqual(result.url, 'https://www.yna.co.kr/view/AKR001');
}

// B. 매칭 실패 -> 기존 fallback 유지 (0 candidates)
{
  const result = evaluateCandidates(article(), []);
  assert.strictEqual(result.matched, false);
  assert.strictEqual(result.reason, 'no-candidates');
}

// C. 낮은 제목 유사도 -> 매칭 실패
{
  const result = evaluateCandidates(article(), [naverItem({ title: '완전히 다른 주제의 기사 제목입니다' })]);
  assert.strictEqual(result.matched, false);
  assert.strictEqual(result.reason, 'low-similarity');
}

// D. 발행시각 차이가 큰 후보 -> 매칭 실패 (title matches perfectly but 14 days apart - mirrors the
// real Investing.com case from manual measurement)
{
  const result = evaluateCandidates(article(), [naverItem({ pubDate: 'Thu, 27 Aug 2026 12:00:00 +0900' })]);
  assert.strictEqual(result.matched, false);
  assert.strictEqual(result.reason, 'time-gap-too-large');
}

// Source mismatch (aggregator-labeled RSS source) still matches when title
// similarity is perfect - mirrors the real v.daum.net cases from measurement
// (source disagreement must NOT hard-block an otherwise-correct match).
{
  const a = article({ source: 'v.daum.net', sourceUrl: 'https://v.daum.net' });
  const result = evaluateCandidates(a, [naverItem({ originallink: 'https://biz.sbs.co.kr/article/1' })]);
  assert.strictEqual(result.matched, true);
  assert.strictEqual(result.sourceMatch, false);
}
// But with source mismatch, a middling similarity that would pass the
// source-matched threshold must now correctly fail the stricter one.
{
  const a = article({ title: '반도체 수출 호황 지속 관련 소식', source: 'v.daum.net', sourceUrl: 'https://v.daum.net' });
  const partial = naverItem({ title: '반도체 수출 관련 다른 이야기', originallink: 'https://biz.sbs.co.kr/article/2' });
  const sim = titleSimilarity(a.title, partial.title);
  const result = evaluateCandidates(a, [partial]);
  if (sim >= 0.5 && sim < 0.6) assert.strictEqual(result.matched, false);
}

// E + F. HTML description -> plain text 정제 + entity decode
{
  const result = evaluateCandidates(article(), [naverItem({ description: '<b>금리</b>가 &quot;인상&quot;될 &amp; 전망' })]);
  assert.strictEqual(result.description, '금리가 "인상"될 & 전망');
  assert.ok(!/[<>]/.test(result.description));
}

// G. originallink 유효 -> 실제 URL 사용
{
  const result = evaluateCandidates(article(), [naverItem({ originallink: 'https://real.example.com/article/1' })]);
  assert.strictEqual(result.url, 'https://real.example.com/article/1');
}

// H. originallink invalid -> Google News URL fallback (evaluateCandidates
// returns url: null; enrichWithNaver's caller must then leave article.url
// untouched - verified below via the full enrichWithNaver path).
{
  const result = evaluateCandidates(article(), [naverItem({ originallink: 'not-a-valid-url' })]);
  assert.strictEqual(result.matched, true); // still a real content match
  assert.strictEqual(result.url, null); // but no usable link to swap in
}

// --- network-path tests (global.fetch stubbed; no real HTTP calls) ---
const realFetch = global.fetch;
const realId = process.env.NAVER_CLIENT_ID;
const realSecret = process.env.NAVER_CLIENT_SECRET;
process.env.NAVER_CLIENT_ID = 'test-id';
process.env.NAVER_CLIENT_SECRET = 'test-secret';

function stubFetchOnce(responder) {
  global.fetch = async () => responder();
}
function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

(async () => {
  // I. cache hit -> NAVER 재호출 없음
  {
    let calls = 0;
    global.fetch = async () => { calls++; return jsonResponse(200, { items: [naverItem()] }); };
    const articles1 = [article({ id: 'cache-1', url: 'https://news.google.com/rss/articles/CACHE1' })];
    await enrichWithNaver(articles1);
    assert.strictEqual(calls, 1);
    assert.strictEqual(articles1[0].description, '한은이 기준금리 추가 인상을 검토하고 있다고 10일 밝혔다.');
    // Second enrichment pass over an article with the SAME url must reuse the cache.
    const articles2 = [article({ id: 'cache-1b', url: 'https://news.google.com/rss/articles/CACHE1' })];
    await enrichWithNaver(articles2);
    assert.strictEqual(calls, 1, 'a second enrichment of the same article url must not call NAVER again');
  }

  // J. "scheduled refresh"에 해당하는 정상 흐름: enrichWithNaver가 실제로 매칭/치환을 수행
  {
    global.fetch = async () => jsonResponse(200, { items: [naverItem({ originallink: 'https://real.example.com/j' })] });
    const articles = [article({ id: 'j1', url: 'https://news.google.com/rss/articles/JTEST' })];
    const stats = await enrichWithNaver(articles);
    assert.strictEqual(stats.matched, 1);
    assert.strictEqual(articles[0].url, 'https://real.example.com/j');
  }

  // K. API 오류/timeout -> 전체 응답 실패 없이 fallback 유지 (network error는
  // retryable이므로 최대 재시도까지 소진한 뒤에도 최종적으로 fallback되는지 확인)
  {
    let calls = 0;
    global.fetch = async () => { calls++; throw Object.assign(new Error('boom'), { name: 'FetchError' }); };
    const original = { description: '기존 매일경제 보도', url: 'https://news.google.com/rss/articles/KTEST' };
    const articles = [article({ id: 'k1', url: original.url, description: original.description })];
    const stats = await enrichWithNaver(articles);
    assert.strictEqual(stats.apiErrors, 1, 'apiErrors counts the article once, not once per retry attempt');
    assert.strictEqual(stats.retries, 2, 'a persistently-failing network error should exhaust both retries');
    assert.strictEqual(calls, 3, '1 initial attempt + 2 retries = 3 total calls');
    assert.strictEqual(articles[0].description, original.description, 'API error must leave existing description untouched');
    assert.strictEqual(articles[0].url, original.url, 'API error must leave existing url untouched');
  }

  // Retry: a transient 429 that succeeds on the 2nd attempt must be counted
  // as a match, not an error - retry actually recovers the request.
  {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      if (calls === 1) return jsonResponse(429, {});
      return jsonResponse(200, { items: [naverItem({ originallink: 'https://real.example.com/retry-ok' })] });
    };
    const articles = [article({ id: 'retry-ok', url: 'https://news.google.com/rss/articles/RETRYOK' })];
    const stats = await enrichWithNaver(articles);
    assert.strictEqual(calls, 2);
    assert.strictEqual(stats.retries, 1);
    assert.strictEqual(stats.matched, 1);
    assert.strictEqual(stats.apiErrors, 0, 'a request that ultimately succeeds after retry must not count as an error');
    assert.strictEqual(articles[0].url, 'https://real.example.com/retry-ok');
  }

  // Retry: a clear config/auth error (4xx) must NOT be retried - repeating
  // an invalid request can never succeed.
  {
    let calls = 0;
    global.fetch = async () => { calls++; return jsonResponse(401, { errorMessage: 'auth failed' }); };
    const original = { description: '기존 YTN 보도', url: 'https://news.google.com/rss/articles/AUTHFAIL' };
    const articles = [article({ id: 'auth1', url: original.url, description: original.description })];
    const stats = await enrichWithNaver(articles);
    assert.strictEqual(calls, 1, '4xx auth errors must not be retried');
    assert.strictEqual(stats.retries, 0);
    assert.strictEqual(stats.errorsByType['4xx'], 1);
    assert.strictEqual(articles[0].description, original.description);
  }

  // Concurrency: dispatching many articles at once must never exceed the
  // configured NAVER_CONCURRENCY (3) real in-flight requests, regardless of
  // how many articles/categories are being enriched simultaneously - this
  // is what actually prevents the "9 categories x N each" burst.
  {
    resetPeakConcurrency();
    let inFlight = 0;
    let observedPeak = 0;
    global.fetch = async () => {
      inFlight++;
      observedPeak = Math.max(observedPeak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 30)); // force overlap
      inFlight--;
      return jsonResponse(200, { items: [] });
    };
    const manyArticles = Array.from({ length: 12 }, (_, i) => article({
      id: 'conc-' + i,
      title: '동시성 테스트 기사 ' + i,
      url: 'https://news.google.com/rss/articles/CONC' + i
    }));
    await enrichWithNaver(manyArticles);
    assert.ok(observedPeak <= 3, 'observed concurrent NAVER calls (' + observedPeak + ') must never exceed 3');
    assert.ok(getPeakConcurrency() <= 3, 'module-tracked peak concurrency must never exceed 3');
  }

  // Concurrency: TWO SEPARATE enrichWithNaver() calls running at the same
  // time (mirrors fetchAllNewsData's Promise.all over 9 categories) must
  // still share the same global cap - not "3 + 3 = 6".
  {
    resetPeakConcurrency();
    let inFlight = 0;
    let observedPeak = 0;
    global.fetch = async () => {
      inFlight++;
      observedPeak = Math.max(observedPeak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight--;
      return jsonResponse(200, { items: [] });
    };
    const batchA = Array.from({ length: 6 }, (_, i) => article({ id: 'ca-' + i, title: 'A 카테고리 기사 ' + i, url: 'https://news.google.com/rss/articles/CATA' + i }));
    const batchB = Array.from({ length: 6 }, (_, i) => article({ id: 'cb-' + i, title: 'B 카테고리 기사 ' + i, url: 'https://news.google.com/rss/articles/CATB' + i }));
    await Promise.all([enrichWithNaver(batchA), enrichWithNaver(batchB)]);
    assert.ok(observedPeak <= 3, 'two concurrent category enrichments together must still cap at 3, not 6 (' + observedPeak + ' observed)');
  }

  // M. 1차 검색(원본 title)이 0건 -> 제목을 정리한 2차 검색으로 실제 매칭
  // 복구 (임계값은 그대로, evaluateCandidates는 수정하지 않음). 실제
  // 프로덕션 미매칭 기사("코스피 발목 잡은...  - 머니투데이")를 그대로 재현.
  {
    let calls = 0;
    const seenQueries = [];
    global.fetch = async (url) => {
      calls++;
      // NAVER_SEARCH_URL + '?' + new URLSearchParams({query, ...}) encodes
      // spaces as "+" (application/x-www-form-urlencoded), so this must be
      // parsed with URL/searchParams (which decodes "+" as a space) rather
      // than decodeURIComponent (which does not).
      seenQueries.push(new URL(String(url)).searchParams.get('query'));
      if (calls === 1) return jsonResponse(200, { items: [] }); // raw title -> NAVER가 아무것도 못 찾음
      return jsonResponse(200, { items: [naverItem({ title: '코스피 발목 잡은 유가·금리 상승…FOMC 이후 달라질까?', originallink: 'https://www.mt.co.kr/stock/2026/09/11/x' })] });
    };
    const a = article({
      id: 'fbq-1',
      title: '코스피 발목 잡은 유가·금리 상승…FOMC 이후 달라질까? - 머니투데이',
      source: '머니투데이',
      sourceUrl: 'https://www.mt.co.kr',
      url: 'https://news.google.com/rss/articles/FBQ1',
      description: '머니투데이 보도'
    });
    const stats = await enrichWithNaver([a]);
    assert.strictEqual(calls, 2, '1차(원본 title) + 2차(정리된 title) = 총 2회 호출');
    assert.strictEqual(seenQueries[0], a.title, '1차 검색은 원본 title 그대로 사용해야 한다');
    assert.strictEqual(seenQueries[1], buildFallbackQuery(a.title), '2차 검색은 정리된 title을 사용해야 한다');
    assert.strictEqual(stats.matched, 1);
    assert.strictEqual(stats.matchedViaFallbackQuery, 1);
    assert.strictEqual(a.url, 'https://www.mt.co.kr/stock/2026/09/11/x');
    assert.notStrictEqual(a.description, '머니투데이 보도');
  }

  // N. 1차 검색이 0건이고, title을 정리해도 바뀌는 게 없으면(정리할 노이즈가
  // 없는 title) 2차 검색을 하지 않는다 - 의미 없는 중복 호출 방지.
  {
    let calls = 0;
    global.fetch = async () => { calls++; return jsonResponse(200, { items: [] }); };
    const a = article({ id: 'fbq-2', title: '완전히 깨끗한 제목', url: 'https://news.google.com/rss/articles/FBQ2' });
    const stats = await enrichWithNaver([a]);
    assert.strictEqual(calls, 1, '정리해도 title이 바뀌지 않으면 2차 검색을 하면 안 된다');
    assert.strictEqual(stats.matchedViaFallbackQuery, 0);
  }

  // O. 1차 검색에서 후보가 있었지만 유사도가 낮아 거부된 경우에는 2차
  // (정리된 title) 검색을 시도하지 않는다 - "후보가 아예 없을 때"만 재시도
  // 대상이며, 낮은 점수로 거부된 경우까지 다시 검색하면 false positive
  // 위험이 커진다.
  {
    let calls = 0;
    global.fetch = async () => { calls++; return jsonResponse(200, { items: [naverItem({ title: '완전히 다른 주제의 기사 제목입니다' })] }); };
    const a = article({ id: 'fbq-3', title: '한은 "기준금리 추가 인상 검토" - 연합뉴스', url: 'https://news.google.com/rss/articles/FBQ3' });
    const stats = await enrichWithNaver([a]);
    assert.strictEqual(calls, 1, '후보는 있었지만 유사도가 낮아 거부된 경우 2차 검색을 하면 안 된다');
    assert.strictEqual(stats.unmatched, 1);
    assert.strictEqual(stats.matchedViaFallbackQuery, 0);
  }

  // P. 2차 검색도 결국 0건이면 정상적으로 unmatched fallback 유지 (에러
  // 아님, 크래시 아님).
  {
    let calls = 0;
    global.fetch = async () => { calls++; return jsonResponse(200, { items: [] }); };
    const original = { description: '기존 한양경제 보도', url: 'https://news.google.com/rss/articles/FBQ4' };
    const a = article({ id: 'fbq-4', title: '유가 뛰자 비트코인 흔들렸다... 美 CPI 발표 앞두고 시장 긴장', source: '한양경제', url: original.url, description: original.description });
    const stats = await enrichWithNaver([a]);
    assert.strictEqual(calls, 2);
    assert.strictEqual(stats.unmatched, 1);
    assert.strictEqual(a.description, original.description);
    assert.strictEqual(a.url, original.url);
  }

  // L. NAVER API가 0건 반환 -> 정상 fallback
  {
    global.fetch = async () => jsonResponse(200, { items: [] });
    const original = { description: '기존 조선일보 보도', url: 'https://news.google.com/rss/articles/LTEST' };
    const articles = [article({ id: 'l1', url: original.url, description: original.description })];
    const stats = await enrichWithNaver(articles);
    assert.strictEqual(stats.unmatched, 1);
    assert.strictEqual(articles[0].description, original.description);
    assert.strictEqual(articles[0].url, original.url);
  }

  // Not configured -> enrichWithNaver is a complete no-op, never throws.
  {
    delete process.env.NAVER_CLIENT_ID;
    delete process.env.NAVER_CLIENT_SECRET;
    let called = false;
    global.fetch = async () => { called = true; return jsonResponse(200, { items: [] }); };
    const articles = [article({ id: 'noconf1' })];
    const stats = await enrichWithNaver(articles);
    assert.strictEqual(called, false);
    assert.strictEqual(stats.matched, 0);
  }

  global.fetch = realFetch;
  if (realId === undefined) delete process.env.NAVER_CLIENT_ID; else process.env.NAVER_CLIENT_ID = realId;
  if (realSecret === undefined) delete process.env.NAVER_CLIENT_SECRET; else process.env.NAVER_CLIENT_SECRET = realSecret;

  console.log('naver-enrichment.test.js: all assertions passed');
})().catch((err) => { console.error(err); process.exit(1); });
