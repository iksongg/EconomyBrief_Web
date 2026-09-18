// Integration-level test for assets/js/article-ai.js's "AI 핵심 요약" / Q&A
// wiring (the actual bug report this covers: the summary card was reported
// showing text that looked copy-pasted from the Q&A answers below it, and
// the summary heading sometimes read "AI 핵심 내용" instead of the fixed
// "AI 핵심 요약").
//
// tests/ai-summary.test.js already covers news-data.js's buildSummary()
// itself (the template-fallback bullet/qna generator) in isolation. This
// file instead exercises article-ai.js's renderArticle() - the code that
// DECIDES, for a given article, whether the summary card uses Gemini's
// bullets or buildSummary()'s template bullets, and renders the resulting
// title/bullets/qna into the DOM. That decision logic has no exported
// function to call directly (it's a plain browser IIFE that reads/writes
// `document` directly), so this runs it inside a minimal hand-rolled DOM
// (no jsdom - this project has zero npm dependencies by design, see
// gemini-summary.js's own module comment) built just large enough to cover
// every document/EB API article-ai.js touches during a normal render.
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const articleAiSource = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'article-ai.js'), 'utf8');

// ---------------------------------------------------------------------
// Minimal fake DOM - just enough surface area for article-ai.js's
// renderArticle()/wireTermTooltips() to run without touching a real
// browser. `.innerHTML = "...multiple spans..."` is never actually parsed
// (no HTML parser here) - article-ai.js's one dependency on reading a
// child back out of an innerHTML-built element is qEl.querySelector(
// 'span:last-child'), so querySelector() returns a cached per-selector
// stub element instead of `null`, and that stub is what the test reads
// the question label back off of.
// ---------------------------------------------------------------------
function makeFakeElement() {
  var classes = new Set();
  var el = {
    tagName: 'DIV',
    style: {},
    attributes: {},
    textContent: '',
    innerHTML: '',
    children: [],
    _listeners: {},
    _qs: {},
    classList: {
      add: function (c) { classes.add(c); },
      remove: function (c) { classes.delete(c); },
      contains: function (c) { return classes.has(c); },
      toggle: function (c, force) {
        var has = classes.has(c);
        var next = force === undefined ? !has : !!force;
        if (next) classes.add(c); else classes.delete(c);
      }
    },
    setAttribute: function (k, v) { this.attributes[k] = String(v); },
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
    appendChild: function (child) { this.children.push(child); return child; },
    insertAdjacentElement: function () {},
    closest: function () { return null; },
    querySelector: function (sel) {
      if (!this._qs[sel]) this._qs[sel] = makeFakeElement();
      return this._qs[sel];
    },
    querySelectorAll: function () { return []; },
    addEventListener: function (type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    },
    click: function () {
      (this._listeners.click || []).forEach(function (fn) { fn({}); });
    }
  };
  return el;
}

function makeFakeDocument() {
  var byId = {};
  return {
    title: '',
    body: makeFakeElement(),
    getElementById: function (id) {
      if (!byId[id]) byId[id] = makeFakeElement();
      return byId[id];
    },
    createElement: function () { return makeFakeElement(); },
    createTextNode: function (text) { return { nodeType: 3, textContent: text }; },
    querySelector: function () { return makeFakeElement(); },
    querySelectorAll: function () { return []; },
    _byId: byId // test-only escape hatch to inspect specific elements
  };
}

// article-ai.js's own `.then()` chain needs a couple of microtask turns to
// settle (loadArticles() -> findById -> renderArticle()) before the fake DOM
// reflects the render.
function settle() {
  return new Promise(function (resolve) { setImmediate(resolve); }).then(function () {
    return new Promise(function (resolve) { setImmediate(resolve); });
  });
}

