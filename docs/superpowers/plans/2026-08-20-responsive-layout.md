# Flat Responsive Frame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the fixed-size "phone mockup" chrome (402×874px, rounded corners, drop shadow) from all 9 EconomyBrief pages and replace it with a flat frame that fills the viewport height and flexes in width up to 402px, edge-to-edge, matching https://iksongg.github.io/ryuheesongg-train/.

**Architecture:** Pure CSS/HTML edit, no JS or structural changes. One shared stylesheet (`assets/css/common.css`) carries the frame shape; each of the 9 HTML files has its own inline `<style>` block that positions the frame within the page and must be updated to match.

**Tech Stack:** Static HTML/CSS, no build step, no test framework applicable to this change (verification is grep-based structural checks plus manual browser inspection).

## Global Constraints

- Do not change any internal per-screen absolute-positioned layout (e.g. `daily-briefing.html`'s card-stack) — those already have their own `@media (max-width: 402px)` fluid fallback and are unaffected by this change.
- Do not touch `assets/css/app.css` or `.app-shell` (unused by any page).
- Do not touch `design-system/tokens/layout.css`'s `--screen-width` token (documentation only).
- `.device` must remain capped at `max-width: 402px` on all pages — only the fixed-size/rounded/shadow chrome is removed, not the width cap itself.

---

### Task 1: Make the device frame flat and fluid by default (common.css)

**Files:**
- Modify: `assets/css/common.css:30-46` (`.device` / `.scroll-area` rule block)
- Modify: `assets/css/common.css:62-69` (`.status-bar-simple` rule block)
- Modify: `assets/css/common.css:93-98` (`.gnb-tab-bar` rule block)
- Modify: `assets/css/common.css:108-123` (trailing `@media (max-width: 402px)` block)

**Interfaces:**
- Produces: `.device` becomes `width:100%; max-width:402px; height:100dvh;` with no border-radius/box-shadow — this is the shape every page's body now centers. `.status-bar-simple` and `.gnb-tab-bar` become `width:100%` (inheriting the 402px cap from their `.device` parent). `.status-bar-simple .levels` is right-anchored (`right:24px`) instead of left-anchored at a fixed offset.
- Consumes: nothing (this is the base shared stylesheet).

- [ ] **Step 1: Replace the `.device` / `.scroll-area` block**

Find:
```css
/* ---- device frame (shared page shell) ---- */
.device {
  position: relative;
  width: 402px;
  height: 874px;
  background: #ffffff;
  border-radius: 44px;
  overflow: hidden;
  box-shadow: 0 30px 60px rgba(0,0,0,0.18);
}
.scroll-area {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.scroll-area::-webkit-scrollbar { width: 0; height: 0; }
```

Replace with:
```css
/* ---- device frame (shared page shell) ---- */
.device {
  position: relative;
  width: 100%;
  max-width: 402px;
  min-height: 100dvh;
  height: 100dvh;
  background: #ffffff;
  overflow: hidden;
}
.scroll-area {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.scroll-area::-webkit-scrollbar { width: 0; height: 0; }
```

- [ ] **Step 2: Make `.status-bar-simple` fluid and right-anchor the levels indicator**

Find:
```css
.status-bar-simple { position: relative; width: 402px; height: 62px; background: #ffffff; }
.status-bar-simple .time {
  position: absolute; left: 24px; top: 21px; width: 100px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  font-weight: var(--font-weight-semibold); font-size: 17px; color: #000000;
}
.status-bar-simple .levels { position: absolute; left: 278px; top: 21px; width: 100px; height: 22px; }
.status-bar-simple .levels img { display: block; width: 100%; height: 100%; }
```

Replace with:
```css
.status-bar-simple { position: relative; width: 100%; height: 62px; background: #ffffff; }
.status-bar-simple .time {
  position: absolute; left: 24px; top: 21px; width: 100px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  font-weight: var(--font-weight-semibold); font-size: 17px; color: #000000;
}
.status-bar-simple .levels { position: absolute; right: 24px; top: 21px; width: 100px; height: 22px; }
.status-bar-simple .levels img { display: block; width: 100%; height: 100%; }
```

- [ ] **Step 3: Make `.gnb-tab-bar` fluid**

Find:
```css
.gnb-tab-bar {
  position: absolute; left: 0; bottom: 0; width: 402px; z-index: 5;
  background: #fff; border-top: 1px solid #DBDBDB;
  display: flex; align-items: center; justify-content: center;
  height: 90px; padding-bottom: 20px;
}
```

Replace with:
```css
.gnb-tab-bar {
  position: absolute; left: 0; bottom: 0; width: 100%; z-index: 5;
  background: #fff; border-top: 1px solid #DBDBDB;
  display: flex; align-items: center; justify-content: center;
  height: 90px; padding-bottom: 20px;
}
```

- [ ] **Step 4: Remove the now-redundant mobile-only media query**

Find:
```css
/* Keep the prototype inside a mobile-width frame without creating page-level overflow. */
@media (max-width: 402px) {
  html, body { width: 100%; min-width: 0 !important; overflow-x: hidden; }
  body { padding: 0 !important; align-items: flex-start !important; background: #ffffff !important; }
  .device.device {
    width: 100%;
    max-width: 402px;
    min-height: 100dvh;
    height: 100dvh;
    border-radius: 0;
    box-shadow: none;
  }
  .status-bar-simple,
  .gnb-tab-bar { width: 100%; }
  .status-bar-simple .levels { left: auto; right: 24px; }
}
```

Replace with:
```css
/* Prevent page-level horizontal overflow at any viewport width. */
html, body { width: 100%; min-width: 0; overflow-x: hidden; }
```

- [ ] **Step 5: Verify no fixed 402/874px sizing remains in the shared shell rules**

Run: `grep -n "width: 402px\|height: 874px" assets/css/common.css`
Expected: no output. (This intentionally does not match `max-width: 402px`, which is the correct fluid cap and should remain.)

- [ ] **Step 6: Commit**

```bash
git add assets/css/common.css
git commit -m "$(cat <<'EOF'
Make shared device frame flat and fluid by default

Removes the fixed 402x874px/rounded-corner/shadow phone-mockup shape
and makes the existing mobile fallback (full width up to 402px cap,
full viewport height, no chrome) the default at every viewport size.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Edge-to-edge body layout on all 9 pages

**Files:**
- Modify: `index.html` (body block + delete duplicate `.device` block)
- Modify: `main.html`, `newsfeed.html`, `article.html`, `daily-briefing.html`, `deep-research.html`, `glossary.html`, `mypage.html`, `token.html` (body block only)

**Interfaces:**
- Consumes: Task 1's `.device` shape (`width:100%; max-width:402px; height:100dvh;` with no radius/shadow) from `common.css`.
- Produces: every page's `body` centers `.device` horizontally with no padding and top-aligned, so the frame sits flush against the viewport edges at any width.

- [ ] **Step 1: Update `index.html` body rule and remove its duplicate `.device` block**

Find:
```css
  body {
    font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif;
    background: #EAEBEF;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 16px;
  }

  .device {
    position: relative;
    width: 402px;
    height: 874px;
    background: #ffffff;
    border-radius: 44px;
    overflow: hidden;
    box-shadow: 0 30px 60px rgba(0,0,0,0.18);
  }

  .page {
```

Replace with:
```css
  body {
    font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif;
    background: #EAEBEF;
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }

  .page {
```

- [ ] **Step 2: Update `main.html` body rule**

Find:
```css
  body {
    font-family: var(--font-family-base);
    background: #EAEBEF;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 16px;
  }
```

Replace with:
```css
  body {
    font-family: var(--font-family-base);
    background: #EAEBEF;
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }
```

- [ ] **Step 3: Update `article.html` body rule**

Find:
```css
  body {
    font-family: var(--font-family-base);
    background: #EAEBEF;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 16px;
  }
```

Replace with:
```css
  body {
    font-family: var(--font-family-base);
    background: #EAEBEF;
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }
```

- [ ] **Step 4: Update `daily-briefing.html` body rule**

Find:
```css
  body {
    font-family: var(--font-family-base);
    background: #EAEBEF;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 16px;
  }
```

Replace with:
```css
  body {
    font-family: var(--font-family-base);
    background: #EAEBEF;
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }
```

- [ ] **Step 5: Update `newsfeed.html` body rule**

Find:
```css
  body {
    font-family: var(--font-family-base);
    background: #EAEBEF;
    min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    padding: 40px 16px;
  }
```

Replace with:
```css
  body {
    font-family: var(--font-family-base);
    background: #EAEBEF;
    min-height: 100vh;
    display: flex; align-items: flex-start; justify-content: center;
  }
```

- [ ] **Step 6: Update `deep-research.html` body rule**

Find:
```css
  body {
    font-family: var(--font-family-base);
    background: #EAEBEF;
    min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    padding: 40px 16px;
  }
```

Replace with:
```css
  body {
    font-family: var(--font-family-base);
    background: #EAEBEF;
    min-height: 100vh;
    display: flex; align-items: flex-start; justify-content: center;
  }
```

- [ ] **Step 7: Update `glossary.html` body rule**

Find:
```css
  body {
    font-family: var(--font-family-base);
    background: #EAEBEF;
    min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    padding: 40px 16px;
  }
```

Replace with:
```css
  body {
    font-family: var(--font-family-base);
    background: #EAEBEF;
    min-height: 100vh;
    display: flex; align-items: flex-start; justify-content: center;
  }
```

- [ ] **Step 8: Update `mypage.html` body rule**

Find:
```css
  body {
    font-family: var(--font-family-base);
    background: #EAEBEF;
    min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    padding: 40px 16px;
  }
```

Replace with:
```css
  body {
    font-family: var(--font-family-base);
    background: #EAEBEF;
    min-height: 100vh;
    display: flex; align-items: flex-start; justify-content: center;
  }
```

- [ ] **Step 9: Update `token.html` body rule**

Find:
```css
  body {
    font-family: var(--font-family-base);
    background: #EAEBEF;
    min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    padding: 40px 16px;
  }
```

Replace with:
```css
  body {
    font-family: var(--font-family-base);
    background: #EAEBEF;
    min-height: 100vh;
    display: flex; align-items: flex-start; justify-content: center;
  }
```

- [ ] **Step 10: Verify no page still has the old padding/center-align combination**

Run: `grep -rln "padding: 40px 16px" *.html`
Expected: no output.

Run: `grep -c "align-items: flex-start" *.html`
Expected: every one of the 9 files prints `1` (or `:1` depending on grep version — each file has exactly one match).

- [ ] **Step 11: Commit**

```bash
git add index.html main.html newsfeed.html article.html daily-briefing.html deep-research.html glossary.html mypage.html token.html
git commit -m "$(cat <<'EOF'
Remove desktop margin around app frame on all pages

Body no longer pads/centers the frame as a floating card; it now
top-aligns the fluid .device frame flush against the viewport edges
at every width, matching the flat reference layout.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Manual cross-breakpoint verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: the completed frame from Tasks 1–2 across all 9 pages.
- Produces: a pass/fail confirmation for this plan; no code artifact.

- [ ] **Step 1: Serve the site locally**

Run: `cd /Users/heesong/Desktop/economybrief && python3 -m http.server 8811`
Expected: server starts, prints "Serving HTTP on ... port 8811".

- [ ] **Step 2: Open each page in a browser and check 5 widths**

Open `http://localhost:8811/index.html`, `main.html`, `newsfeed.html`, `article.html`, `daily-briefing.html`, `deep-research.html`, `glossary.html`, `mypage.html`, `token.html`.

For each, use browser dev tools to set the viewport to 1440px, 768px, 402px, 375px, and 320px and confirm:
- No rounded corners or drop shadow around the frame at any width.
- The frame touches the top of the browser viewport with no gap (edge-to-edge).
- At 1440px and 768px the frame is horizontally centered, capped at 402px wide, with the page background visible on either side.
- At 402px, 375px, and 320px the frame fills the full available width with no horizontal scrollbar.
- The status bar's time/signal icons stay flush to the right edge of the frame at every width.
- The bottom tab bar (on `main.html`/`newsfeed.html`) spans the full frame width and stays pinned to the bottom.

- [ ] **Step 3: Stop the local server**

Run: `Ctrl+C` in the terminal running the server (or kill the background process).

- [ ] **Step 4: Report results**

If every page passes every check in Step 2, the implementation is complete. If any page fails a check, note which page/width/check failed before considering this plan done.
