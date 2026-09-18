# Accessibility

Source: Figma "디자인시스템" (Design System) board, section **11. Accessibility**.

> 색 대비는 Color 보드에 있습니다. 여기는 터치 영역·포커스·스크린리더 규칙입니다.
> (Color contrast lives on the [Color](../colors/colors.md) board. This section covers touch targets, focus state, and screen reader rules.)

## Minimum Touch Target

아이콘 자체가 24px여도, 탭 가능한 영역은 항상 44×44px 이상 확보합니다.
(Even when the icon itself is 24px, the tappable area must always be at least 44×44px.)

| Size | Result |
|---|---|
| 44×44 | 통과 (Pass) |
| 28×28 | 미달 (Fails) |

## Focus State

키보드·외부 입력 시 Brand/600 2px 아웃라인을 요소 바깥쪽에 4px 띄워서 그립니다.
(For keyboard/external input, draw a 2px Brand/600 outline offset 4px outside the element.)

```css
:focus-visible {
  outline: 2px solid var(--color-brand-600);
  outline-offset: 4px;
}
```

## Screen Reader Labels

- 아이콘만 있는 버튼(공유·북마크·닫기)에는 반드시 접근성 라벨을 붙입니다. "아이콘" 같은 무의미한 라벨은 쓰지 않습니다.
  (Icon-only buttons — share, bookmark, close — must always have an accessibility label. Never use a meaningless label like "icon".)
- 색으로만 상승/하락을 구분하지 않습니다 — 반드시 "+2.4%" 같은 텍스트나 화살표 아이콘을 함께 씁니다.
  (Never distinguish gains/losses by color alone — always pair it with text like "+2.4%" or an arrow icon.)
- 이미지에는 내용을 설명하는 대체 텍스트를 넣습니다. 장식용 이미지는 대체 텍스트를 비워 스크린리더가 건너뛰게 합니다.
  (Images need descriptive alt text. Decorative images should have empty alt text so screen readers skip them.)
- 자동 재생되는 애니메이션·캐러셀은 5초 이내에 일시정지할 수 있어야 합니다.
  (Auto-playing animations/carousels must be pausable within 5 seconds.)
