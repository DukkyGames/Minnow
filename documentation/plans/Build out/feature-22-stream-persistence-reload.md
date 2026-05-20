---
name: feature-22-stream-persistence-reload
overview: Checkpoint in-flight assistant turns to sessions/state.json during streaming; on reload offer Continue or Discard with partial content visible. Provider cannot resume SSE — Continue starts a new completion from checkpoint.
todos:
  - id: pending-turn-types
    content: Add PendingTurn + Chat.pendingTurn in types.ts; ensureChatShape (client + server validators)
    status: pending
  - id: checkpoint-module
    content: Add src/state/pending-turn.ts — sync/clear pendingTurn, debounced checkpoint, pagehide flush
    status: pending
  - id: wire-loop-checkpoints
    content: Call checkpoint from loop.ts stream/tool paths; clear on normal complete; coordinate feature-14 abort
    status: pending
  - id: recovery-ui
    content: pending-turn-recovery banner + renderPendingTurn in messages.ts; hook initApp after loadSessions
    status: pending
  - id: continue-discard-actions
    content: Continue (new completion from checkpoint) and Discard handlers; disable send while recovery pending
    status: pending
  - id: tests
    content: test/state/pending-turn.test.mts + recovery unit tests; register in package.json npm test
    status: pending
  - id: manual-qa-docs
    content: Manual reload-during-stream QA; add documentation/plans/verification/feature-22.md; update documentation/context.md on ship
    status: pending
isProject: false
---

# Feature 22 — Stream persistence across reload

