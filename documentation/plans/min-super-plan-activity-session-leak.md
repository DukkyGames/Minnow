# Super Plan: Activity leak across runs + missing sidebar rows

## Problem

Two linked symptoms when starting a **New plan** while another Super Plan is still running:

1. **Activity tab shows the previous run’s ledger** (stage / Model / Tool rows) under the new plan’s slug — immediately, before the new interview does real work.
2. **No second Super Plan appears** in the plan rail or the Code chat sidebar. After navigating away, the new work is only reachable via the **agent activity panel**. Deleting the prior run and starting fresh makes Activity clean again.

Product intent (confirmed):

- **New plan** while another run is live → always start a **fresh Super Plan chat**; leave the old pipeline running.
- Super Plan runs should appear in the **Code chat sidebar as soon as the pipeline starts** (not only after the brief/spec).

## Root cause

### A. “Empty” plan-chat reuse ignores live Super Plan state

[`findReusableEmptyPlanChat`](../../src/ui/orchestrate-plan-screen.ts) only checks:

```ts
normalizeModeId(c.modeId) === modeId && c.history.length === 0
```

It does **not** exclude chats that already have `chat.superPlan`, `messageCount > 0`, or lazy-unloaded history (`historyLoaded === false`). A live Super Plan transport chat can therefore be treated as a spare composer.

[`startPlanningFromPrompt`](../../src/ui/orchestrate-plan-screen.ts) then calls `resolveOrCreatePlanChat()` → reuses that chat → [`startSuperPlan`](../../src/chat/super-plan/controller.ts) sees a different prompt and calls [`initSuperPlanState`](../../src/chat/super-plan/state.ts), which **replaces** slug/stages on the **same** chat id.

Observed UX matches this exactly:

- New slug in the header
- **No new rail row** (`collectSuperPlanRuns` is one row per chat with `superPlan`)
- Old Activity rows still present

### B. Activity collector seeds before state reset

In `startPlanningFromPrompt` the order is:

1. `renderOrchestratePlanScreen` → `PlanActivityCollector.start()` → **`replayPersistedActivity` reads the old `activityLog`**
2. Then `startSuperPlan` → `initSuperPlanState` wipes `chat.superPlan` (new empty state, no `activityLog`)

The in-memory buffer already holds the previous run. New stage/main-turn rows append on top. `persistBuffer` then writes the mixed ledger onto the **new** `superPlan.activityLog`.

### C. New plan button does not open a fresh chat

Rail **New plan** only does:

```ts
renderOrchestratePlanScreen({ phase: 'prompt', chatId: opts.chatId });
```

That keeps the **current run’s chatId** in compose mode. Submit then depends on `resolveOrCreatePlanChat` to invent a new chat — which fails when (A) fires.

### D. Sidebar listing does not treat Super Plan as listable

[`chatHasListableContent`](../../src/state/session-workspace-scope.ts) only considers draft / history / `messageCount`. It never treats `chat.superPlan` as content.

Combined with Super Plan being framed as “pipeline transport” (not remembered as foreground — see [`sessions.ts`](../../src/state/sessions.ts) / [`resumable.ts`](../../src/chat/super-plan/resumable.ts)), early runs are easy to lose once you leave the Super Plan surface. Sidebar comment even refers to “Super Plan’s hidden session list” as intentional twin of board chats — but the desired product behavior is now: **list from pipeline start**.

### E. Secondary UI bug (retarget)

[`SuperPlanPage.retarget`](../../src/ui/super-plan-page.ts) clears `renderedEntryIds` and swaps the buffer, but does **not** clear the ledger DOM. `paintLedger` only rebuilds when it detects ring-buffer drop. Fix while touching this surface so plan switches cannot leave stale rows painted.

## Fix plan

### 1. Never reuse a live / stateful Super Plan chat as a “spare”

Update `findReusableEmptyPlanChat` (and any twin in [`super-plan-entry.ts`](../../src/ui/super-plan-entry.ts) `resolveOrCreateComposeChat`) so a chat is reusable only when **all** of:

