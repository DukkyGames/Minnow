---
name: POLISH-017 — Pin chats to top
overview: Let users pin important chats so they stay at the top of the workspace-scoped sidebar list, with persistence in sessions/state.json.
source: documentation/bug-hunt-session-2026-05-24.md § POLISH-017
related:
  - documentation/bug-hunt-session-2026-05-24.md (POLISH-001 denser rows)
  - documentation/context.md (Multi-session sidebar, workspace-scoped chats B2)
  - src/state/session-workspace-scope.ts (sidebar sort helpers)
  - src/ui/sidebar.ts (renderSidebar, chat row actions)
todos:
  - id: chat-type-pinned
    content: Add optional `pinned?: boolean` to Chat in src/types.ts; coerce in ensureChatShape (default false / omit when false)
    status: pending
  - id: sort-helper
    content: Add sortChatsForSidebar(chats) in session-workspace-scope.ts — pinned first, then lastMessageAt desc; wire getChatsForWorkspace + getUnassignedChats
    status: pending
  - id: pin-api
    content: Add setChatPinned(chatId, pinned) + toggleChatPinned(chatId) in sessions.ts; touchChat + scheduleSaveSessions on change
    status: pending
  - id: sidebar-ui
    content: Pin/unpin control on .chat-item-row actions; split renderSidebar into Pinned + Recent sections per workspace; mirror for Unassigned bucket
    status: pending
  - id: sidebar-css
    content: Styles for .chat-pin-btn, pinned row affordance, collapsed-rail pin hint; reuse .chat-list-section-head for Pinned header
    status: pending
  - id: context-menu
    content: Optional right-click context menu on chat row (Pin/Unpin, Rename, Delete) — or defer to icon-only v1
    status: pending
  - id: workspace-fallback
    content: Decide + implement resolveActiveChatIdForWorkspace fallback when no remembered chat (pinned-first vs newest-unpinned-only)
    status: pending
  - id: tests
    content: Extend test/sessions/workspace-scoped.test.mts for pin sort order; add sidebar pin toggle unit/DOM test if feasible
    status: pending
  - id: docs-context
    content: Update documentation/context.md Multi-session sidebar section after ship
    status: pending
isProject: false
---

# POLISH-017 — Pin chats to top of sidebar

