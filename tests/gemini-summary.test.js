// Tests for gemini-summary.js - the server-side Gemini "AI 핵심 요약"
// generator. Runs as a plain Node module test (gemini-summary.js is a
// CommonJS server module, not a browser file), monkey-patching
// global.fetch to simulate the Gemini Interactions API without ever
// calling the real network - same technique this project's other server
// module tests (naver-enrichment.test.js) already use. No real
// GEMINI_API_KEY is used or required to run this file.
const assert = require('assert');
process.env.GEMINI_API_KEY = 'test-key-not-real'; // set BEFORE require so any accidental top-level read still sees a configured key
const gemini = require('../gemini-summary');
const {
  enrichWithGemini,
  evaluateGeminiSummary,
  evaluateGeminiQna,
  qnaDuplicatesBullets,
  isValidQnaPairsShape,
  stripLeadingQuestionEcho,
  looksLikeRealDescription,
  sanitizeDescriptionForSummary,
  buildPrompt,
  extractBulletsFromResponse,
  extractQnaAnswersFromResponse,
  getPeakConcurrency,
  resetPeakConcurrency,
  GEMINI_CONCURRENCY,
  QNA_QUESTIONS
} = gemini;

const originalFetch = global.fetch;

function interactionsBody(bullets, qna) {
  const payload = qna === undefined ? { bullets } : { bullets, qna };
  return { steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(payload) }] }] };
}
function mockResponse(bodyObj, status) {
  status = status || 200;
  return { ok: status >= 200 && status < 300, status, json: async () => bodyObj };
}
let idCounter = 0;
function uid() { idCounter += 1; return 'gemini-test-' + idCounter; }
function realArticle(overrides) {
  // Mirrors what server.js's normalizeArticle() actually produces before
  // any enrichment runs - aiSummary:null/summaryStatus:'not_requested' are
  // real fixed defaults there, not test-only conveniences.
  return Object.assign({
    id: uid(),
    title: '한은, 기준금리 3.00%로 동결',
    description: '한국은행이 10일 금융통화위원회를 열고 기준금리를 현 수준인 3.00%로 동결했다. 시장에서는 이번 결정이 대체로 예상된 결과였다고 평가했다.',
    category: '금리',
    source: '연합뉴스',
    aiSummary: null,
    summaryStatus: 'not_requested'
  }, overrides || {});
}

