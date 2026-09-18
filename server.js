const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { enrichArticles } = require('./article-enrichment');
const { enrichWithNaver } = require('./naver-enrichment');
const { enrichWithGemini } = require('./gemini-summary');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const GOOGLE_NEWS_RSS_URL = 'https://news.google.com/rss/search';
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map();
const articleCache = new Map();

function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
loadDotEnv();

const CATEGORIES = {
  AI: { query: '인공지능 OR 생성형 AI OR AI 산업', terms: ['인공지능', '생성형', 'ai', '머신러닝', '데이터센터'] },
  '반도체': { query: '반도체 OR HBM OR 파운드리', terms: ['반도체', 'hbm', '파운드리', '메모리', 'dram', 'nand', '웨이퍼', '칩'] },
  '금리': { query: '기준금리 OR 한국은행 OR 연준', terms: ['기준금리', '금리', '한국은행', '연준', '국채금리', '이자'] },
  '환율': { query: '원달러 환율 OR 외환시장 OR 달러원', terms: ['환율', '원달러', '달러원', '외환시장', '달러', '엔화', '유로'] },
  ETF: { query: 'ETF OR 상장지수펀드 OR ETF 투자', terms: ['etf', '상장지수', 'etn'] },
  '주식': { query: '코스피 OR 코스닥 OR 주식시장', terms: ['주식', '코스피', '코스닥', '증시', '주가', '상장', '시가총액'] },
  '채권': { query: '채권 OR 국채 OR 회사채', terms: ['채권', '국채', '회사채', '채권시장', '채권금리'] },
  '원자재': { query: '원유 OR 국제유가 OR 금값', terms: ['원자재', '원유', '유가', '금값', '구리', '천연가스'] },
  '가상자산': { query: '비트코인 OR 이더리움 OR 가상자산', terms: ['가상자산', '비트코인', '이더리움', '암호화폐', '코인', '블록체인', '디지털자산'] }
};
const CATEGORY_NAMES = Object.keys(CATEGORIES);
const ALLOWED_DOMAINS = new Set([
  // 기존 25개 - 그대로 유지
  'news1.kr', 'yna.co.kr', 'yonhapnewstv.co.kr', 'chosun.com', 'joongang.co.kr', 'hani.co.kr',
  'khan.co.kr', 'mk.co.kr', 'sedaily.com', 'hankyung.com', 'etnews.com', 'sbs.co.kr',
  'newsis.com', 'asiae.co.kr', 'edaily.co.kr', 'mt.co.kr', 'hankookilbo.com', 'kbs.co.kr',
  'imbc.com', 'ohmynews.com', 'inews24.com', 'bizwatch.co.kr', 'newspim.com', 'fnnews.com',
  'biz.chosun.com', 'koreaittimes.com',
  // 원인 부검(autopsy)에서 실제 NewsData.io 원본에 등장했지만 whitelist 누락으로
  // 통째로 탈락하던 주요 국내 종합지 - donga.com/seoul.co.kr/kmib.co.kr은 3대 종합
  // 일간지급이라 반드시 추가, kado.net/dailian.co.kr도 원본에 실제 등장해 추가.
  'donga.com', 'seoul.co.kr', 'kmib.co.kr', 'kado.net', 'dailian.co.kr',
  // 같은 진단에서 whitelist 커버리지 자체가 좁다는 점이 드러나, "한국어 경제
  // 뉴스" 목적에 맞는 주요 종합/경제/IT/방송 매체 중 신뢰도가 높고 실제로
  // 자주 등장할 만한 곳만 보수적으로 추가 (무분별한 전체 허용은 하지 않음).
  'ytn.co.kr', 'mbn.co.kr', 'heraldcorp.com', 'segye.com', 'dt.co.kr'
]);
const ECONOMIC_TERMS = ['주가', '주식', '증시', '코스피', '코스닥', '채권', '국채', '회사채', '금리', '환율', '달러', '투자', '매출', '영업이익', '실적', '기업', '산업', '시장', '거래', '상장', '증권', '주주', '배당', '시가총액', '원유', '유가', '금값', '원자재', '비트코인', '이더리움', '가상자산', '암호화폐', 'etf', '반도체', '메모리', '파운드리', '수출', '수입', '공급', '계약', '인수', '합병', 'ipo'];