**Source:** [bug-hunt session 2026-05-24](../../bug-hunt-session-2026-05-24.md) — POLISH-017  
**Status:** Verified not implemented (2026-05-24) — Linear [MIN-79](https://linear.app/minnowai/issue/MIN-79/polish-017-pin-chats) Backlog; plan ready for implementation  
**Type:** Polish / UX enhancement  
**Primary deliverable:** Pinned chat ordering in sidebar + persisted `Chat.pinned`

---

## Problem

Users with many workspace-scoped chats lose important threads as newer sessions push them down the list. The sidebar orders chats strictly by **last committed message time** (`lastMessageAt`, fallback `updatedAt`) via `getChatsForWorkspace()` — there is no way to keep a chat visible at the top.

---

## Desired behavior (from bug hunt)

1. **Pin / unpin** an important chat so it stays at the **top** of the list for its workspace bucket.
2. Control via **icon on the chat row** (alongside existing rename ✎ and delete 🗑) and/or **context menu**.
3. Optional **“Pinned” section header** at the top of `#chatList` when the current workspace has pinned chats.
4. **Persist** `pinned` on the chat object inside `~/.minnow/sessions/state.json` (or `localStorage` fallback when offline).

Complements **POLISH-001** (denser row layout) — pin control must fit the tighter action cluster.

---

## Current state

| Area | What exists today | Location |
|------|-------------------|----------|
| Sidebar render | Flat list of workspace chats, then **Unassigned** section | [`src/ui/sidebar.ts`](../../../src/ui/sidebar.ts) `renderSidebar()` |
| Workspace filter + sort | Newest-first by `getChatLastMessageAt` | [`src/state/session-workspace-scope.ts`](../../../src/state/session-workspace-scope.ts) `getChatsForWorkspace`, `getUnassignedChats` |
| Chat model | No `pinned` field | [`src/types.ts`](../../../src/types.ts) `Chat` |
| Coercion on load | `ensureChatShape` strips unknown fields | [`src/state/sessions.ts`](../../../src/state/sessions.ts) |
| Row actions | Rename + delete only | [`src/ui/sidebar.ts`](../../../src/ui/sidebar.ts) `appendChatRow()` |
| Section headers | **Unassigned** uses `.chat-list-section-head` + badge | [`src/ui/sidebar.ts`](../../../src/ui/sidebar.ts), [`src/styles/sidebar.css`](../../../src/styles/sidebar.css) |
| Prior art (pin sort) | Memory entries sort pinned first, then `updatedAt` | [`src/ui/settings-sections.ts`](../../../src/ui/settings-sections.ts) `sortMemoryEntries()` |
| Persistence | Single `SessionState` blob, schema **v3** | `~/.minnow/sessions/state.json` |
| Global sort helper | `getChatsSortedByUpdatedDesc()` — **recency only**, used by orchestrator supervisor | [`src/state/sessions.ts`](../../../src/state/sessions.ts), [`src/agents/supervisor/loop.ts`](../../../src/agents/supervisor/loop.ts) |

**Sidebar layout today (`renderSidebar`):**

```text
#chatList
├── [workspace chat rows — newest first, no header]
└── Unassigned (section head + badge, if any legacy chats)
    └── [unassigned rows — newest first]
```

---

## Gap

| Missing | Notes |
|---------|--------|
| `Chat.pinned` | Not in type, coercion, or persisted JSON |
| Sort with pin priority | `getChatsForWorkspace` / `getUnassignedChats` ignore pin state |
| Pin toggle UI | No button, no context menu on `.chat-item-row` |
| Pinned section UX | No visual grouping for pinned vs recent |
| Tests | `workspace-scoped.test.mts` covers recency only |

**Out of scope for v1:**

- Cross-workspace pin sync or global “favorites” list
- Drag-to-reorder among pinned chats (use recency among pinned instead)
- Pin limits / max pinned count
- Keyboard shortcut (can follow later)
- Schema version bump (additive optional field on `Chat` is backward compatible)

---

## Goals

1. **Persist** pin state per chat in session storage (survives reload, workspace switch, server sync).
2. **Order** sidebar lists: **pinned first**, then **most recent message** within each pin tier; scope unchanged (current workspace + separate Unassigned bucket).
3. **Discoverable control** on each row without breaking rename/delete or row click-to-switch.
4. **Accessible** pin button with `aria-label` / `aria-pressed` reflecting state.
5. **Deterministic tests** for sort helper (no browser required for core logic).

---

## Design decisions

### 1. Data model

Add to `Chat`:

```ts
/** When true, sidebar lists this chat above unpinned peers in the same workspace bucket. */
pinned?: boolean;
```

- **Default:** `false` / omitted on disk (same pattern as `unread`).
- **Coercion:** `ensureChatShape` sets `pinned: true` only when `raw.pinned === true`; otherwise omit.
- **No `pinnedAt` in v1:** Among pinned chats, sort by `lastMessageAt` desc (recent activity still bubbles within the pinned group). Avoids migration and extra fields.

### 2. Sort helper (single source of truth)

New pure function in [`session-workspace-scope.ts`](../../../src/state/session-workspace-scope.ts):

```ts
export function sortChatsForSidebar(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => {
    const aPin = a.pinned === true;
    const bPin = b.pinned === true;
    if (aPin !== bPin) return aPin ? -1 : 1;
    return getChatLastMessageAt(b) - getChatLastMessageAt(a);
  });
}
```

Update `getChatsForWorkspace` and `getUnassignedChats` to `.sort` via this helper instead of inline recency-only compare.

**Do not change** `getChatsSortedByUpdatedDesc()` — supervisor orchestration should remain recency-based across all chats, independent of sidebar pin UX.

### 3. Workspace-switch fallback (open question)

`resolveActiveChatIdForWorkspace()` falls back to `getChatsForWorkspace(...)[0]` when no `lastActiveChatIdByWorkspace` entry exists.

| Option | Behavior |
|--------|----------|
| **A (recommended)** | Fallback uses **newest unpinned** chat; if none, use newest pinned. Preserves today’s “open latest work” feel when pins are bookmarks. |
| **B** | Fallback uses first row after pin sort (top pinned or newest). Simpler but may surprise users who pinned an old reference chat. |

**Recommendation:** Option A — add `getNewestChatForWorkspace()` for fallback only; sidebar still uses full pin sort.

### 4. Sidebar structure

When current workspace has pinned chats:

```text
#chatList
├── Pinned (section head + count badge)   ← only if pinned.length > 0
│   └── pinned rows (pin sort)
├── [unpinned workspace rows — no section head, or optional “Recent” head if pinned exist]
└── Unassigned (unchanged pattern; pins apply inside unassigned bucket too)
```

**Section header rule:** Show **Pinned** header when `pinnedWorkspaceChats.length > 0`. Reuse existing `.chat-list-section-head` / `.chat-list-section-badge` (same as Unassigned).

**Unpinned rows:** When pinned section exists, either:
- **v1 default:** render unpinned rows immediately below with **no** “Recent” header (minimal diff), or
- **v1.1:** add **Recent** header for symmetry when pinned section is visible.

Bug hunt says header is **optional** — ship **Pinned** header only in v1.

### 5. Pin control UX

**Primary (v1):** Icon button in `.chat-item-actions`, before rename:

| State | Glyph | aria-label | aria-pressed |
|-------|-------|------------|--------------|
| Unpinned | 📌 (outline / muted) | `Pin chat: {name}` | `false` |
| Pinned | 📌 (filled / accent) | `Unpin chat: {name}` | `true` |

- Click: `stopPropagation()`, toggle via `setChatPinned`, `renderSidebar()`, `scheduleSaveSessions()`.
- Match `.chat-rename-btn` / `.chat-delete-btn` sizing (28px desktop, `--touch-min` coarse).
- Row class `.chat-item-row.is-pinned` optional for subtle accent (e.g. left border or muted pin glyph in collapsed rail).

**Secondary (optional v1 or v1.1):** `contextmenu` on `.chat-item-row` with Pin/Unpin, Rename, Delete — reduces action-bar crowding if POLISH-001 tightens rows further.

**Collapsed sidebar:** Section headers already hidden in rail mode; pinned chats still sort to top. Consider a tiny pin indicator on the row or badge so users know why order changed (CSS only).

### 6. API surface (`sessions.ts`)

```ts
export function setChatPinned(chatId: string, pinned: boolean): boolean;
export function toggleChatPinned(chatId: string): boolean;
```

- Find chat, set `pinned`, call `touchChat(chat)` (metadata touch only — **do not** bump `lastMessageAt`).
- Return `false` if chat missing.
- Export for tests and future command palette.

### 7. Interactions with existing features

| Feature | Impact |
|---------|--------|
| `switchChat` / `deleteChat` | Unchanged; pin state survives switch |
| `deleteChat` on pinned chat | Pin state discarded with chat — OK |
| Workspace switch | Pins are per-chat via `workspacePath`; switching workspace shows that workspace’s pins |
| Unassigned legacy chats | Pin works inside Unassigned section independently |
| Streaming / unread dots | No change to dot priority in [`chat-item-dot.ts`](../../../src/ui/chat-item-dot.ts) |
| `createChat` / `createChatWithMode` | New chats default unpinned |
| Session schema v3 | No version bump; old blobs load with all chats unpinned |

---

## Acceptance criteria

### Data & persistence

- [ ] `Chat.pinned` optional boolean; persisted in `sessions/state.json` when true.
- [ ] Loading pre-pin session JSON yields chats without `pinned` ( treated as unpinned ).
- [ ] `ensureChatShape` coerces `pinned` safely (`true` only when explicitly true).

### Sorting

- [ ] Within a workspace, pinned chats appear above unpinned chats in `#chatList`.
- [ ] Among pinned (or among unpinned), order is **newest `lastMessageAt` first**.
- [ ] Unassigned bucket follows the same pin + recency rules.
- [ ] `getChatsSortedByUpdatedDesc()` behavior unchanged (no pin influence).

### UI

- [ ] Pin/unpin control on each `.chat-item-row` in expanded sidebar.
- [ ] **Pinned** section header with count when current workspace has ≥1 pinned chat.
- [ ] Pin toggle does not trigger `switchChat` (click isolation like rename/delete).
- [ ] `aria-pressed` reflects pin state; keyboard reachable.

### Workspace fallback

- [ ] Documented choice (A or B) implemented for `resolveActiveChatIdForWorkspace` no-memory path.

### Tests

- [ ] Unit tests: pin beats recency; two pinned sort by `lastMessageAt`; unpinned unaffected helper.
- [ ] `npm test` subset passes; `npx tsc --noEmit` clean.

---

## Implementation plan (ordered)

### Phase 1 — Model & sort (no UI)

1. Add `pinned?: boolean` to `Chat` in [`src/types.ts`](../../../src/types.ts).
2. Extend `ensureChatShape` in [`src/state/sessions.ts`](../../../src/state/sessions.ts).
3. Add `sortChatsForSidebar` and refactor `getChatsForWorkspace` / `getUnassignedChats` in [`session-workspace-scope.ts`](../../../src/state/session-workspace-scope.ts).
4. Add tests in [`test/sessions/workspace-scoped.test.mts`](../../../test/sessions/workspace-scoped.test.mts).

### Phase 2 — Session API

5. Implement `setChatPinned` / `toggleChatPinned` in [`sessions.ts`](../../../src/state/sessions.ts).
6. Resolve workspace fallback behavior (Option A recommended) in `resolveActiveChatIdForWorkspace`.

### Phase 3 — Sidebar UI

7. Refactor `renderSidebar()`:
   - Fetch sorted workspace chats via `getChatsForWorkspace`.
   - Partition `pinned` / `unpinned`.
   - `appendChatListSection(list, 'Pinned', pinned, activeId)` when needed.
   - Append unpinned rows (existing `appendChatRow`).
   - Keep Unassigned block as today with internal pin sort.
8. Extend `appendChatRow()`:
   - Add pin button to `.chat-item-actions`.
   - Wire toggle handler.
   - Optional `.is-pinned` class on row.

### Phase 4 — Styles

9. Add `.chat-pin-btn` alongside rename/delete in [`src/styles/sidebar.css`](../../../src/styles/sidebar.css):
   - Muted default; accent when pinned (`aria-pressed="true"`).
   - Collapsed-rail affordance if needed.
10. Coordinate with **POLISH-001** if landed first (action cluster width).

### Phase 5 — Polish & docs

11. (Optional) Context menu on row.
12. Update [`documentation/context.md`](../../context.md) Multi-session sidebar table.
13. Manual QA checklist (below).

---

## Test plan

### Unit (`test/sessions/workspace-scoped.test.mts`)

| Case | Setup | Expect |
|------|-------|--------|
| Pin beats recency | Chat A unpinned `lastMessageAt=500`, Chat B pinned `lastMessageAt=100` | B before A |
| Pin order | Two pinned, different `lastMessageAt` | Newer pinned first |
| Unpinned unchanged | No pins | Same order as today |
| Unassigned pins | Legacy chat pinned in `workspacePath: ''` | Pinned first in `getUnassignedChats` |

### Manual QA

1. Pin a chat → appears at top with **Pinned** header; reload → still pinned.
2. Unpin → returns to recency position; header hides when count 0.
3. Pin multiple chats → pinned group sorted by recent activity.
4. Switch workspace → each workspace shows its own pins only.
5. Rename/delete/pin while another chat streams → no regressions.
6. Collapsed sidebar → pinned chats still at top; controls usable on mobile drawer.
7. Offline (`npm run dev` + localStorage) → pin state persists locally.

---

## Files to touch (implementation)

| File | Change |
|------|--------|
| [`src/types.ts`](../../../src/types.ts) | `Chat.pinned` |
| [`src/state/session-workspace-scope.ts`](../../../src/state/session-workspace-scope.ts) | `sortChatsForSidebar`, update getters |
| [`src/state/sessions.ts`](../../../src/state/sessions.ts) | coerce, pin setters, optional fallback tweak |
| [`src/ui/sidebar.ts`](../../../src/ui/sidebar.ts) | pin button, section split in `renderSidebar` |
| [`src/styles/sidebar.css`](../../../src/styles/sidebar.css) | pin button + pinned row |
| [`test/sessions/workspace-scoped.test.mts`](../../../test/sessions/workspace-scoped.test.mts) | sort tests |
| [`documentation/context.md`](../../context.md) | post-ship doc update |

**Not expected to change:** server routes (session blob is opaque JSON), supervisor loop, chat streaming, schema version.

---

## Open questions (align before implementation)

1. **Workspace fallback:** Option A (newest unpinned) vs Option B (pin sort first) — recommend A.
2. **“Recent” sub-header:** Show when pinned section exists, or pinned header only?
3. **Context menu in v1:** Icon-only first, or ship right-click menu together?
4. **Pin glyph:** Unicode 📌 vs inline SVG for theme consistency (Reef/topbar icons use SVG elsewhere)?
5. **POLISH-001 timing:** If denser rows land first, validate three-button action row at min sidebar width (200px tablet).

---

## References

- Bug hunt item: [`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md) — POLISH-017
- Sidebar architecture: [`documentation/context.md`](../../context.md) — Multi-session sidebar
- Memory pin sort precedent: [`src/ui/settings-sections.ts`](../../../src/ui/settings-sections.ts) `sortMemoryEntries`


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-79](https://linear.app/minnowai/issue/MIN-79/polish-017-pin-chats)
