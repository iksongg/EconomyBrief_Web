# Color

Source: Figma "디자인시스템" (Design System) board, section **02. Color**.

> 이코노미 브리프가 사용하는 컬러 토큰입니다. 모든 값은 Figma 변수로 관리되며, 화면에서는 HEX가 아니라 변수 이름으로 참조합니다. Light/Dark 두 모드 값을 함께 가집니다.
> (These are the color tokens EconomyBrief uses. All values are managed as Figma variables and screens reference the variable name, not the raw HEX. Each token also carries a Light/Dark mode value.)

CSS custom properties: [`../tokens/colors.css`](../tokens/colors.css)

**Note on Dark mode:** the Figma board states each token has both Light and Dark values, but only the Light HEX is exposed as text content on the board — Dark values live in Figma variables and were not retrievable from this pass. Pull them directly from Figma if Dark mode is implemented.

## Brand

이코노미 브리프의 정체성을 담당하는 파랑 계열. 600이 기본 브랜드 컬러이며 숫자가 낮아질수록 배경 쪽으로 쓰입니다.
(The blue family that carries EconomyBrief's identity. 600 is the base brand color; lower numbers skew toward background use.)

| Token | Hex |
|---|---|
| Brand/600 | `#2461FA` |
| Brand/500 | `#3784FF` |
| Brand/400 | `#82B0F9` |
| Brand/300 | `#9FC3FB` |
| Brand/200 | `#BFD7FD` |

## Text

본문 위계를 만드는 5단계. Primary → Tertiary 순으로 중요도가 낮아지며, Inverse는 어두운 면 위에서만 씁니다.
(Five levels of text hierarchy. Importance decreases from Primary to Tertiary; Inverse is only used on dark surfaces.)

| Token | Hex |
|---|---|
| Text/Primary | `#000000` |
| Text/Secondary | `#424350` |
| Text/Tertiary | `#888888` |
| Text/Disabled | `#BDBDBD` |
| Text/Inverse | `#FFFFFF` |

## Background & Border

화면의 바닥면과 경계. Primary가 가장 아래, Elevated가 가장 위에 떠 있는 면입니다.
(Screen surfaces and boundaries. Primary is the lowest surface, Elevated floats highest.)

| Token | Hex |
|---|---|
| Background/Primary | `#FAFAFA` |
| Background/Secondary | `#FFFFFF` |
| Background/Elevated | `#FAFAFA` |
| Border/Default | `#E6E7EB` |

## Status

시스템이 결과를 알릴 때 쓰는 3색. 알림·토스트·인라인 메시지 전용입니다.
(Three colors used when the system reports an outcome — for alerts, toasts, and inline messages only.)

| Token | Hex |
|---|---|
| Status/Success | `#22C55E` |
| Status/Warning | `#F59E0B` |
| Status/Error | `#EF4444` |

## Status 2 — Badge Pairs

태그와 배지 전용. Fill(글자·아이콘)과 Bg(배경)는 항상 같은 계열끼리 짝으로 씁니다.
(For tags and badges only. Always pair a Fill — text/icon color — with its matching Bg — background color.)

| Pair | Fill | Bg |
|---|---|---|
| Red | `#E45C6B` | `#FFF1F2` |
| Yellow | `#E58A00` | `#FFF3E8` |
| Green | `#1FA971` | `#ECF8F1` |
| Blue | `#3D7DFF` | `#EAF2FF` |
| Purple | `#5B6CFF` | `#EEF0FF` |
| Gray | `#5F738C` | `#F3F4F6` |

> Note: the Figma layer for the Red pair's background swatch is named "RadBg" (likely a typo of "RedBg"); documented here as Red/Bg for consistency.