function normalizeText(value) { return String(value || '').normalize('NFC').toLowerCase(); }
function hangulRatio(value) {
  const text = String(value || '').normalize('NFC');
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (!letters.length) return 0;
  return (letters.match(/[가-힣]/g) || []).length / letters.length;
}
function isKoreanTitle(title) { const normalized = String(title || '').normalize('NFC'); return hangulRatio(normalized) >= 0.25 && (normalized.match(/[가-힣]/g) || []).length >= 2; }
function hostOf(link) {
  try { return new URL(link).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; }
}
function isKoreanPublisher(article) {
  const host = hostOf(article.url || article.link);
  return [...ALLOWED_DOMAINS].some(domain => host === domain || host.endsWith(`.${domain}`));
}
function hasAny(text, terms) { const value = normalizeText(text); return terms.some(term => value.includes(normalizeText(term))); }
function assignCategory(article, requested) {
  const text = `${article.title || ''} ${article.description || ''}`;
  if (requested && requested !== 'all') return requested;
  const matches = CATEGORY_NAMES.filter(name => hasAny(text, CATEGORIES[name].terms));
  return matches[0] || null;
}
function isDirectEconomic(article, category) {
  const text = `${article.title || ''} ${article.description || ''}`;
  return hasAny(text, CATEGORIES[category].terms) && hasAny(text, ECONOMIC_TERMS);
}
function validHttpUrl(value) { return /^https?:\/\/[^\s]+$/i.test(String(value || '')); }
function stableId(article) {
  return String(article.article_id || crypto.createHash('sha1').update(`${article.link || ''}|${article.title || ''}`).digest('hex').slice(0, 20));
}
function parseDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  // NewsData.io's old "YYYY-MM-DD HH:MM:SS" format had no timezone marker but
  // was always UTC, so it needs the explicit 'Z' below. Google News RSS's
  // pubDate is RFC 2822 ("Wed, 10 Sep 2026 01:23:45 GMT") and already carries
  // its own timezone, so native Date parsing alone is correct for it.
  const isSpaceSeparatedUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw);
  const date = isSpaceSeparatedUtc ? new Date(raw.replace(' ', 'T') + 'Z') : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
function formatDate(value) {
  const date = parseDate(value);
  if (!date) return '발행 시간 확인 필요';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}
