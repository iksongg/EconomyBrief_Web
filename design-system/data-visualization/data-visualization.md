# Data Visualization

Source: Figma "디자인시스템" (Design System) board, section **07. Data Visualization**.

> 경제 지표를 다루는 화면이 많은 만큼 상승/하락/카테고리 컬러 규칙을 고정합니다. 임의로 새 색을 추가하지 않습니다.
> (Since many screens deal with economic indicators, the up/down/category color rules are fixed. Never introduce a new color ad hoc.)

## Trend Chart

상승은 GreenFill+GreenBg, 하락은 RedFill+RadBg만 사용합니다.
(Use only GreenFill+GreenBg for gains and RedFill+RedBg for losses — see [Status 2](../colors/colors.md#status-2--badge-pairs).)

Examples: 코스피 지수 +2.4% (KOSPI index), 원/달러 환율 −1.8% (KRW/USD exchange rate)

## Multi-Series Palette Order

한 차트에 여러 항목을 비교할 때 이 순서대로만 배정합니다. 6개 넘는 항목은 "기타"로 묶습니다.
(When a chart compares multiple items, assign colors strictly in this order. Anything past the 6th item is grouped as "Other".)

1순위 → 6순위 기타 (Priority 1 → Priority 6 "Other") — 6 slots total, in the fixed multi-series order defined on the board.

## Stacked Bar (구성비 막대 / Composition Bar)

원형 차트 대신 가로 막대를 우선 씁니다. (Prefer a horizontal bar over a pie chart.)

Example segments: 긍정 45% (Positive), 중립 35% (Neutral), 부정 20% (Negative)

## Inline Sparkline

리스트 안에서 쓰는 24px 높이 축소판. (A 24px-tall miniature chart used inside list rows.)

| Item | Change |
|---|---|
| 삼성전자 (Samsung Electronics) | +3.1% |
| SK하이닉스 (SK Hynix) | −0.8% |
| 현대차 (Hyundai Motor) | +0.2% |
