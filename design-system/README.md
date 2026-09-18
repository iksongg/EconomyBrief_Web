# EconomyBrief Design System

Extracted from the Figma file "류희송", page **디자인시스템 (Design System)**
([source](https://www.figma.com/design/XdLJc2p9IBvdC0L3PfFjKP/%EB%A5%98%ED%9D%AC%EC%86%A1?node-id=4908-37747)).

All folder and file names are in English; documented copy/content is kept in its
original Korean with an English gloss, since translating actual product copy
(button labels, notification templates, example sentences) would change the
design system itself.

## Contents

| Section | Folder | Summary |
|---|---|---|
| 02. Color | [`colors/`](colors/colors.md) | 5 token groups, 29 color tokens (Brand, Text, Background & Border, Status, Status 2) |
| 03. Typography | [`typography/`](typography/typography.md) | Pretendard, 4 weights, 13 fixed text styles (10–30px) |
| 04. Grid & Layout | [`grid-layout/`](grid-layout/grid-layout.md) | 402pt / 4-column grid, 4pt spacing scale, corner radius, elevation |
| 05. Iconography | [`iconography/`](iconography/iconography.md) | 42 icon components — 18 line icons + 24 badge icons |
| 06. Components | [`components/`](components/components.md) | Tag, Button, Input, Card, List item, Bottom tab bar, Bottom sheet |
| 07. Data Visualization | [`data-visualization/`](data-visualization/data-visualization.md) | Trend chart colors, multi-series palette order, stacked bar, sparkline |
| 10. Form Controls | [`form-controls/`](form-controls/form-controls.md) | Toggle, Checkbox, Radio button, Progress bar |
| 11. Accessibility | [`accessibility/`](accessibility/accessibility.md) | Minimum touch target, focus state, screen reader labeling rules |
| 12. Voice & Tone | [`voice-tone/`](voice-tone/voice-tone.md) | Writing principles, before/after examples, notification templates |
| 13. Empty & Error States | [`empty-error-states/`](empty-error-states/empty-error-states.md) | The 4 fixed empty/error state cards |

> The source board's section numbering jumps from "07. Data Visualization" to
> "10. Form Controls" — sections 08 and 09 do not exist as top-level frames on
> this board, so nothing was skipped in this extraction.

## Tokens

Ready-to-use CSS custom properties / classes, mirroring the boards above:

| File | Contains |
|---|---|
| [`tokens/colors.css`](tokens/colors.css) | All color tokens as CSS custom properties |
| [`tokens/typography.css`](tokens/typography.css) | Font family/weight variables + one class per text style |
| [`tokens/layout.css`](tokens/layout.css) | Grid, spacing scale, corner radius, elevation |

## Known Gaps

- **Dark mode color values**: the Color board states every token has a Light
  and Dark value, but only Light HEX is exposed as text on the board — Dark
  values live in Figma variables and weren't retrievable from this pass.
- **Elevation shadow specs**: Level 1/2 are documented by name and usage only;
  exact blur/opacity are Figma effect styles, approximated in `layout.css` —
  verify against Figma before shipping.
