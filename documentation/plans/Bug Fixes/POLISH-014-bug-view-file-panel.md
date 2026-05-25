# POLISH-014 — File panel visible on bug view

| Field | Value |
| --- | --- |
| **ID** | POLISH-014 |
| **Type** | Layout / UX polish |
| **Source** | [`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md) |
| **Status** | Verified (open) — [MIN-93](https://linear.app/minnowai/issue/MIN-93/polish-014-file-panel-on-bug-view) |
| **Related** | BUG-001, POLISH-012, POLISH-013, POLISH-015, MIN-16 |

## Goal

When the user opens the global bug tracker (**All bugs**, `#/bugs`), the **file sidebar** (`#fileSidebar`) and **file viewer split** (`#fileViewerPane`, `#splitResizer`) remain visible and usable alongside the bug board — same as during normal chat work — so triage can reference workspace files and (once shipped) **POLISH-012** linked paths/snippets.

## Problem (current behavior)

Today the bugs screen is a **full-viewport overlay** that replaces the entire chat shell:

1. **`#globalBugsView`** is a sibling of **`#appBody`** in [`index.html`](../../../index.html) (not inside the file/chat layout).
2. **`openGlobalBugs()`** in [`src/ui/global-bugs-page.ts`](../../../src/ui/global-bugs-page.ts):
   - Adds `is-open` on `#globalBugsView` (CSS: `display: flex`, `height: 100vh`).
   - Adds `hidden` on **`#appBody`**, which contains **chat sidebar**, **`#workspaceSplit`** (chat + viewer), and **`#fileSidebar`**.
   - Hides `header.topbar` (tracked separately as **POLISH-015**).

Result: bugs-only chrome; no file tree, no viewer, no split ratio / collapse state from [`src/ui/file-layout.ts`](../../../src/ui/file-layout.ts).

MIN-16 phase 4 intentionally hid the chat shell (“hide chat shell while open” in [`documentation/plans/min-16-global-bugs.md`](../../min-16-global-bugs.md)); POLISH-014 revises that decision for the **file panel only**.

## Desired behavior

### Desktop (≥641px, non-mobile file layout)

| Region | On `#/bugs` |
| --- | --- |
| File sidebar | Visible; collapse/expand works (`toggleFileSidebarLayout`, persisted `filePanel` prefs) |
| File viewer split | Visible when `viewerOpen`; resizer and `showViewerSplit` / `hideViewerSplit` unchanged |
| Chat sidebar | **Product choice** — recommend **visible** (switch chats / All bugs entry) unless width is unusable; document in implementation |
| Chat messages + composer | Hidden (bugs replaces center work area) |
| Bug board | Occupies center column (kanban + filters), scrollable |
| Top bar | Out of scope here — **POLISH-015** |

### File ↔ bug workflow (future-friendly)

- User can open a path from the file tree while on All bugs.
- When **POLISH-012** adds file/code links on cards, clicking a link should open the viewer (reuse existing file-open paths from tree/viewer).
- **POLISH-013** “Report bug” from editor can stay on chat/bugs flows; no change required for POLISH-014 beyond layout.

### Mobile (≤640px, `isMobileLayout()`)

Define explicitly in implementation (pick one and test):

| Option | Behavior |
| --- | --- |
| **A (recommended)** | Same as chat: file tree overlay via `openMobileFileSidebar`; bug board full width when tree closed |
| **B** | Hide file panel on bugs route; show only bug board + optional “Files” affordance in bugs header |

Record choice in PR / `context.md` when implemented.

## Root cause (technical)

```
body
├── header.topbar          ← hidden by openGlobalBugs()
├── main#globalBugsView    ← full 100vh overlay when .is-open
├── … settings / benchmark …
└── div#appBody.hidden     ← entire shell hidden, including fileSidebar
    ├── aside#chatSidebar
    ├── div#workspaceSplit
    │   ├── div#mainColumn (chat)
    │   ├── #splitResizer, #fileViewerPane
    └── aside#fileSidebar
```

File UI is **structurally inside** `#appBody`; hiding `appBody` cannot show the file panel without DOM or visibility changes.

## Approach options

### Option 1 — Center-pane swap inside `#appBody` (recommended)

**Idea:** Treat All bugs like a **center route** inside the existing flex shell: keep `appBody` visible, swap `mainColumn` chat UI for the bug board.

| Step | Action |
| --- | --- |
| DOM | Move `#globalBugsView` **inside** `#workspaceSplit` or `#mainColumn` (or wrap both in a `centerPane` container) |
| JS | `openGlobalBugs()`: remove `shell.classList.add('hidden')`; toggle e.g. `document.documentElement.classList.add('route-bugs')` or `appBody.classList.add('bugs-route')` |
| JS | Hide chat-specific nodes: `#chatArea` viewport, `.input-bar`, tool/question hosts, terminal/stats panels if they share `mainColumn` |
| CSS | `.bugs-route #globalBugsView` / `.global-bugs-page`: `flex: 1`, `min-height: 0`, `height: auto` (not `100vh`); drop full-screen overlay rules |
| CSS | Ensure `#fileSidebar` + `#workspaceSplit.viewer-open` layout unchanged ([`src/styles/file-panel.css`](../../../src/styles/file-panel.css), [`applyFileSidebarVisuals`](../../../src/ui/file-layout.ts)) |

**Pros:** Smallest conceptual change; reuses file panel state and init ([`src/ui/init-file-panel.ts`](../../../src/ui/init-file-panel.ts)).  
**Cons:** Must audit every `appBody.hidden` caller and z-index/stacking with settings/benchmark overlays.

### Option 2 — Split shell: file column outside `appBody`

**Idea:** Lift `#fileSidebar` (+ viewer pane) to a parent wrapper so bugs overlay only covers “left + center”.

**Pros:** Bugs page could stay a top-level `<main>`.  
**Cons:** Large HTML/CSS move; breaks parity with settings/benchmark patterns; higher regression risk.

### Option 3 — Duplicate file panel in `#globalBugsView`

**Not recommended** — two trees/viewers, double init, sync nightmares.

## Recommended design (Option 1)

### Layout sketch (desktop)

```text
┌──────────────────────────────────────────────────────────── topbar (POLISH-015) ─┐
├──────────┬──────────────────────────────────────┬────────────┬──────────────────┤
│ Chats    │  All bugs (filters + kanban)       │  Viewer    │  File tree       │
│ sidebar  │  #globalBugsView / #globalBugsList   │  (optional)│  #fileSidebar    │
│          │                                      │            │                  │
└──────────┴──────────────────────────────────────┴────────────┴──────────────────┘
         appBody visible — chat column hidden, bugs in mainColumn region
```

### Routing / lifecycle

| Event | Behavior |
| --- | --- |
| `openGlobalBugs()` | Close settings; set bugs route class; show bugs mount; hide chat column UI; **do not** hide `appBody` |
| `closeGlobalBugs()` | Remove route class; unmount kanban; restore chat column; hash → `#/` |
| `hashchange` → `#/bugs` | Same as today, but layout hooks updated |
| `switchChat` / sidebar | Keep existing refresh of `renderGlobalBugsList()` when bugs open ([`src/ui/sidebar.ts`](../../../src/ui/sidebar.ts)) |
| Settings open | Still `closeGlobalBugs()` first ([`src/ui/settings-page.ts`](../../../src/ui/settings-page.ts)) |

### API surface (no new public tools)

- `isGlobalBugsPageOpen()` — unchanged semantics (`#globalBugsView.is-open`).
- `bug_*` tools — still require All bugs screen ([`src/tools/bug-board-tools.ts`](../../../src/tools/bug-board-tools.ts)).

## Implementation todos

- [ ] **DOM** — Relocate `#globalBugsView` under `#appBody` / `#workspaceSplit` / `#mainColumn`; remove duplicate full-page `100vh` assumption.
- [ ] **JS `global-bugs-page.ts`** — Stop adding `hidden` on `#appBody`; add route class on `html` or `appBody`; scope topbar hide to POLISH-015 follow-up (or leave hidden until POLISH-015 ships — document interim).
- [ ] **CSS `global-bugs-page.css`** — Flex child layout: `flex: 1`, `min-height: 0`, internal scroll on `.global-bugs-page-body`; remove or gate `height: 100vh` / `display: none` overlay pattern.
- [ ] **CSS shell** — Add `.route-bugs` (name TBD) rules: hide `.chat-viewport`, `.input-bar`, empty-state in main column; show `.global-bugs-page.is-open` in center.
- [ ] **Regression audit** — Grep `appBody` + `hidden`, `globalBugsView`, `isGlobalBugsPageOpen` (settings, benchmark, sidebar, bug-board refresh).
- [ ] **Mobile** — Implement option A or B; verify `fileSidebarBackdrop` z-index vs bugs header.
- [ ] **File panel** — Manual pass: collapse sidebar, open viewer, resize split, refresh tree — all on `#/bugs`.
- [ ] **BUG-001** — Re-test first-click open/close after layout change (hash + `btnAllBugs` race).
- [ ] **Tests** — Add/update UI test if harness can assert DOM visibility (optional: `global-bugs-page` route class + `#fileSidebar` not `hidden` ancestor).
- [ ] **Docs** — Update [`documentation/context.md`](../../context.md) bug tracker bullet; mark MIN-16 plan note “shell hidden” superseded for file panel; link this plan.

## Files likely touched

| File | Change |
| --- | --- |
| [`index.html`](../../../index.html) | Reparent `#globalBugsView` |
| [`src/ui/global-bugs-page.ts`](../../../src/ui/global-bugs-page.ts) | Open/close visibility model |
| [`src/styles/global-bugs-page.css`](../../../src/styles/global-bugs-page.css) | In-shell flex layout |
| [`src/styles/sidebar.css`](../../../src/styles/sidebar.css) or new `bugs-route.css` | Route-specific hide/show |
| [`documentation/context.md`](../../context.md) | Behavior note + plan link |
| [`documentation/plans/min-16-global-bugs.md`](../../min-16-global-bugs.md) | Footnote: file panel exception (POLISH-014) |

**Read-only reference (no change unless regression):** [`src/ui/file-layout.ts`](../../../src/ui/file-layout.ts), [`src/ui/init-file-panel.ts`](../../../src/ui/init-file-panel.ts), [`src/state/file-panel.ts`](../../../src/state/file-panel.ts), [`src/ui/bug-board.ts`](../../../src/ui/bug-board.ts).

## Test plan

### Manual

1. From chat, click **All bugs** — kanban visible; file sidebar visible; tree loads workspace files.
2. Open a file from tree — viewer opens; split resizer works; stats strip sync if applicable.
3. Collapse file sidebar — rail icon state correct after navigate away and back.
4. Close bugs (back button / hash `#/`) — chat column returns; file panel state preserved.
5. Deep link: load app with `#/bugs` — same layout as button open.
6. Open settings from bugs — bugs close, settings full screen (unchanged policy).
7. Narrow viewport ≤640px — document chosen mobile behavior; no trapped focus in backdrop.
8. **BUG-001** — first click All bugs stays open.

### Automated (optional)

- Extend or add `test/ui/global-bugs-page.test.mts` (if present): with bugs open, `#fileSidebar` is not inside an ancestor with `.hidden` (or `appBody` lacks `hidden`).

```bash
npm test
npx tsc --noEmit
```

## Out of scope

| Item | Owner |
| --- | --- |
| Top bar visible on bugs | **POLISH-015** |
| Bug categories / file links on cards | **POLISH-012** |
| Editor context menu Report bug | **POLISH-013** |
| Kanban title/description layout | **POLISH-010** |
| Full bug detail page | Later polish (bug-hunt backlog) |

## Dependencies and ordering

| Order | Item | Reason |
| --- | --- | --- |
| Can ship alone | POLISH-014 | Layout-only |
| Better together | POLISH-015 | Shared `openGlobalBugs` / topbar visibility |
| After | POLISH-012 | Link clicks need viewer visible (validates this work) |
| Re-test | BUG-001 | Layout change may fix or worsen hash race |

## Acceptance criteria

- [ ] With `#/bugs` open, `#fileSidebar` is visible on desktop without opening settings or closing bugs.
- [ ] File viewer can open and close while bugs remain open.
- [ ] `filePanel` prefs (collapsed, split ratio, `viewerOpen`) persist across bugs open/close.
- [ ] No duplicate file trees; single `#fileTreeHost` / `#fileViewerHost`.
- [ ] Chat composer and message list are not visible behind the bug board.
- [ ] Mobile behavior documented and matches chosen option A or B.

## Open questions (resolve before implementation)

1. **Chat sidebar on bugs route** — keep visible (recommended) or hide to give kanban more width?
2. **Interim top bar** — hide until POLISH-015, or unhide topbar in same PR if trivial?
3. **Bugs header** — keep `.global-bugs-page-header` (back, title, summary) inside center column, or merge back into topbar later with POLISH-015?

---

*Plan only — no code changes. Implementation PR should reference POLISH-014 and update `context.md`.*


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-93](https://linear.app/minnowai/issue/MIN-93/polish-014-file-panel-on-bug-view)
