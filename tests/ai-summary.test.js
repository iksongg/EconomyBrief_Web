// Function-level test for assets/js/news-data.js's buildSummary() - the
// template function that feeds article.html's "AI 핵심 요약"/"핵심 내용"
// card (#ai-summary-list) via article-ai.js's fallback path (used for every
// real live article, since api-news-client.js deliberately leaves
// aiSummary/whatHappened/whyImportant/whatNext unset). buildSummary()'s
// `qna` field also feeds the separate Q&A block (#qna-block) below the
// card - a fixed-question restatement of the same article, distinct from
// the free-form summary bullets above it (see the structural check near
// the end of this file).
// Run headlessly via Node's built-in vm module (no browser, no jsdom) -
// same pattern as the project's other tests. buildSummary() is a pure
// function of its `article` argument (no DOM/network access), so a bare
// `{ window: {} }` sandbox is enough to load news-data.js and call it.
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'news-data.js'), 'utf8');

function loadEBNews() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.EBNews;
}

(function () {
  const EBNews = loadEBNews();

  // A. The raw description string must never be echoed back 3 (or more)
  // times verbatim across bullets+qna - the exact bug reported ("description
  // 을 반복하고 카테고리 일반론 문장을 붙이는 형태").
  const oneSentence = {
    title: '한은, 기준금리 동결',
    description: '한국은행이 기준금리를 3.00%로 동결했다.',
    category: '금리',
    source: '연합뉴스',
    keywords: []
  };
  const r1 = EBNews.buildSummary(oneSentence);
  const allTexts1 = r1.bullets.concat(r1.qna.map((q) => q.a));
  const exactDescCount1 = allTexts1.filter((t) => t === oneSentence.description).length;
  assert.ok(exactDescCount1 < 3, 'description이 3번 이상 그대로 반복되면 안 된다 (실제: ' + exactDescCount1 + '번)');

  // B. A sentence that is (whitespace/punctuation-normalized) identical to
  // the title must never be used as summary content - the summary must add
  // something beyond restating the headline.
  const titleEchoed = {
    title: '삼성전자 3나노 파운드리 확대',
    description: '삼성전자 3나노 파운드리 확대. 이는 시장 점유율 확보 전략의 일환이다.',
    category: '반도체',
    source: 'ZDNet',
    keywords: []
  };
  const r2 = EBNews.buildSummary(titleEchoed);
  r2.bullets.forEach((b) => assert.notStrictEqual(b, titleEchoed.title, 'bullet이 title을 그대로 복사하면 안 된다'));
  assert.ok(r2.bullets.every((b) => b.indexOf('시장 점유율') !== -1 || b.indexOf('전략') !== -1) === false || r2.bullets.length <= 1,
    'title과 동일한 문장은 요약에서 제외되어야 한다');
  assert.strictEqual(r2.bullets.length, 1, 'description의 첫 문장이 title과 같으면 그 문장은 제외되고 남은 문장(1개)만 bullet이 되어야 한다');
  assert.ok(r2.bullets[0].indexOf('시장 점유율') !== -1, '남은 실제 문장만 bullet에 사용되어야 한다');

  // C. No generic/boilerplate filler sentences (the exact old strings) may
  // appear anywhere in the output.
  const banned = [
    '분야의 이슈로 분류됩니다',
    '관련 업계와 시장 참여자들의 반응에 관심이 모이고 있습니다',
    '관련 산업과 시장 참여자들에게 영향을 줄 수 있는 사안으로 평가됩니다',
    '향후 발표되는 추가 소식을 통해 확인할 필요가 있습니다'
  ];
  [oneSentence, titleEchoed].forEach((article) => {
    const r = EBNews.buildSummary(article);
    const combined = r.bullets.join(' ') + ' ' + r.qna.map((q) => q.q + ' ' + q.a).join(' ');
    banned.forEach((phrase) => {
      assert.strictEqual(combined.indexOf(phrase), -1, '금지된 generic 문구가 남아있으면 안 된다: ' + phrase);
    });
  });

  // D. Nothing beyond title/description/category/source may appear in the
  // output - no invented numbers/company names/events/forecasts. Verified
  // by requiring every bullet to be a literal substring of the article's
  // own description.
  r1.bullets.forEach((text) => {
    assert.ok(oneSentence.description.indexOf(text) !== -1, 'bullet 본문은 반드시 실제 description에서 그대로 가져온 부분 문자열이어야 한다 (없는 사실 추가 금지)');
  });

  // E. AI 핵심 요약과 Q&A는 서로 다른 콘텐츠다 - Q&A는 문장별로 최대 3개의
  // 질문/답변 쌍을 보여주지만, 요약 카드는 (LLM 없이는 새 문장을 지어낼 수
  // 없으므로) 실제로 존재하는 모든 문장을 하나의 통합된 bullet으로 합쳐
  // 보여준다. 이전에는 bullets가 qna와 똑같이 sentences[0..2]를 1:1로
  // 나눠 담아, 요약 카드와 Q&A 답변이 화면에 그대로 복붙된 것처럼 보이는
  // 실제 버그가 있었다.
  const longDesc = {
    title: '테스트 기사',
    description: '첫 번째 사실이다. 두 번째 사실이다. 세 번째 사실이다. 네 번째 사실이다. 다섯 번째 사실이다.',
    category: '주식',
    source: '한국경제',
    keywords: []
  };
  const r3 = EBNews.buildSummary(longDesc);
  assert.strictEqual(r3.bullets.length, 1, '템플릿 fallback은 실제 문장들을 하나의 통합 bullet으로 합쳐야 한다 (qna처럼 문장별로 쪼개지 않는다)');
  assert.strictEqual(r3.bullets[0], longDesc.description, '통합 bullet은 실제 문장을 모두 포함해야 하고, 없는 내용을 추가하면 안 된다');

  // F. bullet은 plain text여야 하고, "무슨 일:"/"왜 중요:"/"핵심 포인트:"
  // 같은 역할 라벨을 앞에 붙이면 안 된다.
  [r1, r2, r3].forEach((r) => {
    r.bullets.forEach((b) => {
      assert.strictEqual(/^(무슨\s*일|왜\s*중요|핵심\s*포인트)\s*[:：]/.test(b), false, 'bullet에 역할 라벨이 남아있으면 안 된다: "' + b + '"');
    });
  });

  // F2 (실제 버그 재현 방지): 실제 문장이 2개 이상일 때(qna가 2개 이상
  // 질문을 채울 만큼 정보가 있을 때), 요약 bullet 배열이 qna의 답변
  // 배열과 1:1로 똑같이 나열되면 안 된다 - 예전 버그는 bullets ===
  // qna.map(item => item.a) (첫 min(3, N)개 문장을 그대로 병렬 나열) 형태
  // 였다. (문장이 딱 1개뿐이면 요약과 Q&A 둘 다 그 하나의 사실만 보여줄
  // 수밖에 없으므로 - 없는 내용을 지어낼 수 없다 - 이 경우는 검사 대상이
  // 아니다.)
  [r1, r2, r3].forEach((r) => {
    if (r.qna.length < 2) return;
    const qnaAnswers = r.qna.map((item) => item.a);
    assert.notDeepStrictEqual(Array.from(r.bullets), Array.from(qnaAnswers), 'AI 핵심 요약 bullet 배열이 Q&A 답변 배열을 그대로 복사(1:1 나열)하면 안 된다');
  });

  // G. A short (1-sentence) description must not be padded out to 3
  // bullets with invented filler - already covered by r1 above (1 bullet
  // for a 1-sentence description), reasserted explicitly here.
  assert.strictEqual(r1.bullets.length, 1, 'description이 짧으면(1문장) 억지로 3개 bullet을 채우면 안 된다');

  // qna-block: the fabricated "관련 산업과 시장 참여자들에게 영향을 줄 수
  // 있는 사안으로 평가됩니다" style boilerplate answer must never appear
  // (covered by the banned-phrase loop above too). "앞으로 어떻게 될까요?"
  // itself is the correct, original 3rd question label - it is only ever
  // paired with a real 3rd description sentence (never an invented forecast).
  [r1, r2, r3].forEach((r) => {
    r.qna.forEach((item) => {
      assert.ok(['무슨 일이 있었나요?', '왜 중요한가요?', '앞으로 어떻게 될까요?'].indexOf(item.q) !== -1, '알 수 없는 qna 질문 라벨: ' + item.q);
    });
  });

  // qna never invents content either - every qna answer must be a literal
  // substring of the article's own description (no fabricated fallback text).
  [oneSentence, longDesc].forEach((article) => {
    const r = EBNews.buildSummary(article);
    r.qna.forEach((item) => {
      assert.ok(article.description.indexOf(item.a) !== -1, 'qna 답변은 실제 description의 일부여야 한다: ' + item.a);
    });
  });

  // ---------------------------------------------------------------------
  // Regression test (실제 프로덕션 버그): NAVER가 매칭하지 못한 기사는
  // description이 server.js가 생성한 합성 placeholder "{source} 보도"
  // 그대로 남는다. 이전 buildSummary()는 이 문자열을 구두점 없는 "한 문장"
  // 으로 취급해 "무슨 일: 머니투데이 보도" 같은 의미 없는 bullet/QnA를
  // 그대로 노출했다 - looksLikeRealDescription()으로 이 값을 완전히
  // "content 없음"으로 취급하도록 고쳤다(gemini-summary.js의 동일 함수와
  // 판별 기준을 일치시킴).
  // ---------------------------------------------------------------------
  const placeholderArticle = {
    title: '코스피 발목 잡은 유가·금리 상승…FOMC 이후 달라질까?',
    description: '머니투데이 보도',
    category: '주식',
    source: '머니투데이',
    keywords: []
  };
  const rPlaceholder = EBNews.buildSummary(placeholderArticle);
  rPlaceholder.bullets.forEach((b) => {
    assert.strictEqual(b.indexOf('머니투데이 보도'), -1, 'placeholder description("{source} 보도")이 bullet에 그대로 노출되면 안 된다: "' + b + '"');
    assert.strictEqual(b.indexOf('무슨 일:'), -1, '실제 내용이 없을 때 "무슨 일:" 라벨을 붙이면 안 된다 (근거 없는 내용을 "무슨 일"이라고 주장하는 셈)');
  });
  assert.ok(rPlaceholder.bullets.length >= 1, 'placeholder인 경우에도 카드가 완전히 비어있으면 안 되고, 확실한 사실(출처)만 담은 bullet이 있어야 한다');
  assert.strictEqual(rPlaceholder.bullets[0], '머니투데이에서 보도한 소식입니다.');
  // 실제 sentences가 하나도 없으므로(placeholder), qna는 억지로 채우지
  // 않고 완전히 빈 배열이어야 한다 - 무슨 일이 있었나요?의 답으로
  // placeholder 원문을 노출하는 것도, 근거 없는 내용을 지어내 채우는 것도
  // 둘 다 금지된다.
  assert.strictEqual(rPlaceholder.qna.length, 0, 'placeholder에는 실제 문장이 없으므로 qna를 지어내지 말고 비워야 한다');

  // 같은 판별 기준이 "{source} 보도" 정확한 문자열이 아니어도 (너무 짧은
  // description) 동일하게 적용되는지 확인 - 정확히 한 문자열만 막는 방식이
  // 아니라 looksLikeRealDescription()의 일반 기준을 재사용했는지 검증.
  const tooShortArticle = {
    title: '짧은 제목 기사',
    description: '속보',
    category: '경제',
    source: '연합뉴스',
    keywords: []
  };
  const rShort = EBNews.buildSummary(tooShortArticle);
  rShort.bullets.forEach((b) => assert.strictEqual(b.indexOf('속보'), -1, '너무 짧은 description도 content로 취급되면 안 된다'));
  assert.strictEqual(rShort.bullets[0], '연합뉴스에서 보도한 소식입니다.');

  // 다른 언론사명으로도 동일 패턴("{source} 보도")이 일반적으로 걸러지는지
  // 확인 - 문자열 하나만 하드코딩해서 막은 게 아님을 보장.
  ['한국경제', '연합뉴스', 'Reuters'].forEach((src) => {
    const r = EBNews.buildSummary({ title: 'T', description: src + ' 보도', category: 'C', source: src, keywords: [] });
    r.bullets.forEach((b) => assert.strictEqual(b.indexOf(src + ' 보도'), -1));
    r.qna.forEach((item) => assert.notStrictEqual(item.a, src + ' 보도'));
  });

  // ---------------------------------------------------------------------
  // Regression (실제 프로덕션 버그 #1): NAVER description이 검색 스니펫이라
  // "..."/"…"로 끝나 있으면 그 기호 자체가 bullet/Q&A에 노출되던 문제.
  // Regression (실제 프로덕션 버그 #2, 그 첫 수정 자체의 회귀): 말줄임표를
  // 지우면서 "이후 내용 전체 삭제" + "문장이 완결됐는지 추측해서 판단"하는
  // 방식으로 고쳤더니, 실제 기사 내용까지 대량으로 사라졌다 - 이번에는
  // 말줄임표 "기호"만 제거하고 앞뒤 실제 텍스트는 전부 보존해야 한다.
  // ---------------------------------------------------------------------

  // TEST 1: 문장 전체가 "..."로 끝나는 스니펫이어도, 말줄임표 기호만
  // 사라지고 앞의 실제 텍스트는 전부 보존되어야 한다 (삭제하지 않는다).
  {
    const article = {
      title: '연준 9월 금리 동결 전망',
      description: '연준은 9월 FOMC에서 금리를 동결할 가능성이 높으며 시장에서는 향후...',
      category: '금리', source: '연합뉴스', keywords: []
    };
    const r = EBNews.buildSummary(article);
    const combined = r.bullets.join(' ') + ' ' + r.qna.map((q) => q.a).join(' ');
    assert.strictEqual(/\.{3,}|…/.test(combined), false, 'fallback bullet/qna에 말줄임표 기호가 남아있으면 안 된다');
    assert.notStrictEqual(combined.indexOf('시장에서는 향후'), -1, '말줄임표 기호만 제거되어야 하고, 그 앞의 실제 내용은 삭제되면 안 된다');
    assert.strictEqual(r.bullets.length, 1, '억지로 여러 개로 쪼개거나 내용을 부풀리지 않는다');
  }

  // TEST 2: 말줄임표가 없는 정상 문장 두 개는 완전히 무변경으로 보존되어야 한다.
  {
    const article = {
      title: '국제유가 및 증시 동향',
      description: '국제유가는 5% 상승했다. 미국 증시는 하락했다.',
      category: '증시', source: '한국경제', keywords: []
    };
    const r = EBNews.buildSummary(article);
    assert.deepStrictEqual(Array.from(r.bullets), ['국제유가는 5% 상승했다. 미국 증시는 하락했다.'], '요약 bullet은 실제 문장들을 하나로 합친 것이어야 한다');
  }

  // TEST 3 (실제 버그 재현 - 화면 스크린샷과 동일한 사례): 말줄임표
  // 기호만 사라지고, 그 앞에 있던 실제 기사 내용("전망이 더욱 굳어질
  // 가능성이" 등)은 절대 삭제되면 안 된다. "잘못된 결과"는 이 내용을
  // 과도하게 잘라내는 것이다 (예: "...이를 웃돌 경우"까지만 남기는 식).
  {
    const article = {
      title: '8월 CPI 발표 앞둔 시장',
      description: '시장에서는 8월 CPI가 예상 수준이거나 이를 웃돌 경우 9월 금리 인상 전망이 더욱 굳어질 가능성이...',
      category: '금리', source: '글로벌이코노믹', keywords: []
    };
    const r = EBNews.buildSummary(article);
    const combined = r.bullets.join(' ') + ' ' + r.qna.map((q) => q.a).join(' ');
    assert.strictEqual(/\.{3,}|…/.test(combined), false, '말줄임표 기호가 노출되면 안 된다');
    assert.notStrictEqual(combined.indexOf('전망이 더욱 굳어질 가능성이'), -1, '말줄임표 바로 앞의 실제 내용이 과도하게 잘려나가면 안 된다');
    assert.notStrictEqual(combined.indexOf('예상 수준이거나 이를 웃돌 경우'), -1, '문장 앞부분 내용도 삭제되면 안 된다');
  }

  // TEST 4: Gemini 결과에 "..."가 포함되면 evaluateGeminiSummary()가
  // invalid 처리한다는 것은 gemini-summary.js 쪽에서 이미 검증했다
  // (tests/gemini-summary.test.js). 그 invalid 이후 실제로 화면에 쓰이는
  // fallback 경로(news-data.js의 buildSummary())도 같은 원본 description을
  // 받았을 때 말줄임표 기호를 노출하지 않으면서 내용도 삭제하지 않는지 -
  // 위 TEST 1/3이 바로 그 fallback 경로 자체이므로, 두 파일이 서로 다른
  // 런타임(Node 서버 / 브라우저)임에도 최종 사용자에게는 어느 경로로도
  // "..."가 보이지 않으면서 내용도 보존됨을 함께 보장한다.

  // TEST 5: Q&A 답변에서도 말줄임표 기호는 노출되지 않으면서 내용은
  // 보존되어야 한다.
  {
    const article = {
      title: '8월 CPI 발표 앞둔 시장',
      description: '시장에서는 8월 CPI가 예상 수준이거나 이를 웃돌 경우 9월 금리 인상 전망이 더욱 굳어질 가능성이...',
      category: '금리', source: '글로벌이코노믹', keywords: []
    };
    const r = EBNews.buildSummary(article);
    assert.strictEqual(r.qna.length, 1);
    assert.strictEqual(r.qna[0].q, '무슨 일이 있었나요?');
    assert.strictEqual(/\.{3,}|…/.test(r.qna[0].a), false, 'Q&A 답변에 말줄임표 기호가 남아있으면 안 된다: "' + r.qna[0].a + '"');
    assert.notStrictEqual(r.qna[0].a.indexOf('전망이 더욱 굳어질 가능성이'), -1, 'Q&A 답변의 실제 내용도 삭제되면 안 된다');
  }

  // sanitizeDescriptionForSummary()가 실제 기사 내용의 숫자/날짜/금리 등을
  // 삭제하지 않는지 직접 확인 (gemini-summary.js의 동일 함수와 규칙 일치).
  {
    const original = '2026년 9월 11일 기준금리는 3.5%로 유지됐다.';
    assert.strictEqual(EBNews.sanitizeDescriptionForSummary(original), original);
  }

  // ---------------------------------------------------------------------
  // AI 핵심 요약 / Q&A 생성 경로 분리 (실제 프로덕션 버그: 화면에 두 영역이
  // 사실상 동일한 두 문장을 나란히 복붙한 것처럼 보였다).
  // ---------------------------------------------------------------------

  // TEST 1 - AI 요약과 Q&A 중복 방지: 3개의 실제 문장이 있는 기사에서,
  // 요약 카드는 하나로 합쳐진 bullet을, Q&A는 문장별로 나뉜 3개의
  // 질문/답변을 보여줘야 하고, 요약 bullet 배열이 Q&A 답변 배열을 그대로
  // 나열한 것이면 안 된다.
  {
    const article = {
      title: 'CPI 발표 앞둔 시장, 연준 금리 결정 주목',
      description: 'CPI 발표를 앞두고 시장에서는 연준의 9월 금리 결정에 관심이 커지고 있다. CPI가 예상보다 높으면 금리 인상 전망이 강화될 수 있다. 반대로 물가가 둔화하면 금리 동결 기대가 커질 수 있다.',
      category: '금리', source: '연합뉴스', keywords: []
    };
    const r = EBNews.buildSummary(article);
    assert.strictEqual(r.qna.length, 3, 'Q&A는 3개의 질문/답변 쌍을 가져야 한다');
    assert.deepStrictEqual(Array.from(r.qna).map((item) => item.q), ['무슨 일이 있었나요?', '왜 중요한가요?', '앞으로 어떻게 될까요?']);
    assert.strictEqual(r.bullets.length, 1, '요약 카드는 여러 문장을 하나로 합친 bullet 하나여야 한다');
    assert.notDeepStrictEqual(Array.from(r.bullets), Array.from(r.qna.map((item) => item.a)), '요약 bullet 배열이 Q&A 답변 배열을 그대로 나열한 결과이면 안 된다');
  }

  // TEST 2 - Q&A 3개 질문 유지: "어디서 보도했나요?"가 나오면 실패.
  {
    const article = {
      title: '테스트',
      description: '첫 번째 사실이다. 두 번째 사실이다. 세 번째 사실이다.',
      category: '금리', source: '연합뉴스', keywords: []
    };
    const r = EBNews.buildSummary(article);
    const questions = r.qna.map((item) => item.q);
    ['무슨 일이 있었나요?', '왜 중요한가요?', '앞으로 어떻게 될까요?'].forEach((q) => {
      assert.ok(questions.indexOf(q) !== -1, 'Q&A에 "' + q + '"가 있어야 한다');
    });
    assert.strictEqual(questions.indexOf('어디서 보도했나요?'), -1, '"어디서 보도했나요?"는 나타나면 안 된다');
  }

  // TEST 3 - buildSummary()의 qna는 항상 article의 description에서만
  // 만들어지고, article.aiSummary(Gemini가 생성했을 수 있는 필드)를 절대
  // 가져다 쓰지 않는다. (article-ai.js는 Gemini가 자체적으로 생성/검증한
  // article.qna가 있으면 그것을 우선 사용하고, 이 buildSummary()의 qna는
  // 그 경우가 아닐 때의 fallback으로만 쓰인다 - 자세한 것은
  // tests/article-ai-summary.test.js 참고. 이 테스트는 buildSummary() 자체가
  // Gemini의 aiSummary 필드를 절대 읽지 않는지만 확인한다.)
  {
    const article = {
      title: '연준 금리 발표',
      description: '연준이 기준금리를 동결했다. 시장은 안도하는 분위기다.',
      category: '금리', source: '연합뉴스', keywords: [],
      // Gemini가 생성했다고 가정한, description과 다른 문장 - qna에는 이
      // 문장이 절대 나타나면 안 된다.
      aiSummary: ['연방준비제도가 이번 회의에서 기준금리를 현 수준으로 유지하기로 결정했다.'],
      summaryStatus: 'generated'
    };
    const r = EBNews.buildSummary(article);
    r.qna.forEach((item) => {
      assert.strictEqual(item.a.indexOf('연방준비제도가 이번 회의에서'), -1, 'Q&A 답변에 Gemini aiSummary 문장이 섞여 들어가면 안 된다');
    });
  }

  // ---------------------------------------------------------------------
  // Structural guard: article.html must still have exactly one summary
  // card (#ai-summary-list) and one, separate Q&A block (#qna-block) -
  // article-ai.js must wire buildSummary()'s qna field into it.
  // ---------------------------------------------------------------------
  const articleHtml = fs.readFileSync(path.join(__dirname, '..', 'article.html'), 'utf8');
  assert.notStrictEqual(articleHtml.indexOf('id="qna-block"'), -1, 'article.html에 Q&A 영역(#qna-block)이 있어야 한다');
  assert.notStrictEqual(articleHtml.indexOf('.qna-block {'), -1, 'qna-block CSS가 있어야 한다');
  assert.notStrictEqual(articleHtml.indexOf('id="ai-summary-list"'), -1, 'AI 핵심 내용 카드(#ai-summary-list)도 그대로 있어야 한다');

  const articleAiJs = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'article-ai.js'), 'utf8');
  assert.notStrictEqual(articleAiJs.indexOf('qna-block'), -1, 'article-ai.js가 qna-block을 렌더링해야 한다');
  assert.notStrictEqual(articleAiJs.indexOf('summary.qna'), -1, 'template-fallback 경로는 buildSummary()의 qna 필드를 그대로 사용해야 한다');

  console.log('ai-summary.test.js: all assertions passed');
})();
