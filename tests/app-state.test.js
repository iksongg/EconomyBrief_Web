const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function loadAppState(storage = createStorage()) {
  const document = { readyState: 'loading', addEventListener() {}, querySelectorAll() { return []; } };
  const context = {
    document,
    localStorage: storage,
    window: {},
    addEventListener() {},
    EB_ICONS: { icon() { return ''; }, iconSrc() { return ''; } }
  };
  context.window = context;
  const file = path.join(__dirname, '..', 'assets', 'js', 'common.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return { appState: context.EB.appState, storage };
}

{
  const { appState } = loadAppState();
  assert.equal(appState.load().tokens, 14);
}

{
  const { appState } = loadAppState();
  assert.equal(appState.rewardBriefing().rewarded, true);
  assert.equal(appState.rewardBriefing().rewarded, false);
  assert.equal(appState.load().tokens, 19);
}

{
  const { appState } = loadAppState();
  assert.equal(appState.claimSponsorGift().claimed, true);
  assert.equal(appState.claimSponsorGift().claimed, false);
  assert.equal(appState.load().tokens, 15);
}

{
  const storage = createStorage();
  storage.setItem('economybrief-app-v1', JSON.stringify({ tokens: '14', keywords: ['AI', 42] }));
  const { appState } = loadAppState(storage);
  assert.equal(appState.rewardBriefing().state.tokens, 19);
  assert.deepEqual(JSON.parse(JSON.stringify(appState.load().keywords)), ['AI']);
}

console.log('common app state tests passed');
