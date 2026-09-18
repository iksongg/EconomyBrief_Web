/*
  Enriches Google News RSS articles' description/url using NAVER API HUB's
  News Search API - NAVER is an OPTIONAL enrichment provider here, never the
  primary news source. Google News RSS remains the sole discovery/supply
  pipeline (server.js); this module only ever upgrades two already-existing
  fields (description, url) on articles Google RSS already returned, and
  only when a real, conservatively-verified same-article match is found.

  Why this exists: Google News RSS's own <description> is just the title
  re-wrapped in HTML (verified in earlier work, no real summary), and its
  <link> is a Google redirect that never resolves to the real article
  server-side (also verified earlier - following it lands on Google's own
  SPA shell, not the publisher's page). NAVER's News Search API legitimately
  returns a real per-article snippet (its own `description` field) and the
  real publisher URL (`originallink`) for stories it has indexed - this was
  measured directly (see conversation history) at an 85% match rate with a
  100% description/originallink secure rate among matches, 0% observed
  false-positive matches, before this was wired in here.

  Auth: NAVER API HUB (NAVER Cloud Platform), NOT the classic NAVER
  Developers Center. Different endpoint, different header names:
    https://naverapihub.apigw.ntruss.com/search/v1/news
    X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY
  If NAVER_CLIENT_ID/NAVER_CLIENT_SECRET are unset, every call is skipped
  entirely (articles keep their existing Google-RSS-only fallback values) -
  never a hard error, since NAVER is optional.

  Matching is deliberately conservative: a wrong description attached to the
  wrong article is worse than no description at all. Title similarity is the
  primary gate; publish-time proximity is an independent second gate (a
  large time gap rejects a match even if title words happen to overlap);
  source/domain agreement is used only to raise or lower the similarity bar
  required, never as a hard requirement on its own - Google RSS often labels
  an aggregator (v.daum.net) or wire-service reprint as "source", so
  domain disagreement is common even for genuinely correct matches (observed
  directly: several confirmed-correct matches had non-matching domains).
*/

const NAVER_SEARCH_URL = 'https://naverapihub.apigw.ntruss.com/search/v1/news';
// Lowered from 4 to 3 after a real production run showed a 22/171 (~13%)
// API error rate when 9 categories each dispatched their own worker pool
// concurrently: every acquireSlot() call goes through the SAME module-level
// semaphore below regardless of which category's enrichWithNaver() call is
// running it, so true concurrent NAVER requests were already capped at the
// configured value process-wide (never "9 x 4 = 36") - the errors were a
// request-RATE burst (many quick sub-100ms calls back to back), not a
// concurrency-limit bug. 3 plus the retry logic below (which is the more
// direct fix for transient throttling) is the mitigation here.
const NAVER_CONCURRENCY = 3;
const NAVER_TIMEOUT_MS = 4000;
const NAVER_BATCH_BUDGET_MS = 10000;
const NAVER_FAILURE_RETRY_MS = 60 * 60 * 1000; // retry an API-error/timeout after an hour, not every refresh
const RETRY_DELAYS_MS = [500, 1500]; // 1st retry ~500ms later, 2nd ~1.5s after that - max 2 retries, never unbounded
const TITLE_SIM_THRESHOLD_WITH_SOURCE_MATCH = 0.5;
const TITLE_SIM_THRESHOLD_NO_SOURCE_MATCH = 0.6;
const MAX_HOURS_DIFF = 72; // publish-time gap beyond this rejects a match outright, regardless of title score

const enrichmentCache = new Map(); // keyed by the article's own url (Google RSS link)

