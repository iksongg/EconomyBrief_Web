const assert = require('assert');
const { getNextKstRefreshTime, REFRESH_HOURS_KST } = require('../server');

// KST = UTC+9, so KST 00:00 on a given day is UTC 15:00 the previous day.
function kst(y, m, d, h, min = 0, s = 0) {
  return new Date(Date.UTC(y, m - 1, d, h, min, s) - 9 * 60 * 60 * 1000);
}

assert.deepStrictEqual(REFRESH_HOURS_KST, [0, 3, 6, 9, 12, 15, 18, 21]);

// Mid-window: next slot is later the same KST day.
assert.strictEqual(getNextKstRefreshTime(kst(2026, 9, 10, 1, 0)).getTime(), kst(2026, 9, 10, 3, 0).getTime());
assert.strictEqual(getNextKstRefreshTime(kst(2026, 9, 10, 5, 59, 59)).getTime(), kst(2026, 9, 10, 6, 0).getTime());
assert.strictEqual(getNextKstRefreshTime(kst(2026, 9, 10, 12, 0, 1)).getTime(), kst(2026, 9, 10, 15, 0).getTime());

// Exactly on a slot boundary: "next" skips the current instant and returns
// the following slot (never re-fires immediately for the instant it's already at).
assert.strictEqual(getNextKstRefreshTime(kst(2026, 9, 10, 9, 0, 0)).getTime(), kst(2026, 9, 10, 12, 0).getTime());
assert.strictEqual(getNextKstRefreshTime(kst(2026, 9, 10, 0, 0, 0)).getTime(), kst(2026, 9, 10, 3, 0).getTime());

// Midnight rollover: "사용자가 말한 24:00은 다음 날 00:00으로 처리" - anything
// after 21:00 KST rolls to 00:00 KST the next calendar day.
assert.strictEqual(getNextKstRefreshTime(kst(2026, 9, 10, 21, 30)).getTime(), kst(2026, 9, 11, 0, 0).getTime());
assert.strictEqual(getNextKstRefreshTime(kst(2026, 9, 10, 23, 59, 59)).getTime(), kst(2026, 9, 11, 0, 0).getTime());

// Year/month rollover: Dec 31 23:59 KST -> Jan 1 00:00 KST next year.
assert.strictEqual(getNextKstRefreshTime(kst(2026, 12, 31, 23, 30)).getTime(), kst(2027, 1, 1, 0, 0).getTime());

// UTC conversion sanity check, independent of the kst() helper above:
// KST 2026-09-10 00:00 is UTC 2026-09-09T15:00:00Z; the next slot (KST 03:00)
// is UTC 2026-09-09T18:00:00Z.
const nowUtc = new Date('2026-09-09T15:00:00.000Z');
const nextUtc = getNextKstRefreshTime(nowUtc);
assert.strictEqual(nextUtc.toISOString(), '2026-09-09T18:00:00.000Z');

console.log('scheduler.test.js: all assertions passed');
