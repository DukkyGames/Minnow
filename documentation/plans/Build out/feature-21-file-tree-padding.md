# Feature 21 — Tighten file tree row padding (E4)

**Feature ID:** `feature-21-file-tree-padding`  
**Backlog:** [`documentation/plans/product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md) — Epic E, **E4**  
**Wave:** 1 (parallel-safe with **E5**, **A1**, **C3** per backlog)  
**Size:** S  
**Status:** Build plan (not yet implemented)  
**Depends on:** Step 11 file panel (tree + viewer) — no E1/E18/E20 dependency  
**Blocks:** None

| Field | Value |
|-------|--------|
| **Key files** | [`src/styles/file-panel.css`](../../../src/styles/file-panel.css), [`src/ui/file-tree.ts`](../../../src/ui/file-tree.ts) |
| **Backlog acceptance** | Denser rows; touch targets on mobile per `DESIGN.md` (**44px** via `--touch-min`, not 40px icon-btn size) |

---

## 1. Problem summary

### Summary

Make the **project file tree** visually denser on desktop and fine-pointer devices by reducing row and host padding, while **preserving `44px` minimum tap targets** on coarse-pointer (touch) layouts per [`DESIGN.md`](../../../DESIGN.md). Today every row is forced to **`min-height: var(--touch-min)`** in CSS regardless of pointer type, so tightening vertical padding alone has little effect.

---

## Goals

- [ ] Denser file tree rows on **mouse / fine pointer** (more paths visible without scrolling).
- [ ] Row hit area still **≥ `var(--touch-min)` (44px)** when `(pointer: coarse)` (phones, tablets, touch laptops).
- [ ] Indent hierarchy remains readable; expand chevron and file/dir icons stay aligned.
- [ ] No regression to tree click, expand, keyboard, or file drag-to-composer (5px threshold).

## Non-goals (v1)

- Changing sidebar width (`--file-sidebar-w`), font scale, or emoji folder/file prefixes.
- File tree CRUD menus (E1), search filter (E19), or internal DnD move (E20).
- New user setting for “tree density.”
- Redesigning collapsed file-sidebar rail (48px) — header comment about 40px icon overflow is out of scope unless padding work touches that block.

---

## Current state (research)

### CSS — [`src/styles/file-panel.css`](../../../src/styles/file-panel.css)

| Rule | Values | Effect |
|------|--------|--------|
| `.file-tree-host` | `padding: 6px 0` | Extra vertical air above/below tree |
| `.file-tree-row` | `padding: 6px 8px 6px 4px`; `margin: 0 4px`; `gap: 4px`; **`min-height: var(--touch-min)`** | Every row ≥ 44px tall on all devices |
| `.file-tree-row` | `font-size: 13px` | Row shell (label uses 12px mono) |
| `.file-tree-expand` | `18×18px` | Chevron hit inside dir rows |
| `.file-tree-label` | `font-size: 12px` | Basename text |
| Mobile `@media (max-width: 640px)` | Overlay sidebar only | **No** tree row density overrides today |

`--touch-min` is **`44px`** in [`src/styles/tokens.css`](../../../src/styles/tokens.css) and [`DESIGN.md`](../../../DESIGN.md) (`spacing.touch-min`). Backlog wording “40px” refers to **icon-btn** size in DESIGN, not tree rows — implement **44px** for tree touch targets.

### TS row classes — [`src/ui/file-tree.ts`](../../../src/ui/file-tree.ts)

| Class | Set on | Inline style |
|-------|--------|----------------|
| `file-tree-row file-tree-row--dir` | Directory rows | `paddingLeft = ${8 + depth * 14}px` |
| `file-tree-row file-tree-row--file` | File rows (+ `selected`) | `paddingLeft = ${22 + depth * 14}px` |
| `file-tree-expand` (+ `open`) | Dir rows only | — |
| `file-tree-label` | Both | — |
| `file-tree-children` | Expanded subtree container | No extra padding (indent is per-row `paddingLeft`) |

**Indent math:** File base `22px` ≈ dir base `8px` + expand width `18px` — keep this relationship if constants move.

### DESIGN.md touch-target pattern (precedent)

Session sidebar uses **compact desktop, full touch on coarse**:

- [`src/styles/sidebar.css`](../../../src/styles/sidebar.css): `.chat-rename-btn` / `.chat-delete-btn` are **32×32** by default, **`var(--touch-min)`** under `@media (pointer: coarse)`.
- [`src/styles/responsive.css`](../../../src/styles/responsive.css): `.chat-item-row` gets **`padding-top/bottom: 12px`** under `(pointer: coarse)` only.

**File tree should follow the same split:** drop unconditional `min-height: var(--touch-min)` on `.file-tree-row`; apply touch sizing only under `(pointer: coarse)` (and optionally reinforce at `max-width: 640px` when the file sidebar is a touch overlay — same breakpoint as file-panel mobile rules).

### Related tests today

- [`test/file/file-tree-boot.test.mjs`](../../../test/file/file-tree-boot.test.mjs) — offline/loading boot only; no layout assertions.

---

## Target UX / visual spec

### Desktop / fine pointer (`(hover: hover) and (pointer: fine)` or default without coarse)

| Element | Target (recommended) | Rationale |
|---------|----------------------|-----------|
| `.file-tree-row` vertical padding | **`2px 6px`** (was `6px 8px 6px 4px`) | ~8px less vertical chrome per row |
| `.file-tree-row` `min-height` | **`unset` / `0`** (no floor) | Let line box + padding define height (~24–28px) |
| `.file-tree-host` | **`4px 0`** (was `6px 0`) | Slightly tighter scroll area |
| Row `margin` | Keep **`0 4px`** | Preserves hover pill inset |
| Depth indent step | **`12px`** per level (was `14px`) in TS constants | Modest horizontal gain; optional if QA feels cramped |

### Coarse pointer / touch (`@media (pointer: coarse)`)

| Element | Target |
|---------|--------|
| `.file-tree-row` | **`min-height: var(--touch-min)`** (44px) |
| `.file-tree-row` vertical padding | **`6px 8px`** or match session row **`padding-block: 12px`** if computed height &lt; 44px |

Verify in DevTools device mode and on a real phone: tap row (open file / toggle folder), tap expand chevron, long-press drag still works.

### Accessibility

- **Focus-visible** on rows (`tabIndex = 0`) must remain visible after density change; do not remove outline styles.
- Expand hit (`18px`) on coarse pointer: entire row is already ≥ 44px tall — chevron can stay 18px centered in the row.
- Do not shrink label below **12px** (readability + iOS zoom policy alignment with composer note in DESIGN).

---

## Technical design

### 1. CSS changes (`file-panel.css` only for density)

```css
/* Default: dense rows for mouse / trackpad */
.file-tree-row {
  padding: 2px 6px 2px 4px;
  min-height: 0;
  /* keep display, gap, margin, cursor, border-radius */
}

.file-tree-host {
  padding: 4px 0;
}

@media (pointer: coarse) {
  .file-tree-row {
    min-height: var(--touch-min);
    padding: 6px 8px 6px 4px; /* restore comfortable touch padding */
  }
}
```

**Optional (if QA shows short rows on touch overlay):** duplicate `min-height` inside existing `@media (max-width: 640px)` block for `.file-tree-row` when `.file-sidebar.mobile-open` — only if `(pointer: coarse)` alone is insufficient on desktop touch screens emulating fine pointer.

### 2. TS constants (`file-tree.ts`)

Extract magic numbers to module-level constants (single source for tests):

```ts
/** Horizontal indent per tree depth level (px). */
export const FILE_TREE_DEPTH_INDENT_PX = 12;

/** Base paddingLeft for directory rows (expand chevron column). */
export const FILE_TREE_DIR_BASE_PADDING_PX = 6;

/** Base paddingLeft for file rows (no chevron; aligns with dir + expand). */
export const FILE_TREE_FILE_BASE_PADDING_PX =
  FILE_TREE_DIR_BASE_PADDING_PX + 18; // expand width
```

Use in `appendDirRow` / `appendFileRow` instead of inline `8`, `22`, `14`.

**Do not** add inline `paddingTop`/`paddingBottom` in TS — density stays in CSS.

### 3. Class names (no change required)

Keep existing BEM-style classes for E18/E20 hooks:

- `file-tree-row`, `file-tree-row--dir`, `file-tree-row--file`, `selected`
- `file-tree-expand`, `file-tree-label`, `file-tree-children`
- Empty/loading: `file-tree-empty`, `file-tree-loading`, `file-tree-error`

---

## 2. Exact file change list

### Required — implement

| Path | Action |
|------|--------|
| [`src/styles/file-panel.css`](../../../src/styles/file-panel.css) | Dense default `.file-tree-row` / `.file-tree-host`; `@media (pointer: coarse)` restores `min-height: var(--touch-min)` and touch padding |
| [`src/ui/file-tree.ts`](../../../src/ui/file-tree.ts) | Export indent constants; replace inline `8`, `22`, `14` in `appendDirRow` / `appendFileRow` |

### Tests — add

| Path | Action |
|------|--------|
| [`test/file/file-tree-layout.test.mjs`](../../../test/file/file-tree-layout.test.mjs) | **New** — constants + `paddingLeft` at depth 0–2 |
| [`test/file/file-tree-boot.test.mjs`](../../../test/file/file-tree-boot.test.mjs) | Re-run (regression; already in `test/file/*.test.mjs` glob) |

### Verification + docs — on ship

| Path | Action |
|------|--------|
| [`documentation/plans/verification/feature-21.md`](../verification/feature-21.md) | Manual M1–M5 + automated command checklist; PASS/FAIL sign-off |
| [`documentation/context.md`](../../context.md) | One line under File panel § — density / `(pointer: coarse)` split |

### Explicitly unchanged

| Path | Why |
|------|-----|
| `index.html`, `server.js`, tool definitions | No API or markup change |
| `package.json` | `npm test` already runs `test/file/*.test.mjs` — new layout test picked up automatically |
| Sidebar width, emoji prefixes, empty/loading row padding | Non-goals |

---

## 3. Schema / API changes

**None.** CSS + client tree layout only; no config migration, server routes, or session schema.

---

## Implementation plan (ordered todos)

- [ ] **1. CSS density split** — Update `.file-tree-row` and `.file-tree-host` in [`file-panel.css`](../../../src/styles/file-panel.css); add `@media (pointer: coarse)` block mirroring sidebar pattern.
- [ ] **2. TS indent constants** — Refactor [`file-tree.ts`](../../../src/ui/file-tree.ts) to exported constants; verify dir/file alignment at depth 0–3.
- [ ] **3. Unit tests** — Add [`test/file/file-tree-layout.test.mjs`](../../../test/file/file-tree-layout.test.mjs) (constants + rendered `paddingLeft` on mock tree).
- [ ] **4. Manual QA** — Desktop density + mobile touch targets (checklist in § Test plan; record in verification doc).
- [ ] **5. Docs** — After merge, one line in [`documentation/context.md`](../../context.md) file panel § noting density/touch split.
- [ ] **6. Verification doc** — Create [`documentation/plans/verification/feature-21.md`](../verification/feature-21.md) on ship (copy § Test plan checklists).

---

## Acceptance criteria

Maps backlog **E4**: denser rows; mobile touch per `DESIGN.md` (**44px**, `--touch-min`).

1. **Fine pointer:** With a loaded tree of ≥ 20 files, visible row count in `#fileTreeHost` increases versus pre-change screenshot (or computed row height &lt; 40px per row excluding margin).
2. **Coarse pointer:** `getComputedStyle(row).minHeight` resolves to **44px** (or padding yields ≥ 44px total row box).
3. **Interaction:** Click file opens viewer; click dir toggles expand; keyboard Enter/Space on row still works; drag file to composer unchanged (`FILE_TREE_DRAG_THRESHOLD_PX` = 5).
4. **Selection / hover:** `.file-tree-row.selected` and `:hover` backgrounds unchanged in character (only spacing tighter).
5. **No horizontal clip:** Long basenames still ellipsis; expand chevron not overlapped by label at depth 3+.

---

## Test plan

### Automated (`npm test`)

| File | Cases |
|------|--------|
| [`test/file/file-tree-layout.test.mjs`](../../../test/file/file-tree-layout.test.mjs) (new) | `FILE_TREE_FILE_BASE_PADDING_PX === FILE_TREE_DIR_BASE_PADDING_PX + 18`; depth 2 dir `paddingLeft === base + 2*indent`; depth 2 file `paddingLeft === fileBase + 2*indent` |
| [`test/file/file-tree-boot.test.mjs`](../../../test/file/file-tree-boot.test.mjs) | Re-run unchanged (regression) |

**CSS / media queries:** Node `happy-dom` does not reliably emulate `(pointer: coarse)`. Do **not** block on automated `getComputedStyle` min-height unless a future test harness loads real CSS + `matchMedia` mock — prefer manual mobile QA for touch floor.

### Manual QA

**Prerequisites:** `npm start`, workspace with nested `src/` tree (≥ 3 depth levels), file sidebar expanded.

1. **Desktop (mouse):** Open file panel → note more rows visible in same host height → click/hover/selection still clear.
2. **DevTools → touch emulation** or phone: Open mobile file sidebar → tap files and folders → targets feel full-width and easy to hit (no mis-taps on adjacent rows).
3. **Drag:** Drag file row to composer → chip appears; click row without 5px move still opens viewer.
4. **Collapsed rail:** Toggle sidebar collapse → expand again → tree padding unchanged (no rail regression).
5. **Compare session list:** File tree density should feel closer to chat list on desktop, without violating DESIGN 44px rule on touch.

---

## Edge cases

| Case | Expected |
|------|----------|
| `pointer: fine` on touch-capable laptop (Surface) | Dense rows — user may use precise trackpad; acceptable per DESIGN coarse-media rule |
| Very long filenames | `text-overflow: ellipsis` unchanged |
| Loading row `name …` on dir | Same row classes/padding as normal dir row |
| Empty / error states | `.file-tree-empty` padding unchanged (12px 14px) — not part of row density |
| Future E18 context menu | Row height on coarse pointer must fit menu trigger if added to row chrome |
| `prefers-reduced-motion` | No new motion; spacing-only change |

---

## Parallelism and conflicts

| Parallel safe with | Notes |
|--------------------|-------|
| A1 topbar | Different CSS |
| C3 smart scroll | Unrelated |
| E5 editor tab / E6 stats strip | Different files |
| E20 drag-drop move | E20 may add `.file-tree-row--drop-target` classes — merge CSS in same file; no structural conflict if E21 lands first |

| Serial / soft conflict | Notes |
|------------------------|-------|
| E18 file-tree-crud | May add action buttons on rows — re-check row height on coarse pointer after E18 if both ship close together |

---

## Open questions (resolve during implementation)

1. **Indent step 12 vs 14** — ship 12px with constants for one-line revert, or keep 14px and only fix `min-height` split?
2. **640px overlay duplicate rule** — needed in addition to `(pointer: coarse)` for iPad desktop UA?
3. **Export constants from `file-tree.ts`** — acceptable public API for tests, or duplicate expected values only in test file (prefer export to avoid drift).

---

## Verifier handoff

Create [`documentation/plans/verification/feature-21.md`](../verification/feature-21.md) on ship:

- **Automated:** `npm test` (includes `test/file/file-tree-layout.test.mjs` + `file-tree-boot.test.mjs`)
- **Manual:** M1–M5 from § Test plan (below)
- **Sign-off:** PASS only if acceptance criteria 1–5 and manual checks pass; coarse-pointer row height **44px** per `DESIGN.md` (backlog “40px” = icon-btn, not tree rows)

---

## References

| Doc / file | Anchor |
|------------|--------|
| Backlog E4 | [`product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md) § E4 |
| Touch token | `DESIGN.md` → `spacing.touch-min: "44px"`; Do's: “44px touch targets on session actions” |
| Session precedent | `sidebar.css` + `responsive.css` `(pointer: coarse)` |
| Context file panel | [`documentation/context.md`](../../context.md) § File panel (Step 11) |
