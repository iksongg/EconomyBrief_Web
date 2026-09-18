/*
  Shared article data + template-based "AI" text generation.

  Article source (EconomyBrief_API_Final only — this one function is the
  single adaptation point added on top of the original EconomyBrief file):
  loadArticles() first asks window.EBApiNews.getArticles() (assets/js/
  api-news-client.js) for real NewsData.io articles via this project's own
  /api/news proxy. If that resolves a non-empty array, those are used. If it
  resolves null (server down, no NEWSDATA_API_KEY yet, provider error, empty
  result) or api-news-client.js isn't loaded on this page, this falls back
  to window.EB_NEWS_SOURCE exactly as before — the original mock data from
  news-data-source.js, untouched. Every other function below (getById,
  buildSummary, buildDeepAnalysis, ...) and every caller (article-ai.js,
  deep-research-ai.js) is unchanged and doesn't know or care which source
  the articles came from.

  No network calls happen here for the mock path: every mock string is
  derived only from the fields already present in data/news.json for the
  given article (title, description, category, keywords). Nothing is
  invented per article, so this is safe to reuse without fabricating facts.

  The mock article list itself is loaded from window.EB_NEWS_SOURCE, set by
  assets/js/news-data-source.js (a plain <script> — must be loaded before
  this file). That file is the exact same JSON as data/news.json, just
  assigned to a JS variable instead of served as a bare .json resource:
  a fetch('data/news.json') call fails under file:// (no server, so no
  CORS-allowed response) — the previous cause of every article page
  showing "기사를 찾을 수 없습니다" for anyone opening these HTML files
  directly instead of through a local server. A <script src> tag has no
  such restriction, so this loads identically over file:// and http(s)://.
*/
(function () {
  var STORAGE_KEY = 'eb-current-article-id';
  var articlesPromise = null;

  function mockArticles() {
    var source = window.EB_NEWS_SOURCE;
    return source && source.articles ? source.articles : [];
  }

  function loadArticles() {
    if (!articlesPromise) {
      articlesPromise = (window.EBApiNews ? window.EBApiNews.getArticles() : Promise.resolve(null))
        .then(function (apiArticles) {
          return apiArticles && apiArticles.length ? apiArticles : mockArticles();
        })
        .catch(function () { return mockArticles(); });
    }
    return articlesPromise;
  }

  function getById(id) {
    if (!id) return Promise.resolve(null);
    return loadArticles().then(function (articles) {
      var found = null;
      for (var i = 0; i < articles.length; i++) {
        // String() on both sides so a numeric id in the URL (?id=3) still
        // matches a string id in the data (or vice versa).
        if (String(articles[i].id) === String(id)) { found = articles[i]; break; }
      }
      return found;
    });
  }

  // URL query param is the source of truth; sessionStorage is only a refresh-safe
  // backup (deep-research.html can restore the same article after a reload).
  function resolveCurrentId() {
    var fromQuery = new URLSearchParams(window.location.search).get('id');
    if (fromQuery) {
      try { sessionStorage.setItem(STORAGE_KEY, fromQuery); } catch (e) {}
      return fromQuery;
    }
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function rememberId(id) {
    try { sessionStorage.setItem(STORAGE_KEY, id); } catch (e) {}
  }

  // News cards across the app should only ever show "오늘" or "M월 D일" —
  // never a relative time ("5시간 전") or a bare timestamp ("오늘 08:32").
  // This only changes how a raw data/news.json date string is displayed;
  // the stored date values themselves are never touched.
  function formatDate(raw) {
    if (!raw) return raw;
    if (raw.indexOf('오늘') === 0) return '오늘';
    // "N시간 전" is always still today, so this isn't a fabricated date —
    // just today's already-known label without the trailing time.
    if (/^\d+시간 전$/.test(raw)) return '오늘';
    var ymd = raw.match(/^\d{4}\.(\d{1,2})\.(\d{1,2})$/);
    if (ymd) return Number(ymd[1]) + '월 ' + Number(ymd[2]) + '일';
    if (/^\d{1,2}월 \d{1,2}일$/.test(raw)) return raw;
    // Unrecognized format: no safe way to compute "오늘"/"M월 D일" without
    // guessing, so leave it unchanged rather than inventing a date.
    return raw;
  }

  // buildSummary() is a plain template function, NOT an LLM/AI call - there
  // is no OpenAI/Gemini/Anthropic (or any other) API integration anywhere
  // in this project. Every word below comes only from fields this project's
  // own /api/news response already contains for the given article
  // (title/description/category/source) - nothing is inferred, guessed, or
  // invented, because Google RSS + NAVER description is all the real text
  // this project ever has (no full article body is fetched - see
  // article-enrichment.js's own comment on why: Google's RSS <link> only
  // resolves to Google's own SPA shell server-side, never the publisher).
  //
  // Same "is this actually real article content, or just a placeholder"
  // check gemini-summary.js's looksLikeRealDescription() applies server
  // side before ever calling Gemini (identical criteria, deliberately kept
  // in sync: the exact synthetic "{source} 보도" string server.js generates
  // when NAVER has no match, or anything shorter than a real sentence could
  // plausibly be) - this file can't import that server module directly (this
  // runs in the browser, that runs in Node), so the same logic is
  // duplicated here rather than left unchecked. Without this, a fake
  // placeholder like "머니투데이 보도" was being split into a fake "sentence"
  // and shown as if it were the article's actual content (real production
  // bug: bullet "무슨 일: 머니투데이 보도" + qna "무슨 일이 있었나요? →
  // 머니투데이 보도", both meaningless).
  function looksLikeRealDescription(article) {
    var desc = String((article && article.description) || '').trim();
    if (!desc) return false;
    if (article.source && desc === article.source + ' 보도') return false;
    if (desc.length < 20) return false;
    return true;
  }

  // Mirrors gemini-summary.js's sanitizeDescriptionForSummary()/
  // stripEllipsisMarkers() EXACTLY (same patterns, same behavior) -
  // duplicated here for the same cross-runtime reason looksLikeRealDescription()
  // above is duplicated (this file runs in the browser, that one is a Node/
  // CommonJS server module, with no shared import path between them).
  function sanitizeDescriptionForSummary(description) {
    var text = String(description || '');

    text = text.replace(/\[출처\s*[:：][^\]]*\]/g, ' ');
    text = text.replace(/\(출처\s*[:：][^)]*\)/g, ' ');
    text = text.replace(/\[사진\s*=[^\]]*\]/g, ' ');
    text = text.replace(/\(사진\s*=[^)]*\)/g, ' ');
    text = text.replace(/[([]?화면번호\s*\d+[)\]]?/g, ' ');
    text = text.replace(/자료화면/g, ' ');
    text = text.replace(/\[(앵커|기자|리포트|출연|스튜디오)\]/g, ' ');
    text = text.replace(/[가-힣]{2,4}\s*(기자|특파원)\s*=\s*/g, ' ');
    text = text.replace(/(입력|수정|전송|송고)\s*(시간|일시)?\s*[:：]?\s*\d{4}[.\-]\s*\d{1,2}[.\-]\s*\d{1,2}\.?\s*(오전|오후)?\s*\d{1,2}[:시]\s*\d{1,2}분?/g, ' ');
    text = text.replace(/(오전|오후)?\s*\d{1,2}시\s*(\d{1,2}분)?\s*현재/g, ' ');
    text = text.replace(/현재\s*시각/g, ' ');
    text = stripEllipsisMarkers(text);

    return text.replace(/\s{2,}/g, ' ').trim();
  }

  // Removes only the literal "..."/"…" GLYPH itself - never any surrounding
  // real text, before or after it. An earlier version of this function
  // dropped everything from the first ellipsis onward (and even judged
  // whether the remaining fragment "looked like a complete sentence"),
  // which in practice deleted large amounts of real article content (a
  // regression reported and reverted). NAVER search-snippet ellipses are
  // just an "omission" marker, not a boundary past which content is
  // untrustworthy - so the fix is to strip only the marker and let the
  // rest of the pipeline (splitSentences() already accepts a trailing
  // fragment with no closing punctuation, isSameAsTitle(), etc.) work on
  // the fully-preserved text exactly as it already does for any other
  // description with no trailing period.
  function stripEllipsisMarkers(text) {
    return text.replace(/\.{3,}|…/g, ' ');
  }

  // Splits `text` into sentences using only real sentence-ending
  // punctuation (".", "!", "?") - never a comma, since a comma never ends a
  // sentence and cutting there would produce a bullet that is NOT "one full
  // sentence".
  function splitSentences(text) {
    var trimmed = String(text || '').trim();
    if (!trimmed) return [];
    var matches = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [trimmed];
    return matches.map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // Defensive guard against the summary ever just echoing the headline back
  // (whitespace-insensitive exact match only - this project doesn't have
  // the semantic tooling to detect near-duplicates without fabricating a
  // judgment it can't actually back up).
  function isSameAsTitle(sentence, title) {
    // Strips trailing sentence punctuation before comparing - a sentence
    // pulled from description almost always ends in ".", while article
    // titles normally don't, so comparing raw strings would miss the exact
    // case this guard exists for.
    var a = String(sentence || '').replace(/[.!?]+$/, '').replace(/\s+/g, '');
    var b = String(title || '').replace(/[.!?]+$/, '').replace(/\s+/g, '');
    return !!a && a === b;
  }

  function buildSummary(article) {
    // The "{source} 보도" placeholder (or anything too short to be real
    // content) is never split into fake sentences at all - looksLikeRealDescription()
    // gates this exactly like gemini-summary.js gates its own Gemini call,
    // so a NAVER-unmatched article ends up with an EMPTY sentences list here
    // rather than treating the placeholder string itself as "content".
    // Real sentences only otherwise, never the title repeated back, max 3 -
    // a short real description still yields fewer than 3 without ever being
    // padded out with generic filler.
    var sentences = looksLikeRealDescription(article)
      ? splitSentences(sanitizeDescriptionForSummary(article.description)).filter(function (s) { return !isSameAsTitle(s, article.title); })
      : [];

    // The "AI 핵심 요약" card and the Q&A block below are meant to be two
    // DIFFERENT kinds of content - a condensed recap vs. a per-question
    // breakdown - not the same array shown twice. A real production bug:
    // this used to push sentences[i] into `bullets` one-per-slot, in the
    // exact same order qna (below) maps sentences[i] to its questions, so
    // the summary card and the Q&A answers ended up showing textually
    // identical lines side by side. There is no real LLM synthesis
    // available in this template-only fallback (that's Gemini's job, when
    // it succeeds - see gemini-summary.js), so the only honest way to make
    // the summary genuinely different from a 1:1 mirror of qna, without
    // inventing anything, is to merge every real sentence into ONE
    // combined recap bullet instead of parallel per-sentence bullets.
    var bullets = sentences.length ? [sentences.join(' ')] : [];
    // No real sentence survived (no real description at all, or its only
    // sentence happened to equal the title) - rather than leaving the
    // "핵심 내용" card completely empty, state the one fact this project can
    // say with certainty (which real outlet reported it) as plain text, with
    // no role label (it isn't "무슨 일" - it's an honest admission that the
    // real "무슨 일" isn't available yet).
    if (!bullets.length && article.source) {
      bullets.push(article.source + '에서 보도한 소식입니다.');
    }

    // qna mirrors the same real sentences into the original 3-question
    // layout (무슨 일이 있었나요? / 왜 중요한가요? / 앞으로 어떻게
    // 될까요?) - one real description sentence per question, in order.
    // A question is only included when a real sentence exists for it -
    // never padded out with an invented or generic answer when the
    // description doesn't have enough sentences.
    var qna = [];
    if (sentences[0]) qna.push({ q: '무슨 일이 있었나요?', a: sentences[0] });
    if (sentences[1]) qna.push({ q: '왜 중요한가요?', a: sentences[1] });
    if (sentences[2]) qna.push({ q: '앞으로 어떻게 될까요?', a: sentences[2] });

    return { bullets: bullets, qna: qna };
  }

  function buildDeepAnalysis(article) {
    var category = article.category;
    var keywords = article.keywords || [];

    return {
      conclusion: article.title + '. 이는 ‘' + category + '’ 관련 동향으로 평가됩니다.',
      whatHappened: article.description,
      whyItMatters: '‘' + category + '’ 분야에서 나온 소식으로, 관련 산업과 시장 참여자들에게 영향을 줄 수 있는 사안으로 평가됩니다.',
      economicImpact: '‘' + category + '’ 관련 이슈이므로 관련 산업 전반에 영향을 줄 수 있다고 분석됩니다. 다만 구체적인 영향 규모는 후속 발표되는 자료를 통해 추가로 확인할 필요가 있습니다.',
      outlook: '관련 동향이 어떻게 전개될지는 향후 발표되는 추가 소식과 지표를 통해 확인할 필요가 있습니다.',
      risks: '예상과 다른 방향으로 전개될 가능성도 있으므로, 후속 지표와 발표를 지속적으로 확인하는 것이 중요합니다.',
      keywords: keywords.length ? keywords : [category]
    };
  }

  window.EBNews = {
    loadArticles: loadArticles,
    getById: getById,
    resolveCurrentId: resolveCurrentId,
    rememberId: rememberId,
    buildSummary: buildSummary,
    buildDeepAnalysis: buildDeepAnalysis,
    formatDate: formatDate,
    sanitizeDescriptionForSummary: sanitizeDescriptionForSummary
  };
})();
