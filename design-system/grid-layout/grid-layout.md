# Grid & Layout

Source: Figma "디자인시스템" (Design System) board, section **04. Grid & Layout**.

> 모든 화면은 402pt 폭 위에 4컬럼으로 놓입니다. 간격은 4의 배수만 사용하고, 그 사이 값은 만들지 않습니다.
> (Every screen is laid out on a 402pt-wide, 4-column grid. Spacing only ever uses multiples of 4 — no in-between values.)

CSS custom properties: [`../tokens/layout.css`](../tokens/layout.css)

## Screen Grid

| Spec | Value | Note |
|---|---|---|
| Screen base width | 402 pt | iPhone 16 Pro logical resolution |
| Side margin | 20 pt | Content width = 362pt |
| Columns | 4 columns | 1 card = 4 columns, 1 metric tile = 1 column |
| Gutter | 12 pt | Column width = 81.5pt |
| Top safe area | 59 pt | Status bar + notch |
| Bottom tab bar | 56 + 34 pt | Tab height + home indicator |
| Scroll content start | 16 pt | From header to first element |

## Spacing Scale (4pt base)

| Value | Token |
|---|---|
| 4 | xs |
| 8 | sm |
| 12 | md |
| 16 | lg |
| 20 | xl |
| 24 | 2xl |
| 32 | 3xl |
| 40 | 4xl |
| 48 | 5xl |
| 64 | 6xl |

## Corner Radius

| Radius | Used for |
|---|---|
| 4px | Badge · tag |
| 8px | Input · small button |
| 12px | Card · button |
| 16px | Modal · bottom sheet |
| full | Avatar · filter chip |

## Elevation

높이 단계 — 그림자는 3단계까지만. (Elevation levels — shadows are capped at 3 levels.)

| Level | Used for |
|---|---|
| Level 0 | None. Distinguished only by Border/Default |
| Level 1 | Card · list item |
| Level 2 | Bottom sheet · modal · dropdown |
