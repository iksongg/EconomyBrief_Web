// Function-level test for assets/js/common.js's EB.media.renderPressLogo()/
// showLogoPlaceholder() sourceLogo-fallback-badge behavior, run headlessly
// via Node's built-in vm module (no browser, no jsdom, no new dependency) -
// same pattern as tests/api-news-client.test.js. common.js only needs
// window.EB_ICONS (used at top-level script scope) and a `document` with an
// addEventListener stub (its one top-level document call, gating DOM
// component-injection this test never exercises) to load cleanly; the two
// functions under test are otherwise pure/self-contained.
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'common.js'), 'utf8');

function makeFakeImg() {
  var afterendNodes = [];
  return {
    dataset: {},
    style: {},
    insertAdjacentElement: function (position, el) {
      if (position === 'afterend') afterendNodes.push(el);
    },
    _afterendNodes: afterendNodes
  };
}

function makeFakeElement() {
  return {
    _attrs: {},
    className: '',
    textContent: '',
    setAttribute: function (name, value) { this._attrs[name] = value; }
  };
}

function loadEB() {
  var sandbox = {
    window: {
      EB_ICONS: { icon: function () { return ''; }, iconSrc: function () { return ''; } },
      addEventListener: function () {}
    },
    document: {
      readyState: 'loading', // keeps common.js's DOMContentLoaded gate from auto-firing mount() (full component injection this test doesn't exercise) during vm evaluation
      addEventListener: function () {},
      createElement: function () { return makeFakeElement(); }
    }
  };
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { EB: sandbox.window.EB, sandbox: sandbox };
}

(function () {
  const { EB } = loadEB();

  // sourceLogo 있음 -> 실제 logo 유지: a real logoPath must render an <img>
  // (not the placeholder span), pointing at exactly that path.
  const withLogoHtml = EB.media.renderPressLogo('연합뉴스', 'https://yna.co.kr/favicon.ico');
  assert.ok(/^<img /.test(withLogoHtml), '실제 sourceLogo가 있으면 <img> 태그를 렌더링해야 한다');
  assert.ok(withLogoHtml.indexOf('src="https://yna.co.kr/favicon.ico"') !== -1);

  // sourceLogo 없음 -> fallback badge: no logoPath must render the
  // placeholder span carrying the 1-character initial as visible text.
  const noLogoHtml = EB.media.renderPressLogo('연합뉴스', '');
  assert.ok(/^<span class="eb-press-logo eb-logo-placeholder"/.test(noLogoHtml), 'sourceLogo가 없으면 placeholder span을 렌더링해야 한다');
  assert.ok(noLogoHtml.indexOf('>연</span>') !== -1, '연합뉴스 -> 이니셜 "연"이 배지 텍스트로 표시되어야 한다');

  // Investing.com -> I / 마켓인 -> 마 / 포인트경제 -> 포
  assert.ok(EB.media.renderPressLogo('Investing.com', '').indexOf('>I</span>') !== -1);
  assert.ok(EB.media.renderPressLogo('마켓인', '').indexOf('>마</span>') !== -1);
  assert.ok(EB.media.renderPressLogo('포인트경제', '').indexOf('>포</span>') !== -1);

  // 정상 source name은 기존 표시 유지: the aria-label (used for accessibility/
  // existing hover-title behavior) must still carry the FULL, untouched
  // source name, not just the 1-char initial - only the visible glyph is
  // shortened, nothing about the existing label is lost.
  const normalNameHtml = EB.media.renderPressLogo('한국경제', '');
  assert.ok(normalNameHtml.indexOf('aria-label="한국경제"') !== -1, '기존 aria-label(전체 언론사명)은 그대로 유지되어야 한다');

  // logo 로딩 실패 -> fallback badge: simulates the <img onerror=...> path by
  // calling showLogoPlaceholder directly (what the inline onerror handler
  // invokes), with the same real logoPath having already failed to load.
  const failedImg = makeFakeImg();
  EB.media.showLogoPlaceholder(failedImg, '한국경제 (https://broken.example/favicon.ico)', '한');
  assert.strictEqual(failedImg.style.display, 'none', '로딩 실패한 <img>는 숨겨져야 한다');
  assert.strictEqual(failedImg._afterendNodes.length, 1);
  const failedBadge = failedImg._afterendNodes[0];
  assert.strictEqual(failedBadge.className, 'eb-logo-placeholder');
  assert.strictEqual(failedBadge.textContent, '한', '로고 로딩 실패 시에도 이니셜 fallback 배지가 표시되어야 한다');

  // Calling showLogoPlaceholder twice on the same img (already-applied
  // guard) must not insert a second badge - pre-existing double-fire guard,
  // unaffected by this change, re-checked here since the signature grew a
  // 3rd argument.
  EB.media.showLogoPlaceholder(failedImg, 'x', 'X');
  assert.strictEqual(failedImg._afterendNodes.length, 1, '이미 placeholder가 적용된 img에는 중복 배지를 추가하지 않아야 한다');

  console.log('press-logo.test.js: all assertions passed');
})();
