# EconomyBrief Mobile Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the five prioritized EconomyBrief flows as one touch-friendly, static mobile web app.

**Architecture:** `app.html` owns the document shell. `assets/js/app-state.js` owns normalized persisted state and state mutations; `assets/js/app.js` owns hash routing, view rendering, and interactions; `assets/css/app.css` owns responsive layout and component styling. Existing shared tokens and local images are reused.

**Tech Stack:** HTML, CSS custom properties, vanilla JavaScript, Node.js assertions.

## Global Constraints

- No runtime dependency, build tool, or backend.
- Use local assets only; never persist an expiring Figma asset URL.
- Match the 402px Figma mobile system while remaining usable at narrow viewport widths.
- Preserve the existing prototype files; the new app is delivered through `app.html`.

---

### Task 1: Persisted application state

**Files:**
- Create: `assets/js/app-state.js`
- Create: `tests/app-state.test.js`

**Interfaces:**
- Produces `window.EconomyBriefState` with `load()`, `save(next)`, `completeOnboarding(keywords)`, `saveTerm(term)`, `completeBriefing()`, and `claimSponsorGift()`.
- Consumes browser `localStorage` under one `economybrief-app-v1` key.

- [x] **Step 1: Write failing state tests**

Test defaults, keyword persistence, deduplicated glossary saves, one-time five-token briefing reward, and one-time one-token sponsor gift using a real in-memory `localStorage` substitute.

- [x] **Step 2: Run the state tests**

Run: `node tests/app-state.test.js`

Expected: FAIL because the state module is absent.

- [x] **Step 3: Implement the state module**

Use this default shape:

```js
{
  onboardingComplete: false,
  keywords: ['부동산', '금리'],
  tokens: 14,
  briefingRewarded: false,
  sponsorGiftClaimed: false,
  glossary: [],
  tokenHistory: []
}
```

- [x] **Step 4: Re-run the state tests**

Run: `node tests/app-state.test.js`

Expected: PASS.

### Task 2: Build the app shell and route guard

**Files:**
- Create: `app.html`
- Create: `assets/css/app.css`
- Create: `assets/js/app.js`
- Modify: `tests/app-state.test.js`

**Interfaces:**
- Consumes `EconomyBriefState`.
- Produces routes `#/onboarding`, `#/home`, `#/article`, `#/briefing`, and `#/tokens`.

- [x] **Step 1: Write a failing route test**

Test that an incomplete onboarding state resolves a `#/home` request to `#/onboarding`, and a complete state allows `#/home`.

- [x] **Step 2: Run the tests**

Run: `node tests/app-state.test.js`

Expected: FAIL because route resolution is absent.

- [x] **Step 3: Implement shell, responsive CSS, and resolver**

Expose `EconomyBriefApp.resolveRoute(hash, state)` for the test. Render a centered 402px app surface on desktop and full-width surface on mobile.

- [x] **Step 4: Re-run tests**

Run: `node tests/app-state.test.js`

Expected: PASS.

### Task 3: Implement onboarding and home

**Files:**
- Modify: `app.html`
- Modify: `assets/css/app.css`
- Modify: `assets/js/app.js`

**Interfaces:**
- Consumes the route resolver and `completeOnboarding(keywords)`.
- Produces the onboarding-to-home transition and keyword-aware home heading.

- [x] **Step 1: Implement the four onboarding slides and home route**

Use the Figma onboarding node `87:6910` as visual reference. Add progress dots, skip/next/selection behavior, the primary CTA, a home news card, and a briefing navigation control.

- [x] **Step 2: Re-run the state and route tests**

Run: `node tests/app-state.test.js`

Expected: PASS.

### Task 4: Implement article, briefing, and token flow

**Files:**
- Modify: `assets/css/app.css`
- Modify: `assets/js/app.js`
- Modify: `tests/app-state.test.js`

**Interfaces:**
- Consumes `saveTerm`, `completeBriefing`, and `claimSponsorGift`.
- Produces article glossary save, briefing completion reward, and token ledger UI.

- [x] **Step 1: Implement the three routes**

Use Figma nodes `87:6520`, `87:6797`, and `87:6565` as references. Add article actions, swipe-or-next briefing cards, completion CTA, token balance, sponsor claim state, and token history.

- [x] **Step 2: Re-run the state and route test suite**

Run: `node tests/app-state.test.js`

Expected: PASS.

### Task 5: Verify the deliverable

**Files:**
- Modify: `docs/superpowers/plans/2026-08-06-mobile-web-app.md`

- [x] **Step 1: Run application behavior tests**

Run: `node tests/app-state.test.js`

- [x] **Step 2: Check JavaScript syntax and local HTML asset references**

Run a Node script that compiles `app-state.js`, `app.js`, and every inline script, then resolves local `src` and `href` assets.

- [ ] **Step 3: Inspect all five app routes at 402px**

Open `app.html` in a browser and inspect `#/onboarding`, `#/home`, `#/article`, `#/briefing`, and `#/tokens`; exercise the complete onboarding-to-token path.

- [ ] **Step 4: Record completed checks in this plan**

Mark each verification step as complete only after its successful output is observed.
