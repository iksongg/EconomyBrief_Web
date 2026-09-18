/*
  Fills in publisher favicons (sourceLogo) that Google News RSS itself never
  provides, by reading each publisher's own homepage - <link rel="icon">/
  "shortcut icon"/"apple-touch-icon"> - for a real, verified icon URL.
  Nothing is guessed, generated, or hardcoded per-outlet: a homepage with no
  icon tag simply yields null (server.js/normalizeArticle's existing null
  handling is unchanged).

  IMPORTANT - why this module does NOT also fetch article image/description:
  Google News RSS's <link> is not a plain HTTP redirect to the publisher.
  Verified directly (curl -L on a real RSS <link>): following every redirect
  hop server-side still lands on a news.google.com URL whose HTML is Google
  News's own single-page-app shell (its actual navigation to the publisher
  happens client-side, via JS, inside that app - something a server-side
  fetch() can never execute or observe). An earlier version of this module
  fetched `article.url` (that same RSS <link>) expecting a real article page
  and got Google's own og:image/description/favicon back for every single
  article instead - identical across all 150+ articles, and actively
  misleading (it looked like real per-article data but wasn't the article at
  all). That approach was reverted rather than shipped.

  What IS reachable and genuinely real: RSS's <source url="..."> attribute
  is the publisher's own homepage (e.g. "https://zdnet.co.kr"), confirmed by
  direct request to return that publisher's actual homepage with its own
  distinct favicon tags. A logo is inherently a publisher-level (not
  article-level) asset, so using the homepage for exactly this one field is
  honest - unlike doing the same for image/description, which are
  inherently article-specific and would misrepresent a generic outlet image
  as if it were that article's own picture.

  Enrichment is cached by source homepage URL (not per-article URL) for the
  life of the process - there are only a couple dozen distinct publishers
  across all categories vs. 150+ articles, so this is both far cheaper than
  per-article fetching and correctly reused across every article from the
  same outlet, across RSS refreshes, and across the 60s browser polling in
  live-feed-inject.js (polling only ever re-asks server.js's own /api/news
  cache; this module is only invoked when server.js is actually building a
  fresh RSS-cache entry, never on every request).
*/

const ENRICHMENT_CONCURRENCY = 4;
const ENRICHMENT_TIMEOUT_MS = 4000;
const ENRICHMENT_BATCH_BUDGET_MS = 10000;
const ENRICHMENT_FAILURE_RETRY_MS = 60 * 60 * 1000; // retry a failed homepage after an hour, not every refresh
const MAX_ENRICHMENT_BYTES = 1.5 * 1024 * 1024; // don't download multi-MB homepages just to read <head> icon links
const MAX_REDIRECTS = 5;

const enrichmentCache = new Map(); // keyed by source homepage URL

// Basic, literal-value SSRF guard: blocks obvious localhost/private/loopback
// targets before this process makes an outbound request to them, and is
// re-checked on EVERY redirect hop below (not just the initial URL). This is
// deliberately simple - a literal-host/IP check, not a DNS-resolution or
// connect-time IP check - so a public hostname that only resolves to a
// private IP at connect time (DNS rebinding) is not caught; closing that
// fully would need a custom resolver/dispatcher, out of scope here.
function isSafeHttpUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch (_) { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host === '0.0.0.0' || host === '::1' || host === '[::1]') return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
  }
  return true;
}

function resolveUrl(maybeRelative, baseUrl) {
  try { return new URL(maybeRelative, baseUrl).toString(); } catch (_) { return null; }
}

