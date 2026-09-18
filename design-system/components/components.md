# Components

Source: Figma "디자인시스템" (Design System) board, section **06. Components**.

> 컬러·타이포·아이콘을 조합한 기본 컴포넌트입니다. 버튼과 입력창은 상태별로, 태그는 Status 2 페어 그대로 사용합니다.
> (Base components built by combining color, typography, and icon tokens. Buttons and inputs are documented per state; tags reuse the Status 2 fill/bg pairs directly.)

## Tag

Status 2 Fill/Bg 페어를 그대로 사용합니다. (Uses the [Status 2](../colors/colors.md#status-2--badge-pairs) fill/bg pairs as-is.)

Examples: `+2.4% 상승`, `−1.8% 하락`, `딥리서치`, `정보`, `주의`, `보합`

## Button

Primary · Secondary · Ghost 세 종류, 각 Default/Disabled 상태. 호버·눌림은 Brand 램프를 한 단계 이동해 표현합니다.
(Three variants — Primary, Secondary, Ghost — each with Default/Disabled states. Hover/press is expressed by shifting one step along the Brand ramp.)

| Variant | States |
|---|---|
| Primary | Default, Disabled |
| Secondary | Default, Disabled |
| Ghost | Default, Disabled |

## Input

| State | Example content |
|---|---|
| Default | 이메일을 입력하세요 (Enter your email) |
| Focused | 이메일을 입력하세요 (Enter your email) |
| Error | 이메일 형식이 올바르지 않아요 (Invalid email format) |
| Disabled | 비활성 입력창 (Disabled input) |

## Card (News Card)

- Top: badge icon (`icon/badge/smart_toy`) + eyebrow text — "AI 요약 · 딥리서치" (AI summary · Deep Research)
- Title: "한국은행, 기준금리 3.0%로 동결" (Bank of Korea holds base rate at 3.0%)
- Description: "물가 상승 압력이 완화되며 3개월 연속 동결 기조를 유지했습니다."
- Bottom: "2026.08.02 · 한국경제" (date · source)

## List Item

Icon + title + trailing value, e.g.:

| Icon | Title | Value |
|---|---|---|
| `icon/line/home` | 반도체 수출 3개월 연속 증가 | +2.4% |
| `icon/line/newsmode` | 달러 환율 금융위기 이후 최고치 | −1.8% |
| `icon/line/account_circle` | 글로벌 AI 반도체 수요 급증 | 보합 |

## Bottom Tab Bar

| Icon | Label |
|---|---|
| `icon/line/home` | 홈 (Home) |
| `icon/line/newsmode` | 뉴스피드 (News Feed) |
| `icon/line/bookmark` | 도토리 (Acorn — the app's saved/points feature) |
| `icon/line/account_circle` | 마이페이지 (My Page) |

## Bottom Sheet

Example: token-gated premium article prompt.

- Title: "토큰 3개로 프리미엄 기사 보기" (View the premium article for 3 tokens)
- Subtitle: "보유 토큰: 5개 · 이 기사는 3개가 필요해요" (You have 5 tokens · this article needs 3)
- CTA button: "토큰 사용하고 보기" (Use tokens and view)
