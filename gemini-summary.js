/*
  Generates the real "AI 핵심 요약" bullets for article.html via the Google
  Gemini API - this REPLACES the previous template-only buildSummary()
  (assets/js/news-data.js) as the primary summary source. Gemini is an
  OPTIONAL enrichment layer on top of Google News RSS/NAVER, exactly like
  naver-enrichment.js and article-enrichment.js: it never adds, removes,
  reorders, or recategorizes articles, and every article keeps working
  normally (title/description/source/thumbnail/url) even if Gemini is
  unconfigured or fails outright.

  API: Gemini's newer "Interactions API" (POST /v1beta/interactions),
  called via plain REST fetch() - no @google/genai SDK, so this adds zero
  new npm dependencies. Auth is the x-goog-api-key HEADER (never a query
  string), so the key can never leak into a logged URL. If GEMINI_API_KEY
  is unset, enrichWithGemini() below returns immediately without making any
  network call - every article simply keeps summaryStatus:'not_requested'
  (normalizeArticle's existing default) and the client falls back to
  news-data.js's buildSummary() template, unchanged from before this file
  existed.

  Model: GEMINI_MODEL env var, defaulting to gemini-3.5-flash-lite - per
  ai.google.dev/gemini-api/docs/models this is documented as "the fastest
  and most cost-effective [Flash model] for high-throughput execution",
  which fits this task (summarizing 4 short fields into <=4 short bullets,
  no deep reasoning needed) better than the heavier gemini-3.8-flash also
  named in that same doc page. Never hardcoded elsewhere in this file.

  Hallucination defense (the actual point of this module, not an
  afterthought): the prompt explicitly bans invented facts/numbers/
  entities/causes/forecasts/investment advice and a fixed list of generic
  filler phrases (see BANNED_PHRASES). That alone is not trusted - every
  response is re-checked in code by evaluateGeminiSummary()/
  evaluateGeminiQna() before it's ever attached to an article: bullet count
  1-4 (qna: always exactly 3), no empty/duplicate/over-long items, no
  verbatim title echo, no verbatim full-description copy, none of the
  banned phrases, and no number in an item that doesn't literally appear
  somewhere in the article's own title+description. Any failure - network,
  invalid JSON, or a validation failure - falls back to the exact same
  deterministic template this project already had, not a worse ad-hoc
  summary.

  A call is skipped entirely (no network request) whenever the article's
  description isn't real content yet - the synthetic "{source} 보도"
  placeholder server.js generates before NAVER enrichment runs, or one
  NAVER left unmatched - so this never spends a paid API call summarizing
  a description that has no actual information in it.
*/

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
// Lowered from 2 to 1 after a real production run against the live Gemini
// API showed sustained 429s in 8/9 categories during a full 9-category
// warmup (each category's own enrichWithGemini() call shares this SAME
// module-level semaphore, so the real issue - confirmed by a 10-article
// sequential re-run having 0 errors - was request RATE from ~9 categories'
// worth of near-simultaneous first calls each racing for a slot, not the
// raw concurrency limit itself being violated). 1 plus the longer backoff
// below (the more direct fix for a per-minute quota) is the mitigation -
// same diagnosis/fix shape as naver-enrichment.js's own NAVER_CONCURRENCY
// 4->3 change after an analogous burst.
const GEMINI_CONCURRENCY = Number(process.env.GEMINI_CONCURRENCY) || 1;
const GEMINI_TIMEOUT_MS = 8000; // LLM generation is slower than a plain search API lookup
const GEMINI_BATCH_BUDGET_MS = 20000;
const GEMINI_FAILURE_RETRY_MS = 60 * 60 * 1000; // retry a transient API failure after an hour, not every refresh
const RETRY_DELAYS_MS = [2000, 5000]; // max 2 retries - lengthened from [800, 2000] to give a per-minute rate limit window an actual chance to clear
const MIN_DESCRIPTION_LENGTH = 20; // shorter than this isn't real content worth summarizing

const BANNED_PHRASES = [
  '관련 업계의 관심이 커지고 있습니다',
  '시장에 영향을 줄 것으로 예상됩니다',
  '향후 추이를 지켜볼 필요가 있습니다',
  '투자자들의 관심이 필요합니다',
  '전문가들은 주목하고 있습니다'
];

// Metadata leak patterns evaluateGeminiSummary() rejects a bullet for -
// these are exact tag/label SHAPES, never the bare underlying word (e.g.
// "출처" alone is never banned - only "[출처:"/"(출처:", the actual tag
// form), so a bullet that naturally uses one of these words in a real
// sentence is never wrongly flagged.
const METADATA_LEAK_PATTERNS = ['[출처:', '(출처:', '화면번호', '자료화면', '[사진=', '(사진='];

