/*
  Shared real-news data source for EconomyBrief_API_Final.

  Fetches NewsData.io articles through this project's own server proxy
  (server.js -> /api/news), never NewsData.io directly, so the API key never
  reaches the browser. Every consumer on every page (main.html/newsfeed.html
  via live-feed-inject.js, article.html/deep-research.html via news-data.js's
  loadArticles()) calls window.EBApiNews.getArticles() and gets back the
  SAME array from the SAME in-flight/cached promise, so an article clicked
  on main.html resolves to the identical id on article.html without a
  second network round trip.

  On any failure (server down, missing NEWSDATA_API_KEY, provider error,
  empty result) this resolves to `null` instead of rejecting, so every
  caller can do `articles || fallbackMockArticles` and never has to special-
  case a thrown error. Nothing here touches window.EB_NEWS_SOURCE directly -
  that stays exactly what news-data-source.js set, untouched, so the mock
  data is always intact as a fallback.

  aiSummary/whatHappened/whyImportant/whatNext are deliberately left unset
  on every transformed article: article-ai.js already falls back to
  EBNews.buildSummary(article) (a template driven only by the article's own
  title/description/category/keywords) whenever those fields are missing,
  so real articles automatically get the same non-fabricated summary
  treatment as mock ones with zero changes to article-ai.js.

  deepResearch IS generated here (buildDeepResearch below), because
  deep-research-ai.js reads article.deepResearch.* directly with no such
  fallback built in - leaving it unset would render blank Deep Research
  sections for every real article. The generator only reorganizes fields
  NewsData.io already returned (title/description/category/keywords); it
  never invents a number, date, or fact that didn't come from the API.
*/
(function () {
  'use strict';

  var API_BASE = 'api';
  var FALLBACK_IMAGE = 'assets/img/news/ai-data-investment.webp';
  // Google News RSS never provides a per-article image (raw.image is always
  // null for every real article - see server.js/article-enrichment.js), so
  // every card fell back to the exact same FALLBACK_IMAGE. This gives each
  // of the 9 categories a POOL of fallbacks instead (previously one file per
  // category, which meant every article in a category showed the identical
  // picture). Every file below already existed in assets/img/news/ before
  // this change (no new/generated/downloaded images) and was opened and
  // visually checked so its actual pictured content matches the category,
  // not just a similar-sounding filename - several files were rejected here
  // despite promising names (e.g. krw-usd-1380.webp/krw-usd-export-earnings.webp
  // are actually port/container photos, not currency; realestate-etf-plan.webp
  // is a government press conference, not an ETF product).
  // '가상자산' still has no existing image whose content is actually about
  // crypto - deliberately left out rather than forcing a mismatched picture,
  // so it falls through to FALLBACK_IMAGE exactly as before.
  //
  // Every pool below is deliberately kept 16:9 (900x507) only - article.html's
  // .hero-image renders at a fixed width:100%/height:200px with
  // object-fit:cover (unchanged, not touched here), which crops a 1:1 image
  // by roughly a quarter off each side to fill that box. samsung-hbm4.webp,
  // bok-rate-325.webp and fed-rate-cut-sep.webp are the only 1:1 (424x424)
  // files that were previously mixed into the 반도체/금리/주식 pools - they
  // are excluded here (not deleted from assets/img/news/, since other pages
  // still reference them directly) so the API-news thumbnail rotation only
  // ever assigns a 16:9 image.
  var CATEGORY_FALLBACK_IMAGE_POOLS = {
    'AI': [
      'assets/img/news/ai-data-investment.webp',
      'assets/img/news/bigtech-ai-datacenter.webp'
    ],
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
    '환율': [
      'assets/img/news/krw-usd-1379.webp',
      'assets/img/news/krw-usd-export.webp',
      'assets/img/news/fed-cut-domestic-market-impact.webp'
    ],
    'ETF': [
      'assets/img/news/leveraged-etf-stabilization-measures.webp',
      'assets/img/news/ai-semi-etf-individual.webp'
    ],
    '주식': [
      'assets/img/news/kospi-2750-close.webp',
      'assets/img/news/kospi-2700.webp',
      'assets/img/news/tesla-earnings-volatility.webp'
    ],
    // Only one genuinely bond-matching image exists in assets/img/news/ (the
    // rest of the candidates checked were export/shipping or stock-market
    // photos) - kept as a single-image pool exactly as instructed, rather
    // than inventing a second file.
    '채권': [
      'assets/img/news/nyse-index-movement.webp'
    ],
    '원자재': [
      'assets/img/news/oil-85-dollar.webp',
      'assets/img/news/oil-price-up.webp'
    ]
  };
  var articlesPromise = null;

  function normalizeText(value) {
    return String(value || '').trim();
  }

  // Google News RSS appends a language suffix (e.g. "Investing.com 한국어",
  // "Reuters 한국어") to non-Korean-native outlets in its Korean edition.
  // This strips only that trailing " 한국어" for the DISPLAY label; it never
  // touches the raw value used elsewhere (see sourceRaw below), and normal
  // Korean outlet names (e.g. "한국경제", "연합뉴스") never match the pattern
  // since it requires a preceding space before a trailing "한국어".
  function normalizeSourceLabel(source) {
    var raw = String(source || '').trim();
    if (!raw) return raw;
    var stripped = raw.replace(/\s+한국어\s*$/u, '').trim();
    return stripped || raw;
  }

  // Simple deterministic string hash (djb2-like) - same input always yields
  // the same non-negative integer in this session and across sessions/pages,
  // with no Math.random anywhere in the selection path.
  function hashString(value) {
    var str = String(value || '');
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  // Assigns a fallback image to EVERY article in `rawList` that has no real
  // article.image, considering the whole list together (not one article in
  // isolation). Returns a parallel array: results[i] is the chosen image
  // for rawList[i], or null where rawList[i].image is already real (that
  // slot must never be touched by fallback logic at all).
  //
  // Why not plain `hash(id) % pool.length` (the previous approach): two
  // unrelated articles can hash to the same pool index by coincidence
  // (a "hash collision"), which is exactly what showed up on the real
  // mobile feed as repeated/adjacent identical thumbnails. This replaces
  // that with a per-category ROTATING CURSOR: the first article seen for a
  // category picks its pool's starting position from hash(key) (so the
  // rotation phase is still deterministic and varies feed-to-feed), and
  // every subsequent article of that same category simply advances to the
  // next pool index (wrapping). That guarantees zero repeats within one
  // full cycle of a category's pool (satisfies "fewer articles than pool
  // -> no duplicates") and, once a pool is exhausted, the *smallest
  // possible* repeat distance - the same image can only recur after every
  // other image in that pool has appeared once (satisfies "more articles
  // than pool -> repeats allowed, but never back-to-back").
  //
  // A single extra check (`chosen === lastAssigned`) guards the ONE case
  // rotation alone can't cover: two DIFFERENT categories whose pools
  // happen to contain the exact same asset file landing on adjacent cards.
  // (None of the real pools currently share a file - verified by hashing
  // every pool image - but the guard keeps the guarantee correct even if
  // that ever changes, and `poolsOverride` below exists so this exact
  // scenario can be exercised in a unit test without touching the real
  // pools.) A same-category repeat can never reach this check to begin
  // with, since the rotation above already guarantees the immediately
  // preceding SAME-category pick (if any) differs from this one.
  //
  // No Math.random anywhere: processing the identical rawList in the
  // identical order always produces the identical results array.
  function computeFallbackImages(rawList, poolsOverride) {
    var pools = poolsOverride || CATEGORY_FALLBACK_IMAGE_POOLS;
    var cursors = {}; // category -> next pool index to use
    var results = new Array(rawList.length);
    var lastAssigned = null;
    for (var i = 0; i < rawList.length; i++) {
      var raw = rawList[i] || {};
      if (raw.image) { results[i] = null; continue; } // real image: fallback logic never runs for this slot
      var category = normalizeText(raw.category) || '경제';
      var pool = (pools[category] && pools[category].length) ? pools[category] : [FALLBACK_IMAGE];
      var chosen;
      if (pool.length === 1) {
        // Nothing to rotate/diversify away from - always this one file,
        // unchanged, whether it's a genuinely single-image category pool
        // or the generic FALLBACK_IMAGE for an unmapped category.
        chosen = pool[0];
      } else {
        var key = raw.id || raw.url || String(i);
        if (!Object.prototype.hasOwnProperty.call(cursors, category)) {
          cursors[category] = hashString(key) % pool.length;
        }
        var idx = cursors[category] % pool.length;
        chosen = pool[idx];
        cursors[category] = idx + 1;
        if (chosen === lastAssigned) {
          idx = cursors[category] % pool.length;
          chosen = pool[idx];
          cursors[category] = idx + 1;
        }
      }
      results[i] = chosen;
      lastAssigned = chosen;
    }
    return results;
  }

  // Same "is this real content, or just a placeholder" check gemini-summary.js/
  // news-data.js already use elsewhere (kept in sync deliberately, duplicated
  // here rather than depending on window.EBNews - see this file's header
  // comment on why buildDeepResearch() stays self-contained). Returns the
  // first real sentence of the description, or null when there isn't one.
  function firstRealSentence(article) {
    var desc = String(article.description || '').trim();
    if (!desc || (article.source && desc === article.source + ' 보도') || desc.length < 20) return null;
    var match = desc.match(/[^.!?]+[.!?]+/);
    return match ? match[0].trim() : desc;
  }

  function buildDeepResearch(article) {
    var category = article.category || '경제';
    var keywords = article.keywords && article.keywords.length ? article.keywords : [category];
    return {
      summary: article.description || (article.title + '에 대한 심층 분석입니다.'),
      // keyPoints[0] used to just repeat article.title verbatim - redundant
      // with the page's own headline shown just above it, and Google News
      // RSS titles are sometimes terse/awkwardly phrased on their own,
      // which reads even more oddly once repeated as a bullet (the reported
      // bug). Uses the description's own first real sentence instead when
      // there is one, falling back to the title only when there's truly
      // nothing else real to say.
      keyPoints: [
        firstRealSentence(article) || article.title,
        '관련 키워드: ' + keywords.join(', '),
        '‘' + category + '’ 분야의 주요 동향으로 분류됩니다.',
        article.source ? article.source + ' 보도 기준' : '원문 기준 정리된 내용입니다.'
      ],
      // Reworded away from the near-duplicate "OO 분야에서 나온 소식으로,
      // 관련 산업과 시장 참여자들에게 영향을 줄 수 있는 사안으로 평가됩니다"
      // boilerplate (the same generic filler pattern already banned from
      // news-data.js's buildSummary()) - still only states the real
      // category, never a fabricated impact.
      impact: category + ' 관련 소식인 만큼, 같은 분야의 다른 지표나 후속 보도와 함께 살펴볼 필요가 있습니다.',
      outlook: '관련 동향이 어떻게 전개될지는 향후 발표되는 추가 소식과 지표를 통해 확인할 필요가 있습니다.',
      risks: '예상과 다른 방향으로 전개될 가능성도 있으므로, 후속 지표와 발표를 지속적으로 확인하는 것이 중요합니다.'
    };
  }

  function transform(raw, fallbackImage) {
    var title = normalizeText(raw.title);
    var description = normalizeText(raw.description);
    var category = normalizeText(raw.category) || '경제';
    var rawSource = normalizeText(raw.source) || '출처 확인 필요';
    var article = {
      id: 'newsdata-' + normalizeText(raw.id),
      title: title || '제목 없음',
      // Display label only (language-suffix stripped, e.g. "Investing.com
      // 한국어" -> "Investing.com"). The untouched original is kept below as
      // sourceRaw so no data is destroyed by the display-only normalization.
      source: normalizeSourceLabel(rawSource),
      sourceRaw: rawSource,
      sourceLogo: raw.sourceLogo || null,
      date: normalizeText(raw.date) || '발행 시간 확인 필요',
      publishedAt: raw.publishedAt || null,
      category: category,
      description: description || '설명이 제공되지 않았습니다.',
      // raw.image (a genuinely real per-article image) always wins if it's
      // ever present. Its absence falls through to `fallbackImage`, which
      // fetchArticles() below already computed for this article by looking
      // at the WHOLE article list at once (see computeFallbackImages) - not
      // decided by this single article in isolation - and only that being
      // unavailable falls through further to the single generic
      // FALLBACK_IMAGE.
      image: raw.image || fallbackImage || FALLBACK_IMAGE,
      keywords: Array.isArray(raw.keywords) ? raw.keywords.filter(Boolean) : [],
      originalUrl: raw.url || null,
      isLiveApiArticle: true,
      // Real Gemini-generated summary bullets (gemini-summary.js, server
      // side) when present; article-ai.js only trusts these when
      // summaryStatus is exactly 'generated' AND this is a non-empty array -
      // any other value (server default 'not_requested', or a skipped/
      // failed/invalid Gemini attempt) makes it fall back to the existing
      // template summary (news-data.js buildSummary()), unchanged.
      aiSummary: Array.isArray(raw.aiSummary) ? raw.aiSummary.filter(Boolean) : null,
      summaryStatus: raw.summaryStatus || 'not_requested',
      // Real Gemini-generated Q&A pairs (gemini-summary.js), generated and
      // validated completely independently of aiSummary above (same API
      // call, but a separate part of its response, with its own
      // hallucination checks and its own "does this just repeat a bullet"
      // check) - present only when Gemini itself produced usable Q&A for
      // this specific article. article-ai.js only trusts this when it's a
      // non-empty array of {q, a} pairs; anything else falls back to
      // news-data.js's buildSummary().qna, unchanged.
      qna: Array.isArray(raw.qna) ? raw.qna.filter(function (item) { return item && typeof item.q === 'string' && typeof item.a === 'string'; }) : null
    };
    article.deepResearch = buildDeepResearch(article);
    return article;
  }

  function fetchArticles() {
    return fetch(API_BASE + '/news?category=all', { headers: { Accept: 'application/json' } })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          if (!response.ok) throw new Error(body.error || 'API 요청 실패');
          return body;
        });
      })
      .then(function (data) {
        var raw = Array.isArray(data.articles) ? data.articles : [];
        if (!raw.length) return null;
        // Computed once over the full ordered list BEFORE transforming any
        // single article, so each article's fallback pick can account for
        // what was already assigned to the articles before it (including
        // ones in a different category) - see computeFallbackImages.
        var fallbackImages = computeFallbackImages(raw);
        return raw.map(function (item, i) { return transform(item, fallbackImages[i]); });
      })
      .catch(function () {
        // Server down, no NEWSDATA_API_KEY yet, provider error, timeout, etc.
        // Every caller treats null as "use the existing mock data instead."
        return null;
      });
  }

  // options.forceRefresh bypasses the cached promise below to actually hit
  // /api/news again - added for newsfeed.html's 60s polling (assets/js/
  // live-feed-inject.js), which needs to notice server-side refreshes
  // instead of forever replaying this page's first response. Every existing
  // caller (getArticles() with no args) is unaffected: same permanently-
  // cached single promise as before, so an article clicked on main.html
  // still resolves to the identical id on article.html with no extra
  // network round trip.
  function getArticles(options) {
    if (!articlesPromise || (options && options.forceRefresh)) articlesPromise = fetchArticles();
    return articlesPromise;
  }

  window.EBApiNews = { getArticles: getArticles };
  // Test-only introspection hook - no production page reads this. Exposes
  // the pure fallback-image-assignment function (with its pool map
  // overridable) so unit tests can verify the anti-collision/rotation
  // behavior directly, including scenarios (two categories sharing one
  // asset file) that don't occur in the real CATEGORY_FALLBACK_IMAGE_POOLS.
  window.EBApiNews.__test = {
    computeFallbackImages: computeFallbackImages,
    CATEGORY_FALLBACK_IMAGE_POOLS: CATEGORY_FALLBACK_IMAGE_POOLS
  };
})();
