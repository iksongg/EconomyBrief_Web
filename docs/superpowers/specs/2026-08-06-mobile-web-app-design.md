# EconomyBrief Mobile Web App Design

## Goal

Turn the prioritized EconomyBrief Figma flows into a cohesive, touch-friendly mobile web app that works from one static entry point and retains user progress locally.

## Scope

The first release implements these connected flows:

1. Four-step onboarding and interest-keyword selection.
2. Home with personalized news and entry to daily briefing.
3. Article detail with glossary saving and entry to deep research.
4. Daily briefing card swipes, completion state, and token reward.
5. Token balance, sponsor reward claim, and history.

News feed, full deep-research report, and My Page are intentionally retained as later-stage routes.

## Technical Approach

- Keep the current dependency-free HTML, CSS, and JavaScript stack.
- Introduce `app.html` as the mobile-web-app shell. It renders the active view in a device-width responsive layout and uses hash routes such as `#/home` and `#/briefing`.
- Split shared behavior into focused modules: route and persisted state, view templates, and interaction handlers. Existing image assets and design-system tokens are reused.
- Store onboarding completion, selected keywords, glossary entries, token balance, and claimed sponsor reward in `localStorage`. No server authentication or remote API is introduced in this release.

## Visual and Interaction Rules

- Reproduce the Figma 402px mobile visual system using the existing Pretendard font and design tokens. The reviewed onboarding frame establishes the primary blue `#2461FA`, 16px primary-button radius, and 60px primary-button height.
- On desktop, center the phone-width app against a neutral background; on mobile, use the available viewport width.
- Use semantic buttons and links, visible keyboard focus, accessible labels for icon-only controls, and `prefers-reduced-motion` fallbacks.
- Do not use expiring Figma asset URLs in the app. Reuse existing local assets, and add Figma-exported assets locally only when a matching asset does not exist.

## State and Data Flow

- `appState` is loaded once from `localStorage`, normalized with defaults, and persisted after every mutation.
- Completing onboarding marks `onboardingComplete` and routes to Home. If it is incomplete, Home redirects to onboarding.
- Saving a term deduplicates by normalized name and updates the glossary count.
- Completing the briefing adds five tokens once per daily session. Claiming the sponsor gift adds one token once and prepends the token history event.

## Verification

- Add Node-based behavior tests for state normalization, keyword persistence, one-time briefing reward, and one-time sponsor claim.
- Run every route's inline/module JavaScript syntax check and verify all local asset references.
- Manually compare each implemented route against its Figma screenshot at 402px width and exercise the full onboarding-to-token flow.

## Non-Goals

- Real user authentication, backend news APIs, payments, push notifications, and editing the Figma source file are not part of the first release.