// The article page's Q&A block always asks exactly these 3 fixed questions
// (never "어디서 보도했나요?" or anything else) - Gemini is only ever asked
// for the 3 ANSWERS, in this fixed order, never for the question text
// itself, so there is no way for a model response to introduce a different
// or extra question.
const QNA_QUESTIONS = ['무슨 일이 있었나요?', '왜 중요한가요?', '앞으로 어떻게 될까요?'];

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    // 1-4: "3~4 for a well-covered article, fewer only when there's
    // genuinely not enough real content" - unlike qna below, bullets are
    // allowed to come back short rather than ever padding with invented
    // content.
    bullets: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 4
    },
    // Exactly one answer per QNA_QUESTIONS entry, same order, never the
    // question text itself (see QNA_QUESTIONS above). Deliberately asked for
    // in the SAME API call as `bullets` (one request, not two) so this adds
    // no extra network round trip, no change to GEMINI_CONCURRENCY/retry/
    // cache lifecycle - only the response shape grows. Fixed at exactly 3
    // (not "up to 3"): the page always shows all 3 fixed questions, so a
    // short/conservative factual answer (e.g. "no forecast is given") is
    // required instead of omitting a question - see buildPrompt() and
    // evaluateGeminiQna().
    qna: {
      type: 'array',
      items: { type: 'string' },
      minItems: 3,
      maxItems: 3
    }
  },
  required: ['bullets', 'qna']
};

// summaryCache is keyed by the article's own stable id (server.js's
// stableId(), a hash of link+title - unaffected by description/url being
// later upgraded by NAVER) so the SAME real-world article always hits the
// same cache entry across refreshes, even though the 8x/day Google RSS
// refresh reassigns fresh in-memory article objects each time.
const summaryCache = new Map();

// Strips broadcast/wire-service METADATA that sometimes rides along inside
// a NAVER/RSS description (source tags, on-air screen numbers, wire
// bylines, "as-of" broadcast time markers, labeled input/edit/transmission
// timestamps) before it's ever shown to Gemini - without this, Gemini has
// no way to tell that e.g. "(화면번호 6511)" isn't part of the actual news.
// Deliberately narrow, pattern-based removal only: it never strips a bare
// number/date/percentage that isn't attached to one of these label
// patterns, since those are very often real article content (기준금리
// 3.5%, 2026년 9월 11일, 코스피 2,500선 등) that must survive intact.
// This only affects the string built into the Gemini prompt - the
// article's own `description` field (used elsewhere, e.g. news-data.js's
// template fallback, and looksLikeRealDescription()'s own gating check) is
// never mutated.
function sanitizeDescriptionForSummary(description) {
  let text = String(description || '');

  // [출처: ...] / (출처: ...) - source tags. Only this exact tag shape is
  // removed - the bare word "출처" appearing naturally in a real sentence
  // is left untouched.
  text = text.replace(/\[출처\s*[:：][^\]]*\]/g, ' ');
  text = text.replace(/\(출처\s*[:：][^)]*\)/g, ' ');
  // [사진=...] / (사진=...) - photo credits
  text = text.replace(/\[사진\s*=[^\]]*\]/g, ' ');
  text = text.replace(/\(사진\s*=[^)]*\)/g, ' ');
  // (화면번호 1234) / 화면번호 1234 - on-air screen numbers, bracketed or bare
  text = text.replace(/[([]?화면번호\s*\d+[)\]]?/g, ' ');
  // 자료화면 - stock/archive footage marker
  text = text.replace(/자료화면/g, ' ');
  // [앵커]/[기자]/[리포트]/[출연]/[스튜디오] - broadcast-transcript role tags,
  // never real article content.
  text = text.replace(/\[(앵커|기자|리포트|출연|스튜디오)\]/g, ' ');
  // Wire-service bylines: "이름 기자 = " / "이름 특파원 = " - the trailing
  // "=" is the actual byline marker, so this never touches "기자"/"특파원"
  // appearing as ordinary content elsewhere in a sentence.
  text = text.replace(/[가-힣]{2,4}\s*(기자|특파원)\s*=\s*/g, ' ');
  // 입력/수정/전송/송고 timestamps: "입력 2026.09.11. 오후 12:46" 등
  text = text.replace(/(입력|수정|전송|송고)\s*(시간|일시)?\s*[:：]?\s*\d{4}[.\-]\s*\d{1,2}[.\-]\s*\d{1,2}\.?\s*(오전|오후)?\s*\d{1,2}[:시]\s*\d{1,2}분?/g, ' ');
  // Broadcast "as-of" time markers: "오후 12시 46분 현재" / "오전 10시 현재" -
  // only the time-then-현재 construction, never bare "현재" on its own
  // (which very often IS real content, e.g. "현재 진행 중인 협상").
  text = text.replace(/(오전|오후)?\s*\d{1,2}시\s*(\d{1,2}분)?\s*현재/g, ' ');
  text = text.replace(/현재\s*시각/g, ' ');
  text = stripEllipsisMarkers(text);

  return text.replace(/\s{2,}/g, ' ').trim();
}