function normalizeArticle(article, category) {
  const title = String(article.title || '').normalize('NFC').trim();
  const description = String(article.description || '').normalize('NFC').trim();
  const link = String(article.link || '').trim();
  const image = validHttpUrl(article.image_url) ? article.image_url : null;
  return {
    id: stableId(article), title, source: String(article.source_name || '').normalize('NFC').trim() || hostOf(link) || '출처 확인 필요',
    sourceLogo: validHttpUrl(article.source_icon) ? article.source_icon : null,
    publishedAt: article.pubDate || null, date: formatDate(article.pubDate), url: validHttpUrl(link) ? link : null,
    category, description, image, keywords: Array.isArray(article.keywords) ? article.keywords.slice(0, 8).map(value => String(value || '').normalize('NFC').trim()).filter(Boolean) : [],
    aiSummary: null, summaryStatus: 'not_requested', qna: null, language: article.language || null,
    country: Array.isArray(article.country) ? article.country : [], apiCategory: Array.isArray(article.category) ? article.category : [],
    apiDuplicate: article.duplicate === true, sourceUrl: article.source_url || null
  };
}
function filterAndNormalizeWithStats(results, requested, options = {}) {
  const seenLinks = new Set(); const seenTitles = new Set(); const output = [];
  const stats = { received: Array.isArray(results) ? results.length : 0, accepted: 0, missingRequired: 0, nonKoreanTitle: 0, nonKoreanPublisher: 0, nonEconomic: 0, providerDuplicate: 0, localDuplicate: 0 };
  for (const raw of Array.isArray(results) ? results : []) {
    const category = assignCategory(raw, requested);
    if (!category || !CATEGORIES[category]) { stats.nonEconomic += 1; continue; }
    const article = normalizeArticle(raw, category);
    if (!article.title || !article.description || !article.url) { stats.missingRequired += 1; continue; }
    if (!isKoreanTitle(article.title)) { stats.nonKoreanTitle += 1; continue; }
    // Google News RSS's link is always a news.google.com redirect (never the
    // publisher's own domain), so the domain whitelist below cannot say
    // anything about who published it - options.skipPublisherCheck lets the
    // RSS call path skip this specific check instead of rejecting everything.
    // isKoreanTitle + isDirectEconomic below still apply, so filtering isn't
    // dropped entirely, just the one check that needs a real publisher domain.
    if (!options.skipPublisherCheck && !isKoreanPublisher(article)) { stats.nonKoreanPublisher += 1; continue; }
    if (!isDirectEconomic(article, category)) { stats.nonEconomic += 1; continue; }
    if (article.apiDuplicate) { stats.providerDuplicate += 1; continue; }
    const titleKey = normalizeText(article.title).replace(/[^0-9a-z가-힣]/g, '');
    if (seenLinks.has(article.url) || (titleKey && seenTitles.has(titleKey))) { stats.localDuplicate += 1; continue; }
    seenLinks.add(article.url); if (titleKey) seenTitles.add(titleKey);
    output.push(article); articleCache.set(article.id, article);
  }
  stats.accepted = output.length;
  return { articles: output, stats };
}
function filterAndNormalize(results, requested, options) { return filterAndNormalizeWithStats(results, requested, options).articles; }
function kstDateString(date) {
  // 'en-CA' formats as YYYY-MM-DD, so this is a plain string compare away
  // from answering "is this the same KST calendar day as today" - no manual
  // offset math, which is what makes UTC vs. KST day-boundary bugs (a
  // 23:xx UTC article actually being *tomorrow* in KST) easy to get wrong.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
// Splits the already-filtered/deduped articles into "published today in
// KST (Asia/Seoul)" vs. everything older, each sorted newest-first by
// actual publishedAt. Kept as two separate arrays (not concatenated here)
// specifically so softDiversifyBySource below can be applied to each group
// on its own and never reach across the boundary to pull an older article
// forward just to break up a same-source run in today's group - that would
// be "끌어오는" behavior the source-repetition fix is explicitly not
// allowed to do. Articles with no parseable publishedAt count as older,
// sorted last within that group.
function groupByRecency(articles) {
  const today = kstDateString(new Date());
  const withDate = articles.map((article) => {
    const parsed = parseDate(article.publishedAt);
    return { article, time: parsed ? parsed.getTime() : -Infinity, isToday: parsed ? kstDateString(parsed) === today : false };
  });
  const byTime = (a, b) => b.time - a.time;
  const todayGroup = withDate.filter((entry) => entry.isToday).sort(byTime).map((entry) => entry.article);
  const olderGroup = withDate.filter((entry) => !entry.isToday).sort(byTime).map((entry) => entry.article);
  return { todayGroup, olderGroup };
}
// Softens same-outlet runs WITHOUT touching overall recency order: walking
// the already newest-first list, whenever the next article's source is the
// same as the one just placed, this looks ahead (within this same recency-
// sorted group only) for the nearest upcoming article from a DIFFERENT
// source and pulls only that one forward - e.g. [A,A,A,B,B] -> [A,B,A,B,A].
// If every remaining article is the same source, it's placed in its normal
// recency position and repeats are allowed (never fabricates or reorders
// in a source's favor - it only ever reduces how it's already ordered).
// This is intentionally NOT diversifyBySource's old global round-robin
// (which reshuffled the entire list by source bucket, wrecking recency
// order) - it's a local, minimal adjustment on top of an already-correct
// recency sort.
function softDiversifyBySource(articles) {
  const pool = articles.slice();
  const result = [];
  let lastSource = null;
  while (pool.length) {
    let index = 0;
    if (lastSource !== null && pool[0].source === lastSource) {
      const altIndex = pool.findIndex((article) => article.source !== lastSource);
      if (altIndex !== -1) index = altIndex;
    }
    const [picked] = pool.splice(index, 1);
    result.push(picked);
    lastSource = picked.source;
  }
  return result;
}
function selectByRecency(articles) {
  const { todayGroup, olderGroup } = groupByRecency(articles);
  return softDiversifyBySource(todayGroup).concat(softDiversifyBySource(olderGroup));
}
function providerError(status) {
  const error = new Error(status === 401 || status === 403 ? 'Google 뉴스 인증에 실패했습니다.' : status === 429 ? 'Google 뉴스 호출 한도에 도달했습니다.' : status >= 500 ? 'Google 뉴스 서버 오류가 발생했습니다.' : `Google 뉴스 요청에 실패했습니다. (${status})`);
  error.statusCode = status || 502;
  return error;
}
// Ported from [API] EconomyBrief's scripts/fetch-news.js: Google News RSS
// items wrap their title/source/link/pubDate in plain XML tags, titles are
// suffixed with " - 언론사명" (stripped below), and text needs CDATA/entity
// decoding. This is the same parsing logic, just inlined into the live
// request path here instead of a batch script that writes a JSON file.
function decodeRssEntities(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
function stripRssMarkup(str) {
  return decodeRssEntities(String(str || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, '')).trim();
}
function extractRssTag(block, tag) {
  const match = block.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>'));
  return match ? match[1] : '';
}
function parseRssItems(xml) {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return blocks.map((block) => {
    const rawTitle = stripRssMarkup(extractRssTag(block, 'title'));
    const source = stripRssMarkup(extractRssTag(block, 'source'));
    const title = source && rawTitle.endsWith(' - ' + source) ? rawTitle.slice(0, -(' - ' + source).length) : rawTitle;
    const link = stripRssMarkup(extractRssTag(block, 'link'));
    const pubDate = stripRssMarkup(extractRssTag(block, 'pubDate'));
    // <source url="https://example.com">언론사명</source> - the url attribute
    // (the publisher's own homepage domain) was previously discarded here;
    // it now flows through as sourceUrl so normalizeArticle()'s existing
    // (previously always-null) sourceUrl field gets a real value with no
    // schema change.
    const sourceUrlMatch = block.match(/<source\s+url=["']([^"']*)["']/);
    const sourceUrl = sourceUrlMatch ? sourceUrlMatch[1] : '';
    return { title, source, link, pubDate, sourceUrl };
  });
}
// Adapts a parsed Google News RSS item into the same raw-field shape
// normalizeArticle() already expects from NewsData.io (article_id/title/
// description/link/source_name/source_icon/pubDate/image_url/keywords/...),
// so normalizeArticle() itself needs zero changes. image_url, source_icon,
// keywords and article_id are simply left unset (RSS has none of these) -
// normalizeArticle()'s existing `|| null` / `|| []` fallbacks already turn
// that into the correct "field genuinely unavailable" value with no
// fabricated data. description is not a real summary - Google News RSS
// doesn't provide one - so it's set to the same "{언론사} 보도" placeholder
// [API] EconomyBrief used, purely so the UI has non-empty body text.
function mapRssItemToProviderShape(item) {
  return {
    title: item.title,
    description: item.source ? `${item.source} 보도` : '',
    link: item.link,
    source_name: item.source,
    source_url: item.sourceUrl || null,
    pubDate: item.pubDate
  };
}
async function fetchGoogleNewsRss(query) {
  const params = new URLSearchParams({ q: query, hl: 'ko', gl: 'KR', ceid: 'KR:ko' });
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000);
  let response;
  try { response = await fetch(`${GOOGLE_NEWS_RSS_URL}?${params}`, { signal: controller.signal, headers: { Accept: 'application/rss+xml, application/xml, text/xml' } }); }
  catch (error) { if (error.name === 'AbortError') { error.statusCode = 504; error.message = 'Google 뉴스 RSS 응답 시간이 초과되었습니다.'; } throw error; }
  finally { clearTimeout(timer); }
  if (!response.ok) throw providerError(response.status || 502);
  const xml = await response.text();
  // NewsData.io's old two-page fetch topped out at ~20 raw articles per
  // category before filtering. A single Google News RSS query can return
  // 100+, so this caps it back to the same rough scale the rest of the
  // pipeline (and the page's card slots) was already sized for, rather than
  // shipping hundreds of unused articles to the browser on every load.
  return parseRssItems(xml).slice(0, 20).map(mapRssItemToProviderShape);
}
// options.expiresAt (a timestamp), when given, is used as this cache entry's
// exact expiry instead of the default rolling 30-minute CACHE_TTL_MS - this
// is how the KST scheduler below makes a scheduled refresh's data stay
// cached all the way until the *next* scheduled slot (~3h) instead of
// expiring after 30 minutes and getting silently re-fetched by whatever
// on-demand request happens to land after that. Calls with no options (every
// existing on-demand /api/news request) are completely unaffected: same
// 30-minute TTL as before.
function cacheTtlFor(options) {
  return options && options.expiresAt ? Math.max(options.expiresAt - Date.now(), 0) : CACHE_TTL_MS;
}
async function fetchNewsData(category, options = {}) {
  const cached = cache.get(category);
  if (cached && cached.expiresAt > Date.now() && !options.force) return cached.value;
  const results = await fetchGoogleNewsRss(CATEGORIES[category].query);
  // requested = category (not 'all'), so assignCategory() tags every article
  // with this exact category directly - no keyword-guessing involved.
  const filtered = filterAndNormalizeWithStats(results, category, { skipPublisherCheck: true });
  // Upgrades sourceLogo from null to each publisher's real favicon where
  // available (article-enrichment.js), fetched from the publisher's own
  // homepage (RSS's <source url> attribute) - NOT from article.url, which
  // is a Google News redirect that resolves server-side to Google's own
  // SPA shell rather than the publisher's article (verified directly; see
  // article-enrichment.js's file comment). image is deliberately left
  // untouched for the same reason - no reliable server-side way exists to
  // reach the real article page for a thumbnail, so it keeps its existing
  // RSS-only fallback (null -> category fallback image client-side).
  //
  // description/url ARE separately upgraded by naver-enrichment.js: NAVER
  // API HUB's News Search API is an optional secondary provider, used only
  // to find the same real-world article (conservative title/time-gap
  // matching, never a blind first-result pick) and borrow its genuine
  // description + real publisher originallink. Google News RSS is still the
  // sole discovery/supply source - NAVER never adds, removes, re-orders, or
  // re-categorizes a single article; on no match (or NAVER not configured/
  // erroring) description/url simply keep their existing Google-RSS-derived
  // fallback values, exactly as before this module existed.
  //
  // Both run here - only when actually building a fresh cache entry
  // (scheduled refresh or on-demand cache miss), never on every /api/news
  // request - so 60s browser polling and repeat on-demand requests within
  // the cache window never trigger new NAVER (or sourceLogo) API calls.
  try {
    const naverStats = await enrichWithNaver(filtered.articles);
    console.log(`[naver-enrichment] category=${category} rss=${results.length} target=${naverStats.total} matched=${naverStats.matched} matchedViaFallbackQuery=${naverStats.matchedViaFallbackQuery} unmatched=${naverStats.unmatched} apiErrors=${naverStats.apiErrors} retries=${naverStats.retries} cacheHits=${naverStats.cacheHits} errorsByType=${JSON.stringify(naverStats.errorsByType)}`);
  } catch (_) { /* best-effort - articles keep their existing description/url */ }
  try { await enrichArticles(filtered.articles); } catch (_) { /* best-effort - articles keep their RSS-only fallback values */ }
  const value = { category, fetchedAt: new Date().toISOString(), articles: selectByRecency(filtered.articles), returnedCount: results.length, filterStats: filtered.stats, source: 'Google News RSS' };
  cache.set(category, { expiresAt: Date.now() + cacheTtlFor(options), value });
  // Gemini runs in the BACKGROUND, started only AFTER this cache entry (and
  // therefore this and every /api/news response reading it) is already
  // available - deliberately NOT awaited, so a request/60s poll is never
  // blocked on an LLM call to get its news data. `filtered.articles` holds
  // the EXACT SAME article objects referenced by value.articles above
  // (selectByRecency/softDiversifyBySource/dedupeArticles only ever filter/
  // reorder an array, never clone its elements - true all the way up
  // through fetchAllNewsData's own merged "all" cache entry too), so when
  // this finishes later and sets article.aiSummary/summaryStatus, those
  // exact same cached objects are updated in place with no separate
  // cache-write step - the next request/poll simply sees the update.
  // Still runs only once per actual fresh RSS fetch (never on every
  // request/poll) via gemini-summary.js's own article-id-keyed cache.
  enrichWithGemini(filtered.articles).then((geminiStats) => {
    console.log(`[gemini-summary] category=${category} target=${geminiStats.total} generated=${geminiStats.generated} skipped=${geminiStats.skipped} invalid=${geminiStats.invalid} apiErrors=${geminiStats.apiErrors} retries=${geminiStats.retries} cacheHits=${geminiStats.cacheHits} errorsByType=${JSON.stringify(geminiStats.errorsByType)} invalidReasons=${JSON.stringify(geminiStats.invalidReasons)}`);
  }).catch(() => { /* best-effort - articles keep summaryStatus:'not_requested', client falls back to buildSummary() */ });
  return value;
}
function dedupeArticles(articles) {
  const seenLinks = new Set(); const seenTitles = new Set(); const output = [];
  for (const article of articles) {
    const titleKey = normalizeText(article.title).replace(/[^0-9a-z가-힣]/g, '');
    if (seenLinks.has(article.url) || (titleKey && seenTitles.has(titleKey))) continue;
    seenLinks.add(article.url); if (titleKey) seenTitles.add(titleKey);
    output.push(article);
  }
  return output;
}
// The 9 UI categories stay 9 categories (never collapsed to [API]
// EconomyBrief's 6) - each one is fetched as its own real Google News RSS
// query via fetchNewsData(name), which already tags every article with that
// exact category with no keyword-guessing. "all" is just those 9 per-
// category results merged and re-deduped, instead of one combined query
// whose articles would need guessing their category back from title text.
// Reusing fetchNewsData(name) also means each category's own 30-minute
// cache entry is shared with (and reused by) direct /api/news?category=X
// requests, so this never triggers more than 9 RSS requests per cache
// window regardless of how many pages hit "all".
async function fetchAllNewsData(options = {}) {
  const cached = cache.get('all');
  if (cached && cached.expiresAt > Date.now() && !options.force) return cached.value;
  const perCategory = await Promise.all(CATEGORY_NAMES.map(async (name) => {
    try { return (await fetchNewsData(name, options)).articles; }
    catch (_) { return []; /* best-effort: one category's RSS failing shouldn't fail "all" */ }
  }));
  const merged = dedupeArticles(perCategory.flat());
  const value = { category: 'all', fetchedAt: new Date().toISOString(), articles: selectByRecency(merged), returnedCount: merged.length, source: 'Google News RSS' };
  cache.set('all', { expiresAt: Date.now() + cacheTtlFor(options), value });
  return value;
}
async function getNews(category) {
  if (category && category !== 'all') return fetchNewsData(category);
  return fetchAllNewsData();
}

// --- KST 8x/day refresh scheduler -----------------------------------------
// Refreshes all 9 categories' Google News RSS data at fixed KST clock times
// instead of leaving refresh cadence purely up to whichever on-demand
// request happens to land after the 30-minute CACHE_TTL_MS expires. The
// 30-minute cache above is NOT removed - it's still the fallback for cold
// starts and for the (rare) case a scheduled tick is missed - but a
// scheduler-driven fetch's cache entry is given a TTL that stretches to the
// *next* scheduled slot (via cacheTtlFor's options.expiresAt), so ordinary
// /api/news traffic between two scheduled times keeps hitting that cache
// instead of triggering its own extra RSS calls.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const REFRESH_HOURS_KST = [0, 3, 6, 9, 12, 15, 18, 21];

// Pure function: given any "now" (a real Date, in UTC as Date always is),
// returns the next KST-aligned refresh instant among REFRESH_HOURS_KST as a
// Date (still just a UTC instant - Date has no timezone of its own). Kept
// pure and exported so it can be unit-tested with arbitrary Date inputs
// instead of depending on the system clock or timers.
function getNextKstRefreshTime(now) {
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  const kstMidnight = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()));
  for (const hour of REFRESH_HOURS_KST) {
    const candidateUtc = new Date(kstMidnight.getTime() + hour * 60 * 60 * 1000 - KST_OFFSET_MS);
    if (candidateUtc.getTime() > now.getTime()) return candidateUtc;
  }
  // Past 21:00 KST today (사용자가 말한 24:00 = 다음 날 00:00) - next slot is
  // 00:00 KST tomorrow.
  const tomorrowMidnightKst = new Date(kstMidnight.getTime() + 24 * 60 * 60 * 1000);
  return new Date(tomorrowMidnightKst.getTime() - KST_OFFSET_MS);
}

