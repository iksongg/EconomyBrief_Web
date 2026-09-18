# Typography

Source: Figma "디자인시스템" (Design System) board, section **03. Typography**.

> Pretendard 한 벌로 전체 화면을 구성합니다. 아래 13개 스타일 외의 크기는 사용하지 않습니다.
> (The entire product is built on a single typeface, Pretendard. No size outside the 13 styles below is used.)

CSS classes: [`../tokens/typography.css`](../tokens/typography.css)

- Typeface: Pretendard (single typeface)
- Weights: 4 — Regular 400, Medium 500, SemiBold 600, Bold 700
- Text styles: 13
- Size range: 10–30px

## Weights

| Weight | Usage |
|---|---|
| Regular · 400 | 본문과 긴 문장. 가장 많이 쓰이는 기본값입니다. (Body copy and long-form text. The most common default.) |
| Medium · 500 | 라벨과 칩. Regular보다 한 칸 또렷하게 만들 때. (Labels and chips — one step crisper than Regular.) |
| SemiBold · 600 | 제목과 버튼. 강조의 기본 수단입니다. (Titles and buttons — the default way to emphasize.) |
| Bold · 700 | 화면 제목과 숫자. 한 화면에 두 곳 이상 쓰지 않습니다. (Screen titles and figures. Never used in more than two places per screen.) |

## Type Scale

| Style | Spec | Example | Where it's used |
|---|---|---|---|
| Display/L | Bold 30px · line-height 39px · tracking -2% | 경제, 이렇게 쉬웠나요 | Splash · first onboarding line |
| Heading/1 | Bold 24px · line-height 32px · tracking -2% | 오늘의 브리핑 | Top-of-screen title |
| Heading/2 | Bold 20px · line-height 28px · tracking -2% | 반도체 수출 3개월 연속 증가 | Section title · article title |
| Heading/3 | SemiBold 18px · line-height 26px · tracking -1.5% | 딥리서치 요약 | Card title · modal title |
| Title/1 | SemiBold 17px · line-height 25px · tracking -1.5% | 기준금리 동결 결정 | List item title |
| Title/2 | SemiBold 16px · line-height 24px · tracking -1% | 자세히 보기 | Button label · tab · emphasis phrase |
| Body/1 | Regular 16px · line-height 26px · tracking -1% | 한국은행이 기준금리를 연 3.0%로 동결했습니다. | Article body · long reading area |
| Body/2 | Regular 14px · line-height 22px · tracking -1% | 수출 증가가 물가에 미치는 영향을 살펴봅니다. | Default body copy · descriptions |
| Body/2 Emphasis | SemiBold 14px · line-height 22px · tracking -1% | 전월 대비 +2.4% | Inline emphasis · figures |
| Label/1 | Medium 14px · line-height 20px · tracking -1% | 관심 분야 | Input label · filter chip |
| Caption/1 | Regular 12px · line-height 18px · tracking -0.5% | 2026.08.02 · 한국경제 | Meta info · timestamp · source |
| Caption/2 | SemiBold 12px · line-height 17px · tracking -0.5% | 딥리서치 | Badge text · tag |
| Overline | Regular 10px · line-height 14px · tracking 0% | 도토리 | Tab bar label · smallest text unit |
