# Interaction Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the glossary count and rendering, complete the token reward flow, and align the research ETA with its demo timer.

**Architecture:** Retain the existing HTML/CSS/vanilla-JavaScript structure. Normalize legacy glossary data in the shared module, render each glossary record through DOM text nodes, and add small page-local handlers for reward and navigation behavior.

**Tech Stack:** HTML, CSS, vanilla JavaScript, Node.js assertions.

## Global Constraints

- Do not add dependencies or a build system.
- Preserve existing Korean copy except where timing/navigation is corrected.
- Keep browser state local to the current static prototype.

---

### Task 1: Add regression checks

**Files:**
- Create: `tests/interaction-fixes.test.js`

**Interfaces:**
- Consumes: source files in the project root.
- Produces: a Node-runnable contract test command.

- [x] **Step 1: Write failing tests**

Assert that `common.js` derives glossary count from `terms.length`, `glossary.html` uses DOM text assignment instead of interpolating persisted values into `innerHTML`, the completion CTA targets `token.html`, the claim button has a handler, and the ETA starts at `6초 후`.

- [x] **Step 2: Run test to verify it fails**

Run: `node tests/interaction-fixes.test.js`

Expected: FAIL because the reviewed source still contains the stale count and missing claim behavior.

- [x] **Step 3: Implement the smallest required source changes**

Modify the shared glossary module and the three affected pages only.

- [x] **Step 4: Run test to verify it passes**

Run: `node tests/interaction-fixes.test.js`

Expected: PASS.

### Task 2: Run static verification

**Files:**
- Modify: `assets/js/common.js`, `glossary.html`, `token.html`, `daily-briefing.html`, `deep-research.html`

**Interfaces:**
- Consumes: completed Task 1 behavior.
- Produces: syntax-valid inline scripts and valid local asset references.

- [x] **Step 1: Extract every inline script and compile it with `new Function`**

Run a Node script that parses each HTML file's inline `<script>` block and compiles it.

- [x] **Step 2: Check each local `src` and `href` file reference**

Run a Node script that resolves local assets relative to their referencing HTML file.

- [x] **Step 3: Record results**

Report the exact commands and successful results to the user.
