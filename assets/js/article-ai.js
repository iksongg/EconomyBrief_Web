/*
  Renders article.html for whichever article id is in the URL (?id=...),
  falling back to sessionStorage so a refresh keeps showing the same article.
  If no valid id resolves, the page shows the not-found state instead of any
  other article's content — there is no shared fallback article.
*/
(function () {
  var FLAGSHIP_ID = 'ai-data-investment';

  // The original hand-written example content, including the interactive HBM
  // glossary term. Kept verbatim only for this one article; every other
  // article uses the generic per-article template in news-data.js instead.
  var FLAGSHIP_SUMMARY_BULLETS_HTML = [
    '빅테크 기업들이 AI 데이터센터 투자를 하고 있습니다.',
    'AI 서버에 필요한 <button type="button" class="term" data-term="hbm">HBM</button> 수요가 증가하고 있습니다.',
    '반도체 기업들의 실적 개선 기대감도 높아지고 있습니다.',
    'AI 인프라 투자가 향후 수년간 지속될 가능성이 높다고 전망했습니다.'
  ];
  var FLAGSHIP_TERMS = {
    hbm: {
      title: 'HBM(고대역폭메모리)',
      desc: '여러 개의 D램을 수직으로 쌓아 데이터 처리 속도를 크게 높인 고성능 메모리로, AI 서버·GPU에 주로 쓰입니다.',
      category: '반도체'
    }
  };
  var FLAGSHIP_QNA = [
    { q: '무슨 일이 있었나요?', a: '빅테크 기업들이 AI 데이터센터 투자를 확대하며, AI 서버에 필요한 HBM 수요도 함께 늘고 있습니다.' },
    { q: '왜 중요한가요?', a: '국내 반도체 기업들의 실적 개선 기대감도 함께 높아지고 있어, 관련 산업 전반에 영향을 줄 수 있는 사안입니다.' },
    { q: '앞으로 어떻게 될까요?', a: 'AI 인프라 투자가 향후 수년간 지속될 가능성이 높다고 전망했습니다.' }
  ];

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Wraps the first occurrence of term.word inside text with the same
  // clickable .term button the flagship article's HBM term already uses.
  // Returns { html, embedded } — embedded is false (html is just the escaped
  // text) if the word isn't actually present in this particular string.
  function embedTermButton(text, term) {
    var idx = text.indexOf(term.word);
    if (idx === -1) return { html: escapeHtml(text), embedded: false };
    var before = escapeHtml(text.slice(0, idx));
    var word = escapeHtml(text.slice(idx, idx + term.word.length));
    var after = escapeHtml(text.slice(idx + term.word.length));
    return {
      html: before + '<button type="button" class="term" data-term="term">' + word + '</button>' + after,
      embedded: true
    };
  }

  function renderNotFound() {
    document.body.classList.add('article-missing');
  }

  // Real other articles (never invented content): "관련된 뉴스" pulls same-category
  // articles first, "관심 키워드로 추천된 뉴스" fills from whatever's left — the same
  // "exclude self, same category" pattern deep-research-ai.js's renderSourcesTab uses.
  function renderNewsList(containerId, articles) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    articles.forEach(function (a) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'news-item';
      btn.setAttribute('data-article-id', a.id);

      var info = document.createElement('div');
      info.className = 'news-info';
      var titleEl = document.createElement('div');
      titleEl.className = 'news-title';
      titleEl.textContent = a.title;
      var byline = document.createElement('div');
      byline.className = 'news-byline';
      byline.innerHTML = '<span></span><span>·</span><span></span>';
      byline.children[0].textContent = a.source;
      byline.children[2].textContent = window.EBNews.formatDate(a.date);
      info.appendChild(titleEl);
      info.appendChild(byline);

      var thumb = document.createElement('img');
      thumb.className = 'news-thumb';
      thumb.alt = '';
      thumb.loading = 'lazy';

      btn.appendChild(info);
      btn.appendChild(thumb);
      container.appendChild(btn);

      if (a.image) {
        thumb.src = a.image;
      } else {
        EB.media.showThumbPlaceholder(thumb, a.imagePlaceholder);
      }

      btn.addEventListener('click', function () {
        window.location.href = 'article.html?id=' + encodeURIComponent(a.id);
      });
    });
  }

  function renderRelatedNews(article, allArticles) {
    var others = (allArticles || []).filter(function (a) { return a.id !== article.id; });
    var related = others.filter(function (a) { return a.category === article.category; }).slice(0, 3);
    var relatedIds = related.map(function (a) { return a.id; });
    var recommend = others.filter(function (a) { return relatedIds.indexOf(a.id) === -1; }).slice(0, 3);
    renderNewsList('related-news-list', related);
    renderNewsList('recommend-news-list', recommend);

    // A handful of categories (e.g. 부동산, 주거) currently have no other
    // article sharing them, so `related` can come back empty. Rather than
    // padding it with unrelated-category articles just to hit 3, hide the
    // "관련된 뉴스 TOP3" section (and its divider) entirely when there is
    // nothing real to show — an empty list under a "TOP3" header otherwise
    // reads as broken. The keyword-recommended section below is unaffected.
    var relatedSection = document.getElementById('related-news-list').closest('.news-section');
    if (relatedSection) {
      relatedSection.style.display = related.length ? '' : 'none';
      var divider = relatedSection.nextElementSibling;
      if (divider && divider.classList.contains('section-divider-img')) {
        divider.style.display = related.length ? '' : 'none';
      }
    }
  }

  function renderArticle(article, allArticles) {
    document.title = '이코노미브리프 - ' + article.title;
    document.getElementById('article-title').textContent = article.title;
    document.getElementById('article-date').textContent = article.date;
    var heroImage = document.getElementById('article-hero-image');
    var heroPlaceholder = document.getElementById('article-hero-placeholder');
    if (article.image) {
      heroImage.src = article.image;
      heroImage.alt = article.title;
      heroImage.style.display = '';
      heroPlaceholder.style.display = 'none';
    } else {
      // No dedicated image asset yet for this article — show a neutral
      // placeholder instead of stretching an unrelated category icon.
      // imagePlaceholder (when set) names the file to drop into
      // assets/img/news/ later; article.image just needs to point at it.
      heroImage.style.display = 'none';
      // .hero-placeholder's CSS default is display:none (so it stays hidden
      // until JS decides it's needed) — clearing the inline style with ''
      // just falls back to that none, never actually showing the box. It
      // needs the explicit visible value (flex, matching its align/justify/
      // flex-direction rules) to actually appear.
      heroPlaceholder.style.display = 'flex';
      document.getElementById('article-hero-placeholder-filename').textContent = article.imagePlaceholder || '';
    }

    var sourceEl = document.getElementById('article-source');
    var logoPath = article.sourceLogo || (article.sourceLogoPlaceholder ? 'assets/img/' + article.sourceLogoPlaceholder : '');
    sourceEl.innerHTML = EB.media.renderPressLogo(article.source, logoPath);
    sourceEl.appendChild(document.createTextNode(article.source));

    var isFlagship = article.id === FLAGSHIP_ID;
    var bulletsHtml;
    var qnaHtml;
    var currentTerms = { hbm: FLAGSHIP_TERMS.hbm };
    var summaryTitleEl = document.getElementById('summary-title');
    if (summaryTitleEl) summaryTitleEl.textContent = 'AI 핵심 요약'; // fixed heading, same in every branch below (see the template-fallback branch's own comment)

    if (isFlagship) {
      bulletsHtml = FLAGSHIP_SUMMARY_BULLETS_HTML;
      qnaHtml = FLAGSHIP_QNA.map(function (item) { return { q: item.q, a: escapeHtml(item.a) }; });
    } else if (article.aiSummary && article.whatHappened && article.whyImportant && article.whatNext) {
      // Hand-authored per-article content from data/news.json — preferred path.
      var rawBullets = article.aiSummary;

      // Embed this article's one glossary term wherever its word first
      // appears in a bullet (falling back to the Q&A answers if it isn't in
      // any bullet), so exactly one clickable term shows up per article,
      // never HBM.
      var termEmbedded = false;
      bulletsHtml = rawBullets.map(function (text) {
        if (!termEmbedded && article.term) {
          var result = embedTermButton(text, article.term);
          if (result.embedded) { termEmbedded = true; return result.html; }
        }
        return escapeHtml(text);
      });

      var qnaPairs = [
        { q: '무슨 일이 있었나요?', text: article.whatHappened },
        { q: '왜 중요한가요?', text: article.whyImportant },
        { q: '앞으로 어떻게 될까요?', text: article.whatNext }
      ];
      qnaHtml = qnaPairs.map(function (pair) {
        if (!termEmbedded && article.term) {
          var result = embedTermButton(pair.text, article.term);
          if (result.embedded) { termEmbedded = true; return { q: pair.q, a: result.html }; }
        }
        return { q: pair.q, a: escapeHtml(pair.text) };
      });

      if (termEmbedded && article.term) {
        currentTerms.term = {
          title: article.term.word,
          desc: article.term.definition,
          category: article.category
        };
      }
    } else {
      // Every real live article lands here (Google RSS/NAVER never fill
      // whatHappened/whyImportant/whatNext). gemini-summary.js (server
      // side) may already have generated and validated real bullets AND/OR
      // real Q&A answers for this article - the two are generated and
      // validated completely independently there (same single Gemini call,
      // but evaluated separately, including a check that a Q&A answer never
      // just repeats a bullet - see qnaDuplicatesBullets() in
      // gemini-summary.js), so either one being present/absent has no
      // bearing on the other. Whichever piece Gemini didn't produce (or
      // failed validation for) falls back independently to
      // window.EBNews.buildSummary() - the same deterministic template as
      // before this feature existed, still a single shared function there
      // only because it's a pure function of the article's own description
      // with no Gemini involved at all, not because the two fields are
      // coupled to each other.
      var summary = window.EBNews.buildSummary(article);
      var geminiBullets = (article.summaryStatus === 'generated' && Array.isArray(article.aiSummary) && article.aiSummary.length) ? article.aiSummary : null;
      var geminiQna = (Array.isArray(article.qna) && article.qna.length) ? article.qna : null;
      bulletsHtml = (geminiBullets || summary.bullets).map(escapeHtml);
      qnaHtml = (geminiQna || summary.qna).map(function (item) { return { q: item.q, a: escapeHtml(item.a) }; });
      // Title stays "AI 핵심 요약" (the original UI's fixed heading) in every
      // case, matching the default already set above - a previous revision
      // relabeled this text to a shorter fallback string whenever the
      // template path (no Gemini) was used, but article.html always shows
      // a separate static "AI" badge (.icon-box) directly in front of this
      // element, so the two combined into a garbled heading rather than the
      // shorter label alone as intended. Whether the bullets below came
      // from Gemini or the template fallback is an internal detail the
      // heading doesn't need to expose.
    }

    var summaryList = document.getElementById('ai-summary-list');
    summaryList.innerHTML = '';
    bulletsHtml.forEach(function (html) {
      var li = document.createElement('li');
      li.innerHTML = html;
      summaryList.appendChild(li);
    });

    var qnaBlock = document.getElementById('qna-block');
    if (qnaBlock) {
      qnaBlock.innerHTML = '';
      qnaHtml.forEach(function (item) {
        var wrap = document.createElement('div');
        wrap.className = 'qna-item';
        var qEl = document.createElement('div');
        qEl.className = 'qna-q';
        qEl.innerHTML = '<span class="gicon" role="img" aria-label="">check_circle</span><span></span>';
        qEl.querySelector('span:last-child').textContent = item.q;
        var aEl = document.createElement('div');
        aEl.className = 'qna-a';
        aEl.innerHTML = item.a;
        wrap.appendChild(qEl);
        wrap.appendChild(aEl);
        qnaBlock.appendChild(wrap);
      });
    }

    var hashtagsEl = document.getElementById('article-hashtags');
    hashtagsEl.innerHTML = '';
    (article.keywords || []).forEach(function (kw) {
      var span = document.createElement('span');
      span.textContent = '#' + kw;
      hashtagsEl.appendChild(span);
    });

    document.getElementById('deep-research-btn').addEventListener('click', function () {
      var result = EB.appState.spendTokens(3);
      if (!result.spent) return;
      window.location.href = 'deep-research.html?id=' + encodeURIComponent(article.id);
    });

    renderRelatedNews(article, allArticles);
    wireTermTooltips(currentTerms);
  }

  function wireTermTooltips(terms) {
    var termOverlayBg = document.getElementById('term-overlay-bg');
    var termPopup = document.getElementById('term-popup');
    var termPopupTitle = document.getElementById('term-popup-title');
    var termPopupDesc = document.getElementById('term-popup-desc');
    var activeTermKey = null;

    function openTermPopup(key) {
      var term = terms[key];
      if (!term) return;
      activeTermKey = key;
      termPopupTitle.textContent = term.title;
      termPopupDesc.textContent = term.desc;
      document.querySelector('.ts-save').textContent = '용어저장';
      termOverlayBg.classList.add('visible');
      termPopup.classList.add('visible');
    }
    function closeTermPopup() {
      termOverlayBg.classList.remove('visible');
      termPopup.classList.remove('visible');
    }

    document.querySelectorAll('.term').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        openTermPopup(el.getAttribute('data-term'));
      });
    });
    termOverlayBg.addEventListener('click', closeTermPopup);
    document.querySelector('.ts-save').addEventListener('click', function () {
      var term = terms[activeTermKey];
      if (!term) { closeTermPopup(); return; }
      var result = EB.glossary.save({ term: term.title, definition: term.desc, category: term.category });
      var btn = document.querySelector('.ts-save');
      btn.textContent = result.added ? '저장완료 ✓' : '이미 저장됨';
      setTimeout(closeTermPopup, 700);
    });
  }

  // article.html?id=... is the normal entry point (clicked from a card
  // elsewhere), but the page can also be opened with no id at all — directly
  // by URL, a fresh tab with nothing in sessionStorage yet, etc. Rather than
  // dead-ending on the not-found state there, fall back to the flagship
  // article so the page always has something real to show. A truly unknown
  // id (stale/typo'd link) falls back the same way; only the flagship itself
  // failing to load still shows the not-found state, as a last resort.
  var currentId = window.EBNews.resolveCurrentId() || FLAGSHIP_ID;
  window.EBNews.loadArticles().then(function (allArticles) {
    function findById(id) {
      for (var i = 0; i < allArticles.length; i++) {
        if (String(allArticles[i].id) === String(id)) return allArticles[i];
      }
      return null;
    }
    var article = findById(currentId);
    if (article) { renderArticle(article, allArticles); return; }
    if (currentId === FLAGSHIP_ID) { renderNotFound(); return; }
    var fallback = findById(FLAGSHIP_ID);
    if (fallback) renderArticle(fallback, allArticles); else renderNotFound();
  }).catch(function () {
    renderNotFound();
  });
})();
