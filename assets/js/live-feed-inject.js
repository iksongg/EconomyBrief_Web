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
    setText(card.querySelector('.body'), article.description);
    setTags(card.querySelector('.tags'), article);
  }

  function fillNewsListItem(item, article) {
    item.setAttribute('data-article-id', article.id);
    setText(item.querySelector('.title'), article.title);
    setText(item.querySelector('.desc'), article.description);
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
    setText(card.querySelector('.tl-desc'), article.description);
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
  // (id/title/publishedAt/url) so a poll tick that returns the exact same
  // data can skip calling renderMain/renderNewsfeed entirely instead of
  // re-running setText/setAttribute on every card for no visible change.
  function fingerprint(articles) {
    return articles.map(function (a) {
      return a.id + '|' + a.title + '|' + a.publishedAt + '|' + a.url;
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
