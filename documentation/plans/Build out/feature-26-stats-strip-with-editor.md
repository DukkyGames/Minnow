---
name: feature-26-stats-strip-with-editor
overview: When the workspace split shows the CodeMirror file editor, adapt the inference stats strip so it stays in the chat column only, uses a compact layout, and never overlaps the editor scrollbar or pane.
todos:
  - id: layout-class-hook
    content: Toggle workspace-split stats layout class from file-layout.ts when viewerOpen changes
    status: pending
  - id: split-stats-css
    content: Add viewer-open stats rules in stats.css and file-panel.css (compact strip, no bleed)
    status: pending
  - id: stats-compact-js
    content: Optional stats.ts helper for expand/collapse defaults when split opens or closes
    status: pending
  - id: tests-and-verify
    content: DOM/CSS unit smoke test + manual split QA; update context.md when shipped
    status: pending
  - id: verify-docs
    content: Add documentation/plans/verification/feature-26.md; sign-off PASS/FAIL on ship
    status: pending
isProject: false
---

# Feature 26 — Stats strip with file editor (E6)

| Field | Value |
|-------|-------|
| **ID** | `feature-26-stats-strip-with-editor` |
| **Epic** | E — File panel (**E6** — stats strip with editor) |
| **Wave** | **1** (visible polish; parallel-safe with E4, E5 per backlog — no hard dependency on E5) |
| **Size** | S |
| **Status** | Build plan (not yet implemented) |
| **Depends on** | Step 11 file tree + split viewer (`file-layout.ts`, `file-viewer.ts`) |
| **Blocks** | None |
| **Key files** | `stats.css`, `file-panel.css`, `file-layout.ts` (backlog); optional `stats.ts`, tests |
| **Source backlog** | [`documentation/plans/product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md) § E6 |

---

## Summary

The inference **stats strip** (`#statsStrip`) lives at the bottom of `#mainColumn` inside `#workspaceSplit`. When the user opens a file in the split **CodeMirror** pane (`#fileViewerPane`), the strip must **stay confined to the chat column**, use a **compact** presentation so the narrow column does not clip or visually fight the editor, and must **not overlap** the editor’s vertical scrollbar or content. Implementation is mostly **CSS** plus a **class hook** in `applyFileSidebarVisuals()`; `stats.ts` only needs small tweaks if compact mode should reset mobile expand state.

---

## Problem statement

| Symptom | Likely cause |
|---------|----------------|
| Stats feel “full width” or bleed into the editor column | Wide `.stats-panel` grid (6 columns on desktop) in a **narrow** `.main-column` when `--split-ratio` ~0.55; horizontal overflow or visual crowding at the split boundary |
| CodeMirror scrollbar hard to use or visually clipped | Adjacent panes share one flex row; tall stats + input + terminal stack in `main-column` vs `file-viewer-pane` `flex: 1; min-height: 0` — perceived overlap at gutter, or stats panel `overflow` not contained |
| Backlog says “fixed bottom” | Strip is **docked at the bottom of the chat column** (`flex-shrink: 0`), not `position: fixed` — goal is **column-scoped** docking when split is active |

**DOM is already correct for column scope:** `#statsStrip` is a child of `#mainColumn`, not a sibling of `#workspaceSplit`. The bug is **layout adaptation**, not moving the node.

```411:550:index.html
  <div id="workspaceSplit" class="workspace-split">
  <div class="main-column" id="mainColumn">
    <main class="chat-area" id="chatArea">…</main>
    …
    <div class="stats-strip" id="statsStrip">…</div>
    <section class="terminal-panel" id="terminalPanel">…</section>
  </div>
  <div class="split-resizer" id="splitResizer">…</div>
  <section class="file-viewer-pane hidden" id="fileViewerPane">…</section>
  </div>
```

---

## Goals

1. **When `#workspaceSplit` has `.viewer-open`:** stats strip visually and structurally belongs to the **chat column only** (no span across resizer + editor).
2. **Compact metrics UI** in split mode: either reuse the mobile **Metrics** expand row on desktop, or a single slim **icon/preview row** — backlog allows “spans chat column only **OR** collapses to icon row”.
3. **No overlap with CodeMirror:** editor pane keeps full height; stats do not use `position: fixed` over the workspace; contain overflow inside `.main-column`; optional `z-index` audit so `.file-viewer-pane` scrollers stay above nothing from the chat column.
4. **When split closed:** restore today’s full instrument panel (desktop grid, existing ≤600px collapsible behavior unchanged).
5. **Split resize:** changing `--split-ratio` via `applyFileSidebarVisuals()` must not require extra JS beyond class toggle (CSS only reacts to `.viewer-open`).

---

## Schema / API changes

None. CSS-only layout adaptation; optional small `stats.ts` helper for expand-state reset. No `index.html` structure change, server routes, or persisted settings.

---

## Non-goals

- Moving `#statsStrip` outside `#mainColumn` (unnecessary; increases coupling with terminal panel order).
- Redesigning stat cells, token bars, or `updateStrip()` data logic.
- Terminal panel height or stats content when terminal is open (orthogonal).
- Feature 27 Tab key in editor.
- Persisting “user prefers expanded metrics in split mode” (v1: sensible default only).

---

## Acceptance criteria

| # | Criterion | How to verify |
|---|-----------|---------------|
| AC1 | Open file → split visible → stats strip width **≤** chat column width; does not extend under `#fileViewerPane`. | Visual: resizer alignment; devtools box model on `#statsStrip` vs `#fileViewerPane`. |
| AC2 | CodeMirror vertical scrollbar in `#fileViewerHost` is fully clickable; no stats panel overlay on the gutter. | Manual: drag scrollbar thumb; scroll long file. |
| AC3 | Split closed → full desktop stats grid (same as current ≥601px wide layout). | Close viewer; compare to baseline screenshot. |
| AC4 | Mobile ≤640px: existing collapsible stats (`stats-expand-btn`, `.is-expanded`) still works; split stacks columns per `file-panel.css` without new regressions. | Phone width + open file. |
| AC5 | `showViewerSplit()` / `hideViewerSplit()` / resizer drag all update layout without reload. | Open, resize, close file. |
| AC6 | `updateStrip()` / `toggleStatsPanel()` still update values and ARIA on compact row. | Send chat message; expand metrics if compact. |
| AC7 | `npm test` passes; new test asserts `.viewer-open` toggles stats layout class (or computed class on `#statsStrip`). | Automated smoke. |

---

## Current state (research)

### `index.html` — stats strip

- `#statsStrip.stats-strip` at bottom of `#mainColumn`, above `#terminalPanel`.
- `#statsExpandBtn` + `#statsPanel` (6-cell grid: TPS, TTFT, gen time, total, token bars, model info).
- Mobile collapse is **CSS-only** at `max-width: 600px` in `responsive.css` (expand button hidden on desktop today).

### `src/ui/file-layout.ts`

- `applyFileSidebarVisuals()` sets `#workspaceSplit.viewer-open` from `getFilePanelState().viewerOpen` and `--split-ratio`.
- `showViewerSplit()` / `hideViewerSplit()` call `applyFileSidebarVisuals()` — **single hook point** for stats layout class.

```38:48:src/ui/file-layout.ts
export function applyFileSidebarVisuals(): void {
  const split = document.getElementById('workspaceSplit');
  if (split) {
    split.classList.toggle('viewer-open', state.viewerOpen);
    split.style.setProperty('--split-ratio', String(state.splitRatio));
  }
  …
}
```

### `src/styles/file-panel.css` — split flex

- `.workspace-split` row: `.main-column` + `.split-resizer` + `.file-viewer-pane`.
- `.viewer-open .main-column { flex: var(--split-ratio) 1 0; min-width: 0; }`
- `.viewer-open .file-viewer-pane { flex: calc(1 - var(--split-ratio)) 1 0; min-width: var(--viewer-min-w); }`
- Mobile: both columns `flex: 1 1 auto` (stacked feel); resizer hidden.

### `src/styles/stats.css`

- `.stats-strip { flex-shrink: 0; border-top; grid panel default **visible** on desktop. }
- `.stats-expand-btn { display: none; }` — only shown at ≤600px via `responsive.css`.

### `src/styles/responsive.css`

- ≤899px: stats grid 2 columns + full-width token/model rows.
- ≤600px: expand button + hidden panel until `.is-expanded`.

### `src/ui/stats.ts`

- `toggleStatsPanel()`, `updateStrip()`, `updateStatsExpandPreview()` — no awareness of `viewerOpen`.

---

## Design — split layout behavior

### Recommended approach: **compact strip when `.viewer-open`**

Use one class on `#workspaceSplit` (already exists) and mirror mobile compact UX on **desktop split** without duplicating DOM.

| Mode | Selector | Stats UI |
|------|----------|----------|
| **Full** | `.workspace-split:not(.viewer-open)` | Current desktop: `.stats-panel` visible, `.stats-expand-btn` hidden (≥601px) |
| **Split compact** | `.workspace-split.viewer-open` | Show `.stats-expand-btn` (preview line); hide `.stats-panel` unless `.stats-strip.is-expanded` |
| **Mobile** | `@media (max-width: 600px)` | Keep existing rules; split compact rules must **not** break mobile expand |

**CSS additions (primary work)**

1. **`stats.css`** — under `.workspace-split.viewer-open`:
   - `#statsStrip` or `.stats-strip`: `overflow: hidden; max-width: 100%;` (contain grid bleed).
   - `.stats-expand-btn { display: flex; }` (reuse mobile row styling).
   - `.stats-panel { display: none; }` default; `.stats-strip.is-expanded .stats-panel { display: grid; }` with **narrow-column grid** (e.g. 2 columns + stacked token row, similar to ≤899px breakpoint).
   - Optional: `.stats-panel` max-height + `overflow-y: auto` when expanded in split so a short chat column does not steal all vertical space from `#chatArea`.

2. **`file-panel.css`** — under `.workspace-split.viewer-open`:
   - Confirm `.file-viewer-pane` and `.file-viewer-body` use `min-height: 0; overflow: hidden/auto` so CM scroller owns the pane edge.
   - Ensure `.main-column` does not `overflow: visible` in a way that paints over the resizer (set `overflow: hidden` on `.main-column` if needed — verify chat scroll still works on `#chatArea` only).

3. **Z-index:** keep stats/terminal at default stacking within `.main-column`; avoid `z-index` on stats strip &gt; editor pane. Editor stays sibling — no change expected if overflow is contained.

### Alternative (if compact row feels too hidden on desktop)

**Icon-only row** when split: single line with 4 monospace chips (TPS · TTFT · total · stop) in `.stats-expand-preview` width; expand still opens full panel. Slightly more CSS/HTML than reusing expand btn — only if product rejects mobile-style row on desktop.

### JS hook (minimal)

In `applyFileSidebarVisuals()` after toggling `viewer-open`:

- Option A — **CSS only** (preferred): no JS change.
- Option B — if expanded stats should not persist across open file: when `viewerOpen` becomes true, remove `is-expanded` from `#statsStrip` and reset `aria-expanded` on `#statsExpandBtn` (small function in `stats.ts` called from `file-layout.ts`).

Do **not** move `#statsStrip` in the DOM.

---

## Implementation steps

### 1. CSS — split compact stats (`stats.css`)

- [ ] Add block `.workspace-split.viewer-open .stats-strip { … }` for contain + compact expand row.
- [ ] Show `.stats-expand-btn` in split mode (desktop and tablet).
- [ ] Default-hide `.stats-panel`; show when `.stats-strip.is-expanded`.
- [ ] Split-expanded grid: 2 columns (reuse or extract shared rules from `responsive.css` ≤899px to avoid drift).
- [ ] Comment why split reuses mobile expand pattern.

### 2. CSS — pane isolation (`file-panel.css`)

- [ ] Verify `.workspace-split.viewer-open .file-viewer-pane` flex column fills height; `.file-viewer-body` scroll isolated.
- [ ] If overlap persists in QA: `overflow: hidden` on `.main-column` (chat area keeps `overflow-y: auto`).

### 3. Hook — `file-layout.ts` (optional collapse reset)

- [ ] If Option B: import `collapseStatsPanelForSplit()` from `stats.ts`; call when `viewerOpen === true`.
- [ ] Ensure `hideViewerSplit()` does not leave spurious `is-expanded` if user had opened panel in split.

### 4. `stats.ts` (only if Option B)

- [ ] `collapseStatsPanelForSplit(): void` — remove `is-expanded`, sync `aria-expanded`, refresh preview via `updateStatsExpandPreview()`.

### 5. Regression checks

- [ ] Terminal open below stats strip — no layout change to terminal resize handle.
- [ ] Tool approval host above composer — unchanged.
- [ ] Tablet 641–899px with viewer: compact + 2-col expanded grid.

### 6. Tests

- [ ] `test/ui/stats-split-layout.test.mjs` (or `.mts`): jsdom fixture with `#workspaceSplit`, `#statsStrip`; call `applyFileSidebarVisuals` with mocked `getFilePanelState` **or** test pure helper `syncStatsStripLayout(viewerOpen: boolean)` if extracted for testability.
- [ ] Assert: `viewer-open` on split ⇒ `#statsStrip` not `is-expanded` (if Option B) OR assert class on split and computed display rules via classList only.
- [ ] Pattern: [`test/ui/thought-bubbles.test.mjs`](../../../test/ui/thought-bubbles.test.mjs).

### 7. Documentation (on ship)

- [ ] [`documentation/context.md`](../../../documentation/context.md) — Layout section: one bullet on split + compact stats.
- [ ] Create / update [`documentation/plans/verification/feature-26.md`](../verification/feature-26.md) on ship (automated + manual sign-off).

---

## Verifier handoff

Create or complete [`documentation/plans/verification/feature-26.md`](../verification/feature-26.md):

- **Automated:** `npm test` (includes `test/ui/stats-split-layout.test.mjs` when added)
- **Manual:** M1–M10 from § Manual test plan (map to AC1–AC6)
- **Sign-off:** PASS only if AC1–AC7 and manual checks pass; implementation matches backlog E6 goal (chat-column stats, no CM scrollbar overlap)

---

## Build and run

| Step | Command |
|------|---------|
| Install | `npm install` (if deps changed — this feature should not add deps) |
| Dev | `npm start` — open workspace, file tree, open a `.ts` file to show split |
| Production bundle | `npm run build` — confirm CSS bundles include new rules |
| Tests | `npm test` |

No server API or `index.html` structure change required unless QA demands an extra wrapper (unlikely).

---

## Manual test plan

1. **Baseline (no viewer):** Wide window → full stats grid visible; no expand button (≥601px).
2. **Open editor:** Open any file → split appears → stats compact row (Metrics + preview); panel hidden until expand.
3. **Expand in split:** Tap/click expand → panel fits in chat column; scroll chat + stats if both tall — chat area still scrolls independently.
4. **CodeMirror scrollbar:** Long file in viewer → drag vertical scrollbar; no dead zone on right edge.
5. **Resize split:** Drag `#splitResizer` → stats stay inside left column; ratio updates.
6. **Close viewer:** Close file → full stats grid returns; expand button hidden on desktop.
7. **Stream metrics:** Send message → `updateStrip` fills values; preview text updates on compact row.
8. **Terminal:** Toggle terminal (Ctrl+`) with viewer open → stats + terminal stack in main column only.
9. **Mobile ≤600px:** Open file → split stacks; metrics expand/collapse still works.
10. **Narrow split ratio:** Drag split to ~35% chat — compact row still readable; no horizontal scroll on `body`.

---

## Files touched (expected)

| File | Change |
|------|--------|
| [`src/styles/stats.css`](../../../src/styles/stats.css) | Split compact + expanded grid rules |
| [`src/styles/file-panel.css`](../../../src/styles/file-panel.css) | Overflow / pane height guards if needed |
| [`src/ui/file-layout.ts`](../../../src/ui/file-layout.ts) | Optional collapse call when opening viewer |
| [`src/ui/stats.ts`](../../../src/ui/stats.ts) | Optional `collapseStatsPanelForSplit()` |
| [`test/ui/stats-split-layout.test.mjs`](../../../test/ui/stats-split-layout.test.mjs) | New smoke test |
| [`documentation/context.md`](../../../documentation/context.md) | On ship only |

**Not expected:** `index.html` move, `updateStrip` logic changes, `file-viewer.ts` CM config.

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Desktop users lose always-visible metrics when editing | Expand row shows live preview (`#statsExpandPreview`); one click to expand |
| `overflow: hidden` on `.main-column` clips floating UI | Scope overflow to stats strip only; keep `#chatArea` as scroll container |
| Duplicated grid rules between `responsive.css` and `stats.css` | Extract shared custom properties or duplicate 2-col block with comment linking both files |
| `is-expanded` left true when closing split leaves huge stats on full layout | Option B reset on `hideViewerSplit()` |

---

## Open questions (resolve before or during implementation)

1. **Desktop split default:** collapsed expand row only, or always show 2-stat mini row without expand? (Backlog allows either; plan defaults to **collapsed + expand**.)
2. Should opening the file viewer **force-collapse** an expanded stats panel? (Recommended **yes** for AC2 vertical space.)
3. Product preference: reuse mobile “Metrics” label on desktop split vs icon-only chips?

---

## Related

- Epic E5 [`feature-27-editor-tab-key.md`](feature-27-editor-tab-key.md) — explicitly out of scope here.
- Step 11 file tree / viewer (historical); split wiring in [`src/ui/init-file-panel.ts`](../../../src/ui/init-file-panel.ts).
- Layout summary in [`documentation/context.md`](../../../documentation/context.md) § Layout.