function extractIconHref(html) {
  const rels = ['apple-touch-icon', 'shortcut icon', 'icon'];
  for (const rel of rels) {
    const escaped = rel.replace(/\s+/g, '\\s+');
    let m = html.match(new RegExp('<link\\s+[^>]*rel=["\']' + escaped + '["\'][^>]*href=["\']([^"\']*)["\']', 'i'));
    if (!m) m = html.match(new RegExp('<link\\s+[^>]*href=["\']([^"\']*)["\'][^>]*rel=["\']' + escaped + '["\']', 'i'));
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

// --- shared concurrency limiter --------------------------------------------
let activeSlots = 0;
const waiters = [];
function acquireSlot() {
  if (activeSlots < ENRICHMENT_CONCURRENCY) { activeSlots += 1; return Promise.resolve(); }
  return new Promise((resolve) => waiters.push(resolve));
}
function releaseSlot() {
  const next = waiters.shift();
  if (next) next(); else activeSlots -= 1;
}

// Follows redirects manually (redirect: 'manual') instead of letting fetch
// follow them automatically, specifically so isSafeHttpUrl can re-check
// EVERY hop, not just the initial URL. `deadline` is one shared timestamp
// across the whole hop chain so a fast multi-hop redirect chain can't add
// up to more than ENRICHMENT_TIMEOUT_MS in total.
async function fetchPage(url, deadline, redirectsLeft) {
  if (!isSafeHttpUrl(url) || redirectsLeft < 0) return null;
  const remaining = deadline - Date.now();
  if (remaining <= 0) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EconomyBriefBot/1.0)', Accept: 'text/html' }
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return null;
      const nextUrl = resolveUrl(location, url);
      if (!nextUrl) return null;
      return fetchPage(nextUrl, deadline, redirectsLeft - 1);
    }
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html/i.test(contentType)) return null;
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength && contentLength > MAX_ENRICHMENT_BYTES) return null;
    const html = await response.text();
    if (html.length > MAX_ENRICHMENT_BYTES) return null;
    return { html, finalUrl: url };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function getCached(sourceUrl) {
  const entry = enrichmentCache.get(sourceUrl);
  if (!entry) return undefined;
  if (entry.failed && Date.now() - entry.cachedAt > ENRICHMENT_FAILURE_RETRY_MS) return undefined; // allow a retry
  return entry.logo;
}

async function enrichSourceLogo(sourceUrl) {
  const cached = getCached(sourceUrl);
  if (cached !== undefined) return cached;
  await acquireSlot();
  try {
    const page = await fetchPage(sourceUrl, Date.now() + ENRICHMENT_TIMEOUT_MS, MAX_REDIRECTS);
    let logo = null;
    if (page) {
      const rawIcon = extractIconHref(page.html);
      const resolved = rawIcon ? resolveUrl(rawIcon, page.finalUrl) : null;
      logo = resolved && isSafeHttpUrl(resolved) ? resolved : null;
    }
    enrichmentCache.set(sourceUrl, { logo, failed: !page, cachedAt: Date.now() });
    return logo;
  } catch (_) {
    enrichmentCache.set(sourceUrl, { logo: null, failed: true, cachedAt: Date.now() });
    return null;
  } finally {
    releaseSlot();
  }
}

// Groups articles by their (usually shared) sourceUrl so each distinct
// publisher's homepage is fetched at most once per batch, then applies the
// resulting favicon to every article from that publisher. Mutates and
// returns `articles` in place. An article whose sourceLogo isn't found
// within budget simply keeps whatever it already had (null) - never
// treated as an error, and picked up again on a future refresh.
async function enrichArticles(articles) {
  const bySource = new Map();
  for (const article of articles) {
    if (!article || !article.sourceUrl || article.sourceLogo) continue;
    if (!bySource.has(article.sourceUrl)) bySource.set(article.sourceUrl, []);
    bySource.get(article.sourceUrl).push(article);
  }
  const sourceUrls = Array.from(bySource.keys());
  const batchStart = Date.now();
  let cursor = 0;
  async function worker() {
    while (cursor < sourceUrls.length) {
      if (Date.now() - batchStart > ENRICHMENT_BATCH_BUDGET_MS) return;
      const sourceUrl = sourceUrls[cursor++];
      const logo = await enrichSourceLogo(sourceUrl);
      if (logo) {
        for (const article of bySource.get(sourceUrl)) article.sourceLogo = logo;
      }
    }
  }
  const workerCount = Math.min(ENRICHMENT_CONCURRENCY, sourceUrls.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return articles;
}

module.exports = {
  enrichArticles,
  isSafeHttpUrl,
  resolveUrl,
  extractIconHref
};