let refreshTimer = null;
// Timers only run for as long as this Node process is alive - a restart
// (deploy, crash, manual stop) clears this entirely and scheduleNextRefresh()
// starts over from whatever "now" is at the next startScheduler() call. There
// is no persistence of the schedule across restarts, and no catch-up logic
// for ticks that were missed while the process was down - the existing
// 30-minute on-demand cache (above) is what keeps /api/news answering
// correctly in that gap until the scheduler's next real tick.
function scheduleNextRefresh() {
  const now = new Date();
  const next = getNextKstRefreshTime(now);
  const delay = Math.max(next.getTime() - now.getTime(), 1000);
  refreshTimer = setTimeout(async () => {
    const expiresAt = getNextKstRefreshTime(new Date()).getTime();
    try { await fetchAllNewsData({ force: true, expiresAt }); }
    catch (_) { /* best-effort - an on-demand request or the next scheduled tick will retry */ }
    scheduleNextRefresh();
  }, delay);
  // Don't let this timer alone keep the process alive (e.g. during tests).
  if (refreshTimer && typeof refreshTimer.unref === 'function') refreshTimer.unref();
}
function startScheduler() {
  scheduleNextRefresh();
  // The in-memory cache is always empty on a fresh process start, regardless
  // of where "now" happens to fall inside the 3-hour cycle - this warms it
  // once here so the very first visitor doesn't pay for a cold RSS fetch,
  // without treating "time since the last scheduled slot" as a reason to
  // force a redundant fetch (that's exactly what options.force above is for,
  // and it's deliberately NOT passed here).
  if (!cache.get('all')) {
    fetchAllNewsData({ expiresAt: getNextKstRefreshTime(new Date()).getTime() }).catch(() => {});
  }
}
function sendJson(res, status, body) { const text = JSON.stringify(body); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(text); }
const BLOCKED_STATIC_NAMES = new Set(['.gitignore', 'server.js', 'article-enrichment.js', 'naver-enrichment.js', 'gemini-summary.js', 'package.json', 'package-lock.json']);
function isBlockedStatic(relative) {
  if (BLOCKED_STATIC_NAMES.has(relative)) return true;
  if (relative === '.env' || relative.startsWith('.env.')) return true;
  if (relative === '.git' || relative.startsWith('.git/')) return true;
  if (relative === 'tests' || relative.startsWith('tests/')) return true;
  if (relative === 'scripts' || relative.startsWith('scripts/')) return true;
  return false;
}
function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'main.html' : pathname.replace(/^\//, '');
  if (isBlockedStatic(relative)) return sendJson(res, 404, { error: '페이지를 찾을 수 없습니다.' });
  const file = path.resolve(ROOT, relative);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendJson(res, 404, { error: '페이지를 찾을 수 없습니다.' });
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
}
const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (parsed.pathname === '/api/health') return sendJson(res, 200, { ok: true, provider: 'Google News RSS', projectModified: true });
    if (parsed.pathname === '/api/news') {
      const category = parsed.searchParams.get('category') || 'all';
      if (category !== 'all' && !CATEGORIES[category]) return sendJson(res, 400, { error: '지원하지 않는 카테고리입니다.' });
      const data = await getNews(category); return sendJson(res, 200, data);
    }
    if (parsed.pathname === '/api/article') {
      const article = articleCache.get(parsed.searchParams.get('id'));
      if (!article) return sendJson(res, 404, { error: '기사 캐시가 만료되었거나 찾을 수 없습니다. 뉴스 목록에서 다시 선택해 주세요.' });
      return sendJson(res, 200, article);
    }
    return serveStatic(req, res, parsed.pathname);
  } catch (error) { sendJson(res, error.statusCode || 500, { error: error.message || '서버 오류가 발생했습니다.' }); }
});
if (require.main === module) {
  server.listen(PORT, () => console.log(`EconomyBrief server listening on http://localhost:${PORT}`));
  startScheduler();
}

module.exports = { CATEGORIES, ALLOWED_DOMAINS, isKoreanTitle, isKoreanPublisher, isDirectEconomic, normalizeArticle, filterAndNormalize, filterAndNormalizeWithStats, validHttpUrl, assignCategory, providerError, selectByRecency, groupByRecency, softDiversifyBySource, getNextKstRefreshTime, REFRESH_HOURS_KST, fetchNewsData };