(async function () {
  var GEMINI_BULLETS = [
    '미국의 8월 소비자물가지수(CPI) 발표가 연방준비제도의 9월 금리 결정에 중요한 변수로 떠올랐다.',
    'CPI가 예상보다 높게 나오면 금리 인상 가능성이 커질 수 있다는 관측이 나온다.'
  ];
  var TEMPLATE_BULLETS = ['시장에서는 8월 CPI가 예상 수준이거나 이를 웃돌 경우 9월 금리 인상 전망이 더욱 굳어질 가능성이 있다. 나오는 마지막 핵심 물가 지표라는 점에서 분수령이 될 전망이다.'];
  var QNA = [
    { q: '무슨 일이 있었나요?', a: '나오는 마지막 핵심 물가 지표라는 점에서 연방준비제도(Fed)의 금리 인상 여부를 가를 분수령이 될 전망이다.' },
    { q: '왜 중요한가요?', a: '시장에서는 8월 CPI가 예상 수준이거나 이를 웃돌 경우 9월 금리 인상 전망이 더욱 굳어질 가능성이 있다.' },
    { q: '앞으로 어떻게 될까요?', a: '반대로 물가 상승세가 둔화하면 금리 동결 기대가 높아질 수 있다.' }
  ];
  var buildSummaryResult = { bullets: TEMPLATE_BULLETS, qna: QNA };

  function bulletsText(fakeDocument) {
    return fakeDocument._byId['ai-summary-list'].children.map(function (li) { return li.innerHTML; });
  }
  function qnaAnswers(fakeDocument) {
    return fakeDocument._byId['qna-block'].children.map(function (wrap) {
      return wrap.children[1].innerHTML; // [qEl, aEl] - aEl.innerHTML is set directly
    });
  }
  function qnaQuestions(fakeDocument) {
    return fakeDocument._byId['qna-block'].children.map(function (wrap) {
      // qEl.querySelector('span:last-child').textContent = item.q - see
      // makeFakeElement()'s querySelector() comment above.
      return wrap.children[0].querySelector('span:last-child').textContent;
    });
  }

  async function run(article) {
    var fakeDocument = makeFakeDocument();
    var sandbox = {
      document: fakeDocument,
      console: console,
      window: {
        location: { href: '' },
        EBNews: {
          resolveCurrentId: function () { return article.id; },
          loadArticles: function () { return Promise.resolve([article]); },
          buildSummary: function () { return buildSummaryResult; },
          formatDate: function (d) { return d; }
        }
      },
      EB: {
        media: {
          renderPressLogo: function () { return ''; },
          showThumbPlaceholder: function () {},
          showLogoPlaceholder: function () {},
          apply: function () {}
        },
        glossary: { save: function () { return { added: true }; } },
        appState: { spendTokens: function () { return { spent: false }; } }
      }
    };
    vm.createContext(sandbox);
    vm.runInContext(articleAiSource, sandbox);
    await settle();
    return fakeDocument;
  }

  // ---- TEST 4: Gemini 성공 -------------------------------------------------
  // AI Summary는 Gemini summary를 사용해야 하고, Q&A는 그 결과를 복사하지
  // 않아야 한다.
  {
    var article = {
      id: 'test-cpi-live-1', title: 'CPI 발표 앞둔 시장', category: '금리', source: '연합뉴스',
      date: '2026.09.11', keywords: [], description: 'x'.repeat(30),
      summaryStatus: 'generated', aiSummary: GEMINI_BULLETS
    };
    var doc = await run(article);

    assert.deepStrictEqual(bulletsText(doc), GEMINI_BULLETS, 'Gemini가 성공하면 AI 핵심 요약은 Gemini bullets를 그대로 써야 한다');
    assert.strictEqual(doc._byId['summary-title'].textContent, 'AI 핵심 요약', 'Gemini 성공 시 제목은 "AI 핵심 요약"이어야 한다');

    var answers = qnaAnswers(doc);
    var questions = qnaQuestions(doc);
    assert.deepStrictEqual(questions, ['무슨 일이 있었나요?', '왜 중요한가요?', '앞으로 어떻게 될까요?'], 'Q&A는 정확히 이 3개 질문이어야 한다');
    assert.strictEqual(questions.indexOf('어디서 보도했나요?'), -1, '"어디서 보도했나요?"는 나타나면 안 된다');

    GEMINI_BULLETS.forEach(function (bullet) {
      assert.strictEqual(answers.indexOf(bullet), -1, 'Q&A 답변이 Gemini의 AI 요약 bullet을 그대로 복사하면 안 된다: "' + bullet + '"');
    });
    assert.notDeepStrictEqual(bulletsText(doc), answers, 'AI 핵심 요약과 Q&A 답변 배열이 통째로 동일하면 안 된다');
  }

  // ---- TEST 5: Gemini 실패/미요청 -------------------------------------------
  // AI Summary는 AI Summary 전용 fallback(buildSummary().bullets)을 써야
  // 하고, Q&A fallback과 동일한 배열/문장을 그대로 복사하면 안 된다.
  {
    var article2 = {
      id: 'test-cpi-live-2', title: 'CPI 발표 앞둔 시장 (fallback)', category: '금리', source: '연합뉴스',
      date: '2026.09.11', keywords: [], description: 'x'.repeat(30),
      summaryStatus: 'not_requested', aiSummary: null
    };
    var doc2 = await run(article2);

    assert.deepStrictEqual(bulletsText(doc2), TEMPLATE_BULLETS, 'Gemini가 실패/미요청이면 AI 요약 fallback(템플릿) bullets를 써야 한다');
    assert.strictEqual(doc2._byId['summary-title'].textContent, 'AI 핵심 요약', 'Gemini 실패 시에도 제목은 여전히 "AI 핵심 요약"이어야 한다 (기존 "핵심 내용" 라벨은 사용하지 않는다)');

    var answers2 = qnaAnswers(doc2);
    var questions2 = qnaQuestions(doc2);
    assert.deepStrictEqual(questions2, ['무슨 일이 있었나요?', '왜 중요한가요?', '앞으로 어떻게 될까요?']);
    assert.strictEqual(questions2.indexOf('어디서 보도했나요?'), -1);

    assert.notDeepStrictEqual(bulletsText(doc2), answers2, '템플릿 fallback에서도 AI 요약 bullets 배열이 Q&A 답변 배열과 통째로 동일하면 안 된다');
  }

  // ---- TEST 7: Gemini가 Q&A까지 독립적으로 생성한 경우 -----------------------
  // article-ai.js는 article.qna(Gemini가 서버에서 생성/검증한 실제 Q&A)가
  // 있으면 그것을 우선 사용해야 한다 - buildSummary()의 템플릿 qna로
  // 덮어써지면 안 된다.
  // gemini-summary.js now always produces exactly 3 pairs (RESPONSE_SCHEMA.qna
  // minItems===maxItems===3) - mirrored here for realism.
  var GEMINI_QNA = [
    { q: '무슨 일이 있었나요?', a: '연방준비제도가 9월 회의에서 기준금리를 현 수준으로 유지하기로 결정했다.' },
    { q: '왜 중요한가요?', a: '이번 결정은 시장이 예상했던 시나리오와 대체로 부합하는 것으로 평가된다.' },
    { q: '앞으로 어떻게 될까요?', a: '기사에서는 향후 방향을 구체적으로 제시하지 않았다.' }
  ];
  {
    var article4 = {
      id: 'test-cpi-live-3', title: 'CPI 발표 앞둔 시장 (gemini qna)', category: '금리', source: '연합뉴스',
      date: '2026.09.11', keywords: [], description: 'x'.repeat(30),
      summaryStatus: 'generated', aiSummary: GEMINI_BULLETS, qna: GEMINI_QNA
    };
    var doc4 = await run(article4);

    assert.deepStrictEqual(bulletsText(doc4), GEMINI_BULLETS, 'AI 핵심 요약은 여전히 Gemini bullets를 써야 한다');
    assert.deepStrictEqual(qnaQuestions(doc4), GEMINI_QNA.map(function (p) { return p.q; }), 'Q&A 질문은 Gemini가 생성한 article.qna의 질문 순서를 따라야 한다');
    assert.deepStrictEqual(qnaAnswers(doc4), GEMINI_QNA.map(function (p) { return p.a; }), 'Gemini가 생성한 article.qna가 있으면 그 답변을 그대로 써야 한다 (템플릿 qna로 덮어쓰면 안 된다)');
    var noneMatchTemplate = qnaAnswers(doc4).every(function (a) { return QNA.map(function (q) { return q.a; }).indexOf(a) === -1; });
    assert.ok(noneMatchTemplate, 'Gemini qna가 있을 때 템플릿 buildSummary().qna 답변이 섞여 나오면 안 된다');
  }

  // ---- TEST 7b: 독립성 (반대 방향) - AI Summary는 Gemini, Q&A는 템플릿 ------
  // Gemini가 bullets만 생성하고 article.qna는 없는 경우(서버 쪽에서 qna만
  // 검증 실패했거나 애초에 없었던 경우) - AI Summary는 그대로 Gemini 결과를
  // 쓰고, Q&A만 독립적으로 템플릿 fallback을 써야 한다 (한쪽의 부재가 다른
  // 쪽까지 fallback시키면 안 된다).
  {
    var article5 = {
      id: 'test-cpi-live-4', title: 'CPI 발표 앞둔 시장 (qna만 fallback)', category: '금리', source: '연합뉴스',
      date: '2026.09.11', keywords: [], description: 'x'.repeat(30),
      summaryStatus: 'generated', aiSummary: GEMINI_BULLETS, qna: null
    };
    var doc5 = await run(article5);

    assert.deepStrictEqual(bulletsText(doc5), GEMINI_BULLETS, 'article.qna가 없어도 AI Summary는 그대로 Gemini bullets를 써야 한다');
    assert.deepStrictEqual(qnaAnswers(doc5), QNA.map(function (q) { return q.a; }), 'article.qna가 없으면 Q&A만 독립적으로 템플릿 fallback을 써야 한다');
  }

  // ---- TEST 6: source-only fallback ("OOO에서 보도한 소식입니다.")가 그대로 --
  // AI 핵심 요약으로 노출돼도 article-ai.js가 이를 특별 취급하지 않고 그대로
  // 통과시키는지 확인한다 (이 문구 자체가 news-data.js의 buildSummary()에서
  // 왜/어떻게 나오는지는 tests/ai-summary.test.js가 이미 검증함 - 여기서는
  // article-ai.js가 그 값을 가로채 다른 문구로 바꾸거나 감추지 않는지만
  // 확인한다).
  {
    var sourceOnlyResult = { bullets: ['연합뉴스에서 보도한 소식입니다.'], qna: [] };
    var article3 = {
      id: 'test-source-only', title: '단신', category: '금리', source: '연합뉴스',
      date: '2026.09.11', keywords: [], description: '연합뉴스 보도',
      summaryStatus: 'not_requested', aiSummary: null
    };
    var savedBuildSummaryResult = buildSummaryResult;
    buildSummaryResult = sourceOnlyResult;
    var doc3 = await run(article3);
    buildSummaryResult = savedBuildSummaryResult;

    assert.deepStrictEqual(bulletsText(doc3), sourceOnlyResult.bullets, 'article-ai.js는 buildSummary()가 반환한 fallback bullet을 그대로 렌더링해야 한다 (가공하지 않는다)');
    assert.strictEqual(doc3._byId['summary-title'].textContent, 'AI 핵심 요약');
  }

  // ---- 구조적 회귀 가드: 소스 코드 자체에 금지된 문자열이 없어야 한다 -------
  assert.strictEqual(articleAiSource.indexOf('어디서 보도했나요'), -1, 'article-ai.js 소스에 "어디서 보도했나요?" 문자열이 있으면 안 된다');
  assert.strictEqual(articleAiSource.indexOf('핵심 내용'), -1, 'article-ai.js 소스에 "핵심 내용" 라벨이 남아있으면 안 된다 (제목은 항상 "AI 핵심 요약")');

  console.log('article-ai-summary.test.js: all assertions passed');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