- `modeId` matches
- no `chat.superPlan` (or only cancelled/finished with no desire to keep — prefer **no `superPlan` at all** for spares)
- truly empty transcript: `history.length === 0` **and** (`historyLoaded !== false` or `messageCount === 0`)
- not currently advancing / streaming

### 2. New plan always allocates a fresh compose chat

Change Super Plan page `onNewPlan` to mirror hub **Make a plan** / `preferNew`:

- Create or resolve an **empty spare** super-plan chat (not the current run)
- `switchChat` to it
- Render compose phase on **that** chat id
- Leave the previous pipeline running (`advanceSuperPlan` / pause state untouched)

### 3. Reset Activity before the collector can see the old ledger

When starting a new pipeline on a chat (or when `initSuperPlanState` runs):

- Ensure `activityLog` is absent/empty on the new state (already true for `createSuperPlanState`)
- **Render / start collector only after** `initSuperPlanState`, **or** explicitly reset the page buffer when Super Plan state is replaced
- Prefer: `startSuperPlan` initializes state first; plan screen render for a brand-new run never replays another run’s log

Also clear ledger DOM in `retarget` / `startCollector` (`ledgerEl.replaceChildren()`, reset `renderedEntryIds`).

### 4. List Super Plan runs in the Code sidebar from pipeline start

Extend listability so a chat with in-flight (or any) `superPlan` counts as sidebar content:

- `chatHasListableContent` (or a Super Plan–specific branch in `isSidebarListedChat`) returns true when `chat.superPlan` is present and the chat is in the current workspace
- Ensure `renderSidebar` is triggered when `initSuperPlanState` / stage start stamps the chat (touch + save already happen — verify list rebuild)
- Title: use `resolveSuperPlanDisplayTitle` / interim `Plan <slug>` so the row is recognizable before the brief exists (avoid a blank “New chat” that looks missing)

Do **not** rely on agent activity panel as the only recovery path.

### 5. Guard `startSuperPlan` against silent mid-run reuse

If `startSuperPlan` is ever called on a chat whose pipeline is still advancing with a **different** prompt:

- Do not `initSuperPlanState` on that chat
- Allocate a new chat (or throw / surface an error) so two prompts cannot fight one `advancingChats` entry

### 6. Tests

- `findReusableEmptyPlanChat` / resolve helpers: live Super Plan with empty `history` array but `superPlan` set / `messageCount > 0` / `historyLoaded: false` must **not** be reused
- New plan while run A is live → creates chat B; A still running; B’s Activity starts empty (only B’s stage rows)
- `initSuperPlanState` / start order: collector must not replay a prior `activityLog` after a prompt restart on the same id (if same-id restart remains possible for finished runs)
- Sidebar: chat with `superPlan` and empty history appears in `getSidebarListedChatsForWorkspace`
- `retarget` clears prior ledger DOM

### 7. Docs

Update [`documentation/context.md`](../context.md) Super Plan paragraph:

- New plan opens a fresh transport chat; concurrent runs are allowed
- Activity ledger is strictly per `chatId` / `superPlan` instance; collectors must not seed across resets
- Super Plan runs are listed in the Code sidebar from pipeline start

## Out of scope

- Changing the ten-stage pipeline itself
- Agent activity panel redesign
- Deleting finished Super Plan chats automatically

## Todos

- [x] Harden `findReusableEmptyPlanChat` + compose spare resolution (exclude `superPlan`, lazy history, streaming/advancing)
- [x] Wire Super Plan **New plan** to create/switch a fresh compose chat; leave prior run running
- [x] Fix start/render order so Activity never replays a replaced run’s `activityLog`; clear ledger DOM on retarget/collector restart
- [x] Guard `startSuperPlan` against replacing an in-flight different prompt on the same chat
- [x] Make Super Plan chats sidebar-listable from `superPlan` presence; sensible interim title
- [x] Add regression tests (reuse, Activity isolation, sidebar listing, retarget DOM)
- [x] Update `documentation/context.md`
- [x] Run scoped tests (`test/ui/super-plan-page.test.mts`, plan-screen / sidebar listing / controller lifecycle); verify in browser: two concurrent runs, Activity isolated, both visible in rail + sidebar
