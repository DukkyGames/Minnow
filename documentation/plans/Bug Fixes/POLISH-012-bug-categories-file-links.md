# POLISH-012 — Bug categories and file links

| Field | Value |
| --- | --- |
| **ID** | POLISH-012 |
| **Type** | Polish / feature |
| **Status** | Verified baseline 2026-05-24 — not implemented; Linear [MIN-91](https://linear.app/minnowai/issue/MIN-91/polish-012-bug-categories-file-links) |
| **Source** | [`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md) |
| **Related** | MIN-16, POLISH-010, POLISH-013, POLISH-014, POLISH-023 |

## Goal

Extend the global bug tracker so each bug has a **category** for taxonomy and filtering, and **one or more links** to workspace files (optional line range and captured code snippet). Categories and links must appear on Kanban cards and in filters on `#/bugs`, and be available to agents via the `bug_*` tools and persisted in `~/.minnow/bugs/state.json`.

## Current state (baseline)

| Area | Today |
| --- | --- |
| **Model** | `BugCard` in `src/types.ts`: `id`, `title`, `description`, `severity`, `column`, `workspacePath`, timestamps, optional pipeline fields (`notes`, `planPath`, `chatId`, run ids). No category or file/code links. |
| **Persistence** | `BugsState { version: 1, bugs: BugCard[] }` in `src/state/bug-board-store.ts`; mirrored server-side in `server/config/validators.js` (`validateBugsState` / `ensureBugCard`). |
| **UI** | `src/ui/bug-board.ts` Kanban + add form (title, description, severity). `src/ui/global-bugs-page.ts` filters: workspace scope, column, hide complete. Cards show severity, workspace, truncated description/notes. **Open plan** uses `openFileInViewer(planPath)` only. |
| **Tools** | `bug_add` / `bug_update` / `bug_get_state` in `src/tools/bug-board-tools.ts` + schemas in `src/tools/definitions.ts`. No category or link fields. |
| **File viewer** | `openFileInViewer` accepts `skipUnsavedGuard` and `asCode` only — **no line-range navigation** yet. |

## Product requirements

### Categories

- Each bug has **one primary category** (required on new bugs after rollout; optional during migration with default).
- **Preset categories** (v1): `ui`, `tools`, `agents`, `benchmark`, `docs`, `other` — labels in UI: UI, Tools, Agents, Benchmark, Docs, Other. Aligns with bug-hunt examples (UI, Tools, Benchmark) and Minnow surface areas.
- **Filtering:** `#/bugs` filter bar adds **Category** (All + each preset). Composes with existing scope / column / hide-complete filters via `collectGlobalBugs`.
- **Display:** Category chip on Kanban cards (meta row, distinct from severity). Color tokens reuse orchestrate board category chip pattern where sensible (`bt--*` style or new `bug-cat--*` classes).
- **Agents:** `bug_add` accepts `category`; `bug_update` can change it. Debugger/planner prompts mention setting category when filing from investigation.

**Deferred (explicit out of scope for POLISH-012 v1):**

- User-defined category CRUD and `~/.minnow/bugs/categories.json`.
- Multi-label tags per bug.

### File and code links

- Each bug may have **0..N links** (`BugLink[]`), ordered, stable `id` per link for updates.
- Per link fields:

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Short stable id (e.g. `link-1` or uuid fragment) for `bug_update` patches |
| `path` | yes | Workspace-relative path, normalized (same rules as `planPath`) |
| `startLine` | no | 1-based inclusive |
| `endLine` | no | 1-based inclusive; must be ≥ `startLine` when both set |
| `snippet` | no | Captured source text (max length cap, e.g. 8 KB) |
| `label` | no | Short display override (defaults to `path` or `path:start-end`) |

- **Display on card:** Show category + link summary (e.g. `2 files` or first path truncated). Full list on card only if ≤2 links; otherwise count + expand in detail (see POLISH-023).
- **Actions:** Click link → open file in viewer (`openFileInViewer`); if line range present, scroll/reveal range (new viewer option — see below).
- **Validation:** Reject paths outside workspace, `..` segments, absolute paths. Strip or truncate snippet on persist.
- **Agents:** `bug_add` optional `links` array; `bug_update` supports `links` replace or `add_links` / `remove_link_ids` (pick one strategy in implementation — recommend **full replace** for v1 simplicity, document in tool description).

### Visibility and layout

- Kanban cards and filter summary must surface category + links without waiting for POLISH-023 detail panel.
- **POLISH-014** (file panel visible on `#/bugs`) improves link triage but is not a blocker: v1 may close bugs view when opening a link (same as **Open plan** today); document follow-up to keep panel open once POLISH-014 lands.

## Proposed data model

```ts
/** Preset bug taxonomy (v1). */
export type BugCategory =
  | 'ui'
  | 'tools'
  | 'agents'
  | 'benchmark'
  | 'docs'
  | 'other';

/** Workspace-relative file/code reference on a bug. */
export interface BugLink {
  id: string;
  path: string;
  startLine?: number;
  endLine?: number;
  snippet?: string;
  label?: string;
}

export interface BugCard {
  // ...existing fields...
  category: BugCategory;
  links?: BugLink[];
}
```

**Persistence bump:**

```ts
export type BugsState = {
  version: 2;
  bugs: BugCard[];
};
```

**Migration (`parseBugsState`):**

- `version: 1` → upgrade each card: `category: 'other'`, `links: []` omitted.
- Unknown `category` strings on load → coerce to `other`.
- Invalid links dropped with console/status warning (do not drop entire card).
- Write back as `version: 2` on next save.

Mirror the same rules in `server/config/validators.js` so API `PUT /api/config/bugs` stays consistent.

## Architecture decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Category cardinality | Single required enum | Matches filter UX and bug-hunt “assign/filter by category” |
| Custom categories | Out of v1 | Avoid settings UI scope; `other` covers edge cases |
| Link identity | Per-link `id` | Enables surgical `bug_update` without replacing whole bug |
| Snippet storage | Inline on card | Small snippets; POLISH-023 attachments are separate blobs |
| `bug_update` links | Full array replace in v1 | Simpler validation; agents send complete `links` when editing |
| Default category | `other` | Safe migration for legacy bugs |
| Line navigation | Extend `OpenFileInViewerOptions` with `startLine?` / `endLine?` | Reuse existing viewer; scroll after `mountEditor` (CodeMirror `scrollIntoView`) |
| Read-only snippet preview | Optional: `openAttachmentSnapshotInViewer` pattern | If path missing but snippet present, show read-only excerpt |

## Implementation plan (phased)

### Phase 1 — Schema and store

- [ ] Add `BugCategory`, `BugLink`, extend `BugCard` in `src/types.ts`.
- [ ] Bump `BugsState` to `version: 2`; implement migration in `parseBugsState` / `ensureBugCardShape` (`src/state/bug-board-store.ts`).
- [ ] Extend `AddBugInput`, `UpdateBugPatch`, `addBug`, `updateBug` for `category` and `links`.
- [ ] Add `isBugCategory`, link normalizers (path trim, line bounds, snippet max length).
- [ ] Update `server/config/validators.js` `ensureBugCard` + `validateBugsState` for v2 fields.
- [ ] Unit tests: `test/state/bug-board-store.test.mts` (migration v1→v2, invalid links, category coercion).

### Phase 2 — Tools and agent docs

- [ ] Extend `validateBugAddArgs` / `validateBugUpdateArgs` in `src/tools/bug-board-tools.ts`.
- [ ] Update tool schemas in `src/tools/definitions.ts` (`category` enum, `links` array schema).
- [ ] Update `src/chat/prompts/modes/debug.full.md` and `debug.lite.md` with category + links examples.
- [ ] Tests: `test/tools/bug-board-tools.test.mts` round-trip add/update with links.

### Phase 3 — Filtering and aggregation

- [ ] Extend `CollectGlobalBugsOptions` with `category?: BugCategory | 'all'` (`src/state/global-bugs.ts`).
- [ ] Wire filter in `global-bugs-page.ts` + `index.html` control (mirror column filter).
- [ ] Pass options through `setGlobalBugKanbanOptions` / `bug-board.ts` empty state copy.
- [ ] Tests: `test/state/global-bugs.test.mts` category filter cases.

### Phase 4 — UI (cards, add form, link actions)

- [ ] Add category `<select>` to add-bug form (`renderAddBugForm` in `bug-board.ts`).
- [ ] Render category chip + link row on `renderBugCard` (compact; respect POLISH-010 two-line title/description when that ships).
- [ ] Link click handler: `closeGlobalBugs()` then `openFileInViewer(path, { startLine, endLine })` until POLISH-014.
- [ ] Extend `openFileInViewer` / editor mount to scroll to `startLine` (and optionally highlight range).
- [ ] CSS: `src/styles/global-bugs-page.css` — category chips, link list, truncation.
- [ ] Manual QA checklist on `#/bugs` (see Test plan).

### Phase 5 — Documentation

- [ ] Update `documentation/context.md` bug tracker row (schema v2, filters, links).
- [ ] Add MIN-16 v2 note or short `documentation/plans/min-16-global-bugs-v2.md` referencing POLISH-012 scope.

## UI mock (Kanban card)

```
┌─────────────────────────────────────┐
│ Fix tools menu missing on mobile   │  ← title (POLISH-010 line 1)
│ Repro: open #/bugs on narrow…      │  ← description line 2
│ [UI]  high · my-project             │  ← category chip + severity + ws
│ src/ui/global-bugs-page.ts (+2)    │  ← link summary
│ [Investigate] [Open plan] [Open …]  │
└─────────────────────────────────────┘
```

## Tool API sketch (v1)

**`bug_add`** — add optional:

- `category`: enum (default `other` if omitted)
- `links`: `{ id?, path, start_line?, end_line?, snippet?, label? }[]` (`id` auto-generated if missing)

**`bug_update`** — add optional:

- `category`: enum
- `links`: full replacement array (omit = unchanged)

**`bug_get_state`** — returns v2 snapshot including new fields.

## Dependencies and sequencing

| Item | Relationship |
| --- | --- |
| **POLISH-010** | Independent layout polish; implement before or in parallel with card rendering in Phase 4 |
| **POLISH-013** | **Depends on POLISH-012** schema — Report bug pre-fills `links` + `category` |
| **POLISH-014** | **Enhances** link UX (keep file panel while on `#/bugs`); not required for schema/tools |
| **POLISH-023** | **Builds on** links/category for full detail panel + attachments; card summary still needed in 012 |
| **MIN-16** | Update global bugs plan when v2 ships |

Recommended order: **POLISH-012** → **POLISH-013** → **POLISH-014** / **POLISH-023** (014 and 023 can parallelize after 012).

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Large snippets bloat `state.json` | Hard cap per snippet and per bug total link payload |
| Opening link closes `#/bugs` | Document; fix with POLISH-014 split layout |
| Server/client schema drift | Single validation story in validators.js + shared test vectors |
| Agent fills invalid paths | Validate in store; return clear tool errors |
| No line scroll in viewer | Phase 4 explicitly adds `startLine`/`endLine` to viewer options |

## Test plan

- [ ] **Store:** v1 JSON loads as v2 with `category: other`; add/update with links; invalid link stripped; snippet truncated.
- [ ] **Tools:** `bug_add` with category + links; `bug_update` category and links replace; errors for bad enum/path.
- [ ] **Global bugs:** filter by category; combined with workspace + column filters.
- [ ] **UI (manual):** create bug with category UI; see chip + links on card; click link opens correct file; line range scrolls when set.
- [ ] **Regression:** existing bugs without new fields still load; `bug_get_state` backward-compatible for agents (new fields appear, agents ignore unknown keys).

## Open questions (resolve before implementation)

1. **Category default on manual add form:** default `other` or infer last-used from `sessionStorage`?
2. **Link editor in UI:** v1 manual path input only, or wait for POLISH-013 and agents-only links for v1?
3. **Snippet in card UI:** show truncated snippet on card or links-only until POLISH-023?
4. **Benchmark category:** keep as preset even if benchmark UI is niche, or merge into `tools`?

**Recommendation:** (1) default `other`; (2) minimal manual “Add link” row in add form (path + optional lines) so humans are not blocked before POLISH-013; (3) links-only on card, snippet in detail later; (4) keep `benchmark` preset per bug-hunt.

## Todos (implementation checklist)

- [ ] **P1** Types + `BugsState` v2 + client store migration
- [ ] **P1** Server `validateBugsState` / `ensureBugCard` parity
- [ ] **P1** Store unit tests
- [ ] **P2** `bug_add` / `bug_update` / definitions + tool tests
- [ ] **P2** Debug mode prompt updates
- [ ] **P3** `collectGlobalBugs` category filter + HTML control
- [ ] **P3** Global bugs filter tests
- [ ] **P4** Kanban card + add-form UI + link open + viewer line scroll
- [ ] **P4** Styles + manual QA
- [ ] **P5** `context.md` + MIN-16 plan note

## Out of scope (POLISH-012)

- Context menu **Report bug** (POLISH-013)
- Split layout with file panel on `#/bugs` (POLISH-014)
- Full bug detail drawer/page and image/file attachments (POLISH-023)
- User-defined category management
- Linear export, cross-device sync
- Changing workflow columns or severity model

---

## Verification (APPROVED)

**Date:** 2026-05-24  
**Verifier:** Agent (POLISH-012 plan review)  
**Plan poll:** 25-minute wait completed before Linear filing (per workflow).

### Code path verification

| Claim | Result |
| --- | --- |
| `BugCard` has no `category` or `links` | **Confirmed** — `src/types.ts` L295–315 |
| `BugsState` is `version: 1` only | **Confirmed** — `src/state/bug-board-store.ts` L15–17, `parseBugsState` L65–74 |
| Server `validateBugsState` / `ensureBugCard` v1 only | **Confirmed** — `server/config/validators.js` L220–233 |
| `validateBugAddArgs` — title, description, severity only | **Confirmed** — `src/tools/bug-board-tools.ts` L52–60 |
| `CollectGlobalBugsOptions` — scope, column, hideComplete; no category | **Confirmed** — `src/state/global-bugs.ts` L19–24 |
| `#/bugs` filters: scope, column, hide complete (no category) | **Confirmed** — `global-bugs-page.ts` + `index.html` IDs |
| Add form: title, description, severity only | **Confirmed** — `renderAddBugForm` in `bug-board.ts` L213–257 |
| **Open plan** uses `openFileInViewer(planPath)` only | **Confirmed** — `bug-board.ts` L117 |
| `OpenFileInViewerOptions` — no line range | **Confirmed** — `file-viewer.ts` L447–450 (`skipUnsavedGuard`, `asCode` only) |
| Orchestrate category chip pattern (`bt--*`) exists for reuse | **Confirmed** — `orchestrate-board.ts` L741, `orchestrate-board.css` L477+ |
| Store/tool tests exist (no category/link cases yet) | **Confirmed** — `test/state/bug-board-store.test.mts`, `test/tools/bug-board-tools.test.mts` |
| No `BugCategory` / `BugLink` types in codebase | **Confirmed** — grep `src/` |

### Bug-hunt alignment

[documentation/bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) § POLISH-012 (categories, file/code links, `#/bugs` + `bug_*` tools) matches this plan. Tracker status **Requested**.

### Plan quality

- Phased implementation (schema → tools → filters → UI → docs) is sequenced correctly; **POLISH-013** correctly depends on this schema.
- v2 migration (`category: other`, drop invalid links) is safe for existing `~/.minnow/bugs/state.json`.
- Open questions resolved with clear recommendations (default `other`, minimal manual link row, links-only on card, keep `benchmark` preset).
- Line navigation via extended `openFileInViewer` is the right integration point; POLISH-014 documented as follow-up UX enhancement.
- Risks (snippet bloat, server/client drift) have concrete mitigations in plan.

### Outcome

**APPROVED** — Plan is ready for implementation. Linear issue filed for tracking.

---

*Plan only — no application code changes in this item.*
