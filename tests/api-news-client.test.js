// Function-level test for assets/js/api-news-client.js's transform()/
// CATEGORY_FALLBACK_IMAGES image-selection logic, run headlessly via Node's
// built-in vm module (no browser, no new dependency, no jsdom). The file is
// a browser IIFE that only exposes window.EBApiNews.getArticles(), so this
// drives that exact real entry point with a stubbed window.fetch returning
// a controlled /api/news-shaped payload, instead of re-implementing the
// priority logic separately and testing the copy.
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'api-news-client.js'), 'utf8');

function runWithMockFetch(articlesPayload) {
  const sandbox = {
    window: {},
    fetch: async () => ({
      ok: true,
      json: async () => ({ articles: articlesPayload })
    })
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.EBApiNews.getArticles();
}

(async () => {
  // 1) A real per-article image must never be overridden by any fallback.
  const withRealImage = await runWithMockFetch([
    { id: '1', title: 'T', source: 'S', category: '반도체', description: 'D', url: 'https://x.test/1', image: 'https://real.cdn/x.jpg' }
  ]);
  assert.strictEqual(withRealImage[0].image, 'https://real.cdn/x.jpg');

  // 2) null image + a category that HAS a mapping -> a file from that
  // category's own fallback POOL (each category now has multiple candidate
  // images, not one fixed file - see pickFallbackImage/CATEGORY_FALLBACK_IMAGE_POOLS).
  // Kept in sync with assets/js/api-news-client.js's own
  // CATEGORY_FALLBACK_IMAGE_POOLS - all 16:9 (900x507) only. samsung-hbm4.webp/
  // bok-rate-325.webp/fed-rate-cut-sep.webp (the only 1:1 424x424 files that
  // used to be mixed in) were removed from these pools so the API-news
  // thumbnail rotation never assigns a square image into the 16:9
  // .hero-image box (width:100%/height:200px/object-fit:cover - unchanged).
  const CATEGORY_POOLS = {
    'AI': ['assets/img/news/ai-data-investment.webp', 'assets/img/news/bigtech-ai-datacenter.webp'],
    '반도체': [
      'assets/img/news/hbm-demand-surge.webp',
      'assets/img/news/ai-chip-demand-impact.webp',
      'assets/img/news/ai-chip-equipment-earnings.webp',
      'assets/img/news/samsung-3nm-foundry.webp',
      'assets/img/news/ai-semi-etf-inflow.webp'
    ],
    '금리': [
      'assets/img/news/bok-rate-350.webp',
      'assets/img/news/bok-rate-hold-2.webp',
      'assets/img/news/bok-rate-outlook-h2.webp',
      'assets/img/news/bok-rate-household-loan-impact.webp',
      'assets/img/news/rate-inflation-debt-balance.webp',
      'assets/img/news/us-inflation-rate-outlook.webp',
      'assets/img/news/household-debt-1900t.webp',
      'assets/img/news/fed-hike-signal.webp'
    ],
    '환율': ['assets/img/news/krw-usd-1379.webp', 'assets/img/news/krw-usd-export.webp', 'assets/img/news/fed-cut-domestic-market-impact.webp'],
    'ETF': ['assets/img/news/leveraged-etf-stabilization-measures.webp', 'assets/img/news/ai-semi-etf-individual.webp'],
    '주식': [
      'assets/img/news/kospi-2750-close.webp',
      'assets/img/news/kospi-2700.webp',
      'assets/img/news/tesla-earnings-volatility.webp'
    ],
    '채권': ['assets/img/news/nyse-index-movement.webp'],
    '원자재': ['assets/img/news/oil-85-dollar.webp', 'assets/img/news/oil-price-up.webp']
  };
  const semiconductor = await runWithMockFetch([
    { id: '2', title: 'T', source: 'S', category: '반도체', description: 'D', url: 'https://x.test/2', image: null }
  ]);
  assert.ok(CATEGORY_POOLS['반도체'].includes(semiconductor[0].image), '반도체 fallback must come from its own pool, got ' + semiconductor[0].image);

  // Spot-check every mapped category resolves to a file from ITS OWN pool
  // (no category ever borrows another category's fallback image - the pools
  // don't share filenames, so this also proves no cross-category leakage).
  const mixedBatch = await runWithMockFetch(
    Object.keys(CATEGORY_POOLS).map((cat, i) => ({ id: String(i), title: 'T', source: 'S', category: cat, description: 'D', url: 'https://x.test/' + i, image: null }))
  );
  Object.keys(CATEGORY_POOLS).forEach((cat, i) => {
    assert.ok(CATEGORY_POOLS[cat].includes(mixedBatch[i].image), 'category ' + cat + ' resolved to ' + mixedBatch[i].image + ' which is not in its own pool');
  });
  const distinctImages = new Set(mixedBatch.map((a) => a.image));
  assert.strictEqual(distinctImages.size, Object.keys(CATEGORY_POOLS).length, 'every mapped category must resolve to a DIFFERENT image than every other category');

  // ---------------------------------------------------------------------
  // Fallback-thumbnail DISTRIBUTION tests (this turn's fix): plain
  // `hash(id) % pool.length` (previous approach) let two unrelated
  // articles collide on the same pool index by coincidence, which is what
  // showed up as repeated/adjacent identical thumbnails on the real mobile
  // feed. computeFallbackImages() now assigns images by considering the
  // WHOLE article list together (per-category rotating cursor + a global
  // adjacent-duplicate guard) - see assets/js/api-news-client.js. Letters
  // A-H below follow this turn's requested test list.
  // ---------------------------------------------------------------------

  // A. Same article.id, processed as its own list, on two separate calls ->
  // same fallback image both times (determinism is about reprocessing an
  // identical list identically, not about one id having one fixed image
  // regardless of what list it appears in - see H below for the full-list
  // version of this same guarantee).
  const singleArticle = [{ id: 'fixed-id-1', title: 'T', source: 'S', category: '금리', description: 'D', url: 'https://x.test/g1', image: null }];
  const singleRun1 = await runWithMockFetch(singleArticle);
  const singleRun2 = await runWithMockFetch(singleArticle);
  assert.strictEqual(singleRun1[0].image, singleRun2[0].image, '동일 article.id를 담은 동일 목록을 두 번 처리하면 항상 같은 fallback image가 나와야 한다');

  // B. Many different article ids, same multi-image category ('금리', 8
  // images after removing the one 1:1 outlier bok-rate-325.webp) -> every
  // one of the 8 should now resolve to a DIFFERENT image (not just ">1
  // distinct" as before) - the rotating cursor guarantees a full cycle with
  // zero repeats before anything can recur.
  const manyIds = await runWithMockFetch(
    Array.from({ length: CATEGORY_POOLS['금리'].length }, (_, i) => ({ id: 'rate-article-' + i, title: 'T', source: 'S', category: '금리', description: 'D', url: 'https://x.test/b' + i, image: null }))
  );
  const distinctForCategory = new Set(manyIds.map((a) => a.image));
  assert.strictEqual(distinctForCategory.size, CATEGORY_POOLS['금리'].length, '풀 크기만큼의 서로 다른 기사는 전부 서로 다른 이미지를 받아야 한다');
  manyIds.forEach((a) => assert.ok(CATEGORY_POOLS['금리'].includes(a.image)));

  // C. Fewer articles than the pool ('환율', 3 images) -> zero duplicates
  // among them (a strict subset of a full cycle, so also zero repeats).
  const fewerThanPool = await runWithMockFetch([
    { id: 'fx-1', title: 'T', source: 'S', category: '환율', description: 'D', url: 'https://x.test/c1', image: null },
    { id: 'fx-2', title: 'T', source: 'S', category: '환율', description: 'D', url: 'https://x.test/c2', image: null }
  ]);
  assert.notStrictEqual(fewerThanPool[0].image, fewerThanPool[1].image, '풀보다 적은 수의 같은 카테고리 기사는 중복 없이 배정되어야 한다');

  // D. More articles than the pool ('ETF', 2 images, 5 articles) ->
  // duplicates are unavoidable, but no two ADJACENT articles may share the
  // same image (the concrete bug reported from the real mobile feed).
  const moreThanPool = await runWithMockFetch(
    Array.from({ length: 5 }, (_, i) => ({ id: 'etf-' + i, title: 'T', source: 'S', category: 'ETF', description: 'D', url: 'https://x.test/d' + i, image: null }))
  );
  for (let i = 1; i < moreThanPool.length; i++) {
    assert.notStrictEqual(moreThanPool[i].image, moreThanPool[i - 1].image, '풀보다 기사가 많아도 바로 인접한 기사끼리는 같은 이미지를 받으면 안 된다 (index ' + i + ')');
  }

  // E. Two DIFFERENT categories whose pools happen to contain the exact
  // same asset file must not land that shared file on two adjacent cards.
  // None of the real production pools currently share a file (see the
  // final report's dedup check), so this exercises the general mechanism
  // via window.EBApiNews.__test's poolsOverride with a synthetic pool
  // (clearly test-only filenames, never written to the real
  // CATEGORY_FALLBACK_IMAGE_POOLS or assets/img/news/).
  {
    const sandbox = { window: {}, fetch: async () => ({ ok: true, json: async () => ({ articles: [] }) }) };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    const testHook = sandbox.window.EBApiNews.__test;
    function hashString(value) {
      const str = String(value || '');
      let hash = 0;
      for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
      return Math.abs(hash);
    }
    const sharedPool = ['test-shared-1.webp', 'test-shared-2.webp'];
    const firstKey = 'cat-x-seed';
    const firstIdx = hashString(firstKey) % sharedPool.length;
    let collidingKey = null;
    for (let n = 0; n < 1000; n++) {
      if (hashString('k' + n) % sharedPool.length === firstIdx) { collidingKey = 'k' + n; break; }
    }
    assert.ok(collidingKey, 'test setup: could not find a naturally-colliding key (increase search range)');
    const crossCategoryList = [
      { id: firstKey, category: 'TestCatX', image: null },
      { id: collidingKey, category: 'TestCatY', image: null }
    ];
    const crossCategoryResults = testHook.computeFallbackImages(crossCategoryList, { TestCatX: sharedPool, TestCatY: sharedPool });
    assert.notStrictEqual(crossCategoryResults[0], crossCategoryResults[1], '서로 다른 카테고리라도 동일 asset이 연속으로 노출되면 안 된다');
  }

  // F. article.image가 실제로 존재하면 computeFallbackImages는 해당 슬롯에
  // 전혀 개입하지 않는다 (null 반환) - fallback 로직이 실행조차 되지 않음을
  // transform() 우회 없이 직접 확인.
  {
    const sandbox = { window: {}, fetch: async () => ({ ok: true, json: async () => ({ articles: [] }) }) };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    const testHook = sandbox.window.EBApiNews.__test;
    const withRealImageResult = testHook.computeFallbackImages([
      { id: 'f1', category: 'AI', image: 'https://real.cdn/pic.jpg' }
    ]);
    assert.strictEqual(withRealImageResult[0], null, '실제 image가 있는 기사 슬롯은 fallback 로직이 건드리면 안 된다');
  }

  // G. a category whose pool has exactly ONE image ('채권') must keep
  // returning that single existing file for every article, regardless of id
  // - never invents a second file, never perturbed by adjacent-duplicate
  // avoidance (there is nothing else to diversify into).
  const bondArticles = await runWithMockFetch([
    { id: 'bond-1', title: 'T', source: 'S', category: '채권', description: 'D', url: 'https://x.test/g1', image: null },
    { id: 'bond-2-totally-different', title: 'T', source: 'S', category: '채권', description: 'D', url: 'https://x.test/g2', image: null }
  ]);
  assert.strictEqual(bondArticles[0].image, 'assets/img/news/nyse-index-movement.webp');
  assert.strictEqual(bondArticles[1].image, 'assets/img/news/nyse-index-movement.webp');

  // H. Processing the exact same full (mixed-category) article list twice
  // must produce byte-identical results end to end - no Math.random
  // anywhere in the selection path.
  const mixedList = [
    { id: 'h1', title: 'T', source: 'S', category: '금리', description: 'D', url: 'https://x.test/h1', image: null },
    { id: 'h2', title: 'T', source: 'S', category: 'ETF', description: 'D', url: 'https://x.test/h2', image: null },
    { id: 'h3', title: 'T', source: 'S', category: '금리', description: 'D', url: 'https://x.test/h3', image: null },
    { id: 'h4', title: 'T', source: 'S', category: '반도체', description: 'D', url: 'https://x.test/h4', image: null },
    { id: 'h5', title: 'T', source: 'S', category: 'ETF', description: 'D', url: 'https://x.test/h5', image: null }
  ];
  const hRun1 = await runWithMockFetch(mixedList);
  const hRun2 = await runWithMockFetch(mixedList);
  assert.deepStrictEqual(hRun1.map((a) => a.image), hRun2.map((a) => a.image), '동일한 전체 기사 목록을 두 번 처리하면 완전히 동일한 결과가 나와야 한다');

  // 3) null image + '가상자산' (no mapping exists) -> falls through to the
  // single generic FALLBACK_IMAGE, not left blank and not a wrong guess.
  const crypto = await runWithMockFetch([
    { id: '3', title: 'T', source: 'S', category: '가상자산', description: 'D', url: 'https://x.test/3', image: null }
  ]);
  assert.strictEqual(crypto[0].image, 'assets/img/news/ai-data-investment.webp');

  // 4) null image + an entirely unknown/unlisted category -> same generic
  // fallback, never throws.
  const unknown = await runWithMockFetch([
    { id: '4', title: 'T', source: 'S', category: '기타', description: 'D', url: 'https://x.test/4', image: null }
  ]);
  assert.strictEqual(unknown[0].image, 'assets/img/news/ai-data-investment.webp');

  // A. NAVER 매칭 성공 시 서버가 채워준 실제 description이 transform()을
  // 거쳐 카드가 쓰는 article.description으로 "그대로" 전달되는지 - title로
  // 재작성되거나 잘리지 않아야 한다.
  const realNaverDesc = '코스피지수가 선물·옵션 동시 만기일인 10일 장 초반 방향성을 찾지 못하고 보합권에서 등락하고 있다.';
  const withRealDescription = await runWithMockFetch([
    { id: 'a', title: '코스피, 네 마녀의 날 경계감에 보합권 등락', source: '한국경제', category: '주식', description: realNaverDesc, url: 'https://x.test/a', image: null }
  ]);
  assert.strictEqual(withRealDescription[0].description, realNaverDesc);

  // B. NAVER 매칭 실패로 서버가 내려준 기존 fallback("{source} 보도")도
  // 그대로 전달되어야 한다 - fallback을 감지해 다른 문구로 바꾸지 않는다.
  const withFallbackDesc = await runWithMockFetch([
    { id: 'b', title: '어떤 제목', source: '한국경제', category: '주식', description: '한국경제 보도', url: 'https://x.test/b', image: null }
  ]);
  assert.strictEqual(withFallbackDesc[0].description, '한국경제 보도');

  // C. description이 null/빈 문자열이면(서버가 이런 값을 주는 일은 없지만,
  // 클라이언트도 방어적으로) 안전한 fallback 문구가 적용되어야 한다 - 빈
  // 문자열을 정상 description으로 취급해 카드에 빈 칸을 남기지 않는다.
  const withNullDesc = await runWithMockFetch([
    { id: 'c1', title: '제목만 있음', source: 'S', category: '경제', description: null, url: 'https://x.test/c1', image: null },
    { id: 'c2', title: '제목만 있음2', source: 'S', category: '경제', description: '   ', url: 'https://x.test/c2', image: null }
  ]);
  assert.strictEqual(withNullDesc[0].description, '설명이 제공되지 않았습니다.');
  assert.strictEqual(withNullDesc[1].description, '설명이 제공되지 않았습니다.', '공백만 있는 description도 빈 값으로 취급되어야 한다');

  // D. title과 description이 서로 다른 실제 내용일 때, description이
  // title로 덮어써지거나 title과 동일해지지 않아야 한다.
  const distinctTitleDesc = await runWithMockFetch([
    { id: 'd', title: '한은 "기준금리 추가 인상 검토"', source: '연합뉴스', category: '금리', description: '한국은행이 물가 상승 압력을 고려해 추가 금리 인상 여부를 검토 중이라고 10일 밝혔다.', url: 'https://x.test/d', image: null }
  ]);
  assert.notStrictEqual(distinctTitleDesc[0].description, distinctTitleDesc[0].title);
  assert.strictEqual(distinctTitleDesc[0].description, '한국은행이 물가 상승 압력을 고려해 추가 금리 인상 여부를 검토 중이라고 10일 밝혔다.');

  // A. Google News RSS's Korean-edition language suffix ("Investing.com
  // 한국어") must be stripped from the DISPLAY label (article.source), while
  // the untouched original is preserved separately as sourceRaw so no data
  // is destroyed by the display-only normalization.
  const investing = await runWithMockFetch([
    { id: 'src-a', title: 'T', source: 'Investing.com 한국어', category: '주식', description: 'D', url: 'https://x.test/a' }
  ]);
  assert.strictEqual(investing[0].source, 'Investing.com');
  assert.strictEqual(investing[0].sourceRaw, 'Investing.com 한국어');

  const reuters = await runWithMockFetch([
    { id: 'src-a2', title: 'T', source: 'Reuters 한국어', category: '주식', description: 'D', url: 'https://x.test/a2' }
  ]);
  assert.strictEqual(reuters[0].source, 'Reuters');

  // B. A normal Korean outlet name (no language suffix) must be left exactly
  // as-is - the regex only strips a trailing " 한국어", so names that merely
  // contain "한국" (e.g. "한국경제") must never be touched.
  const normalSources = await runWithMockFetch([
    { id: 'src-b1', title: 'T', source: '한국경제', category: '주식', description: 'D', url: 'https://x.test/b1' },
    { id: 'src-b2', title: 'T', source: '연합뉴스', category: '주식', description: 'D', url: 'https://x.test/b2' },
    { id: 'src-b3', title: 'T', source: '매일경제', category: '주식', description: 'D', url: 'https://x.test/b3' }
  ]);
  assert.strictEqual(normalSources[0].source, '한국경제');
  assert.strictEqual(normalSources[1].source, '연합뉴스');
  assert.strictEqual(normalSources[2].source, '매일경제');

  // C. sourceLogo present on the raw API article must survive transform()
  // unchanged, so the card-rendering layer (live-feed-inject.js) actually
  // receives the real favicon URL enrichment produced server-side.
  const withLogo = await runWithMockFetch([
    { id: 'src-c', title: 'T', source: 'ZDNet', category: 'AI', description: 'D', url: 'https://x.test/c', sourceLogo: 'https://zdnet.co.kr/favicon.ico' }
  ]);
  assert.strictEqual(withLogo[0].sourceLogo, 'https://zdnet.co.kr/favicon.ico');

  // D. sourceLogo absent (server couldn't find a favicon within budget) must
  // come through as null, not an empty string or undefined, so the renderer's
  // existing `if (article.sourceLogo)` falsy check reliably falls back to the
  // gray placeholder badge instead of trying to load a broken image URL.
  const withoutLogo = await runWithMockFetch([
    { id: 'src-d', title: 'T', source: 'Some Outlet', category: 'AI', description: 'D', url: 'https://x.test/d' }
  ]);
  assert.strictEqual(withoutLogo[0].sourceLogo, null);

  // CSS sanity check (text-level, no browser): the two description selectors
  // that display real API description text on main.html must clamp to 2
  // lines. newsfeed.html's .tl-desc already had -webkit-line-clamp: 2 before
  // this change and is included here so a future regression on either file
  // would fail this test too.
  const mainHtml = fs.readFileSync(path.join(__dirname, '..', 'main.html'), 'utf8');
  const newsfeedHtml = fs.readFileSync(path.join(__dirname, '..', 'newsfeed.html'), 'utf8');
  function ruleFor(html, selector) {
    const m = html.match(new RegExp(selector.replace(/[.]/g, '\\.') + '\\s*\\{([^}]*)\\}'));
    return m ? m[1] : null;
  }
  const highlightBodyRule = ruleFor(mainHtml, '.news-highlight .body');
  const newsListDescRule = ruleFor(mainHtml, '.news-list .desc');
  const tlDescRule = ruleFor(newsfeedHtml, '.timeline-card .tl-desc');
  assert.ok(highlightBodyRule && /-webkit-line-clamp:\s*2\b/.test(highlightBodyRule), '.news-highlight .body must clamp to 2 lines');
  assert.ok(newsListDescRule && /-webkit-line-clamp:\s*2\b/.test(newsListDescRule), '.news-list .desc must clamp to 2 lines');
  assert.ok(tlDescRule && /-webkit-line-clamp:\s*2\b/.test(tlDescRule), '.timeline-card .tl-desc must still clamp to 2 lines');

  // ---------------------------------------------------------------------
  // Regression (실제 프로덕션 버그): buildDeepResearch()가 Deep Research
  // 상세 분석의 "주요 영향 요인" 1번 항목에 article.title을 그대로 복붙해,
  // Google News RSS 특유의 어색한 원문 제목이 그대로 노출되고 있었다
  // (Deep Research 헤더에 이미 같은 제목이 표시되므로 중복이기도 했다).
  // "AI 핵심 분석"(impact)도 news-data.js의 buildSummary()에서 이미
  // 금지했던 것과 같은 종류의 일반론 문구를 반복하고 있었다.
  // ---------------------------------------------------------------------
  const realDescArticle = await runWithMockFetch([{
    id: 'dr-1', title: '배에서 배로 실어 온다...사우디, 아시아 원유 공급 논의', source: '서울신문', category: '원자재',
    description: '사우디아라비아가 원유 수송 차질 우려를 완화하기 위해 해상 환적 방식을 검토하고 있다. 이는 아시아 수출 물량 확대를 위한 조치로 풀이된다.',
    url: 'https://x.test/dr-1', keywords: ['원자재']
  }]);
  const dr = realDescArticle[0].deepResearch;
  assert.notStrictEqual(dr.keyPoints[0], realDescArticle[0].title, '주요 영향 요인 1번이 기사 제목을 그대로 복붙하면 안 된다 (실제 description 문장이 있을 때)');
  assert.ok(realDescArticle[0].description.indexOf(dr.keyPoints[0]) !== -1, '대신 사용하는 문장은 실제 description에서 그대로 가져온 부분 문자열이어야 한다 (없는 내용 생성 금지)');
  assert.strictEqual(dr.impact.indexOf('분야에서 나온 소식으로'), -1, 'impact가 news-data.js에서 이미 금지한 일반론 문구를 반복하면 안 된다');
  assert.strictEqual(dr.impact.indexOf('관련 산업과 시장 참여자들에게 영향을 줄 수 있는 사안으로 평가됩니다'), -1);

  // description이 placeholder("{source} 보도")이거나 너무 짧을 때는 여전히
  // article.title로 fallback해야 한다 (진짜 내용이 없을 때 억지로 문장을
  // 만들어내지 않는다).
  const placeholderDescArticle = await runWithMockFetch([{
    id: 'dr-2', title: '테스트 제목', source: '연합뉴스', category: '금리',
    description: '연합뉴스 보도', url: 'https://x.test/dr-2', keywords: ['금리']
  }]);
  assert.strictEqual(placeholderDescArticle[0].deepResearch.keyPoints[0], '테스트 제목', 'description이 placeholder일 때는 title로 fallback해야 한다');

  console.log('api-news-client.test.js: all assertions passed');
})().catch((err) => { console.error(err); process.exit(1); });