// Removes only the literal "..."/"…" GLYPH itself - never any surrounding
// real text, before or after it. NAVER search-snippet descriptions are
// often cut off with a trailing "..."/"…", but an earlier version of this
// function treated the ellipsis as a hard boundary and DROPPED everything
// from the first one onward (even judging whether the leftover fragment
// "looked like a complete sentence") - in production this deleted large
// amounts of real article content (a regression reported and reverted).
// The ellipsis is just an "omission" marker from NAVER's snippet, not a
// signal that anything past it is untrustworthy, so the fix is to strip
// only the marker and let the rest of the pipeline (buildPrompt()'s own
// instruction tells Gemini not to treat it as content; the same fragment
// with no closing punctuation is handled exactly like any other
// description that doesn't end in a period) work on the fully-preserved
// text.
function stripEllipsisMarkers(text) {
  return text.replace(/\.{3,}|…/g, ' ');
}

function looksLikeRealDescription(article) {
  const desc = String((article && article.description) || '').trim();
  if (!desc) return false;
  // The exact synthetic placeholder server.js's mapRssItemToProviderShape()
  // generates before NAVER enrichment runs (and NAVER leaves in place for
  // any article it couldn't confidently match) - literally just "{source}
  // 보도", zero real information to summarize.
  if (article.source && desc === `${article.source} 보도`) return false;
  if (desc.length < MIN_DESCRIPTION_LENGTH) return false;
  return true;
}