| Field | Value |
|-------|-------|
| **Feature ID** | `feature-22-stream-persistence-reload` |
| **Backlog** | [`documentation/plans/product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md) — **C5** |
| **Epic** | C — Chat UX and control |
| **Wave** | 2 (with C1 stop, C2 message actions) |
| **Size** | L |
| **Status** | Build plan (not implemented) |
| **Depends on** | C1 [`feature-14-stop-generation.md`](feature-14-stop-generation.md) (abort + partial semantics); session blob in [`documentation/context.md`](../../context.md) |
| **Blocks** | Nothing critical |
| **Out of scope** | True SSE resume (not supported by OpenAI-compatible APIs); workspace-scoped chat grouping ([`feature-03-workspace-scoped-chats.md`](feature-03-workspace-scoped-chats.md)) unless v2 migration is already landed |

### Backlog alignment (C5)

| Backlog wording | Build plan decision |
|-----------------|---------------------|
| Checkpoint `pendingTurn` with `role`, `content`, `thinking[]`, `toolCalls?`, `startedAt` | **Ship** — full `PendingTurn` schema + client/server `ensureChatShape` validation |
| Debounced save mid-turn | **Ship** — `schedulePendingCheckpoint` at **150ms** + `pagehide` / `beforeunload` flush via `saveSessionsNow()` |
| Boot → **Continue** or **Discard** | **Ship** — `pending-turn-recovery.ts` banner; **Continue** = new completion (not SSE resume) |
| “If provider cannot resume, show partial as assistant message” | **Ship** — `renderPendingTurn()` assistant row in DOM (not `history` until Continue promotes or user Discards) |
| Key files: `loop.ts`, `sessions.ts`, `messages.ts`, schema version bump | **Ship** all three + `pending-turn.ts`, validators; **no version bump** for C5-only (optional `Chat` field on v1) |
| Depends on C1 | **Ship** with integration contract below — abort writes `pendingTurn` (`stopped: true`), not duplicate `history` row |
| Acceptance: reload → partial + Continue/Discard; no silent loss | See **Acceptance criteria** |

---

## Problem

Today an in-flight assistant reply lives only in the DOM and `app-state.streaming`. Persistence gaps:

| Event | What is saved | What is lost |
| ----- | ------------- | ------------ |
| User sends | `chat.history` gets user row; `scheduleSaveSessions()` (~300ms debounce) | — |
| SSE deltas | Nothing until turn completes | Prose, reasoning, partial tool_calls |
| Tool loop mid-run | Assistant tool-call row + tool results (lines ~675, ~709) | In-flight *next* assistant stream |
| Page reload / crash | Last debounced save may omit tail | Unfinished assistant turn |
| Abort (pre–C1) | Often nothing in `history` | Partial DOM only |

```487:489:src/tools/loop.ts
  chat.history.push({ role: 'user', content: historyContent });
  touchChat(chat);
  scheduleSaveSessions();
```

Assistant text is pushed to `history` only after a completion round finishes (e.g. ~797) or on tool-call boundaries (~675). **`scheduleSaveSessions` is not called per SSE chunk** — only on milestones — so a reload mid-stream typically shows the user message and an empty assistant tail.

---

## Goal

1. **Checkpoint** streaming assistant state on the active `Chat` as `pendingTurn`, debounced during stream/tool phases, with a **synchronous flush** on `pagehide` / `beforeunload`.
2. **On boot**, if the active (or switched-to) chat has `pendingTurn`, show **partial content** and a **Continue** / **Discard** choice — no silent empty loss.
3. **Continue** starts a **new** completion (provider cannot resume mid-SSE); partial text is visible and included in the API context per § Continue semantics.
4. **Discard** clears `pendingTurn` and leaves history as-is (user message retained).

---

## Acceptance criteria

| # | Criterion |
|---|-----------|
| AC1 | During an active stream, `chat.pendingTurn` is written debounced (~150ms) and flushed synchronously on `pagehide` / `beforeunload` while `streaming`. |
| AC2 | Hard reload mid-stream shows the user message, **partial assistant content** from `pendingTurn`, and a **Continue** / **Discard** banner (no empty assistant tail). |
| AC3 | **Discard** clears `pendingTurn`, persists, and re-renders `history` only (user message retained). |
| AC4 | **Continue** starts a **new** completion (provider cannot resume SSE); partial text remains visible; `pendingTurn` clears when the new stream starts successfully. |
| AC5 | Normal completion clears `pendingTurn` before the final assistant row is persisted to `history`. |
| AC6 | Client and server `ensureChatShape` preserve valid `pendingTurn`; invalid shapes are stripped (no silent data loss of other chat fields). |
| AC7 | `localStorage` fallback (`minnow-sessions-v1`) behaves the same as server-backed `~/.minnow/sessions/state.json`. |
| AC8 | After C1: stop mid-stream then reload still offers recovery (`pendingTurn.stopped: true`); no duplicate assistant bubble in `history` + `pendingTurn`. |

**Verifier sign-off:** Report **PASS** only when AC1–AC8 hold, `npm run build` and `npm test` pass, and manual **U1–U7** in [`documentation/plans/verification/feature-22.md`](../verification/feature-22.md) are checked.

---

## `pendingTurn` schema

Add to [`src/types.ts`](../../../src/types.ts) (not a `Message` history row — ephemeral checkpoint on `Chat`):

```typescript
/** In-flight assistant turn checkpoint (survives reload). */
export interface PendingTurn {
  /** Always assistant for this feature. */
  role: 'assistant';
  /** Accumulated visible prose (markdown source). May be "" during thinking-only. */
  content: string;
  /** Normalized reasoning segments (same shape as AssistantMessage.thinking). */
  thinking?: string[];
  /** Finalized tool calls for the current assistant leg (after finalizeToolCalls). */
  toolCalls?: ToolCall[];
  /** Epoch ms when the user message for this turn was committed. */
  startedAt: number;
  /** Model/provider at turn start (Continue retry). */
  modelId?: string;
  providerId?: string;
  /** 0-based tool loop index when checkpointed during multi-round tool use. */
  toolRound?: number;
  /** UI phase hint: 'streaming' | 'tools' | 'thinking'. */
  phase?: 'streaming' | 'tools' | 'thinking';
  /** Set when user stopped via C1 before reload. */
  stopped?: boolean;
  /** Optional; aligns with feature-05 if shipped. */
  thinkingDurationMs?: number;
}

export interface Chat {
  // ...existing fields...
  /** Non-null while a turn was interrupted or still in progress at last save. */
  pendingTurn?: PendingTurn | null;
}
```

### Validation (`ensureChatShape`)

| Field | Rule |
| ----- | ---- |
| `role` | Must be `'assistant'`; else drop entire `pendingTurn`. |
| `content` | String; default `''`. |
| `thinking` | `string[]` of non-empty strings; else omit. |
| `toolCalls` | Reuse existing `ensureToolCalls()`; omit if empty. |
| `startedAt` | Required number; if missing, drop `pendingTurn`. |
| `phase` | Whitelist above; else omit. |
| `toolRound` | Non-negative integer; else omit. |

Implement in:

- [`src/state/sessions.ts`](../../../src/state/sessions.ts) `ensureChatShape`
- [`server/config/validators.js`](../../../server/config/validators.js) `ensureChatShape` (mirror client rules so PUT `/api/config/sessions` does not strip the field)

**Stale checkpoints:** If `pendingTurn` exists but `history` has no trailing user message after `startedAt` (user cleared chat), auto-clear `pendingTurn` on load.

---

## Session schema version

| Approach | When | Action |
| -------- | ---- | ------ |
| **Recommended (this feature)** | Ship C5 alone | Keep `SESSION_SCHEMA_VERSION = 1`. `pendingTurn` is an **optional** `Chat` field — forward-compatible JSON (same pattern as optional `thinking[]`, `thinkingDurationMs`). |
| **Coordinated** | `feature-03` v2 already merged | Bump to `2` in one migration: preserve `pendingTurn` on each chat; document in feature-03 plan. Do **not** double-migrate. |

Update [`parseSessionStateFromJson`](../../../src/state/sessions.ts) only if version `2` is introduced; for v1-only ship, no version constant change.

Server [`validateSessionState`](../../../server/config/validators.js) continues to accept `version: 1` with optional `pendingTurn` on chats.

---

## Checkpoint pipeline

### New module: `src/state/pending-turn.ts`

| Export | Responsibility |
| ------ | -------------- |
| `syncPendingTurn(chat, snapshot)` | Assign `chat.pendingTurn` from live stream state; `touchChat`; `scheduleSaveSessions()`. |
| `clearPendingTurn(chat)` | Set `pendingTurn` undefined; save. |
| `buildPendingSnapshot(...)` | Map loop locals + `ThoughtBubbleController.getSegmentsNormalized()` + `finalizeToolCalls` output into `PendingTurn`. |
| `schedulePendingCheckpoint(chat, snapshot)` | Debounce **150ms** during stream (faster than `SAVE_DEBOUNCE_MS` 300ms for tail loss); coalesce into one `scheduleSaveSessions`. |
| `flushPendingTurnNow()` | `saveSessionsNow()` for `pagehide` / `visibilitychange` when `streaming`. |

Register **`pagehide`** (and `beforeunload` as fallback) in [`main.ts`](../../../src/main.ts) after sessions load: if `streaming`, flush pending snapshot + `saveSessionsNow()`.

### Wire points in [`src/tools/loop.ts`](../../../src/tools/loop.ts)

| Hook | Update `pendingTurn` |
| ---- | -------------------- |
| After `setStreaming(true)` + stream row created | Initial snapshot: `content: ''`, `phase: 'streaming'`, `startedAt`, model/provider ids. |
| `handleChunk` (prose/reasoning/tool deltas) | Debounced `schedulePendingCheckpoint` with latest `fullText`, thinking segments, tool acc (optional: store raw acc only on chunk end). |
| After assistant tool-call row pushed (~675) | Snapshot with `toolCalls`, `phase: 'tools'`. |
| Between tool executions | Keep `phase: 'tools'`; update if needed. |
| Normal assistant completion (~784–797) | **`clearPendingTurn`** before/after pushing final `AssistantMessage`. |
| `finally` when `completedNormally` | Ensure cleared. |
| `AbortError` (C1) | Snapshot with `stopped: true` + partial content; **keep** `pendingTurn` until user Discard or Continue promotes it. |

Also wire **`sendMessagePlain`** ([`src/api/chat.ts`](../../../src/api/chat.ts)) for parity (legacy/tests).

### What not to duplicate in `history`

While `pendingTurn` is active, do **not** also push a duplicate partial assistant row into `history` (avoids double bubbles on reload). Exception: tool-loop legs already persisted as `AssistantToolCallMessage` + `tool` rows remain in `history`; `pendingTurn` covers only the **current incomplete** assistant leg.

---

## Continue / Discard UX

### Detection

After [`loadSessionsFromStorage`](../../../src/state/sessions.ts) and [`renderChatFromHistory`](../../../src/ui/messages.ts) in [`initApp`](../../../src/main.ts):

1. `const chat = getActiveChat()`.
2. If `chat.pendingTurn` → run recovery flow (do not auto-start streaming).

Also run when **switching chats** via [`switchActiveChat`](../../../src/state/sessions.ts): if target has `pendingTurn`, show banner and render partial.

### UI (new: `src/ui/pending-turn-recovery.ts` + styles)

| Element | Behavior |
| ------- | -------- |
| Banner | Above `#chatArea` or sticky under header: “Generation was interrupted.” Shows elapsed since `startedAt` (optional). |
| Partial render | [`renderPendingTurn(chat)`](../../../src/ui/messages.ts): append assistant row from `pendingTurn` (prose + Thoughts toggle + tool call shells if `toolCalls` without results yet). Reuse `setAssistantBubbleContent`, `renderThoughtsToggle`, `renderToolCall`. Mark row `msg--interrupted` / `data-pending-turn`. |
| **Continue** | Primary button. See semantics below. |
| **Discard** | Secondary / destructive confirm. `clearPendingTurn`, re-`renderChatFromHistory`, hide banner. |

Disable **Send** and mode/expert switches while recovery banner is showing for that chat (same guard as `streaming`).

### Continue semantics (no true SSE resume)

LM Studio / OpenAI-compatible APIs **cannot** resume a half-open SSE body. **Continue** means:

1. Clear recovery banner UI state.
2. Build API messages from `chat.history` (includes user turn) plus **checkpoint context**:
   - **Option A (recommended):** Append a synthetic **user** follow-up: `Continue your previous reply from where you left off.` (hidden from displayed history — store flag on turn or use ephemeral system append in `buildApiMessages` only).
   - **Option B:** Push partial assistant to `history` with `content` from `pendingTurn`, then run normal `sendMessageWithTools` with empty composer (messier UX).
3. Copy `modelId` / `providerId` from `pendingTurn` when present.
4. `clearPendingTurn` when the new stream **starts** (not when Continue is clicked — if fetch fails, keep checkpoint).
5. On success, new assistant message replaces the interrupted narrative in the thread.

Document in UI copy: “Continue starts a new request from your last checkpoint.”

### Discard semantics

- `clearPendingTurn(chat)`; persist.
- Re-render history only (no partial assistant in DOM).
- User message remains; user may edit composer and send again.

### Provider cannot resume edge case

If Continue fails (offline, model missing), show status error and **leave** partial visible from `pendingTurn` (re-show banner). Align with backlog: “show partial as assistant message” — if Continue is abandoned, offer **“Save as message”** secondary that promotes `pendingTurn` → `AssistantMessage` in `history` and clears pending (optional nice-to-have; not required for AC if Continue + Discard cover loss).

---

## Changes by file

| File | Changes |
| ---- | ------- |
| [`src/types.ts`](../../../src/types.ts) | `PendingTurn`, `Chat.pendingTurn` |
| [`src/state/pending-turn.ts`](../../../src/state/pending-turn.ts) | **New** — checkpoint + flush |
| [`src/state/sessions.ts`](../../../src/state/sessions.ts) | `ensureChatShape` pendingTurn; stale cleanup on load |
| [`server/config/validators.js`](../../../server/config/validators.js) | Mirror `ensurePendingTurn` in `ensureChatShape` |
| [`src/tools/loop.ts`](../../../src/tools/loop.ts) | Checkpoint hooks; clear on complete; C1 abort snapshot |
| [`src/api/chat.ts`](../../../src/api/chat.ts) | Same for plain path |
| [`src/ui/messages.ts`](../../../src/ui/messages.ts) | `renderPendingTurn`, `renderChatFromHistory` skip duplicate if pending rendered |
| [`src/ui/pending-turn-recovery.ts`](../../../src/ui/pending-turn-recovery.ts) | **New** — banner, Continue/Discard |
| [`src/styles/messages.css`](../../../src/styles/messages.css) or new `pending-turn-recovery.css` | Banner + interrupted row |
| [`src/main.ts`](../../../src/main.ts) | Recovery after first paint; `pagehide` flush |
| [`src/ui/sidebar.ts`](../../../src/ui/sidebar.ts) | Optional badge on chat row with pending turn |
| [`documentation/context.md`](../../context.md) | Persistence table + recovery UX (on ship) |

---

## Coordination with C1 (stop generation)

| Scenario | `pendingTurn` | `history` |
| -------- | ------------- | --------- |
| User stops mid-stream | Keep with `stopped: true`, partial `content` / `thinking` | No duplicate assistant row until Continue or “save as message” |
| User stops then reload | Banner: Continue / Discard | Same |
| Normal complete | Cleared | Final assistant row |
| Discard after stop | Cleared | User row only |

### C1 integration contract (ship C1 before or with C5)

[`feature-14-stop-generation.md`](feature-14-stop-generation.md) Phase 2 pushes a partial `AssistantMessage` with `stopped: true` into `history` on abort. **When C5 lands**, change the abort path:

1. `finalizeStoppedTurn` (or equivalent) calls **`syncPendingTurn`** with `stopped: true` and partial prose/thinking — **do not** push a partial assistant row to `history` on abort (avoids double bubbles after reload).
2. Stopped affordance (`msg--stopped`, “Generation stopped”) applies to the **pending** row via `renderPendingTurn` until Continue promotes or Discard clears.
3. If C1 shipped alone first, C5 PR must update the abort handler in the same change set as `pendingTurn` wiring.

Implement C1 abort handler **before** or **with** C5 so abort calls `syncPendingTurn` instead of only `return`.

---

## Build and test

### Build

```bash
npm run build
```

Typecheck must pass for new `PendingTurn` exports and recovery module imports.

### Automated tests

| Test file | Cases |
| --------- | ----- |
| `test/state/pending-turn.test.mts` | `ensureChatShape` round-trip; invalid `pendingTurn` stripped; `buildPendingSnapshot` static fixture |
| `test/state/pending-turn-recovery.test.mts` | `shouldOfferRecovery(chat)`; stale pending cleared when history empty; Continue clears pending on start (mocked) |

Use [`setSessionStateForTests`](../../../src/state/sessions.ts) and fixed chat ids (no `Date.now()` in assertions).

Register new tests in [`package.json`](../../../package.json) `npm test` script if not globbed.

### Manual QA

| Step | Expected |
| ---- | -------- |
| 1. `npm start`, send long reply | Stream visible |
| 2. Hard reload mid-stream | User msg + partial assistant + banner |
| 3. **Discard** | Partial gone; user msg remains |
| 4. Repeat reload → **Continue** | New stream; completes; `pendingTurn` absent in `sessions/state.json` |
| 5. Reload during tool loop (after tool_calls, before tools finish) | Checkpoint shows tool state or prose per last save; no silent empty chat |
| 6. `localStorage` fallback (no server) | Same behavior with `minnow-sessions-v1` |
| 7. Stop (C1) then reload | `stopped: true` in checkpoint; banner still works |

Inspect `~/.minnow/sessions/state.json` for `pendingTurn` object during step 2.

---

## Risks and mitigations

| Risk | Mitigation |
| ---- | ---------- |
| Large `pendingTurn` + history → quota | Debounce; cap `content` length in checkpoint (e.g. same as max message display) — document if hit |
| Double assistant bubbles | Single source: `pendingTurn` OR `history`, not both |
| Tool calls without results on reload | Render calls; show “interrupted” on pending results; Continue sends API context with tool messages already in `history` |
| Race: save after complete | Clear `pendingTurn` synchronously before `scheduleSaveSessions` on complete |
| Server validator strips field | Update `server/config/validators.js` in same PR |

---

## Implementation order

1. Types + `ensureChatShape` (client + server).  
2. `pending-turn.ts` checkpoint API + pagehide flush.  
3. `loop.ts` / `chat.ts` hooks + clear on complete.  
4. `messages.ts` render + recovery UI + `main.ts` boot.  
5. C1 abort integration (if not already merged).  
6. Tests + manual QA + `context.md`.

---

## Verifier handoff

Create [`documentation/plans/verification/feature-22.md`](../verification/feature-22.md):

- **Plan review:** backlog C5 + per-agent template (pre-implementation)
- **Automated:** `npm run build`; `npm test` including `test/state/pending-turn.test.mts` and `test/state/pending-turn-recovery.test.mts`
- **Manual:** U1–U7 from § Manual QA below
- **Sign-off:** AC1–AC8; C1 contract applied; no `SESSION_SCHEMA_VERSION` bump unless feature-03 v2 is merged

---

## References

- Backlog: [`documentation/plans/product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md) § C5  
- Sessions: [`src/state/sessions.ts`](../../../src/state/sessions.ts) — `scheduleSaveSessions`, `SAVE_DEBOUNCE_MS` = 300 ([`src/constants.ts`](../../../src/constants.ts))  
- Send path: [`src/tools/loop.ts`](../../../src/tools/loop.ts) — `sendMessageWithTools`, `streamCompletionTurn`  
- UI history: [`src/ui/messages.ts`](../../../src/ui/messages.ts) — `renderChatFromHistory`, `appendStreamingAssistantRow`  
- Stop (dependency): [`documentation/plans/Build out/feature-14-stop-generation.md`](feature-14-stop-generation.md)
