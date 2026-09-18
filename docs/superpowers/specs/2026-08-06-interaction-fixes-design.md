# Interaction Fixes Design

## Goal

Make the reviewed static prototype's glossary, token reward flow, and research ETA behave consistently without introducing external dependencies.

## Decisions

- The glossary term array is the source of truth for the displayed count. The persisted `count` field is removed during normalization so old browser data is repaired automatically.
- Glossary rows are built with DOM APIs and `textContent`; persisted strings are never interpolated into HTML.
- Claiming the sponsor reward increases the displayed balance from 14 to 15, prepends a reward entry, disables the control, and remains claimed until the page reloads.
- The completion CTA routes to `token.html`. The analysis ETA initially reads six seconds and the existing timer remains six seconds.

## Verification

- A Node assertion script checks the source-level behavioral contracts: no stale glossary count, safe DOM rendering, token destination, claim handler/state update, and ETA consistency.
- Inline JavaScript syntax and local asset references are checked after the changes.