function buildPrompt(article) {
  const sanitizedDescription = sanitizeDescriptionForSummary(article.description);
  return [
    '너는 뉴스 기사의 핵심 내용을 요약하는 AI다.',
    '입력으로 제공되는 title과 description을 바탕으로 기사 전체의 핵심 내용을 자연스러운 한국어 문장으로 요약하라.',
    '반드시 실제 기사 내용만 요약해야 한다.',
    '',
    '이 결과는 Q&A 답변이 아니다. 사용자가 별도로 "무슨 일이 있었나요?", "왜 중요한가요?", "앞으로 어떻게 될까요?"라는 개별 질문에 대한 답변을 따로 보게 된다 - 지금 작성하는 것은 그 답변들을 각각 흉내 내거나 나열한 것이 아니라, 기사 전체를 읽고 전체 맥락을 하나로 엮은 독립적인 요약이어야 한다.',
    '단순히 description 문장 하나씩을 순서대로 bullet에 옮기지 마라. 사건, 원인, 영향, 전망 등 서로 다른 정보를 유기적으로 연결해 각 문장이 서로 다른 핵심 정보를 담도록 재구성하라.',
    '',
    '요약에 포함할 수 있는 내용:',
    '- 실제로 발생한 사건',
    '- 주요 사실',
    '- 기사에 명시된 수치',
    '- 주요 인물이나 기관의 발언',
    '- 기사에서 설명하는 원인',
    '- 기사에서 설명하는 영향',
    '- 기사에서 제시하는 전망',
    '',
    '다음 정보는 기사 핵심 내용으로 간주하지 말고 요약에서 반드시 제외하라:',
    '- [출처: ...]와 같은 출처 태그',
    '- (출처: ...)와 같은 출처 표기',
    '- 기자명, 기자 작성 표기',
    '- 화면번호',
    '- 자료화면',
    '- 사진 크레딧',
    '- 방송 송출용 현재 시각 (예: "오후 12시 46분 현재")',
    '- 입력/수정/전송 시각',
    '- 검색 시스템이나 방송 시스템에서 사용하는 메타데이터',
    '특히 "화면번호 6511", "자료화면", "[출처: 연합뉴스]", "오후 12시 46분 현재" 같은 정보는 기사의 핵심 내용이 아니므로 절대 요약하지 마라.',
    '',
    'description은 검색 스니펫이라 문장 중간이나 끝에 "..." 또는 "…" 표시가 있을 수 있다. 이 표시는 일부 내용이 생략되었다는 뜻일 뿐 기사의 실제 내용이 아니다. 이 경우를 반드시 지켜라:',
    '- 최종 요약에 "..." 또는 "…" 기호 자체를 절대 출력하지 마라.',
    '- "..." 표시 앞뒤로 실제로 제공된 내용은 전부 활용해서 자연스럽고 완결된 문장으로 다시 써라 - "..." 뒤에도 실제 내용이 이어진다면 그 내용까지 요약에서 임의로 빼지 마라.',
    '- "..." 때문에 생략된 부분이 무엇이었을지 추측하거나 새로 만들어내지 마라.',
    '- 검색 시스템의 생략 표시일 뿐인 "..." 기호 자체를 문장의 일부처럼 그대로 베끼지 마라.',
    '다음처럼 "..."/"…" 기호 자체가 문장에 그대로 남아있는 결과는 절대 생성하지 마라: "연준은 금리 인상 가능성을...", "시장은 향후...", "유가는 상승세를 보이며...".',
    '',
    '절대 규칙 (반드시 지킬 것):',
    '- title/description/category/source에 없는 사실이나 해석을 추가하지 마세요.',
    '- 새로운 숫자를 만들지 마세요.',
    '- 새로운 기업명/기관명/인물명/정책명을 만들지 마세요. 원문에 있는 숫자·기업명·인물명·정책명은 최대한 정확하게 유지하세요.',
    '- 기사에 없는 원인을 추론하지 마세요.',
    '- 기사에 없는 전망을 만들지 마세요.',
    '- 투자 판단을 하지 마세요.',
    '- "~할 것으로 보인다"처럼 근거 없는 전망 문장을 만들지 마세요.',
    '- description이 짧으면 짧은 만큼만 요약하세요. 정보가 부족하면 bullet 수를 줄이세요.',
    '- 빈 정보를 일반론으로 채우지 마세요.',
    '- 다음 상투적인 문장은 절대 사용하지 마세요: ' + BANNED_PHRASES.map((p) => '"' + p + '"').join(', ') + '.',
    '- title을 그대로 반복하거나, title을 문장 형태로만 바꾼 결과를 만들지 마세요.',
    '- description을 그대로 복사하지 말고, 의미를 이해해서 요약하세요.',
    '- bullet끼리 같은 내용을 반복하지 마세요.',
    '- "무슨 일", "왜 중요", "핵심 포인트", "앞으로 어떻게" 같은 라벨이나 질문 형태로 나누어 쓰지 마세요. 각 bullet은 하나의 기사 내용을 자연스럽게 이어가는 서로 다른 문장이어야 합니다.',
    '- 불필요한 배경 설명, 반복되는 내용, 과장된 수식어는 넣지 마세요.',
    '',
    '목표: 사용자가 제목과 이 요약만 보고 5~10초 안에 "무슨 뉴스인지" 이해하게 만드는 것입니다.',
    '단순 축약이 아니라, 제공된 텍스트 안에서 가장 중요한 사실과 변화를 선별해 재구성하세요.',
    '뉴스를 처음 접하는 사람도 bullet만 읽고 전체 내용을 이해할 수 있도록, 각 문장의 핵심 주어와 내용이 명확하게 드러나야 합니다.',
    '',
    '출력 규칙: 실질적인 기사 내용이 충분하면 3~4개의 문장으로 작성하고, 부족하면 1~2개로 작성하세요(최대 4개, 절대 5개 이상 금지).',
    '각 bullet(문장)은 독립적으로 읽어도 자연스러워야 하며, 너무 길지 않아야 합니다. 빈 bullet은 만들지 마세요.',
    '4개를 채우기 위해 정보가 부족한데도 억지로 채우거나 없는 내용을 지어내면 안 됩니다 - 이 경우 적은 개수만 반환하세요.',
    '',
    '이제 위 bullets(AI 핵심 요약)와는 별개로, qna라는 두 번째 결과도 반드시 정확히 3개 작성하라. 2개나 1개는 절대 허용되지 않는다 - 정보가 부족해도 개수를 줄이지 말고, 아래 3번 지침대로 짧고 보수적인 답변으로 채워라.',
    'qna는 독자가 이 기사에 대해 가질 법한 질문에 직접 답하는, bullets와는 다른 역할의 콘텐츠다. 아래 고정된 3개 질문 순서대로 답변만 작성하라 (질문 문장 자체는 절대 포함하지 말고, 답변 문자열만 배열에 담아라 - 이미 정해진 질문을 답변 앞에 그대로 반복해서 적지 마라):',
    '1. ' + QNA_QUESTIONS[0] + ' -> 기사에서 실제로 일어난 사건 자체를 설명하라.',
    '2. ' + QNA_QUESTIONS[1] + ' -> 그 사건이 왜 중요한지, 어떤 의미가 있는지 설명하라.',
    '3. ' + QNA_QUESTIONS[2] + ' -> 기사에 명시된 전망이나 영향을 설명하라. 기사에 구체적인 전망이 없으면, 없는 전망을 지어내지 말고 "기사에서는 향후 방향을 구체적으로 제시하지 않았다."처럼 사실 그대로를 짧게 답하라 - 이 경우에도 답변 자체는 반드시 작성해야 하며 항목을 생략하면 안 된다.',
    '',
    'qna 작성 시 반드시 지킬 것:',
    '- qna는 반드시 정확히 3개를 작성한다. "정보가 부족하다"는 이유로 항목 수를 줄이지 마라 - 대신 그 항목의 답변 내용 자체를 위 3번 지침처럼 짧고 보수적인 사실 진술로 작성하라.',
    '- qna의 각 답변은 bullets의 문장을 그대로 복사하거나, 단어 몇 개만 바꾼 것이어서는 안 된다. bullets는 기사 전체를 종합한 요약이고, qna는 그 질문 하나에만 집중해서 답하는 것이므로 서술 방식과 초점이 달라야 한다.',
    '- 같은 사실을 언급하는 것 자체는 괜찮다 (예: bullets와 "왜 중요한가요?" 답변이 같은 사실을 근거로 들 수 있다). 다만 문장 전체를 거의 그대로 재사용하지 마라.',
    '- qna에도 위의 절대 규칙(없는 사실/숫자/기업명/전망 추가 금지, "..."/"…" 기호 금지, 상투 문구 금지, description 그대로 복사 금지)이 동일하게 적용된다.',
    '- "앞으로 어떻게 될까요?"에 기사에 실제 전망이 없으면 미래를 임의로 예측하거나 지어내지 말고, 전망이 제시되지 않았다는 사실 자체를 답변으로 써라.',
    '',
    '기사 정보:',
    'title: ' + (article.title || ''),
    'description: ' + sanitizedDescription,
    'category: ' + (article.category || ''),
    'source: ' + (article.source || '')
  ].join('\n');
}

