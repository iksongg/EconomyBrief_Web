# EconomyBrief Flat Responsive Frame Design

## Goal

Replace the fixed-size "phone mockup" chrome (402×874px, 44px rounded corners, drop
shadow) that currently wraps every page with a flat, fluid frame that fills the full
viewport height and grows/shrinks in width up to 402px — matching the reference
behavior at https://iksongg.github.io/ryuheesongg-train/.

## Current State

All 9 pages (`index.html`, `main.html`, `newsfeed.html`, `article.html`,
`daily-briefing.html`, `deep-research.html`, `glossary.html`, `mypage.html`,
`token.html`) share the `.device` shell defined in `assets/css/common.css`. By
default `.device` is a fixed 402×874px box with `border-radius: 44px` and a box
shadow, centered on the page by `body { display:flex; align-items:center;
justify-content:center; padding: 40px 16px; }`. A `@media (max-width: 402px)` block
in `common.css` already switches `.device` to `width:100%; max-width:402px;
height:100dvh` with no radius/shadow, but only below the 402px breakpoint — above it,
the fixed card-with-shadow "phone mockup" look remains.

`index.html` additionally re-declares the fixed 402×874/44px/shadow shape inline,
duplicating `common.css`.

## Change

**`assets/css/common.css`**
- Make the fluid shape (`width:100%; max-width:402px; min-height:100dvh; height:100dvh;
  border-radius:0; box-shadow:none;`) the unconditional default for `.device`,
  replacing the fixed 402×874/44px/shadow default. Remove the now-redundant
  `@media (max-width: 402px)` block that previously gated this.
- `.status-bar-simple` and `.gnb-tab-bar`: change fixed `width: 402px` to `width:
  100%` unconditionally (they inherit the 402px cap from their `.device` parent).
- `.status-bar-simple .levels`: replace the fixed `left: 278px` with `right: 24px`
  so the time/signal icons stay pinned to the right edge at any width ≤402px
  (identical position to today at exactly 402px width).

**All 9 HTML files** (inline `<style>` block)
- `body`: remove `padding: 40px 16px`; change `align-items: center` to `align-items:
  flex-start`. Keep existing background color, `display:flex`, `justify-content:
  center`, `min-height: 100vh` (or `100dvh` where already present). This makes the
  frame sit flush against the top of the viewport with no margin, matching the
  reference's edge-to-edge treatment. On viewports wider than 402px, the existing
  body background remains visible as neutral space on either side of the centered
  column.
- `index.html` only: delete the inline `.device { width:402px; height:874px;
  border-radius:44px; box-shadow:...; }` block — it becomes redundant once
  `common.css` carries the correct default.

## Out of Scope

- Internal per-screen absolute-positioned layouts (e.g. `daily-briefing.html`'s
  card-stack swipe UI) are unchanged. They already have their own `@media
  (max-width: 402px)` fallback rules that convert fixed px to `calc(100% - Npx)`,
  which continues to apply correctly since `.device` is still capped at 402px.
- `assets/css/app.css` / `.app-shell` are unused by any current HTML page and are
  not touched.
- `design-system/tokens/layout.css`'s `--screen-width: 402px` token is documentation
  only (not referenced by any CSS rule) and is not touched.

## Verification

- Open each of the 9 pages in a browser at 1440px, 768px, 402px, 375px, and 320px
  widths. Confirm: no rounded corners or drop shadow at any width, the frame fills
  full viewport height, width grows/shrinks fluidly up to a 402px cap, no horizontal
  scrollbar appears, and the status bar time/signal icons stay flush to the right
  edge.
