---
name: POLISH-023 — Bug detail view + attachments
overview: Add a dedicated bug detail surface on #/bugs with full metadata, edit actions, and persisted file/image/URL attachments stored under ~/.minnow/bugs/.
source: documentation/bug-hunt-session-2026-05-24.md (POLISH-023)
related:
  - documentation/bug-hunt-session-2026-05-24.md
  - documentation/plans/min-16-global-bugs.md
  - documentation/context.md (Bug tracker / MIN-16)
  - POLISH-010 (title + description layout on cards)
  - POLISH-012 (categories + file/code links)
  - POLISH-013 (Report bug context menu)
  - POLISH-014 (file panel visible in bug view)
  - POLISH-015 (keep top bar in bug tracker)
  - BUG-001 (bugs view open/close flash) — layout/routing neighbor
todos:
  - id: product-decisions
    content: Confirm detail UX (split panel vs full page), hash route (#/bugs/:id), and attachment size/type limits
    status: pending
  - id: schema-v2
    content: Design BugCard v2 fields — attachments[], links[], category?, history[] — with migration in parseBugsState / server validators
    status: pending
  - id: attachment-storage
    content: Define ~/.minnow/bugs/attachments/<bugId>/ layout + GET/PUT/delete API (or multipart upload endpoint)
    status: pending
  - id: store-crud
    content: Extend bug-board-store addBug/updateBug/removeAttachment + orphan cleanup on bug delete
    status: pending
  - id: detail-ui-shell
    content: Add bug detail panel/page in global-bugs-page + bug-board; wire card click vs chat-open click targets
    status: pending
  - id: detail-ui-fields
    content: Render full title, description, notes, severity, column, workspace, timestamps, plan path, run ids, chat link
    status: pending
  - id: attachment-ui
    content: Upload picker, thumbnail grid, file download/open, URL chips; reuse processFile limits from attachments/
    status: pending
  - id: edit-in-detail
    content: Inline or form edit for title/description/severity/column; save via store (not agent-only)
    status: pending
  - id: tools-schema
    content: Extend bug_add / bug_update / bug_get_state schemas for attachments and links (agent + UI parity)
    status: pending
  - id: routing-hash
    content: Support #/bugs and #/bugs/<bugId>; back/close restores kanban selection state
    status: pending
  - id: layout-deps
    content: Coordinate with POLISH-014/015 — detail panel width when file sidebar + topbar visible
    status: pending
  - id: polish-012-013-hooks
    content: Stub link/category sections in detail view; document integration points for POLISH-012/013
    status: pending
  - id: tests-store
    content: Unit tests for attachment metadata parsing, migration, orphan paths
    status: pending
  - id: tests-ui
    content: DOM tests for open detail, add/remove attachment mock, deep link hash
    status: pending
  - id: manual-verify
    content: Dogfood on #/bugs — create bug, attach screenshot, open in viewer, investigate chat link
    status: pending
  - id: docs-context
    content: Update documentation/context.md after implementation; mark POLISH-023 resolved in bug-hunt doc
    status: pending
isProject: false
---

# POLISH-023 — Bug detail view + rich attachments

| Field | Value |
|-------|-------|
| **ID** | POLISH-023 |
| **Type** | Polish / feature (bug tracker UX) |
| **Status** | **APPROVED** (verified 2026-05-24 — implementation pending) |
| **Source** | [`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md) — POLISH-023 |
| **Area** | `#/bugs`, `src/ui/bug-board.ts`, `src/ui/global-bugs-page.ts`, `src/state/bug-board-store.ts`, `~/.minnow/bugs/` |
| **Severity** | N/A (enhancement) |

---

## Summary

Today the **All bugs** screen (`#/bugs`) is a Kanban of truncated cards plus a minimal **Add bug** form. Cards with `chatId` navigate to the investigation chat on click; there is no way to read the full description, manage attachments, or edit a bug without agent tools (`bug_add` / `bug_update`) while the page is open.

POLISH-023 adds a **bug detail view** (panel or dedicated route) and **persisted attachments** (images, files, optional URLs) with previews in that view. Creation and editing flows (including future **Report bug** from POLISH-013) should support add/remove attachments without requiring the agent.

---

## Problem statement

| | |
|---|---|
| **Expected** | Click any bug card → see full metadata, linked plan/chat, file/code links (when POLISH-012 lands), and attachments with thumbnails; edit and attach files from the UI. |
| **Actual** | Cards truncate description (160 chars) and notes (200 chars); click only opens chat when `chatId` is set; no attachment model in `BugCard` or on disk. |
| **Impact** | Triage and documentation happen outside Minnow (screenshots in chat, external issue trackers) or via agent tools only. |

---

## Current implementation (audit)

### Data model (`src/types.ts` — `BugCard`)

Fields today: `id`, `title`, `description`, `severity`, `column`, `workspacePath`, `createdAt`, `updatedAt`, optional `notes`, `planPath`, `chatId`, `investigateRunId`, `planRunId`, `fixRunId`. No `attachments`, `links`, `category`, or change history.

### Persistence

- File: `~/.minnow/bugs/state.json` (`BugsState`: `{ version: 1, bugs: BugCard[] }`).
- API: `GET/PUT /api/config/bugs` via `src/config/api-client.ts`; validation in `server/config/validators.js`.
- Store: `src/state/bug-board-store.ts` — `parseBugsState` / `ensureBugCardShape`, `addBug`, `updateBug`, `touchBugsStore` → `emitBugsChange`.

### UI (`src/ui/bug-board.ts`, `src/ui/global-bugs-page.ts`)

- `mountGlobalBugKanban` renders columns + `renderBugCard` + `renderAddBugForm`.
- Card click: only if `bug.chatId` → `openGlobalBugInChat` (closes `#/bugs`, shows chat shell).
- Pipeline actions on card: Investigate, Plan fix, Start fix, Open plan (`src/chat/bug-board/pipeline.ts`).
- Global page hides `#appBody` and `header.topbar` on open (conflicts with **POLISH-014** / **POLISH-015** — layout work is a dependency, not blocking schema design).

### Tools (`src/tools/bug-board-tools.ts`)

- `bug_add`: title, description, severity, optional `bug_id`.
- `bug_update`: column, notes, plan_path, investigate/plan run ids.
- Gated: All bugs screen must be open (`isGlobalBugsPageOpen`).

### Composer attachments (reference only)

- `src/attachments/store.ts` + `processFile` — ephemeral pending files for chat send, not persisted to bugs.
- Reuse **processing rules** (MIME, size, image data URLs) for bug uploads; do **not** store large base64 blobs inside `state.json`.

### Related polish (out of scope for v1 implementation here, in scope for detail layout)

| ID | Relationship |
|----|----------------|
| POLISH-010 | Detail view is the right place for full title + description layout (cards stay compact). |
| POLISH-012 | Detail sections for **category** and **file/code links**; schema should reserve fields. |
| POLISH-013 | Report bug flow should create bug + optional attachments + links in one shot. |
| POLISH-014 | Detail panel must fit split layout when file sidebar stays visible. |
| POLISH-015 | Top bar visible on `#/bugs` affects detail header chrome. |

---

## Desired behavior

### Detail view

1. **Open:** User clicks a kanban card (primary hit target) → detail opens. Secondary actions (Investigate, etc.) remain on card or move to detail toolbar — avoid accidental navigation when opening detail.
2. **Content:** Full title, description, notes, severity, column (workflow status), workspace label, `createdAt` / `updatedAt`, `planPath` (open in file viewer), investigation **Open chat** when `chatId` set, run id fields for debugging.
3. **Edit:** User can edit title, description, severity, column, notes from detail (persist via `updateBug` / extended patch). Agent `bug_update` remains supported.
4. **Close:** Back control or Escape returns to Kanban; optional deep link `#/bugs/<bugId>` restores selection on reload.
5. **History (v2 optional):** Append-only audit log (`column` changes, attachment add/remove) — defer if scope tight; at minimum show `updatedAt`.

### Attachments

1. **Types:** Images (screenshots), generic files (logs, zips, text), optional **URL** links (no blob; stored as metadata only).
2. **Add:** File picker + drag-drop on detail (and later add-bug form / Report bug modal).
3. **Display:** Thumbnails for images; icon + name + size for files; external link row for URLs.
4. **Remove:** Per-attachment delete with confirm for non-empty bugs.
5. **Open:** Images inline/lightbox; files via existing download/open path (tool server or blob URL).
6. **Limits:** Align with composer attachment policy (document max sizes in plan implementation — e.g. reject > N MB, cap count per bug).

### Agent parity

- `bug_add` / `bug_update` accept attachment descriptors (paths after upload, or server-side ingest) so agents filing bugs from `#/bugs` can attach repro artifacts.
- `bug_get_state` returns attachment metadata in JSON.

---

## Design decisions (to confirm before coding)

### 1. Detail presentation

| Option | Pros | Cons |
|--------|------|------|
| **A. Right split panel** (Kanban left, detail right) | Keeps board context; fits POLISH-014 split shell | Narrow Kanban on small screens |
| **B. Full-width detail overlay** | Simple on mobile | Hides board until back |
| **C. Replace main column** (like settings) | Clear focus | Loses Kanban unless split |

**Recommendation:** **A** on wide viewports (≥ ~900px), **B** below breakpoint — matches file-panel split patterns elsewhere in the app.

### 2. Card click vs chat navigation

- **Proposal:** Card body click → detail; explicit **Open chat** button in detail (and optional small icon on card) → `openGlobalBugInChat`.
- Stops conflating “inspect bug” with “jump to investigation chat.”

### 3. Schema version

| Approach | Notes |
|----------|-------|
| **Bump `BugsState.version` to `2`** | Clean attachment array on `BugCard`; migration copies v1 bugs unchanged. |
| **Stay v1 + optional fields** | Simpler diff; `ensureBugCardShape` already strips unknown fields — attach `attachments?: BugAttachment[]` without version bump if server validator allows. |

**Recommendation:** **`version: 2`** in `state.json` with parser accepting v1 for one release (migrate on load).

### 4. Attachment storage (not in JSON blob)

```
~/.minnow/bugs/
  state.json
  attachments/
    <bugId>/
      <attachmentId>-<sanitizedOriginalName>
```

- **Metadata in `BugCard.attachments`:** `{ id, name, mimeType, size, kind: 'file'|'image'|'url', storagePath?, url?, createdAt }`.
- **Server:** New routes e.g. `POST /api/bugs/attachments` (multipart), `GET /api/bugs/attachments/:bugId/:file`, `DELETE ...` — or extend config store with binary helper under `server/config/` (mirror patterns used for other `~/.minnow` resources).
- **localStorage mode:** Degrade to “metadata only + user message” or IndexedDB stub — document limitation if `npm run dev` without tool server.

### 5. URL attachments

- Store `{ id, kind: 'url', url, title? }` only in JSON (no file).
- Validate URL scheme (`http:`, `https:`) before save.

---

## Proposed types (implementation reference)

```ts
/** Reference — not committed in this plan phase */
export type BugAttachmentKind = 'image' | 'file' | 'url';

export interface BugAttachment {
  id: string;
  kind: BugAttachmentKind;
  name: string;
  mimeType?: string;
  size?: number;
  /** Workspace-relative or bugs-relative path under ~/.minnow/bugs/attachments/ */
  storagePath?: string;
  url?: string;
  createdAt: number;
}

// BugCard extension
attachments?: BugAttachment[];
// POLISH-012 placeholders:
category?: string;
links?: Array<{ path: string; startLine?: number; endLine?: number; snippet?: string }>;
```

---

## Implementation phases

### Phase 1 — Schema + storage (no UI)

- [ ] Add `BugAttachment` types and `attachments` on `BugCard`.
- [ ] Extend `ensureBugCardShape`, `server/config/validators.js`, `UpdateBugPatch`.
- [ ] Implement attachment directory create/write/delete on server; client API wrappers in `api-client.ts`.
- [ ] Unit tests: parse/migrate state, reject invalid attachment rows, orphan file cleanup when bug removed (if delete bug added later).

### Phase 2 — Detail shell + read-only

- [ ] `openBugDetail(bugId)` / `closeBugDetail()` in `global-bugs-page.ts` or new `bug-detail-panel.ts`.
- [ ] Hash: `#/bugs/<bugId>` in `onHashChange`.
- [ ] Render all existing fields read-only; wire Open plan / Open chat.
- [ ] Change card click behavior (Phase 1 UX decision).

### Phase 3 — Attachments UI

- [ ] Upload UI on detail; list + remove; image thumbnails.
- [ ] `addBugAttachment(bugId, file)` / `removeBugAttachment(bugId, attachmentId)` in store.
- [ ] Extend add-bug form with optional attachments (post-create upload queue).

### Phase 4 — Edit + tools + integration

- [ ] Inline edit fields on detail; `updateBug` patches for title/description/severity/column/notes.
- [ ] Extend `bug_add` / `bug_update` / definitions + `validateBugUpdateArgs`.
- [ ] Hooks for POLISH-012 (links/category sections) and POLISH-013 (pre-filled create modal).
- [ ] Layout pass with POLISH-014/015 (topbar + file panel visible).

### Phase 5 — Docs + QA

- [ ] Manual test matrix (below).
- [ ] Update `documentation/context.md` bug tracker row.
- [ ] Mark POLISH-023 **Done** in bug-hunt session doc.

---

## UI sketch (information architecture)

```
#/bugs
┌─────────────────────────────────────────────────────────────┐
│ [← Back]  All bugs                    [filters…]            │
├──────────────────────────┬──────────────────────────────────┤
│  Add bug form            │  Bug detail (when selected)      │
│  Kanban columns          │  Title [edit]                    │
│  [card][card]            │  Severity · Column · Workspace   │
│                          │  Description (full)              │
│                          │  Notes                           │
│                          │  Links (POLISH-012 placeholder)  │
│                          │  Attachments [+ Add]             │
│                          │    [thumb] [thumb] [file.zip]    │
│                          │  [Open chat] [Investigate] …     │
└──────────────────────────┴──────────────────────────────────┘
```

When POLISH-014 lands, the file sidebar occupies the left edge and the diagram becomes three columns (files | kanban | detail).

---

## Files to touch (implementation checklist)

| Layer | Files |
|-------|--------|
| Types | `src/types.ts` |
| Store | `src/state/bug-board-store.ts`, `src/state/bug-board-events.ts` (optional `emitBugDetailChange`) |
| API client | `src/config/api-client.ts` |
| Server | `server/config/paths.js`, `server/config/middleware.js`, new attachment handlers, `validators.js` |
| UI | `src/ui/bug-board.ts`, `src/ui/global-bugs-page.ts`, new `src/ui/bug-detail-panel.ts`, `src/styles/global-bugs-page.css`, `index.html` mount points if needed |
| Tools | `src/tools/bug-board-tools.ts`, `src/tools/definitions.ts` |
| Tests | `test/state/bug-board-store.test.mts`, `test/tools/bug-board-tools.test.mts`, new `test/ui/bug-detail*.test.mjs` |
| Docs | `documentation/context.md`, `documentation/plans/min-16-global-bugs.md` (v2 scope note) |

---

## Test plan

### Automated

- Store: load v1 state → v2 shape; round-trip `attachments` metadata; invalid attachment dropped in `ensureBugCardShape`.
- Tools: `bug_update` with attachment id list; error on unknown `bug_id`.
- UI (jsdom): click card opens detail element with full description text; Escape closes.

### Manual

1. Open `#/bugs`, add bug with long description → card truncated, detail shows full text.
2. Attach PNG + `.log` → thumbnails/names appear; reload page → attachments persist.
3. Remove attachment → file deleted from `~/.minnow/bugs/attachments/<id>/`.
4. Bug with `chatId` → **Open chat** works; card click does not skip detail.
5. **Investigate** / **Open plan** from detail still work.
6. With `npm start`, verify API upload; with `npm run dev` only, confirm documented degradation.
7. Agent on `#/bugs`: `bug_get_state` includes attachment metadata after `bug_update`.

---

## Open questions (align with product owner)

1. **Delete bug:** Is full bug deletion in scope (cascade delete attachment dir)? If not, orphan cleanup only on attachment remove.
2. **Max attachments per bug** and **max file size** — match composer (32KB text warning vs hard cap)?
3. **Edit history:** Required for v1 or defer?
4. **Categories/links:** Ship empty sections in detail now, or wait for POLISH-012?
5. **Implementation order vs POLISH-014/015:** Should layout fixes land first so detail panel is designed once for the final shell?

---

## Out of scope (this item)

- Cross-device sync beyond existing `~/.minnow` blob
- Linear / GitHub issue export
- Full-text search across attachment contents
- Virus scanning or cloud object storage
- Per-chat bug boards (legacy removed; global store only)

---

## References

- Bug hunt spec: [`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md) — POLISH-023
- MIN-16 shipped scope: [`documentation/plans/min-16-global-bugs.md`](../min-16-global-bugs.md)
- Architecture: [`documentation/context.md`](../../context.md) — Bug tracker (MIN-16)

---

## Verification (APPROVED)

**Date:** 2026-05-24  
**Verifier:** Agent (POLISH-023 plan review)  
**Plan poll:** Plan file present at session start (25min wait not required per BUG-003 precedent).

### Code path verification

| Claim | Result |
|-------|--------|
| `BugCard` has no `attachments`, `links`, or `category` | **Confirmed** — `src/types.ts` L295–315 |
| `BugsState.version` is `1` only; no v2 migration | **Confirmed** — `src/state/bug-board-store.ts` L15–17, L68 |
| Server `validateBugsState` accepts `version: 1` only; strips unknown fields via `ensureBugCard` | **Confirmed** — `server/config/validators.js` L163–234 |
| No `~/.minnow/bugs/attachments/` API routes | **Confirmed** — no bug attachment handlers under `server/` |
| Card click opens chat when `chatId` set (no detail view) | **Confirmed** — `src/ui/bug-board.ts` L128–141 |
| Description truncated at 160 chars on card | **Confirmed** — `src/ui/bug-board.ts` L159–162 |
| Notes truncated at 200 chars on card | **Confirmed** — `src/ui/bug-board.ts` L169–172 (same pattern) |
| Hash routing is `#/bugs` only (no `#/bugs/<id>`) | **Confirmed** — `src/ui/global-bugs-page.ts` L146–148, L190–206 |
| Top bar hidden on `#/bugs` open | **Confirmed** — `global-bugs-page.ts` L140, L122 (POLISH-015 dependency) |
| `bug_add` / `bug_update` lack attachment fields | **Confirmed** — `src/tools/definitions.ts` L856–907; `validateBugUpdateArgs` L68–109 |
| No `bug-detail-panel.ts` or attachment store | **Confirmed** — glob search; plan-only |
| Fix not yet implemented | **Confirmed** — no `BugAttachment` type in codebase |

### Bug-hunt alignment

[`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md) POLISH-023 summary, desired behavior, and area notes match the audit. Status remains **Requested** in the hunt doc until Phase 5 ships.

### Plan quality

- Current-state audit in this plan matches live code (2026-05-24).
- Schema v2 + `~/.minnow/bugs/attachments/<bugId>/` design is actionable; composer `processFile` reuse called out correctly.
- Card-click vs **Open chat** split and split-panel recommendation are clear.
- Phases 1–5, file checklist, and manual test matrix are implementation-ready.
- Dependencies on POLISH-012/014/015 documented; can implement schema + detail shell before layout polish.

### Tests

Direct `node --test` on bug store/tools modules failed in this environment (ESM `.ts` import resolution without `tsx` runner). Not a regression signal for POLISH-023; use `npm test` subset or full suite before merge.

### Outcome

**APPROVED** — Plan is ready for implementation. Linear: [MIN-86](https://linear.app/minnowai/issue/MIN-86/polish-023-bug-detail-attachments).