// Best-effort extraction of the model's JSON text out of the Interactions
// API response (ai.google.dev/gemini-api/docs/get-started: generated text
// lives at steps[].content[].text where the step's type is "model_output";
// response_format.mime_type:"application/json" makes that text a JSON
// string matching RESPONSE_SCHEMA). A couple of defensive fallbacks are
// checked too in case the deployed API's exact response shape differs -
// none of this is trusted blindly either way, since evaluateGeminiSummary()
// re-validates whatever comes out before it's ever used.
// Shared by extractBulletsFromResponse() and extractQnaAnswersFromResponse()
// below - both fields live in the SAME single API response/JSON object (one
// request produces both bullets and qna together), so the text-location and
// JSON.parse steps only need to happen once.
function extractParsedJsonFromResponse(body) {
  let text = null;
  if (body && Array.isArray(body.steps)) {
    for (const step of body.steps) {
      if (step && step.type === 'model_output' && Array.isArray(step.content)) {
        const part = step.content.find((c) => c && c.type === 'text' && typeof c.text === 'string');
        if (part) { text = part.text; break; }
      }
    }
  }
  if (text === null && typeof (body && body.output_text) === 'string') text = body.output_text;
  if (text === null && body && (Array.isArray(body.bullets) || Array.isArray(body.qna))) return body;
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function extractBulletsFromResponse(body) {
  const parsed = extractParsedJsonFromResponse(body);
  return parsed && Array.isArray(parsed.bullets) ? parsed.bullets : null;
}

function extractQnaAnswersFromResponse(body) {
  const parsed = extractParsedJsonFromResponse(body);
  return parsed && Array.isArray(parsed.qna) ? parsed.qna : null;
}

// Defense-in-depth against the prompt's "don't split into 무슨 일/왜 중요/
// 핵심 포인트" instruction being ignored: strips a literal leading label of
// that shape from a bullet before it's validated/used, rather than
// rejecting (and wasting) an otherwise-good, non-hallucinated bullet.
const ROLE_LABEL_PREFIX_RE = /^(무슨\s*일|왜\s*중요|핵심\s*포인트)\s*[:：]\s*/;
function stripRoleLabelPrefix(text) {
  return String(text || '').replace(ROLE_LABEL_PREFIX_RE, '');
}

function normalizeForCompare(text) {
  return String(text || '').replace(/[.!?]+$/, '').replace(/\s+/g, '').toLowerCase();
}
function extractNumbers(text) {
  return String(text || '').match(/\d+(\.\d+)?/g) || [];
}

// Re-validates a Gemini response in code - the actual hallucination guard,
// not just the prompt instructions. Pure (no network/mutation), so it's
// directly unit-testable with synthetic item arrays. Returns the FIRST
// violation found (not a full list) since any single violation is enough to
// reject the whole array and fall back. Content-only (no length-range
// check) - evaluateGeminiSummary() and evaluateGeminiQna() below each apply
// their OWN count rule first (bullets: 1-4, allowed to come back short; qna:
// always exactly 3, never short) before delegating here for the shared
// per-item checks (grounded in the article's own title/description, no
// hallucinated numbers/entities, no banned phrases, no ellipsis, no empty/
// duplicate/over-long items).
function evaluateTextItemContents(items, article) {
  const titleNorm = normalizeForCompare(article.title);
  const descNorm = normalizeForCompare(article.description);
  const sourceText = String(article.title || '') + ' ' + String(article.description || '');
  const seen = new Set();
  for (const raw of items) {
    if (typeof raw !== 'string') return { valid: false, reason: 'non-string-bullet' };
    const text = raw.trim();
    if (!text) return { valid: false, reason: 'empty-bullet' };
    if (text.length > 200) return { valid: false, reason: 'bullet-too-long' };
    const norm = normalizeForCompare(text);
    if (norm === titleNorm) return { valid: false, reason: 'title-echo' };
    if (norm === descNorm) return { valid: false, reason: 'description-copy' };
    if (seen.has(norm)) return { valid: false, reason: 'duplicate-bullet' };
    seen.add(norm);
    for (const phrase of BANNED_PHRASES) {
      if (text.indexOf(phrase) !== -1) return { valid: false, reason: 'banned-phrase' };
    }
    for (const pattern of METADATA_LEAK_PATTERNS) {
      if (text.indexOf(pattern) !== -1) return { valid: false, reason: 'metadata-leak' };
    }
    // A NAVER search-snippet ellipsis ("..."/"…") that survived sanitization
    // and the prompt instruction means the item is an unfinished sentence -
    // reject outright rather than string-slicing off the "..." (that would
    // just leave a different, still-arbitrary cut point - see gemini-summary.js
    // module comment). The normal retry/fallback policy takes over instead.
    if (/\.{3,}|…/.test(text)) return { valid: false, reason: 'ellipsis' };
    for (const n of extractNumbers(text)) {
      if (sourceText.indexOf(n) === -1) return { valid: false, reason: 'unknown-number' };
    }
  }
  return { valid: true };
}

function evaluateGeminiSummary(bullets, article) {
  if (!Array.isArray(bullets) || !bullets.length) return { valid: false, reason: 'empty' };
  if (bullets.length > 4) return { valid: false, reason: 'too-many-bullets' };
  return evaluateTextItemContents(bullets, article);
}

// Q&A answers get every content rule evaluateGeminiSummary() enforces on
// bullets (grounded in the article's own title/description, no
// hallucinated numbers/entities, no banned phrases, no ellipsis, no empty/
// duplicate/over-long items), but the COUNT rule is different and stricter:
// exactly 3, never fewer - the page always shows all 3 fixed questions, so
// a short/conservative factual answer (per buildPrompt()'s own instruction)
// is required instead of ever omitting one.
function evaluateGeminiQna(qnaAnswers, article) {
  if (!Array.isArray(qnaAnswers) || !qnaAnswers.length) return { valid: false, reason: 'empty' };
  if (qnaAnswers.length !== QNA_QUESTIONS.length) return { valid: false, reason: 'wrong-answer-count' };
  return evaluateTextItemContents(qnaAnswers, article);
}

// Defense-in-depth against a qna answer echoing its own fixed question text
// back (despite the prompt's explicit "질문 문장 자체는 절대 포함하지 말라"
// instruction) - strips an exact leading echo of QNA_QUESTIONS[i] before the
// answer is validated/used, the same "fix rather than waste an otherwise-
// good answer" policy stripRoleLabelPrefix() already applies to bullets.
function stripLeadingQuestionEcho(text, question) {
  const t = String(text || '');
  const q = String(question || '');
  if (q && t.indexOf(q) === 0) {
    return t.slice(q.length).replace(/^[\s:：\-]+/, '');
  }
  return t;
}

// Final structural gate on the {q, a} pairs actually about to be attached to
// an article, checked right before caching/assigning (see enrichOne()
// below) - independent of, and in addition to, evaluateGeminiQna()'s
// content checks above. Catches the exact shape of corruption a q/a pair
// must never have: a missing/blank answer, a question label that doesn't
// match the fixed QNA_QUESTIONS constant at that position (q is always
// assigned FROM that constant in this module, never from the model, so this
// should be unreachable in practice - this exists purely as a safety net,
// not because that construction is expected to fail), or an answer that's
// just the question restated.
function isValidQnaPairsShape(pairs) {
  if (!Array.isArray(pairs) || pairs.length !== QNA_QUESTIONS.length) return false;
  return pairs.every((pair, i) => {
    if (!pair || typeof pair.q !== 'string' || typeof pair.a !== 'string') return false;
    if (pair.q !== QNA_QUESTIONS[i]) return false;
    const answer = pair.a.trim();
    if (!answer) return false;
    if (normalizeForCompare(answer) === normalizeForCompare(pair.q)) return false;
    return true;
  });
}

// The one rule that's specific to the qna/bullets PAIR rather than either
// array in isolation: a qna answer that (once whitespace/punctuation/case
// differences are normalized away) is identical to one of the AI summary
// bullets is exactly the "AI Summary copy-pasted into Q&A" bug this module
// exists to prevent - reject the offending answer's role (qna, not the
// bullets, since the bullets are the primary "AI 핵심 요약") and let the
// normal Q&A fallback (news-data.js buildSummary()) take over for this
// article instead. A qna answer covering the SAME underlying fact as a
// bullet in different words is expected and fine - this only catches a
// near-verbatim copy, not topical overlap.
function qnaDuplicatesBullets(qnaAnswers, bullets) {
  if (!Array.isArray(qnaAnswers) || !Array.isArray(bullets)) return false;
  const bulletNorms = bullets.map(normalizeForCompare);
  return qnaAnswers.some((a) => bulletNorms.indexOf(normalizeForCompare(a)) !== -1);
}

// --- shared concurrency limiter (same pattern as naver-enrichment.js) -----
let activeSlots = 0;
let peakActiveSlots = 0;
const waiters = [];
function acquireSlot() {
  if (activeSlots < GEMINI_CONCURRENCY) {
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
function getPeakConcurrency() { return peakActiveSlots; }
function resetPeakConcurrency() { peakActiveSlots = activeSlots; }

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Single attempt, no retry - classifies the failure so the caller can
// decide whether it's worth retrying (429/5xx/timeout/network) or not
// (4xx/no-credentials/parse-error - repeating an invalid request or a
// malformed response can't be fixed by asking again).
async function callGeminiOnce(article) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, errorType: 'no-credentials' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(GEMINI_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        input: buildPrompt(article),
        response_format: { type: 'text', mime_type: 'application/json', schema: RESPONSE_SCHEMA }
      })
    });
    if (res.status === 429) return { ok: false, status: 429, errorType: '429' };
    if (res.status >= 500) return { ok: false, status: res.status, errorType: '5xx' };
    if (!res.ok) return { ok: false, status: res.status, errorType: '4xx' };
    const body = await res.json();
    const rawBullets = extractBulletsFromResponse(body);
    if (!rawBullets) return { ok: false, errorType: 'parse-error' };
    const bullets = rawBullets.map((b) => (typeof b === 'string' ? stripRoleLabelPrefix(b) : b));
    // qna is best-effort within an otherwise-successful call: an older/
    // differently-shaped response with no `qna` field at all (or one that
    // fails validation later) must never invalidate the bullets above - it
    // only means article.qna stays unset and the client falls back to
    // buildSummary()'s own qna for this article, exactly as if Gemini were
    // never configured for Q&A at all.
    const rawQna = extractQnaAnswersFromResponse(body);
    const qnaAnswers = Array.isArray(rawQna)
      ? rawQna.map((a, i) => (typeof a === 'string' ? stripLeadingQuestionEcho(stripRoleLabelPrefix(a), QNA_QUESTIONS[i]) : a))
      : null;
    return { ok: true, bullets, qnaAnswers };
  } catch (e) {
    return { ok: false, errorType: e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

async function callGeminiWithRetry(article, stats) {
  let result = await callGeminiOnce(article);
  for (let attempt = 0; !result.ok && attempt < RETRY_DELAYS_MS.length; attempt++) {
    const retryable = result.errorType === '429' || result.errorType === '5xx' || result.errorType === 'timeout' || result.errorType === 'network';
    if (!retryable) break;
    if (stats) stats.retries += 1;
    await sleep(RETRY_DELAYS_MS[attempt]);
    result = await callGeminiOnce(article);
  }
  return result;
}

function getCached(id) {
  const entry = summaryCache.get(id);
  if (!entry) return undefined;
  if (entry.apiFailed && Date.now() - entry.cachedAt > GEMINI_FAILURE_RETRY_MS) return undefined; // allow a retry
  return entry; // { bullets, qna } on a generated+validated call, either field null on its own non-generation
}

// Returns { bullets, qna } - bullets is the AI Summary array (or null),
// qna is an array of { q, a } pairs built from QNA_QUESTIONS (or null).
// The two are validated and populated completely independently of each
// other (see evaluateGeminiSummary()/evaluateGeminiQna() above): a bad/
// missing qna never discards otherwise-valid bullets, and vice versa - one
// Gemini call can partially succeed.
async function enrichOne(article, stats) {
  const cached = getCached(article.id);
  if (cached !== undefined) {
    stats.cacheHits += 1;
    return cached;
  }
  if (!looksLikeRealDescription(article)) {
    stats.skipped += 1;
    const entry = { bullets: null, qna: null, apiFailed: false, cachedAt: Date.now() };
    summaryCache.set(article.id, entry);
    return entry;
  }
  await acquireSlot();
  try {
    const result = await callGeminiWithRetry(article, stats);
    if (!result.ok) {
      stats.apiErrors += 1;
      stats.errorsByType[result.errorType] = (stats.errorsByType[result.errorType] || 0) + 1;
      const transient = result.errorType === '429' || result.errorType === '5xx' || result.errorType === 'timeout' || result.errorType === 'network';
      const entry = { bullets: null, qna: null, apiFailed: transient, cachedAt: Date.now() };
      summaryCache.set(article.id, entry);
      return entry;
    }

    const bulletsEvaluation = evaluateGeminiSummary(result.bullets, article);
    let validBullets = null;
    if (bulletsEvaluation.valid) {
      validBullets = result.bullets;
      stats.generated += 1;
    } else {
      stats.invalid += 1;
      stats.invalidReasons[bulletsEvaluation.reason] = (stats.invalidReasons[bulletsEvaluation.reason] || 0) + 1;
    }

    let validQna = null;
    if (result.qnaAnswers) {
      const qnaEvaluation = evaluateGeminiQna(result.qnaAnswers, article);
      if (!qnaEvaluation.valid) {
        stats.qnaInvalid += 1;
        stats.qnaInvalidReasons[qnaEvaluation.reason] = (stats.qnaInvalidReasons[qnaEvaluation.reason] || 0) + 1;
      } else if (validBullets && qnaDuplicatesBullets(result.qnaAnswers, validBullets)) {
        // The one cross-array check: an otherwise-valid qna answer that's
        // near-verbatim identical to a bullet is the exact "AI Summary
        // copy-pasted into Q&A" bug this whole feature exists to prevent.
        stats.qnaInvalid += 1;
        stats.qnaInvalidReasons['duplicates-bullets'] = (stats.qnaInvalidReasons['duplicates-bullets'] || 0) + 1;
      } else {
        const pairs = result.qnaAnswers.map((a, i) => ({ q: QNA_QUESTIONS[i], a }));
        // Final safety net, independent of evaluateGeminiQna() above (see
        // isValidQnaPairsShape()'s own comment) - should be unreachable
        // given q is always assigned from QNA_QUESTIONS right here, never
        // from the model, but guards against exactly the "q/a merged or
        // mismatched" shape of corruption regardless of how it could arise.
        if (isValidQnaPairsShape(pairs)) {
          validQna = pairs;
          stats.qnaGenerated += 1;
        } else {
          stats.qnaInvalid += 1;
          stats.qnaInvalidReasons['malformed-pair-shape'] = (stats.qnaInvalidReasons['malformed-pair-shape'] || 0) + 1;
        }
      }
    }

    const entry = { bullets: validBullets, qna: validQna, apiFailed: false, cachedAt: Date.now() };
    summaryCache.set(article.id, entry);
    return entry;
  } finally {
    releaseSlot();
  }
}

// Mutates and returns `articles` in place: only a generated+validated
// summary ever sets article.aiSummary/summaryStatus, and only a generated+
// validated (and non-duplicate) qna ever sets article.qna - everything else
// (skipped, API error, invalid response, not configured) leaves those
// fields exactly as normalizeArticle() already set them
// (null/null/'not_requested'), so the client's existing template fallback
// (news-data.js buildSummary(), used for whichever of the two pieces didn't
// come from Gemini) takes over with zero special-casing needed there.
// Returns summary counts for logging (never article content, never the API
// key).
async function enrichWithGemini(articles) {
  const stats = {
    total: articles.length, generated: 0, skipped: 0, invalid: 0, apiErrors: 0, cacheHits: 0, retries: 0,
    errorsByType: {}, invalidReasons: {},
    qnaGenerated: 0, qnaInvalid: 0, qnaInvalidReasons: {}
  };
  if (!process.env.GEMINI_API_KEY) return stats; // optional provider, not configured - silently skip, no network call at all
  const batchStart = Date.now();
  let cursor = 0;
  async function worker() {
    while (cursor < articles.length) {
      if (Date.now() - batchStart > GEMINI_BATCH_BUDGET_MS) return;
      const article = articles[cursor++];
      if (!article || !article.id) continue;
      const result = await enrichOne(article, stats);
      if (result.bullets) {
        article.aiSummary = result.bullets;
        article.summaryStatus = 'generated';
      }
      if (result.qna) {
        article.qna = result.qna;
      }
    }
  }
  const workerCount = Math.min(GEMINI_CONCURRENCY, articles.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return stats;
}

module.exports = {
  enrichWithGemini,
  evaluateGeminiSummary,
  evaluateGeminiQna,
  qnaDuplicatesBullets,
  isValidQnaPairsShape,
  stripLeadingQuestionEcho,
  looksLikeRealDescription,
  sanitizeDescriptionForSummary,
  stripEllipsisMarkers,
  buildPrompt,
  extractBulletsFromResponse,
  extractQnaAnswersFromResponse,
  stripRoleLabelPrefix,
  getPeakConcurrency,
  resetPeakConcurrency,
  GEMINI_MODEL,
  GEMINI_CONCURRENCY,
  QNA_QUESTIONS
};