function decodeHtmlEntities(str) {
  return String(str)
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
// Required cleanup only (HTML tags, entities, whitespace) - never rewrites,
// truncates, or removes any part of NAVER's own sentence content.
function cleanDescription(raw) {
  if (!raw) return null;
  const cleaned = decodeHtmlEntities(String(raw)).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return cleaned || null;
}
function normalizeTitleForMatch(t) {
  return decodeHtmlEntities(String(t || ''))
    .replace(/<[^>]*>/g, '')
    .toLowerCase()
    .replace(/[\[\]()【】\-–—:·,.!?"'“”‘’…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// Token-overlap (Jaccard-like) similarity - the same measure used in the
// manual measurement this module's thresholds were calibrated against.
function titleSimilarity(a, b) {
  const ta = new Set(normalizeTitleForMatch(a).split(' ').filter((w) => w.length > 1));
  const tb = new Set(normalizeTitleForMatch(b).split(' ').filter((w) => w.length > 1));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  const union = new Set([...ta, ...tb]).size;
  return inter / union;
}
// Some outlets append their own name after the headline ("... - 머니투데이"),
// wrap it in bracket tags ("[투데이's 금 시세]", "(종합)"), or use an ellipsis
// before a trailing subhead - none of that is part of the actual story
// text, but NAVER's search treats the whole title string as one combined
// query, so this extra noise very often returns ZERO candidates even when
// NAVER genuinely has the same story indexed under a cleaner headline.
// Verified directly against 5 real currently-unmatched production articles:
// 2/5 recovered a same-story, high-confidence match this way (one at
// score 0.9, same domain, same hour) once queried with this cleaned title,
// while evaluateCandidates()'s EXISTING thresholds (unchanged by this
// function) still correctly rejected a borderline cross-outlet paraphrase
// in a 3rd case - this only gives the search a fair chance, it never
// changes what counts as an acceptable match.
function buildFallbackQuery(title) {
  return String(title || '')
    .replace(/\s*-\s*[^-]+$/, '')
    .replace(/\.{2,}|…/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/["'"''""]/g, '')
    .replace(/By\s+\S+$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidHttpUrl(value) { return /^https?:\/\/[^\s]+$/i.test(String(value || '')); }
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return null; }
}
function hoursBetween(dateA, dateB) {
  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  if (isNaN(a) || isNaN(b)) return null;
  return Math.abs(a - b) / 3600000;
}

// Picks the best NAVER candidate for `article` (by title similarity) and
// decides whether it clears the conservative match bar. Pure - no network,
// no mutation - so it's directly unit-testable with synthetic candidate
// lists exactly shaped like NAVER's real API response items.
function evaluateCandidates(article, candidates) {
  let best = null;
  let bestScore = -1;
  for (const item of candidates || []) {
    const score = titleSimilarity(article.title, item.title);
    if (score > bestScore) { bestScore = score; best = item; }
  }
  if (!best) return { matched: false, reason: 'no-candidates' };

  const rssHost = hostOf(article.sourceUrl);
  const naverHost = hostOf(best.originallink);
  const sourceMatch = !!(rssHost && naverHost && (rssHost === naverHost || rssHost.endsWith('.' + naverHost) || naverHost.endsWith('.' + rssHost)));
  const hoursDiff = hoursBetween(article.publishedAt, best.pubDate);

  if (hoursDiff !== null && hoursDiff > MAX_HOURS_DIFF) {
    return { matched: false, reason: 'time-gap-too-large', score: bestScore, hoursDiff, sourceMatch };
  }
  const threshold = sourceMatch ? TITLE_SIM_THRESHOLD_WITH_SOURCE_MATCH : TITLE_SIM_THRESHOLD_NO_SOURCE_MATCH;
  if (bestScore < threshold) {
    return { matched: false, reason: 'low-similarity', score: bestScore, hoursDiff, sourceMatch };
  }

  const cleanedDescription = cleanDescription(best.description);
  const validOriginalLink = isValidHttpUrl(best.originallink) ? best.originallink : null;
  return {
    matched: true,
    score: bestScore,
    hoursDiff,
    sourceMatch,
    description: cleanedDescription,
    url: validOriginalLink
  };
}

// --- shared concurrency limiter -------------------------------------------
// Module-level (not per-call, not per-category) - every enrichWithNaver()
// call from every category goes through this SAME state, so real concurrent
// NAVER requests are capped at NAVER_CONCURRENCY process-wide no matter how
// many categories are refreshing at once.
let activeSlots = 0;
let peakActiveSlots = 0;
const waiters = [];
function acquireSlot() {
  if (activeSlots < NAVER_CONCURRENCY) {
    activeSlots += 1;
    if (activeSlots > peakActiveSlots) peakActiveSlots = activeSlots;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}
function releaseSlot() {
  const next = waiters.shift();
  if (next) next(); else activeSlots -= 1;
}
// Exposed for tests/reporting only - the real observed peak concurrent
// NAVER requests since process start (or since resetPeakConcurrency()).
function getPeakConcurrency() { return peakActiveSlots; }
function resetPeakConcurrency() { peakActiveSlots = activeSlots; }

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Single attempt, no retry - classifies the failure so the caller can decide
// whether it's worth retrying (429/5xx/timeout/network) or not (4xx/config).
async function searchNaverOnce(query) {
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return { ok: false, errorType: 'no-credentials' };
  const url = NAVER_SEARCH_URL + '?' + new URLSearchParams({ query, display: 10, sort: 'sim' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NAVER_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret }
    });
    if (res.status === 429) return { ok: false, status: 429, errorType: '429' };
    if (res.status >= 500) return { ok: false, status: res.status, errorType: '5xx' };
    if (!res.ok) return { ok: false, status: res.status, errorType: '4xx' }; // e.g. 401 auth misconfig - not retryable
    const body = await res.json();
    return { ok: true, items: Array.isArray(body.items) ? body.items : [] };
  } catch (e) {
    return { ok: false, errorType: e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

// Retries ONLY transient failures (429 / 5xx / timeout / network), up to
// RETRY_DELAYS_MS.length times (2), with short backoff between attempts.
// A clear config/auth error (4xx, missing credentials) returns immediately -
// repeating an invalid request can't ever succeed.
async function searchNaverWithRetry(query, stats) {
  let result = await searchNaverOnce(query);
  for (let attempt = 0; !result.ok && attempt < RETRY_DELAYS_MS.length; attempt++) {
    const retryable = result.errorType === '429' || result.errorType === '5xx' || result.errorType === 'timeout' || result.errorType === 'network';
    if (!retryable) break;
    if (stats) stats.retries += 1;
    await sleep(RETRY_DELAYS_MS[attempt]);
    result = await searchNaverOnce(query);
  }
  return result;
}

function getCached(url) {
  const entry = enrichmentCache.get(url);
  if (!entry) return undefined;
  if (entry.apiFailed && Date.now() - entry.cachedAt > NAVER_FAILURE_RETRY_MS) return undefined; // allow a retry
  return entry.result; // { description, url } on match, null on confirmed no-match
}

async function enrichOne(article, stats) {
  const cached = getCached(article.url);
  if (cached !== undefined) {
    stats.cacheHits += 1;
    return cached;
  }
  await acquireSlot();
  try {
    const search = await searchNaverWithRetry(article.title, stats);
    if (!search.ok) {
      stats.apiErrors += 1;
      stats.errorsByType[search.errorType] = (stats.errorsByType[search.errorType] || 0) + 1;
      // Transient (429/5xx/timeout/network) -> worth retrying after the 1h
      // cooldown on a future refresh. A clear config error (4xx/missing
      // credentials) is settled for this process - caching it as a
      // non-retryable "no result" avoids ever calling again for nothing.
      const transient = search.errorType === '429' || search.errorType === '5xx' || search.errorType === 'timeout' || search.errorType === 'network';
      enrichmentCache.set(article.url, { result: null, apiFailed: transient, cachedAt: Date.now() });
      return null;
    }
    let decision = evaluateCandidates(article, search.items);
    let viaFallbackQuery = false;
    // Only retried when the first search came back with LITERALLY NOTHING
    // to evaluate (no-candidates) - never because a real candidate existed
    // but scored too low or was too far apart in time; that's
    // evaluateCandidates() correctly doing its job, not a query problem,
    // and re-querying there would only risk a false-positive on a second
    // roll of the dice. Also skipped when cleaning the title changes
    // nothing (no point repeating an identical search).
    if (!decision.matched && decision.reason === 'no-candidates') {
      const fallbackQuery = buildFallbackQuery(article.title);
      if (fallbackQuery && fallbackQuery !== article.title) {
        const fallbackSearch = await searchNaverWithRetry(fallbackQuery, stats);
        if (fallbackSearch.ok) {
          const fallbackDecision = evaluateCandidates(article, fallbackSearch.items);
          if (fallbackDecision.matched) { decision = fallbackDecision; viaFallbackQuery = true; }
        } else {
          // A transient failure on this second, best-effort attempt doesn't
          // change the (already-settled) outcome of the first search -
          // just tracked for observability.
          stats.errorsByType[fallbackSearch.errorType] = (stats.errorsByType[fallbackSearch.errorType] || 0) + 1;
        }
      }
    }
    const result = decision.matched ? { description: decision.description, url: decision.url } : null;
    if (decision.matched) {
      stats.matched += 1;
      if (viaFallbackQuery) stats.matchedViaFallbackQuery += 1;
    } else {
      stats.unmatched += 1;
    }
    enrichmentCache.set(article.url, { result, apiFailed: false, cachedAt: Date.now() });
    return result;
  } finally {
    releaseSlot();
  }
}

// Mutates and returns `articles` in place: on a confirmed match, upgrades
// description (cleaned NAVER snippet) and url (real originallink, only if a
// valid http/https URL) - anything not matched, not found, or API-failed
// keeps its existing Google-RSS-derived description/url exactly as-is.
// Returns summary counts for logging (no article content, no credentials).
async function enrichWithNaver(articles) {
  const stats = { total: articles.length, matched: 0, matchedViaFallbackQuery: 0, unmatched: 0, apiErrors: 0, cacheHits: 0, retries: 0, errorsByType: {} };
  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
    return stats; // optional provider, not configured - silently skip
  }
  const batchStart = Date.now();
  let cursor = 0;
  async function worker() {
    while (cursor < articles.length) {
      if (Date.now() - batchStart > NAVER_BATCH_BUDGET_MS) return;
      const article = articles[cursor++];
      if (!article || !article.title || !article.url) continue;
      const result = await enrichOne(article, stats);
      if (result) {
        if (result.description) article.description = result.description;
        if (result.url) article.url = result.url;
      }
    }
  }
  const workerCount = Math.min(NAVER_CONCURRENCY, articles.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return stats;
}

module.exports = {
  enrichWithNaver,
  evaluateCandidates,
  titleSimilarity,
  normalizeTitleForMatch,
  buildFallbackQuery,
  cleanDescription,
  isValidHttpUrl,
  hostOf,
  hoursBetween,
  getPeakConcurrency,
  resetPeakConcurrency
};
