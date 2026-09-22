/*
  Fills main.html's and newsfeed.html's EXISTING static news cards with real
  NewsData.io articles from window.EBApiNews.getArticles() (assets/js/
  api-news-client.js). Only main.html/newsfeed.html need this file: their
  cards are hand-written static markup (no news-data-source.js/news-data.js
  on those two pages), unlike article.html/deep-research.html which already
  resolve an article dynamically by id (that path is adapted once, inside
  news-data.js's loadArticles(), not here).

  This never rewrites markup or adds/removes cards - it only sets text/
  image/href-equivalent attributes on the cards that are already in the
  page, so card size, image aspect ratio, and layout are exactly what the
  original EconomyBrief HTML/CSS already defines. If the API call resolves
  null (server down, no NEWSDATA_API_KEY yet, provider error, empty
  result), this does nothing at all and the page is left showing its
  original static mock content - the fallback is simply "don't touch it."

  Click-through already works without any change here: main.html/
  newsfeed.html's own inline scripts read each card's data-article-id /
  data-article attribute at click time and navigate to
  article.html?id=<that value>. Overwriting that attribute with a real
  article's id (below) is enough to repoint the existing click handler.
*/
(function () {
  'use strict';

  function setText(el, value) { if (el && value) el.textContent = value; }

  // Same "is this real content, or just a placeholder" check gemini-summary.js/
  // news-data.js/api-news-client.js already apply elsewhere (kept in sync
  // deliberately, duplicated here rather than depending on window.EBNews -
  // this file intentionally has no dependency on news-data.js since
  // main.html/newsfeed.html don't load it). Catches the exact synthetic
  // "{source} 보도" string server.js's mapRssItemToProviderShape() generates
  // before NAVER enrichment runs (and NAVER leaves in place for any article
  // it couldn't confidently match).
  function looksLikeRealDescription(article) {
    var desc = String((article && article.description) || '').trim();
    if (!desc) return false;
    if (article.source && desc === article.source + ' 보도') return false;
    if (desc.length < 20) return false;
    return true;
  }

  // Same noise-removal patterns as news-data.js's sanitizeDescriptionForSummary()
  // (bylines/timestamps/photo captions/screen-number tags NAVER's own
  // snippets carry) - duplicated here for the same cross-file reason
  // looksLikeRealDescription() above already is (this file intentionally
  // has no dependency on news-data.js).
  function cleanNewsNoise(text) {
    var t = String(text || '');
    t = t.replace(/\[출처\s*[:：][^\]]*\]/g, ' ');
    t = t.replace(/\(출처\s*[:：][^)]*\)/g, ' ');
    t = t.replace(/\[사진\s*=[^\]]*\]/g, ' ');
    t = t.replace(/\(사진\s*=[^)]*\)/g, ' ');
    t = t.replace(/[([]?화면번호\s*\d+[)\]]?/g, ' ');
    t = t.replace(/자료화면/g, ' ');
    t = t.replace(/\[(앵커|기자|리포트|출연|스튜디오)\]/g, ' ');
    t = t.replace(/[가-힣]{2,4}\s*(기자|특파원)\s*=\s*/g, ' ');
    t = t.replace(/(입력|수정|전송|송고)\s*(시간|일시)?\s*[:：]?\s*\d{4}[.\-]\s*\d{1,2}[.\-]\s*\d{1,2}\.?\s*(오전|오후)?\s*\d{1,2}[:시]\s*\d{1,2}분?/g, ' ');
    t = t.replace(/(오전|오후)?\s*\d{1,2}시\s*(\d{1,2}분)?\s*현재/g, ' ');
    t = t.replace(/현재\s*시각/g, ' ');
    return t.replace(/\s{2,}/g, ' ').trim();
  }

  // NAVER's search-snippet API caps length and appends "..."/"…" when it
  // cuts a sentence off mid-thought. Only a TRAILING marker (the very last
  // thing in the string) means that; a mid-text one is the original
  // article's own editorial pause within an otherwise complete sentence and
  // must never be treated the same way (dropping real content just because
  // an earlier "..." appears somewhere is exactly the "deleted large
  // amounts of real content" regression news-data.js's own history warns
  // about - see its stripTrailingTruncatedFragment() comment). Drops only
  // the incomplete tail back to the last genuine sentence ending (if any) -
  // never guesses or fabricates what came after.
  function stripTrailingTruncatedFragment(text) {
    var trimmed = String(text || '').trim();
    var match = trimmed.match(/^([\s\S]*?)(\.{3,}|…)\s*$/);
    if (!match) return trimmed;
    var before = match[1];
    var masked = before.replace(/\.{3,}|…/g, function (m) { return new Array(m.length + 1).join('x'); });
    var lastReal = masked.match(/^[\s\S]*[.!?](?=\s|$)/);
    return lastReal ? before.slice(0, lastReal[0].length).trim() : '';
  }

  // Returns the first genuinely complete sentence of a cleaned description,
  // or null when none exists - never a raw substring cut, never a fragment
  // that stops mid-thought, and never mistaking a decimal point ("0.25%p")
  // or an ellipsis run for real punctuation (both masked with same-length
  // placeholders first so the final slice comes from the untouched text).
  function firstCompleteSentence(text) {
    var cleaned = stripTrailingTruncatedFragment(text).replace(/\.{3,}|…/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!cleaned) return null;
    var masked = cleaned.replace(/(\d)\.(\d)/g, '$1x$2');
    var match = masked.match(/[^.!?]+[.!?](?=\s|$)/);
    if (match) return cleaned.slice(0, match[0].length).trim();
    // No genuine terminator survived masking. A description with NO
    // terminator-class character anywhere is simply a real sentence that
    // never ends in punctuation (common in short NAVER snippets) - use it
    // whole. Otherwise (only decimal points and/or a truncation marker)
    // there is no complete sentence to use.
    return /[.!?]/.test(cleaned) ? null : cleaned;
  }

  // Converts a small, curated set of the most common Korean news
  // sentence-final endings (plain "다" form) to their polite 합니다체
  // equivalent, e.g. "동결했다." -> "동결했습니다.". Deliberately NOT a
  // general Korean conjugation engine - handling every irregular stem
  // (ㄷ/ㅂ/ㅅ/르 irregulars etc.) correctly would risk producing a WRONG or
  // ungrammatical ending, which is its own kind of fabrication. Only ever
  // rewrites a matched SUFFIX; an ending outside this list is returned
  // completely unchanged - keeping a sentence in its original (still
  // perfectly valid, just less formal) tone is always safer than guessing.
  var POLITE_ENDING_MAP = [
    [/했다\.?$/, '했습니다.'],
    [/였다\.?$/, '였습니다.'],
    [/았다\.?$/, '았습니다.'],
    [/었다\.?$/, '었습니다.'],
    [/한다\.?$/, '합니다.'],
    [/된다\.?$/, '됩니다.'],
    [/이다\.?$/, '입니다.'],
    [/있다\.?$/, '있습니다.'],
    [/없다\.?$/, '없습니다.'],
    [/보인다\.?$/, '보입니다.'],
    [/전망이다\.?$/, '전망입니다.'],
    [/분석이다\.?$/, '분석입니다.']
  ];
  function toPoliteEnding(sentence) {
    var s = String(sentence || '').trim();
    for (var i = 0; i < POLITE_ENDING_MAP.length; i++) {
      if (POLITE_ENDING_MAP[i][0].test(s)) return s.replace(POLITE_ENDING_MAP[i][0], POLITE_ENDING_MAP[i][1]);
    }
    return s;
  }

  // Builds a short, complete-reading card description straight from the raw
  // NAVER/RSS description, when no Gemini summary is available yet: clean
  // known noise -> pull out the first real, properly-terminated sentence ->
  // best-effort polite-ending rewrite. Never a raw substring cut, never a
  // mid-sentence fragment, never "..."/"…" used to disguise one, and never
  // an invented fact or connector - if no genuine complete sentence can be
  // found in the available text at all, returns null so the caller shows
  // nothing rather than a fabricated placeholder line.
  function buildNaturalDescription(article) {
    if (!looksLikeRealDescription(article)) return null;
    var sentence = firstCompleteSentence(cleanNewsNoise(article.description));
    if (!sentence) return null;
    return toPoliteEnding(sentence);
  }

  // Only trusts a Gemini summary that actually finished validating
  // (summaryStatus === 'generated', non-empty aiSummary) - never the
  // article's title or an invented sentence. Falls back to a naturally
  // extracted real sentence from the raw description, then to '' (never a
  // placeholder phrase like "OO에서 보도한 소식입니다") so the caller clears
  // the field instead of ever showing fabricated or truncated-looking text.
  function resolveCardDescription(article) {
    if (article && article.summaryStatus === 'generated' && Array.isArray(article.aiSummary) && article.aiSummary[0]) {
      return article.aiSummary[0];
    }
    var natural = buildNaturalDescription(article);
    return natural || '';
  }

  // Unlike setText() above (which deliberately leaves an unfilled slot's
  // existing static mock text untouched), a description that resolves to
  // "no real content yet" must actively clear whatever text is already
  // there (mock, or a stale previous poll's placeholder) rather than ever
  // leave a fabricated/placeholder sentence showing. Only empties the text
  // node - the surrounding CSS/layout is completely unchanged.
  function setDescription(el, article) {
    if (!el) return;
    el.textContent = resolveCardDescription(article);
  }

  function shortDate(article) {
    var d = new Date(article.publishedAt || '');
    if (isNaN(d.getTime())) return article.date || '발행 시간 확인 필요';
    var elapsedMs = Date.now() - d.getTime();
    var hours = Math.floor(elapsedMs / 3600000);
    if (hours >= 0 && hours < 24) {
      var minutes = Math.floor(elapsedMs / 60000);
      if (minutes < 1) return '방금 전';
      if (minutes < 60) return minutes + '분 전';
      return hours + '시간 전';
    }
    return (d.getMonth() + 1) + '월 ' + (d.getDate()) + '일';
  }

  function setImage(imgEl, article) {
    if (!imgEl) return;
    imgEl.onerror = function () { imgEl.onerror = null; imgEl.src = 'assets/img/news/ai-data-investment.webp'; };
    imgEl.src = article.image;
  }

  function setPressLogo(container, article) {
    if (!container || !window.EB || !window.EB.media) return;
    var logoEl = container.querySelector('.eb-press-logo');
    if (!logoEl) return;
    var wrapper = document.createElement('div');
    wrapper.innerHTML = window.EB.media.renderPressLogo(article.source, article.sourceLogo || '');
    if (wrapper.firstElementChild) logoEl.replaceWith(wrapper.firstElementChild);
  }

  function setTags(container, article) {
    if (!container) return;
    var values = (article.keywords && article.keywords.length ? article.keywords.slice(0, 3) : [article.category]);
    var spans = container.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      if (values[i]) spans[i].textContent = '#' + String(values[i]).replace(/^#/, '');
    }
  }

  // Fills at most articles.length slots, one distinct article per slot, in
  // order, and never wraps back around to an article already used in THIS
  // call. Any slots beyond articles.length are left completely untouched
  // (original static mock content stays) instead of repeating an article -
  // this is what actually stops the same real headline from appearing
  // twice in the same list when NewsData.io's free tier + the server's
  // strict Korean/economic filters return fewer articles than there are
  // card slots on the page (common: ~3-4 filtered articles vs. 7 news-list
  // items or 10 ticker items). It also naturally satisfies the opposite
  // case (server returns more articles than slots): extra articles are
  // simply never used, no slot is created to fit them.
  function fillOnce(elements, articles, fillFn) {
    var n = Math.min(elements.length, articles.length);
    for (var i = 0; i < n; i++) fillFn(elements[i], articles[i]);
    return n;
  }

  function fillHighlightCard(card, article) {
    card.setAttribute('data-article-id', article.id);
    setText(card.querySelector('.headline'), article.title);
    setDescription(card.querySelector('.body'), article);
    setTags(card.querySelector('.tags'), article);
  }

  function fillNewsListItem(item, article) {
    item.setAttribute('data-article-id', article.id);
    setText(item.querySelector('.title'), article.title);
    setDescription(item.querySelector('.desc'), article);
    setText(item.querySelector('.byline span:last-child'), article.source + ' · ' + shortDate(article));
    setPressLogo(item.querySelector('.byline'), article);
    setImage(item.querySelector('.thumb'), article);
  }

  function fillTrendCard(card, article) {
    card.setAttribute('data-article-id', article.id);
    setText(card.querySelector('.headline'), article.title);
    setText(card.querySelector('.byline span:last-child'), article.source + ' · ' + shortDate(article));
    setPressLogo(card.querySelector('.byline'), article);
    setImage(card.querySelector('.image-wrap img.bg'), article);
    setTags(card.querySelector('.tags'), article);
  }

  function renderMain(articles) {
    var highlightRow = document.getElementById('news-highlight-row');
    if (highlightRow) {
      var realCards = Array.prototype.filter.call(
        highlightRow.querySelectorAll('.news-highlight'),
        function (el) { return !el.hasAttribute('data-loop-clone'); }
      );
      var filledCount = fillOnce(realCards, articles, fillHighlightCard);
      // The loop-clone card only exists to make the horizontal scroll wrap
      // seamlessly back to card #1 - mirror it only when card #1 itself
      // was actually replaced with real data, otherwise leave the clone's
      // original mock content matching the (untouched) real card #1.
      var clone = highlightRow.querySelector('[data-loop-clone]');
      if (clone && filledCount > 0) fillHighlightCard(clone, articles[0]);
    }

    var items = document.querySelectorAll('.news-list .item');
    fillOnce(items, articles, fillNewsListItem);

    var trendCards = document.querySelectorAll('.trend-card');
    fillOnce(trendCards, articles, fillTrendCard);
  }

  function fillTickerItem(item, article) {
    item.setAttribute('data-article-id', article.id);
    setText(item.querySelector('.tc-text'), article.title);
  }

  function fillTimelineCard(card, article) {
    card.setAttribute('data-article', article.id);
    card.setAttribute('data-category', article.category);
    setText(card.querySelector('.tl-time'), shortDate(article));
    setText(card.querySelector('.tl-title'), article.title);
    setDescription(card.querySelector('.tl-desc'), article);
    setTags(card.querySelector('.tl-tags'), article);
    setImage(card.querySelector('.tl-thumb'), article);
  }

  function renderNewsfeed(articles) {
    var tcItems = document.querySelectorAll('#tc-track .tc-item:not([aria-hidden])');
    var tcFilledCount = fillOnce(tcItems, articles, fillTickerItem);
    var tcClone = document.querySelector('#tc-track .tc-item[aria-hidden]');
    if (tcClone && tcFilledCount > 0) fillTickerItem(tcClone, articles[0]);

    var cards = document.querySelectorAll('.timeline-card');
    fillOnce(cards, articles, fillTimelineCard);

    // Card heights can change once real (often longer) titles/descriptions
    // replace the mock text above. newsfeed.html's own layoutTimelineLine()
    // (inline <script> in this file's HTML) already recomputes the dashed
    // line's position/height from each card's actual measured offsetTop on
    // window's 'resize' event - dispatching a synthetic resize is the
    // smallest way to reuse that existing, already-correct logic instead
    // of duplicating it here or editing newsfeed.html's inline script.
    window.dispatchEvent(new Event('resize'));
  }

  // Fingerprints the parts of an article list that actually change the DOM
  // (id/title/publishedAt/url/summaryStatus) so a poll tick that returns the
  // exact same data can skip calling renderMain/renderNewsfeed entirely
  // instead of re-running setText/setAttribute on every card for no visible
  // change. summaryStatus is included so that a background Gemini summary
  // finishing AFTER the initial load (server.js's enrichWithGemini runs
  // async, unrelated to id/title/publishedAt/url) is still treated as "new
  // data worth re-rendering" - otherwise a card stuck showing an empty
  // description (no real NAVER description, Gemini not done yet at the time
  // of the first poll) would never pick up the now-available summary on a
  // later 60s poll, since nothing else about the article would have changed.
  function fingerprint(articles) {
    return articles.map(function (a) {
      return a.id + '|' + a.title + '|' + a.publishedAt + '|' + a.url + '|' + a.summaryStatus;
    }).join(';');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var isMain = !!document.getElementById('news-highlight-row');
    var isFeed = !!document.querySelector('.timeline-list');
    if (!isMain && !isFeed) return;
    if (!window.EBApiNews) return;

    var lastFingerprint = null;
    function renderIfChanged(articles, isInitialLoad) {
      if (!articles || !articles.length) return; // API unavailable: leave existing mock cards untouched
      var fp = fingerprint(articles);
      if (!isInitialLoad && fp === lastFingerprint) return; // no new data since the last check
      lastFingerprint = fp;
      if (isMain) renderMain(articles);
      if (isFeed) renderNewsfeed(articles);
    }

    window.EBApiNews.getArticles().then(function (articles) { renderIfChanged(articles, true); });

    // Live polling is scoped to newsfeed.html's real-time timeline only (not
    // main.html) per the "뉴스피드 자동 갱신" requirement. Reuses the exact
    // same getArticles()/renderNewsfeed() path as the initial load above;
    // {forceRefresh:true} is api-news-client.js's opt-in to bypass its
    // normal one-fetch-per-pageload cache so each tick actually re-checks
    // /api/news (and therefore the server's cache/scheduled-refresh state)
    // instead of replaying the page's first response forever.
    if (isFeed) {
      var POLL_INTERVAL_MS = 60000;
      var pollTimer = null;
      function poll() {
        window.EBApiNews.getArticles({ forceRefresh: true }).then(function (articles) {
          renderIfChanged(articles, false);
        });
      }
      function startPolling() {
        if (pollTimer) return;
        pollTimer = setInterval(poll, POLL_INTERVAL_MS);
      }
      function stopPolling() {
        if (!pollTimer) return;
        clearInterval(pollTimer);
        pollTimer = null;
      }
      // Leaving the page (navigation/close) simply destroys this script's
      // execution context, which stops the interval with it - no extra
      // cleanup needed for that case. What this DOES need to handle is a
      // backgrounded-but-still-open tab: pause polling while hidden so it
      // doesn't keep hitting /api/news every 60s for nothing, and check once
      // immediately on return instead of waiting out a stale interval.
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) stopPolling();
        else { poll(); startPolling(); }
      });
      if (!document.hidden) startPolling();
    }
  });
})();
