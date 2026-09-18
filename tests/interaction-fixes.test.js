const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadCommonWithEmptyStorage() {
  const storage = new Map();
  const document = {
    readyState: 'loading',
    addEventListener() {},
    querySelectorAll() { return []; }
  };
  const context = {
    document,
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, value); }
    },
    EB_ICONS: {
      icon() { return ''; },
      iconSrc() { return ''; }
    },
    window: {},
    addEventListener() {}
  };
  context.window = context;
  vm.runInNewContext(read('assets/js/common.js'), context);
  return context.EB;
}

{
  const glossary = loadCommonWithEmptyStorage().glossary;
  assert.equal(glossary.count(), glossary.getAll().length,
    'the displayed glossary count must equal the persisted term list length');
}

{
  const glossaryPage = read('glossary.html');
  assert.equal(glossaryPage.includes("listEl.innerHTML = terms.map"), false,
    'persisted glossary values must not be interpolated into innerHTML');
}

{
  const briefing = read('daily-briefing.html');
  assert.match(briefing, /get-token-btn[\s\S]{0,200}?token\.html/,
    'the token reward CTA must open the token page');
}

{
  const token = read('token.html');
  assert.match(token, /class="claim-btn"/, 'the sponsor reward button must exist');
  assert.match(token, /querySelector\('\.claim-btn'\)[\s\S]*?\.addEventListener/,
    'the sponsor reward button must have a click handler');
}

{
  const research = read('deep-research.html');
  assert.match(research, /id="eta-value">6초 후/,
    'the initial ETA must match the six-second demo timer');
}

console.log('interaction-fixes tests passed');
