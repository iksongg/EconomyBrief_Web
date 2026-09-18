/*
  Manual, human-run real-API quality check for gemini-summary.js - NOT part
  of the automated test suite (tests/*.test.js never call the real Gemini
  API). This script:
    1. Fetches real, currently-live articles from this project's own
       running server (http://localhost:<PORT>/api/news) - real Google
       RSS/NAVER title/description/category/source, never fabricated data.
    2. Calls the real Gemini API (via gemini-summary.js) on a sample of
       them, timing each call.
    3. Reports, per article: title-copy check, description-copy check,
       bullet count, hallucination-guard result, and the full bullets
       generated - plus aggregate average response time and success rate.

  Requirements to actually run this:
    - `node server.js` running in another terminal (this script only reads
      from it over HTTP, never starts/stops it).
    - .env's GEMINI_API_KEY populated with a real key.
  If either is missing, this prints a clear message and exits - it never
  prompts for a key and never fabricates a result.

  The API key itself is NEVER printed, logged, or written anywhere by this
  script - gemini-summary.js only ever reads it from process.env internally
  each real API call.

  Usage:
    node scripts/verify-gemini.js [sampleSize] [serverBaseUrl]
    node scripts/verify-gemini.js 10 http://localhost:4173
*/
require('../server'); // side effect only: loads .env into process.env (server.js's require.main guard means this never starts listening or the scheduler)
const { enrichWithGemini, evaluateGeminiSummary, looksLikeRealDescription } = require('../gemini-summary');

const SAMPLE_SIZE = Number(process.argv[2]) || 10;
const BASE_URL = process.argv[3] || `http://localhost:${process.env.PORT || 4173}`;

function isSameAsTitle(bullet, title) {
  const norm = (s) => String(s || '').replace(/[.!?]+$/, '').replace(/\s+/g, '');
  return norm(bullet) === norm(title);
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.log('[verify-gemini] GEMINI_API_KEY가 .env에 설정되어 있지 않습니다. 실제 키를 .env에 채운 뒤 다시 실행하세요.');
    console.log('[verify-gemini] (이 스크립트는 키를 요구하거나 출력하지 않습니다 - .env에서 직접 읽습니다.)');
    process.exit(0);
  }

  let body;
  try {
    const res = await fetch(`${BASE_URL}/api/news?category=all`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    body = await res.json();
  } catch (e) {
    console.log('[verify-gemini] 서버에서 실제 기사를 가져오지 못했습니다: ' + e.message);
    console.log('[verify-gemini] 다른 터미널에서 `node server.js`를 먼저 실행한 뒤 다시 시도하세요.');
    process.exit(1);
  }

  const candidates = (body.articles || []).filter((a) => looksLikeRealDescription(a));
  if (!candidates.length) {
    console.log('[verify-gemini] 요약할 만한 실제 description을 가진 기사가 없습니다 (전부 "{source} 보도" fallback이거나 너무 짧음).');
    process.exit(0);
  }
  const sample = candidates.slice(0, SAMPLE_SIZE);
  console.log(`[verify-gemini] 실제 기사 ${sample.length}건으로 Gemini 실측을 시작합니다 (모델: ${require('../gemini-summary').GEMINI_MODEL}).`);

  const results = [];
  for (const article of sample) {
    // Fresh temporary id per run avoids gemini-summary.js's own permanent
    // cache short-circuiting repeated manual runs against the same article.
    const probe = Object.assign({}, article, { id: 'verify-' + article.id + '-' + Date.now() + '-' + Math.random().toString(36).slice(2) });
    const startedAt = Date.now();
    const stats = await enrichWithGemini([probe]);
    const elapsedMs = Date.now() - startedAt;
    results.push({ article: probe, stats, elapsedMs, success: probe.summaryStatus === 'generated' });
  }

  console.log('');
  results.forEach((r, i) => {
    console.log(`--- [${i + 1}] ${r.article.title}`);
    console.log(`    category=${r.article.category} source=${r.article.source} elapsed=${r.elapsedMs}ms`);
    if (r.success) {
      const bullets = r.article.aiSummary;
      const titleCopy = bullets.some((b) => isSameAsTitle(b, r.article.title));
      const descCopy = bullets.some((b) => b.trim() === r.article.description.trim());
      const revalidated = evaluateGeminiSummary(bullets, r.article);
      console.log(`    결과: 성공 (bullets=${bullets.length}개)`);
      bullets.forEach((b, bi) => console.log(`      ${bi + 1}. ${b}`));
      console.log(`    title 복사 여부: ${titleCopy ? '예 (문제)' : '아니오'}`);
      console.log(`    description 복사 여부: ${descCopy ? '예 (문제)' : '아니오'}`);
      console.log(`    hallucination guard 재검증: ${revalidated.valid ? '통과' : '실패(' + revalidated.reason + ')'}`);
    } else {
      console.log(`    결과: 실패/fallback (invalid=${r.stats.invalid} apiErrors=${r.stats.apiErrors} skipped=${r.stats.skipped} errorsByType=${JSON.stringify(r.stats.errorsByType)} invalidReasons=${JSON.stringify(r.stats.invalidReasons)})`);
    }
    console.log('');
  });

  const successCount = results.filter((r) => r.success).length;
  const avgMs = Math.round(results.reduce((sum, r) => sum + r.elapsedMs, 0) / results.length);
  console.log('=== 요약 ===');
  console.log(`표본 수: ${results.length}`);
  console.log(`성공(실제 Gemini summary 생성): ${successCount} / ${results.length} (${Math.round((successCount / results.length) * 100)}%)`);
  console.log(`평균 응답 시간: ${avgMs}ms`);
  console.log('(API key는 이 출력 어디에도 포함되어 있지 않습니다.)');
}

main().catch((e) => { console.error('[verify-gemini] 오류:', e.message); process.exit(1); });