(async () => {
  // ---------------------------------------------------------------------
  // Pure-function tests: looksLikeRealDescription
  // ---------------------------------------------------------------------
  assert.strictEqual(looksLikeRealDescription({ description: '연합뉴스 보도', source: '연합뉴스' }), false, '"{source} 보도" placeholder는 실제 내용이 아니다');
  assert.strictEqual(looksLikeRealDescription({ description: '짧음', source: 'S' }), false, '너무 짧은 description은 실제 내용으로 보지 않는다');
  assert.strictEqual(looksLikeRealDescription({ description: '', source: 'S' }), false);
  assert.strictEqual(looksLikeRealDescription({ description: '한국은행이 기준금리를 3.00%로 동결하기로 결정했다고 밝혔다.', source: '연합뉴스' }), true, '충분히 긴 실제 description은 true');

  // ---------------------------------------------------------------------
  // Pure-function tests: extractBulletsFromResponse
  // ---------------------------------------------------------------------
  assert.deepStrictEqual(extractBulletsFromResponse(interactionsBody(['a', 'b'])), ['a', 'b']);
  assert.deepStrictEqual(extractBulletsFromResponse({ output_text: JSON.stringify({ bullets: ['x'] }) }), ['x']);
  assert.strictEqual(extractBulletsFromResponse({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'not json' }] }] }), null);
  assert.strictEqual(extractBulletsFromResponse({}), null);
  assert.strictEqual(extractBulletsFromResponse(null), null);

  // ---------------------------------------------------------------------
  // Pure-function tests: evaluateGeminiSummary (hallucination guard)
  // ---------------------------------------------------------------------
  const baseArticle = realArticle();
  assert.strictEqual(evaluateGeminiSummary(['한국은행이 기준금리를 3.00%로 동결하기로 결정했다.'], baseArticle).valid, true, '실제 description에 있는 내용은 valid여야 한다');
  assert.strictEqual(evaluateGeminiSummary([], baseArticle).valid, false, '빈 배열은 invalid');
  assert.strictEqual(evaluateGeminiSummary(['a', 'b', 'c', 'd'], baseArticle).valid, true, '3~4개는 원본 UI 기준 목표 범위이므로 4개는 valid여야 한다');
  assert.strictEqual(evaluateGeminiSummary(['a', 'b', 'c', 'd', 'e'], baseArticle).valid, false, '5개 이상은 invalid');
  assert.strictEqual(evaluateGeminiSummary(['한은, 기준금리 3.00%로 동결'], baseArticle).valid, false, 'title과 동일한 bullet은 invalid');
  assert.strictEqual(evaluateGeminiSummary([baseArticle.description], baseArticle).valid, false, 'description 전체 복사는 invalid');
  assert.strictEqual(evaluateGeminiSummary(['같은 문장입니다.', '같은 문장입니다.'], baseArticle).valid, false, '중복 bullet은 invalid');
  assert.strictEqual(evaluateGeminiSummary(['관련 업계의 관심이 커지고 있습니다.'], baseArticle).valid, false, '금지된 상투 문구는 invalid');
  assert.strictEqual(evaluateGeminiSummary(['영업이익이 4500억원을 기록했다.'], baseArticle).valid, false, '원문에 없는 숫자를 포함하면 invalid');
  assert.strictEqual(evaluateGeminiSummary(['x'.repeat(201)], baseArticle).valid, false, '지나치게 긴 bullet은 invalid');

  // ---------------------------------------------------------------------
  // A / I. Gemini 정상 응답 -> JSON 파싱 -> bullets 1~3개 -> 실제 Gemini
  // summary가 article에 사용됨 (fallback이 아님).
  // ---------------------------------------------------------------------
  {
    const article = realArticle();
    const bullets = ['한국은행이 기준금리를 현 수준인 3.00%로 동결했다.', '시장은 이번 결정을 대체로 예상된 결과로 평가했다.'];
    global.fetch = async () => mockResponse(interactionsBody(bullets));
    const stats = await enrichWithGemini([article]);
    assert.strictEqual(stats.generated, 1);
    assert.strictEqual(article.summaryStatus, 'generated');
    assert.deepStrictEqual(article.aiSummary, bullets, 'Gemini가 성공하면 실제 생성된 bullets가 그대로 사용되어야 한다');
  }

  // ---------------------------------------------------------------------
  // B. Gemini 응답이 description을 그대로 복사 -> validation 실패 -> fallback
  // (article.aiSummary/summaryStatus는 손대지 않은 채로 남아야 한다)
  // ---------------------------------------------------------------------
  {
    const article = realArticle();
    global.fetch = async () => mockResponse(interactionsBody([article.description]));
    const stats = await enrichWithGemini([article]);
    assert.strictEqual(stats.invalid, 1);
    assert.strictEqual(stats.invalidReasons['description-copy'], 1);
    assert.strictEqual(article.aiSummary, null);
    assert.strictEqual(article.summaryStatus, 'not_requested');
  }

  // ---------------------------------------------------------------------
  // C. Gemini가 title을 그대로 반복 -> validation 실패 -> fallback
  // ---------------------------------------------------------------------
  {
    const article = realArticle();
    global.fetch = async () => mockResponse(interactionsBody([article.title]));
    const stats = await enrichWithGemini([article]);
    assert.strictEqual(stats.invalid, 1);
    assert.strictEqual(stats.invalidReasons['title-echo'], 1);
    assert.strictEqual(article.summaryStatus, 'not_requested');
  }

  // ---------------------------------------------------------------------
  // D. 입력에 없는 숫자를 추가 -> validation 실패 -> fallback
  // ---------------------------------------------------------------------
  {
    const article = realArticle();
    global.fetch = async () => mockResponse(interactionsBody(['한국은행이 영업이익 4500억원을 기록했다고 밝혔다.']));
    const stats = await enrichWithGemini([article]);
    assert.strictEqual(stats.invalid, 1);
    assert.strictEqual(stats.invalidReasons['unknown-number'], 1);
    assert.strictEqual(article.summaryStatus, 'not_requested');
  }

  // ---------------------------------------------------------------------
  // E. 429 -> 제한된 retry -> 최종 실패 시 fallback
  // ---------------------------------------------------------------------
  {
    const article = realArticle();
    let callCount = 0;
    global.fetch = async () => { callCount++; return mockResponse({}, 429); };
    const stats = await enrichWithGemini([article]);
    assert.strictEqual(callCount, 3, '1회 시도 + 최대 2회 retry = 총 3회 호출이어야 한다');
    assert.strictEqual(stats.retries, 2);
    assert.strictEqual(stats.apiErrors, 1);
    assert.strictEqual(stats.errorsByType['429'], 1);
    assert.strictEqual(article.summaryStatus, 'not_requested', '최종 실패하면 fallback 상태로 남아야 한다');
  }

  // ---------------------------------------------------------------------
  // F. 500 -> retry -> fallback
  // ---------------------------------------------------------------------
  {
    const article = realArticle();
    let callCount = 0;
    global.fetch = async () => { callCount++; return mockResponse({}, 503); };
    const stats = await enrichWithGemini([article]);
    assert.strictEqual(callCount, 3);
    assert.strictEqual(stats.retries, 2);
    assert.strictEqual(stats.errorsByType['5xx'], 1);
    assert.strictEqual(article.summaryStatus, 'not_requested');
  }

  // 4xx (e.g. bad request/auth) must NOT be retried - a single call only.
  {
    const article = realArticle();
    let callCount = 0;
    global.fetch = async () => { callCount++; return mockResponse({}, 400); };
    const stats = await enrichWithGemini([article]);
    assert.strictEqual(callCount, 1, '명백한 4xx는 재시도하면 안 된다');
    assert.strictEqual(stats.retries, 0);
    assert.strictEqual(stats.errorsByType['4xx'], 1);
  }

  // ---------------------------------------------------------------------
  // G. GEMINI_API_KEY 없음 -> Gemini 호출 자체가 발생하지 않음 -> fallback
  // ---------------------------------------------------------------------
  {
    const savedKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const article = realArticle();
    let fetchCalled = false;
    global.fetch = async () => { fetchCalled = true; return mockResponse(interactionsBody(['x'])); };
    const stats = await enrichWithGemini([article]);
    assert.strictEqual(fetchCalled, false, 'API key가 없으면 네트워크 호출이 전혀 발생하면 안 된다');
    assert.strictEqual(stats.generated, 0);
    assert.strictEqual(article.summaryStatus, 'not_requested');
    process.env.GEMINI_API_KEY = savedKey;
  }

  // ---------------------------------------------------------------------
  // H / K. 동일 article(id 기준) 두 번 요청 -> 두 번째는 Gemini를 다시
  // 호출하지 않고 캐시된 결과를 사용 (60초 polling/반복 요청이 API를
  // 반복 호출하지 않는다는 것과 동일한 매커니즘).
  // ---------------------------------------------------------------------
  {
    const sharedId = uid();
    let callCount = 0;
    const bullets = ['한국은행이 기준금리를 현 수준인 3.00%로 동결했다.'];
    global.fetch = async () => { callCount++; return mockResponse(interactionsBody(bullets)); };

    const first = realArticle({ id: sharedId });
    await enrichWithGemini([first]);
    assert.strictEqual(callCount, 1);

    // A later refresh/poll re-builds a FRESH article object with the same
    // stable id (exactly what server.js's fetchNewsData does every RSS
    // refresh) - summaryStatus/aiSummary start over at their normalizeArticle
    // defaults, but the cache (keyed by id) must still short-circuit it.
    const second = realArticle({ id: sharedId, aiSummary: null, summaryStatus: 'not_requested' });
    const stats2 = await enrichWithGemini([second]);
    assert.strictEqual(callCount, 1, '동일 id의 기사를 다시 처리해도 Gemini를 다시 호출하면 안 된다');
    assert.strictEqual(stats2.cacheHits, 1);
    assert.strictEqual(second.summaryStatus, 'generated', '캐시된 결과가 새 article 객체에도 적용되어야 한다');
    assert.deepStrictEqual(second.aiSummary, bullets);
  }

  // ---------------------------------------------------------------------
  // J. Gemini가 실패해도 기사 자체의 다른 필드(title/description/source/
  // url)는 전혀 건드리지 않는다 - 뉴스 표시 자체가 막히면 안 된다.
  // ---------------------------------------------------------------------
  {
    const article = realArticle({ url: 'https://example.com/real-article' });
    const before = Object.assign({}, article);
    global.fetch = async () => { throw new Error('simulated network failure'); };
    await enrichWithGemini([article]);
    assert.strictEqual(article.title, before.title);
    assert.strictEqual(article.description, before.description);
    assert.strictEqual(article.source, before.source);
    assert.strictEqual(article.url, before.url);
    assert.strictEqual(article.category, before.category);
  }

  // ---------------------------------------------------------------------
  // L. concurrency 제한 확인 - 여러 기사를 동시에 처리해도 실제 동시
  // in-flight 요청 수가 GEMINI_CONCURRENCY(기본 2)를 넘지 않아야 한다.
  // ---------------------------------------------------------------------
  {
    resetPeakConcurrency();
    let inFlight = 0;
    let observedPeak = 0;
    global.fetch = async () => {
      inFlight++;
      observedPeak = Math.max(observedPeak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight--;
      return mockResponse(interactionsBody(['한국은행이 기준금리를 동결했다고 밝혔다.']));
    };
    const articles = Array.from({ length: 6 }, () => realArticle());
    await enrichWithGemini(articles);
    assert.ok(observedPeak <= GEMINI_CONCURRENCY, '실제 동시 in-flight 요청 수가 GEMINI_CONCURRENCY(' + GEMINI_CONCURRENCY + ')를 넘으면 안 된다 (관측값: ' + observedPeak + ')');
    assert.ok(getPeakConcurrency() <= GEMINI_CONCURRENCY);
    // two SEPARATE enrichWithGemini() calls share the same module-level
    // semaphore, so concurrency stays capped even across two simultaneous
    // category refreshes (mirrors naver-enrichment.test.js's equivalent check).
    resetPeakConcurrency();
    let inFlight2 = 0;
    let observedPeak2 = 0;
    global.fetch = async () => {
      inFlight2++;
      observedPeak2 = Math.max(observedPeak2, inFlight2);
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight2--;
      return mockResponse(interactionsBody(['한국은행이 기준금리를 동결했다고 밝혔다.']));
    };
    const batchA = Array.from({ length: 4 }, () => realArticle());
    const batchB = Array.from({ length: 4 }, () => realArticle());
    await Promise.all([enrichWithGemini(batchA), enrichWithGemini(batchB)]);
    assert.ok(observedPeak2 <= GEMINI_CONCURRENCY, '두 개의 동시 enrichWithGemini() 호출도 합쳐서 GEMINI_CONCURRENCY를 넘으면 안 된다 (관측값: ' + observedPeak2 + ')');
  }

  // ---------------------------------------------------------------------
  // M. 프롬프트가 "무슨 일/왜 중요/핵심 포인트로 나누지 말라"고 지시해도
  // Gemini가 그 라벨을 그대로 붙여 응답하는 경우, 통째로 reject해서 버리지
  // 않고 라벨만 제거한 뒤 사용한다 (stripRoleLabelPrefix) - 실제로 유효한
  // 요약 내용까지 낭비하지 않기 위함.
  // ---------------------------------------------------------------------
  {
    const article = realArticle();
    global.fetch = async () => mockResponse(interactionsBody([
      '무슨 일: 한국은행이 기준금리를 3.00%로 동결했다.',
      '왜 중요: 시장 예상과 대체로 부합하는 결정이었다.'
    ]));
    await enrichWithGemini([article]);
    assert.strictEqual(article.summaryStatus, 'generated', '라벨이 붙어 있어도 내용 자체는 유효하므로 reject되지 않고 사용되어야 한다');
    article.aiSummary.forEach((b) => {
      assert.strictEqual(/^(무슨\s*일|왜\s*중요|핵심\s*포인트)\s*[:：]/.test(b), false, 'bullet에 역할 라벨이 남아있으면 안 된다: "' + b + '"');
    });
    assert.strictEqual(article.aiSummary[0], '한국은행이 기준금리를 3.00%로 동결했다.');
    assert.strictEqual(article.aiSummary[1], '시장 예상과 대체로 부합하는 결정이었다.');
  }

  // ---------------------------------------------------------------------
  // N. sanitizeDescriptionForSummary() - strips broadcast/wire-service
  // metadata that rides along inside a real NAVER/RSS description, without
  // ever touching a real number/date/percentage that isn't attached to one
  // of those label patterns.
  // ---------------------------------------------------------------------

  // N1. "[출처: ...]" 태그 제거
  {
    const sanitized = sanitizeDescriptionForSummary('아시아 주요 증시[출처: 연합뉴스] 일본 증시가 유가 상승 영향으로 하락했다.');
    assert.strictEqual(sanitized.indexOf('[출처: 연합뉴스]'), -1, '[출처: ...] 태그는 제거되어야 한다');
    assert.notStrictEqual(sanitized.indexOf('일본 증시가 유가 상승 영향으로 하락했다.'), -1, '실제 기사 문장은 보존되어야 한다');
  }

  // N2. "(화면번호 6511)" 제거, 실제 문장은 보존
  {
    const sanitized = sanitizeDescriptionForSummary('연합뉴스 세계주가지수(화면번호 6511)에 따르면 일본 증시가 하락했다.');
    assert.strictEqual(sanitized.indexOf('화면번호 6511'), -1, '화면번호 태그는 제거되어야 한다');
    assert.notStrictEqual(sanitized.indexOf('일본 증시가 하락했다.'), -1, '실제 기사 문장은 보존되어야 한다');
  }

  // N3. 방송용 "오후 12시 46분 현재" 제거, 뒤따르는 실제 수치 문장은 보존
  {
    const sanitized = sanitizeDescriptionForSummary('오후 12시 46분 현재 일본 증시는 2% 하락했다.');
    assert.strictEqual(sanitized.indexOf('현재'), -1, '방송용 "OO시 OO분 현재" 표현은 제거되어야 한다');
    assert.notStrictEqual(sanitized.indexOf('일본 증시는 2% 하락했다.'), -1, '실제 수치가 담긴 문장은 보존되어야 한다');
  }

  // N4. 실제 기사 내용(날짜/금리 수치)은 절대 삭제하지 않는다
  {
    const original = '2026년 9월 11일 기준금리는 3.5%로 유지됐다.';
    const sanitized = sanitizeDescriptionForSummary(original);
    assert.strictEqual(sanitized, original, '메타데이터 패턴이 없는 실제 기사 문장은 그대로 보존되어야 한다');
  }

  // N5. article.description 원본 자체는 절대 변경되지 않는다 - buildPrompt()는
  // 정제된 문자열을 프롬프트의 "description: " 줄에만 사용하고 article
  // 객체는 건드리지 않는다. (프롬프트의 지시문 자체는 예시로 "[출처: ...]"
  // 같은 문구를 언급하므로, 검사는 실제 "description: " 줄만 대상으로 한다.)
  {
    const article = realArticle({ description: '아시아 증시[출처: 연합뉴스] 하락 마감했다.' });
    const before = article.description;
    const prompt = buildPrompt(article);
    assert.strictEqual(article.description, before, 'buildPrompt()가 article.description 원본을 변경하면 안 된다');
    const descriptionLine = prompt.split('\n').find((line) => line.indexOf('description: ') === 0);
    assert.notStrictEqual(descriptionLine, undefined);
    assert.strictEqual(descriptionLine.indexOf('[출처: 연합뉴스]'), -1, '프롬프트에 전달되는 description 줄에는 메타데이터가 없어야 한다');
    assert.notStrictEqual(descriptionLine.indexOf('하락 마감했다.'), -1, '프롬프트에는 실제 기사 내용이 남아있어야 한다');
  }

  // ---------------------------------------------------------------------
  // O. evaluateGeminiSummary()의 메타데이터 누출 검증 - Gemini가 structured
  // JSON은 정상적으로 반환해도 내용 자체에 메타데이터가 섞여 있으면 invalid
  // 처리해야 한다. "출처"라는 단어 자체는 금지어가 아니다.
  // ---------------------------------------------------------------------

  // O1 (TEST 5). bullet에 "화면번호"가 남아있으면 invalid
  {
    const article = realArticle();
    const evaluation = evaluateGeminiSummary(['일본 증시가 하락했다.', '화면번호 6511에 따르면 하락폭이 확대됐다.'], article);
    assert.strictEqual(evaluation.valid, false, '화면번호가 남은 bullet은 invalid여야 한다');
    assert.strictEqual(evaluation.reason, 'metadata-leak');
  }

  // O2 (TEST 6). 메타데이터 없이 정상적인 3문장은 valid 처리되어야 한다
  {
    const article = realArticle({
      title: '아시아 증시 하락',
      description: '일본과 대만 등 아시아 주요 증시가 유가와 미국 국채금리 상승 영향에 하락했다. 유가 상승으로 투자심리가 위축된 것으로 풀이된다. 시장 전문가들은 당분간 변동성이 이어질 수 있다고 전망했다.'
    });
    const evaluation = evaluateGeminiSummary([
      '일본 증시가 하락했다.',
      '유가 상승으로 투자심리가 위축됐다.',
      '향후 시장 변동성이 이어질 수 있다.'
    ], article);
    assert.strictEqual(evaluation.valid, true, '메타데이터 없는 정상 3문장 요약은 valid여야 한다');
  }

  // O3. "출처"라는 단어 자체가 자연스러운 문장에 등장하는 것까지 금지하면 안 된다.
  {
    const article = realArticle({
      title: '통계청 발표',
      description: '통계청은 이번 발표의 출처를 명확히 밝히며 신뢰도를 강조했다. 관련 자료는 홈페이지에도 공개된다.'
    });
    const evaluation = evaluateGeminiSummary(['통계청은 발표의 출처를 명확히 밝히며 신뢰도를 강조했다.'], article);
    assert.strictEqual(evaluation.valid, true, '"출처"라는 단어 자체가 자연스럽게 쓰인 문장까지 invalid 처리하면 안 된다');
  }

  // ---------------------------------------------------------------------
  // P. 원본 description에 메타데이터가 섞여 있어도, 실제 네트워크 경로에서
  // Gemini에 전달되는 입력이 정제되는지 end-to-end로 확인 (buildPrompt()가
  // callGeminiOnce() 안에서 실제로 호출되는지 검증).
  // ---------------------------------------------------------------------
  {
    const article = realArticle({
      description: '아시아 주요 증시[출처: 연합뉴스] 오후 12시 46분 현재 일본 증시가 유가 상승 영향에 하락하고 있다.'
    });
    let capturedInput = null;
    global.fetch = async (url, opts) => {
      capturedInput = JSON.parse(opts.body).input;
      return mockResponse(interactionsBody(['일본 증시가 유가 상승 영향에 하락하고 있다.']));
    };
    await enrichWithGemini([article]);
    assert.notStrictEqual(capturedInput, null);
    // The prompt's own instruction text legitimately mentions "[출처:
    // 연합뉴스]" etc. as illustrative examples of what to exclude, so this
    // checks only the actual "description: " line built from the article.
    const capturedDescLine = capturedInput.split('\n').find((line) => line.indexOf('description: ') === 0);
    assert.notStrictEqual(capturedDescLine, undefined);
    assert.strictEqual(capturedDescLine.indexOf('[출처: 연합뉴스]'), -1, '실제 API 호출에 전달되는 description 줄에는 메타데이터가 없어야 한다');
    assert.strictEqual(capturedDescLine.indexOf('12시 46분 현재'), -1);
    assert.notStrictEqual(capturedDescLine.indexOf('유가 상승 영향'), -1, '실제 기사 내용은 API 입력에 그대로 남아있어야 한다');
    assert.strictEqual(article.summaryStatus, 'generated');
  }

  // ---------------------------------------------------------------------
  // Q. NAVER 검색 스니펫에 섞여 들어오는 말줄임표("..."/"…") 기호 자체가
  // Gemini 입력/출력에 그대로 노출되는 문제 - 입력 정제(sanitizeDescriptionForSummary)
  // + 출력 검증(evaluateGeminiSummary) 양쪽에서 막는다.
  //
  // 회귀 방지: 이 정제 함수의 이전 버전은 "..."를 만나면 그 이후 내용을
  // 전부 삭제하고, 남은 조각이 "완결된 문장처럼 보이는지"까지 판단하려
  // 했다 - 그 결과 실제 기사 내용이 대량으로 사라지는 문제가 실제로
  // 보고되어 되돌려졌다. 지금은 말줄임표 "기호"만 제거하고, 앞뒤 실제
  // 텍스트는 절대 건드리지 않는다.
  // ---------------------------------------------------------------------

  // TEST 1: 문장 전체가 "..."로 끝나는 스니펫이어도, 말줄임표 기호만
  // 사라지고 앞의 실제 내용은 그대로 보존되어야 한다 (삭제 금지).
  {
    const sanitized = sanitizeDescriptionForSummary('연준은 9월 FOMC에서 기준금리를 동결할 가능성이 높으며 시장에서는 향후...');
    assert.strictEqual(/\.{3,}|…/.test(sanitized), false, '정제된 결과에 말줄임표 기호가 남아있으면 안 된다');
    assert.notStrictEqual(sanitized.indexOf('시장에서는 향후'), -1, '말줄임표 기호만 제거되어야 하고, 그 앞의 실제 내용은 삭제되면 안 된다');
  }

  // TEST 2: 정상적인 마침표는 보존되어야 한다 (말줄임표가 없으면 완전히 무변경).
  {
    const original = '국제유가는 5% 상승했다. 미국 증시는 하락했다.';
    assert.strictEqual(sanitizeDescriptionForSummary(original), original, '말줄임표가 없는 정상 문장은 그대로 보존되어야 한다');
  }

  // 말줄임표가 문장 중간에 있어도, 앞뒤 실제 내용이 모두 보존되어야 한다
  // (뒤에 이어지는 실제 문장까지 삭제하는 것은 금지).
  {
    const sanitized = sanitizeDescriptionForSummary('일본 증시가 하락했다... 정확한 원인은 후속 보도를 통해 확인될 예정이다.');
    assert.strictEqual(/\.{3,}|…/.test(sanitized), false, '말줄임표 기호가 남아있으면 안 된다');
    assert.notStrictEqual(sanitized.indexOf('일본 증시가 하락했다'), -1, '말줄임표 앞의 내용이 보존되어야 한다');
    assert.notStrictEqual(sanitized.indexOf('정확한 원인은 후속 보도를 통해 확인될 예정이다.'), -1, '말줄임표 뒤에 이어지는 실제 내용도 삭제되면 안 된다');
  }

  // TEST 3: bullet에 "..."가 하나라도 남아있으면 전체 결과를 invalid 처리한다
  // (잘라서 보여주는 방식 금지 - reject 후 기존 재시도/fallback 정책을 따른다).
  {
    const article = realArticle({
      description: '국제유가는 상승세를 보였다. 미국 증시는 하락했다. 투자자들은 금리 결정을 주시하고 있다.'
    });
    const evaluation = evaluateGeminiSummary([
      '국제유가는 상승세를 보였다...',
      '미국 증시는 하락했다.',
      '투자자들은 금리 결정을...'
    ], article);
    assert.strictEqual(evaluation.valid, false, '말줄임표가 포함된 bullet은 invalid여야 한다');
    assert.strictEqual(evaluation.reason, 'ellipsis');
  }
  // "…" (단일 문자 말줄임표) 형태도 동일하게 걸러야 한다.
  {
    const article = realArticle();
    const evaluation = evaluateGeminiSummary(['일본 증시가 하락했다…'], article);
    assert.strictEqual(evaluation.valid, false);
    assert.strictEqual(evaluation.reason, 'ellipsis');
  }

  // TEST 4: 완결된 3문장은 정상적으로 valid 처리되어야 한다.
  {
    const article = realArticle({
      description: '국제유가는 5% 상승했다. 미국 증시는 금리 상승 영향으로 하락했다. 투자자들은 연준의 정책 결정을 주시하고 있다.'
    });
    const evaluation = evaluateGeminiSummary([
      '국제유가는 5% 상승했다.',
      '미국 증시는 금리 상승 영향으로 하락했다.',
      '투자자들은 연준의 정책 결정을 주시하고 있다.'
    ], article);
    assert.strictEqual(evaluation.valid, true, '말줄임표 없는 완결된 3문장은 valid여야 한다');
  }

  // TEST 5: 메타데이터([출처: ...], (화면번호 ...), 방송용 현재 시각)가 섞인
  // description도 Gemini 입력에서는 모두 제거되어야 한다 (기존 정제 로직 유지 확인).
  {
    const sanitized = sanitizeDescriptionForSummary(
      '아시아 주요 증시[출처: 연합뉴스] 오후 12시 46분 현재 일본 증시가 하락했다. 연합뉴스 세계주가지수(화면번호 6511)에 따르면 낙폭이 확대됐다.'
    );
    assert.strictEqual(sanitized.indexOf('[출처: 연합뉴스]'), -1);
    assert.strictEqual(sanitized.indexOf('화면번호 6511'), -1);
    assert.strictEqual(sanitized.indexOf('12시 46분 현재'), -1);
    assert.notStrictEqual(sanitized.indexOf('일본 증시가 하락했다.'), -1, '실제 기사 문장은 보존되어야 한다');
  }

  // ---------------------------------------------------------------------
  // R. AI Summary와 Q&A 콘텐츠 생성 역할 분리 (Gemini가 둘 다 생성하는 경우).
  // gemini-summary.js는 한 번의 API 호출로 bullets(AI 핵심 요약)와 qna(고정
  // 3문항에 대한 답변)를 함께 받는다 - 두 필드는 서로 독립적으로 검증되고
  // 독립적으로 article에 반영된다(한쪽이 무효여도 다른 쪽은 영향받지 않음).
  // ---------------------------------------------------------------------

  // R1 (TEST 4/6/7). Q&A 질문은 정확히 고정된 3개이고 "어디서 보도했나요?"는
  // 애초에 존재하지 않는다 - Gemini는 질문 텍스트 자체를 생성하지 않고 답변
  // 문자열만 생성하며, 질문 라벨은 코드의 상수(QNA_QUESTIONS)에서만 온다.
  assert.deepStrictEqual(QNA_QUESTIONS, ['무슨 일이 있었나요?', '왜 중요한가요?', '앞으로 어떻게 될까요?']);
  assert.strictEqual(QNA_QUESTIONS.indexOf('어디서 보도했나요?'), -1);

  // R2. extractQnaAnswersFromResponse()는 같은 응답에서 bullets와 별개로
  // qna 배열을 뽑아내야 한다.
  assert.deepStrictEqual(extractQnaAnswersFromResponse(interactionsBody(['a'], ['q1', 'q2'])), ['q1', 'q2']);
  assert.strictEqual(extractQnaAnswersFromResponse(interactionsBody(['a'])), null, 'qna 필드 자체가 없는 (기존 형태) 응답에서는 null이어야 한다');

  // R3 (TEST 1/2/3/4). evaluateGeminiQna()는 evaluateGeminiSummary()와 동일한
  // 사실성 규칙(없는 숫자/제목 그대로/description 그대로/상투 문구/말줄임표)을
  // qna 답변에도 적용하고, 추가로 "정확히 3개"라는 개수 규칙을 강제해야 한다.
  {
    const article = realArticle();
    const validThree = ['한국은행이 기준금리를 3.00%로 동결하기로 결정했다.', '시장은 예상된 결과로 평가했다.', '기사에서는 향후 방향을 구체적으로 제시하지 않았다.'];
    assert.strictEqual(evaluateGeminiQna(validThree, article).valid, true, '정확히 3개이고 내용이 정상이면 valid여야 한다');
    // TEST 4 - 정확히 3개.
    assert.strictEqual(evaluateGeminiQna([], article).valid, false, '빈 배열은 invalid');
    assert.strictEqual(evaluateGeminiQna([validThree[0]], article).valid, false, '1개는 invalid (2개이면 실패해야 한다)');
    assert.strictEqual(evaluateGeminiQna([validThree[0], validThree[1]], article).valid, false, '2개는 invalid');
    assert.strictEqual(evaluateGeminiQna(validThree.concat(['네 번째 답변입니다.']), article).valid, false, '4개는 invalid');
    assert.strictEqual(evaluateGeminiQna(validThree, article).reason, undefined);
    assert.strictEqual(evaluateGeminiQna([validThree[0], validThree[1]], article).reason, 'wrong-answer-count');
    // 내용 규칙(evaluateGeminiSummary와 공유) - 3개 중 하나라도 위반하면 전체 invalid.
    assert.strictEqual(evaluateGeminiQna([article.title, validThree[1], validThree[2]], article).valid, false, 'title을 그대로 반복한 답변은 invalid');
    assert.strictEqual(evaluateGeminiQna([article.description, validThree[1], validThree[2]], article).valid, false, 'description 전체 복사는 invalid');
    assert.strictEqual(evaluateGeminiQna(['영업이익이 4500억원을 기록했다.', validThree[1], validThree[2]], article).valid, false, '원문에 없는 숫자는 invalid');
    assert.strictEqual(evaluateGeminiQna(['답변 하나...', validThree[1], validThree[2]], article).valid, false, '말줄임표가 남은 답변은 invalid');
  }

  // R3b (TEST 3). 코드가 실제로 조립하는 최종 {q, a} 3쌍 구조 자체를 검증하는
  // isValidQnaPairsShape() - q가 고정 질문과 정확히 일치하고, a가 비어있지
  // 않고 q와 달라야 한다.
  {
    const goodPairs = QNA_QUESTIONS.map((q, i) => ({ q, a: '답변 ' + i }));
    assert.strictEqual(isValidQnaPairsShape(goodPairs), true);
    assert.strictEqual(isValidQnaPairsShape(goodPairs.slice(0, 2)), false, '2개뿐이면 invalid');
    assert.strictEqual(isValidQnaPairsShape([{ q: '어디서 보도했나요?', a: '답' }, goodPairs[1], goodPairs[2]]), false, 'q가 고정 질문과 다르면 invalid');
    assert.strictEqual(isValidQnaPairsShape([{ q: QNA_QUESTIONS[0], a: '' }, goodPairs[1], goodPairs[2]]), false, 'a가 비어있으면 invalid');
    assert.strictEqual(isValidQnaPairsShape([{ q: QNA_QUESTIONS[0] }, goodPairs[1], goodPairs[2]]), false, 'a 필드 자체가 없으면 invalid');
    assert.strictEqual(
      isValidQnaPairsShape([{ q: '무슨 일증시의 박스권 장세가지속되면서...' }, goodPairs[1], goodPairs[2]]),
      false,
      '보고된 실제 오염 사례(q에 답변이 섞이고 a가 없는 형태)도 invalid여야 한다'
    );
  }

  // R3c (TEST 2). stripLeadingQuestionEcho() - Gemini가 지침을 어기고 답변
  // 앞에 고정 질문 문구를 그대로 반복해도, 검증 전에 그 접두어만 제거하고
  // 실제 답변 내용은 보존해야 한다.
  {
    const withEcho = QNA_QUESTIONS[0] + ' 한국은행이 기준금리를 동결했다.';
    assert.strictEqual(stripLeadingQuestionEcho(withEcho, QNA_QUESTIONS[0]), '한국은행이 기준금리를 동결했다.');
    assert.strictEqual(stripLeadingQuestionEcho('한국은행이 기준금리를 동결했다.', QNA_QUESTIONS[0]), '한국은행이 기준금리를 동결했다.', '질문을 반복하지 않은 답변은 그대로 유지되어야 한다');
  }

  // R3d (TEST 3 - 사실적 conservative 답변 허용). 전망이 없을 때 쓰라고 지시한
  // "기사에서는 향후 방향을 구체적으로 제시하지 않았다." 같은 문장이 실제로
  // valid 처리되는지 확인 - 개수를 줄이는 대신 이런 답변으로 채우는 정책이
  // 실제로 통과하는지 보장한다.
  {
    const article = realArticle();
    const conservative = ['한국은행이 기준금리를 3.00%로 동결하기로 결정했다.', '시장 예상과 대체로 부합하는 결정이었다.', '기사에서는 향후 방향을 구체적으로 제시하지 않았다.'];
    assert.strictEqual(evaluateGeminiQna(conservative, article).valid, true, '전망이 없을 때 쓰는 사실 진술형 답변도 valid여야 한다');
  }

  // R4 (TEST 2/3 핵심). qnaDuplicatesBullets() - AI Summary bullet을 Q&A
  // 답변으로 그대로(정규화 후 완전 동일) 재사용한 경우만 true여야 하고,
  // 같은 사실을 다른 문장으로 설명하는 것(의미 일부 중복)은 걸리면 안 된다.
  {
    const bullets = ['한국은행이 기준금리를 3.00%로 동결했다.', 'CPI가 예상보다 높게 나오면 금리 인상 가능성이 커질 수 있다.'];
    assert.strictEqual(
      qnaDuplicatesBullets(['한국은행이 기준금리를 3.00%로 동결했다.'], bullets),
      true,
      'bullet과 완전히 동일한(공백/구두점 차이만 있는) 답변은 복붙으로 간주해야 한다'
    );
    assert.strictEqual(
      qnaDuplicatesBullets(['한국은행이   기준금리를 3.00%로 동결했다!'], bullets),
      true,
      '공백/문장부호 차이만 있는 사실상 동일한 문장도 복붙으로 간주해야 한다'
    );
    assert.strictEqual(
      qnaDuplicatesBullets(['8월 CPI 발표가 연준의 9월 금리 결정에 중요한 영향을 줄 수 있다.'], bullets),
      false,
      '같은 사실을 서로 다른 문장으로 설명하는 것은 복붙이 아니다 - 의미 중복 자체를 오류로 처리하면 안 된다'
    );
  }

  // Reused below: a valid, exactly-3-answer qna array (now mandatory - see
  // RESPONSE_SCHEMA.qna's minItems===maxItems===3 and evaluateGeminiQna()).
  const THREE_QNA_ANSWERS = [
    '시장에서는 이번 결정을 대체로 예상된 결과로 받아들였다.',
    '기준금리 동결 여부는 향후 통화정책 방향을 가늠하는 지표로 여겨진다.',
    '기사에서는 향후 방향을 구체적으로 제시하지 않았다.'
  ];

  // R5 (TEST 4/7). Gemini가 bullets와 qna(정확히 3개)를 모두 성공적으로
  // 생성하면, 둘 다 article에 독립적으로 반영되어야 한다.
  {
    const article = realArticle();
    const bullets = ['한국은행이 기준금리를 현 수준인 3.00%로 동결했다.'];
    global.fetch = async () => mockResponse(interactionsBody(bullets, THREE_QNA_ANSWERS));
    const stats = await enrichWithGemini([article]);
    assert.strictEqual(stats.generated, 1);
    assert.strictEqual(stats.qnaGenerated, 1);
    assert.strictEqual(article.summaryStatus, 'generated');
    assert.deepStrictEqual(article.aiSummary, bullets);
    assert.strictEqual(article.qna.length, 3, 'qna는 정확히 3개여야 한다');
    assert.deepStrictEqual(article.qna, QNA_QUESTIONS.map((q, i) => ({ q, a: THREE_QNA_ANSWERS[i] })));
  }

  // R6 (TEST 5/8 핵심 - 독립성). qna 3개 중 하나가 bullet을 그대로 복붙한
  // 경우 - bullets는 정상 사용되지만 qna 전체는 거부되어(article.qna는
  // 설정되지 않아 client가 buildSummary().qna로 fallback) "한쪽 실패가
  // 다른 쪽까지 끌고 내려가지 않는다"를 증명한다.
  {
    const article = realArticle();
    const bullets = ['한국은행이 기준금리를 현 수준인 3.00%로 동결했다.'];
    const qnaWithDuplicate = [bullets[0], THREE_QNA_ANSWERS[1], THREE_QNA_ANSWERS[2]];
    global.fetch = async () => mockResponse(interactionsBody(bullets, qnaWithDuplicate));
    const stats = await enrichWithGemini([article]);
    assert.strictEqual(stats.generated, 1, 'qna가 거부되어도 bullets는 그대로 사용되어야 한다');
    assert.strictEqual(article.summaryStatus, 'generated');
    assert.deepStrictEqual(article.aiSummary, bullets);
    assert.strictEqual(article.qna, undefined, 'bullet을 그대로 복사한 답변이 하나라도 섞인 qna는 반영되면 안 된다');
    assert.strictEqual(stats.qnaInvalid, 1);
    assert.strictEqual(stats.qnaInvalidReasons['duplicates-bullets'], 1);
  }

  // R6b (TEST 4). qna가 정확히 3개가 아니면(2개) 전체를 거부한다 - 개수를
  //줄여서 문제를 회피하는 예전 정책이 되살아나지 않았는지 확인한다.
  {
    const article = realArticle();
    const bullets = ['한국은행이 기준금리를 현 수준인 3.00%로 동결했다.'];
    global.fetch = async () => mockResponse(interactionsBody(bullets, THREE_QNA_ANSWERS.slice(0, 2)));
    const stats = await enrichWithGemini([article]);
    assert.strictEqual(article.qna, undefined, 'qna가 2개뿐이면 반영되면 안 된다');
    assert.strictEqual(stats.qnaInvalid, 1);
    assert.strictEqual(stats.qnaInvalidReasons['wrong-answer-count'], 1);
  }

  // R7 (TEST 8 핵심 - 독립성, 반대 방향). bullets는 무효(title echo)이지만
  // qna(정확히 3개)는 유효한 경우 - qna는 정상 반영되고, bullets 실패가
  // qna까지 막지 않는다는 것을 증명한다 (article.aiSummary/summaryStatus는
  // 여전히 fallback 상태로 남는다).
  {
    const article = realArticle();
    global.fetch = async () => mockResponse(interactionsBody([article.title], THREE_QNA_ANSWERS));
    const stats = await enrichWithGemini([article]);
    assert.strictEqual(stats.invalid, 1, 'title을 그대로 반복한 bullets는 invalid여야 한다');
    assert.strictEqual(article.summaryStatus, 'not_requested', 'bullets가 invalid면 AI Summary는 fallback 상태로 남아야 한다');
    assert.strictEqual(article.aiSummary, null);
    assert.strictEqual(stats.qnaGenerated, 1, 'bullets 실패와 무관하게 qna는 독립적으로 생성되어야 한다');
    assert.deepStrictEqual(article.qna, QNA_QUESTIONS.map((q, i) => ({ q, a: THREE_QNA_ANSWERS[i] })));
  }

  // R8 (하위 호환). qna 필드 자체가 없는 (기존 형태) 응답 - bullets는 기존과
  // 동일하게 동작하고, article.qna는 그대로 미설정 상태(fallback)로 남아야
  // 한다.
  {
    const article = realArticle();
    const bullets = ['한국은행이 기준금리를 현 수준인 3.00%로 동결했다.'];
    global.fetch = async () => mockResponse(interactionsBody(bullets)); // no qna field at all
    const stats = await enrichWithGemini([article]);
    assert.strictEqual(article.summaryStatus, 'generated');
    assert.deepStrictEqual(article.aiSummary, bullets);
    assert.strictEqual(article.qna, undefined);
    assert.strictEqual(stats.qnaGenerated, 0);
    assert.strictEqual(stats.qnaInvalid, 0, 'qna 필드가 아예 없는 것은 invalid로 집계하지 않는다 (그냥 생성되지 않은 것)');
  }

  // R9. 캐시된 결과는 bullets/qna(3개)를 함께 복원해야 한다 (한 번의 API
  // 호출 결과이므로 캐시도 한 쌍으로 저장/복원됨).
  {
    const sharedId = uid();
    const bullets = ['한국은행이 기준금리를 현 수준인 3.00%로 동결했다.'];
    global.fetch = async () => mockResponse(interactionsBody(bullets, THREE_QNA_ANSWERS));

    const first = realArticle({ id: sharedId });
    await enrichWithGemini([first]);

    const second = realArticle({ id: sharedId, aiSummary: null, summaryStatus: 'not_requested' });
    const stats2 = await enrichWithGemini([second]);
    assert.strictEqual(stats2.cacheHits, 1);
    assert.deepStrictEqual(second.aiSummary, bullets);
    assert.strictEqual(second.qna.length, 3);
    assert.deepStrictEqual(second.qna, QNA_QUESTIONS.map((q, i) => ({ q, a: THREE_QNA_ANSWERS[i] })), '캐시 히트에도 qna 3개가 함께 복원되어야 한다');
  }

  // R10 (TEST 2). Gemini가 지침을 어기고 답변 앞에 고정 질문을 그대로
  // 반복해서 반환해도, stripLeadingQuestionEcho()가 그 접두어만 제거한 뒤
  // 검증을 통과시켜야 한다 (오염된 q 필드가 그대로 새어나가는 대신, 정상
  // answer로 복구되어 사용됨).
  {
    const article = realArticle();
    const bullets = ['한국은행이 기준금리를 현 수준인 3.00%로 동결했다.'];
    const answersWithEcho = [
      QNA_QUESTIONS[0] + ' ' + THREE_QNA_ANSWERS[0],
      QNA_QUESTIONS[1] + ' ' + THREE_QNA_ANSWERS[1],
      THREE_QNA_ANSWERS[2]
    ];
    global.fetch = async () => mockResponse(interactionsBody(bullets, answersWithEcho));
    const stats = await enrichWithGemini([article]);
    assert.strictEqual(stats.qnaGenerated, 1, '질문이 답변 앞에 반복돼도 접두어만 제거하고 정상 처리되어야 한다');
    assert.deepStrictEqual(article.qna, QNA_QUESTIONS.map((q, i) => ({ q, a: THREE_QNA_ANSWERS[i] })), '최종 답변에는 반복된 질문 접두어가 남아있으면 안 된다');
  }

  global.fetch = originalFetch;
  console.log('gemini-summary.test.js: all assertions passed');
})().catch((err) => { global.fetch = originalFetch; console.error(err); process.exit(1); });
