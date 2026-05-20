---
name: feature-14-stop-generation
overview: Stop button during streaming — abort fetch, cancel sub-agents, finalize partial assistant bubble with stopped affordance, persist to history.
todos:
  - id: stop-api-composer
    content: Add stopGeneration() + composer send/stop toggle (input.ts, index.html, main.ts, input.css)
    status: pending
  - id: finalize-stopped-turn
    content: finalizeStoppedTurn shared helper + wire AbortError in loop.ts and api/chat.ts
    status: pending
  - id: tool-loop-cooperative-abort
    content: Check chatSignal.aborted between executeTool rounds; skip remaining tools
    status: pending
  - id: stopped-history-render
    content: AssistantMessage.stopped + markMessageStopped in messages.ts and history reload
    status: pending
  - id: approval-modal-restore
    content: tool-approval-modal restores stop mode when streaming after close
    status: pending
  - id: tests-build-verify
    content: test/chat/*.mts + test/ui/composer-send.test.mts; npm run build && npm test; manual QA
    status: pending
  - id: context-doc-on-ship
    content: Update documentation/context.md when feature ships
    status: pending
  - id: verification-doc
    content: Add documentation/plans/verification/feature-14.md; sign-off after ship
    status: pending
isProject: false
---

# Feature 14 — Stop chat while streaming (C1)

| Field | Value |
|-------|-------|
| **ID** | `feature-14-stop-generation` |
| **Epic** | C — Chat UX and control |
| **Wave** | 2 (with C2 message actions, C5 reload persistence) |
| **Size** | S |
| **Depends on** | None |
| **Blocks** | C2 (`feature-15-16-17-message-actions`); C5 (`feature-22-stream-persistence-reload`) coordinates abort snapshot semantics |
| **Source backlog** | [`documentation/plans/product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md) § C1 |

### Backlog traceability (C1)

| Backlog field | Plan coverage |
|---------------|---------------|
| **Current** (`chatFetchAbort`, `AbortError`, disabled send, `streaming` guard) | § Current state |
| **Goal** (Stop button, `abort()`, sub-agent cancel, finalize partial “stopped”) | § Goals 1–5, § Architecture |
| **Acceptance** (~1s abort, composer re-enabled, partial + stopped affordance) | AC1–AC7; AC3 + UX table for composer |
| **Size** S | Metadata table |

---

## Summary

Add a **Stop** control during an in-flight reply: the composer send button becomes a stop action while `streaming === true`, calls `chatFetchAbort.abort()`, cancels sub-agents for the current parent turn, and finalizes the UI with partial assistant text marked as **stopped** and persisted where appropriate. Today abort infrastructure exists but the user cannot trigger it, and the abort path leaves DOM/history inconsistent.

---

## Goals

1. **Discoverable stop** — Send button toggles to Stop (icon + label) while a reply is in progress; composer textarea re-enabled so the user can draft the next message (optional product choice: keep disabled until stop completes — see § UX decisions).
2. **Fast cancellation** — `chatFetchAbort.abort()` ends the active `fetch` / SSE `reader` within ~1s under normal network conditions.
3. **Sub-agent cleanup** — `cancelAllForParentTurn(parentTurnId)` runs on stop (already wired on `AbortError` in `loop.ts`).
4. **Partial content retained** — Visible assistant prose (if any) stays in the thread with a clear **stopped** affordance; empty in-flight shells are removed or collapsed.
5. **Session persistence** — Partial assistant turns saved to `chat.history` when there is meaningful content; tool-chain edge cases documented and handled safely.
6. **Parity** — `sendMessagePlain` (`src/api/chat.ts`) receives the same stop/finalize behavior for tests and legacy path.

---

## Acceptance criteria

| # | Criterion |
|---|-----------|
| AC1 | While `streaming`, `#sendBtn` shows Stop (not disabled spinner-only); click invokes stop within one user action. |
| AC2 | Active SSE `POST …/chat/completions` aborts; `AbortError` is handled without a red error bubble. |
| AC3 | `streaming` returns to `false`, `setSendLoading(false)` / composer stop mode cleared, mode/expert selectors re-enabled. |
| AC4 | Status strip shows a neutral stopped state (e.g. “Stopped”) not “Could not complete…”. |
| AC5 | Partial assistant markdown remains visible; row has `msg--stopped` (or equivalent) + “Generation stopped” chip/label. |
| AC6 | If partial text exists, `chat.history` contains an `assistant` message with that text and `stopped: true` (new optional field); reload via `renderChatFromHistory` shows the same stopped styling. |
| AC7 | Sub-agents spawned during the turn are cancelled (`parent_turn_abort`). |
| AC8 | Automated tests cover `stopGeneration()`, abort finalize helper, and composer mode toggle. |

---

## Current state (research)

### `src/app-state.ts`

- `streaming` flag + `setStreaming()`.
- `chatFetchAbort: AbortController | null` + `setChatFetchAbort()`.
- No exported `stopGeneration()` — abort controller is private to send paths.

### `src/tools/loop.ts` (primary send path)

- Entry: `sendMessageWithTools()`; guarded by `if (streaming) return` at line ~394.
- On send: aborts prior controller, creates new `AbortController`, `setChatFetchAbort(controller)`, `chatSignal = controller.signal`, `parentTurnId = createSubAgentRunId()`, `setSubAgentExecutorContext({ parentTurnId, … })`.
- Sets `setStreaming(true)` + `setSendLoading(true)` → **disables send button and textarea**.
- `streamCompletionTurn(…, chatSignal)` passes signal to `postChatCompletions` → `fetch(…, { signal })`; `reader.read()` throws `AbortError` when aborted.
- **`AbortError` handler (lines ~811–815):** calls `cancelAllForParentTurn(parentTurnId)`, `thoughtController?.abort()`, `streamCtx.streamStatus.dispose()`, then **`return`** (skips error UI).
- **`finally` block:** always runs — `setStreaming(false)`, `setSendLoading(false)`, clears `chatFetchAbort` when signal matches, `scrollBottom()`.
- **Gaps on abort:**
  - Does not `cancelAssistantBubbleRenderDebounce()`, remove cursor, or `revealProse()`.
  - Does not persist partial `fullText` to `chat.history`.
  - Does not mark bubble as stopped; `streamStatus.dispose()` removes status row entirely.
  - Does not set friendly `setStatus` for stop.
  - **Tool loop gap:** between `executeTool` calls (status “Running tools…”), `chatFetchAbort` is idle — stop does nothing until the next `streamCompletionTurn` unless we check `chatSignal.aborted` in the tool loop.

### `src/api/chat.ts` (`sendMessagePlain`)

- Same abort-controller pattern; `AbortError` disposes `streamStatus` and returns; same finalize gaps as tool loop (no partial persist, no stopped marker).
- **No `parentTurnId` / `cancelAllForParentTurn`** on this path (sub-agents only via tool loop) — parity is UI finalize + `stopped` history only.
- Not the default UI path (`messaging.ts` aliases tool loop), but should stay consistent for any caller still using plain send.

### `src/ui/input.ts`

- `setSendLoading(loading)` — disables `#sendBtn`, hides send icon, shows spinner, disables `#msgInput`.
- `handleKey` Enter → `sendMessage()`; no stop branch.
- `scrollBottom()` — used heavily during stream (coordinate with C3 later; out of scope here except don’t regress).

### `index.html` + `main.ts`

- `#sendBtn` `onclick="sendMessage()"`; only send icon + spinner spans (no stop icon).
- `window.sendMessage` wired in `main.ts`.

### Sub-agents — `src/agents/orchestrator.ts`

- `cancelAllForParentTurn(parentTurnId)` cancels runs with reason `parent_turn_abort`.
- `waitForSubAgent` listens to parent `AbortSignal` — sub-agent path already abort-aware when signal is passed (spawn/wait tools); parent stop via `cancelAllForParentTurn` covers fire-and-forget spawns.

### History / render — `src/ui/messages.ts`

- `AssistantMessage` has no `stopped` field today (`src/types.ts`).
- `renderChatFromHistory` does not render stopped affordance.

### Related: tool approval — `src/ui/tool-approval-modal.ts`

- Independently disables `#sendBtn` during approval; restore previous disabled state on close. Stop mode must compose: approval pending → still no send; streaming + not approval → stop enabled.

---

## Schema / API changes

| Change | Detail |
|--------|--------|
| `AssistantMessage.stopped?: boolean` | Client-only history flag; no server API or session schema version bump in v1 |
| `buildApiMessages` | Ignores `stopped` when sending to provider (content unchanged) |
| Session persistence | Existing `chat.history` array; `scheduleSaveSessions` after finalize |

No migration script — optional field on assistant rows only.

---

## Architecture

```mermaid
sequenceDiagram
  participant User
  participant SendBtn as sendBtn / input.ts
  participant Stop as stopGeneration()
  participant Abort as chatFetchAbort
  participant Loop as sendMessageWithTools
  participant SSE as postChatCompletions
  participant Orch as cancelAllForParentTurn

  User->>SendBtn: Click Send
  SendBtn->>Loop: sendMessage()
  Loop->>Abort: new AbortController
  Loop->>Loop: setStreaming(true), setComposerMode(stop)

  User->>SendBtn: Click Stop
  SendBtn->>Stop: stopGeneration()
  Stop->>Abort: abort()
  Abort->>SSE: AbortError
  SSE->>Loop: catch AbortError
  Loop->>Orch: cancelAllForParentTurn
  Loop->>Loop: finalizeStoppedTurn(partial)
  Loop->>Loop: finally: setStreaming(false), setComposerMode(send)
```

### Proposed modules

| Module | Responsibility |
|--------|----------------|
| `src/chat/stop-generation.ts` (new) | `stopGeneration(): void` — `if (chatFetchAbort) chatFetchAbort.abort()` |
| `src/ui/composer-send.ts` (new) or extend `input.ts` | `setComposerStreamingMode('send' \| 'stop')`, `handleComposerPrimaryAction()` |
| `src/chat/finalize-stopped-turn.ts` (new) | Shared `finalizeStoppedTurn(ctx)` for loop + plain send |
| `src/types.ts` | `AssistantMessage.stopped?: boolean` |
| `src/ui/messages.ts` | Stopped chip on render + `markMessageStopped(wrap)` |

---

## UX decisions (confirm before implementation)

| Topic | Recommendation | Alternative |
|-------|----------------|-------------|
| Textarea during stream | **Re-enable** on stop mode (Cursor-like: can type while model runs) | Keep disabled until complete (current) |
| Stop during tool approval | Keep send hidden/disabled (approval CSS already hides composer) | Show stop on approval strip |
| Stop during “Running tools…” | Check `chatSignal.aborted` before each `executeTool`; skip remaining tools with “Stopped by user” result | Let current tool finish (slower) |
| Incomplete tool_calls turn | If assistant+tool_calls already pushed, **do not** rollback v1; stop before next SSE round | Roll back assistant tool row (complex) |
| Empty abort (no tokens) | Remove `msg--awaiting-prose` row | Keep empty assistant shell with “Stopped” |

**Default for v1:** re-enable textarea in stop mode; cooperative abort in tool loop; no rollback of committed tool rows; remove empty awaiting shell.

---

## Implementation plan

### Phase 1 — Stop API and composer toggle

- [ ] **1.1** Add `src/chat/stop-generation.ts`:

```ts
export function stopGeneration(): void {
  if (chatFetchAbort) chatFetchAbort.abort();
}
```

- [ ] **1.2** Replace `setSendLoading` behavior split:
  - `setComposerStreamingMode(mode: 'idle' | 'streaming')` in `src/ui/input.ts` (or `composer-send.ts`):
    - **idle:** send icon visible, spinner hidden, button **enabled**, `aria-label="Send message"`, `data-mode="send"`.
    - **streaming:** stop icon visible (new `#sendStopIcon` in `index.html`), spinner hidden, button **enabled** (not disabled), `aria-label="Stop generating"`, `data-mode="stop"`, class `send-btn--stop`.
  - Keep `msgInput.disabled` only if product chooses locked composer; else enable during streaming.
- [ ] **1.3** `handleComposerPrimaryAction()` (exported to `window`):
  - if `streaming` → `stopGeneration()`
  - else → `sendMessage()`
  - Update `index.html` `onclick`, `main.ts` global, `handleKey` still calls send only when not streaming (Enter should not stop).
- [ ] **1.4** CSS in `src/styles/input.css`:
  - `.send-btn--stop` — distinct stop color (e.g. muted red or neutral per tokens).
  - Stop icon SVG (square/filled stop).
  - Ensure `:disabled` rules do not apply during streaming stop mode.

### Phase 2 — Finalize aborted turn (loop + plain)

- [ ] **2.1** Add `src/chat/finalize-stopped-turn.ts` with context:

```ts
export interface StoppedTurnContext {
  chat: Chat;
  wrap: HTMLElement;
  bubble: HTMLDivElement;
  cursor: HTMLDivElement;
  streamStatus: StreamingStatusHandle;
  thoughtController: ThoughtBubbleController | null;
  partialText: string;
  parentTurnId?: string;
}
```

- [ ] **2.2** `finalizeStoppedTurn(ctx)` implementation order:
  1. `cancelAssistantBubbleRenderDebounce()`
  2. `cursor.remove()` if still attached
  3. `thoughtController?.abort()`
  4. `streamStatus.dispose()` (or extend `stream-status.ts` with `setPhase('stopped')` that shows “Stopped” then dispose — prefer single `markStopped` on wrap)
  5. If `partialText.trim()`:
     - `revealAssistantProseBubble(wrap, bubble, …)`
     - `setAssistantBubbleContent(bubble, partialText, { streaming: false })`
     - `markMessageStopped(wrap)` — chip under label: “Generation stopped”
     - Push `AssistantMessage` with `content`, optional `thinking` from controller, `stopped: true`
     - `touchChat`, `scheduleSaveSessions`, `renderSidebar()`
  6. Else if wrap has `msg--awaiting-prose` and no content: `wrap.remove()`
  7. `setStatus('ok', 'Stopped')` or dedicated `setStatus('idle', 'Stopped')` if status API supports it
  8. `parentTurnId` → `cancelAllForParentTurn` (call from finalize or keep in catch — **once** only)

- [ ] **2.3** Track `partialText` in `sendMessageWithTools`:
  - Maintain `let livePartialText = ''` updated in `streamCompletionTurn` after each delta (return value already has `fullText` — on abort, use last known turn partial + any prose already finalized in multi-turn loop).
  - Pass into `AbortError` handler instead of bare `return`.

- [ ] **2.4** Refactor `loop.ts` `AbortError` catch to call `finalizeStoppedTurn` then fall through to `finally` (remove early `return` before finally, or keep return after finalize).

- [ ] **2.5** Mirror in `api/chat.ts` `sendMessagePlain` abort catch.

### Phase 3 — Tool loop cooperative stop

- [ ] **3.1** After each `executeTool` in the tool_calls branch, if `chatSignal.aborted`:
  - Break tool loop
  - Push synthetic tool result for remaining IDs: `content: 'Stopped by user.'` **or** skip remaining and call `finalizeStoppedTurn` with assistant prose only
  - Do not start next `streamCompletionTurn`
- [ ] **3.2** Before `streamCompletionTurn`, if `chatSignal.aborted`, throw `AbortError` or jump to finalize.
- [ ] **3.3** Document v1 limitation: in-flight `execute_command` / terminal stream may run to completion unless terminal runner gains abort (future).

### Phase 4 — Types and history render

- [ ] **4.1** Extend `AssistantMessage` in `src/types.ts`:

```ts
/** User stopped generation before the model finished. */
stopped?: boolean;
```

- [ ] **4.2** `renderChatFromHistory` / `appendBubble`: if `stopped`, apply `markMessageStopped(wrap)` after bubble render.
- [ ] **4.3** Optional: `buildApiMessages` ignores `stopped` flag (content still sent to API on later turns — correct).

### Phase 5 — Stream status polish (optional small)

- [ ] **5.1** Either extend `StreamPhase` with `'stopped'` or rely on `markMessageStopped` only (simpler).
- [ ] **5.2** `stream-status.ts`: if using phase, label “Generation stopped” before remove.

### Phase 6 — Integration points

- [ ] **6.1** `tool-approval-modal.ts`: when saving `prevSendDisabled`, if `streaming`, restore to **stop mode** not disabled.
- [ ] **6.2** `sidebar.ts` / `clearChat` — already block while streaming; unchanged.
- [ ] **6.3** `window-globals.d.ts` — add `handleComposerPrimaryAction` if replacing onclick name.

### Phase 7 — Build and tests

**Build (must pass before merge):**

```bash
npm run build    # tsc && vite build
npm test         # full suite; add new globs below
```

**Register new tests** in `package.json` `test` script (append to existing `tsx --test` chain):

- `test/chat/stop-generation.test.mts`
- `test/chat/finalize-stopped-turn.test.mts`
- `test/ui/composer-send.test.mts`

Use **jsdom** only where DOM helpers are required (`finalize-stopped-turn`, `composer-send`); keep `stop-generation.test.mts` as a pure module test with mocked `chatFetchAbort` if needed (inject via test-only setter or refactor `stopGeneration` to accept optional controller for testability — prefer minimal export from `app-state` test hook only if unavoidable).

- [ ] **7.1** `test/chat/stop-generation.test.mts`:
  - `stopGeneration()` calls `abort()` on controller when set.
  - No-op when `chatFetchAbort` is null.
- [ ] **7.2** `test/chat/finalize-stopped-turn.test.mts` (jsdom):
  - Partial text → history push with `stopped: true`, chip in DOM.
  - Empty awaiting row → removed.
- [ ] **7.3** `test/ui/composer-send.test.mts`:
  - `setComposerStreamingMode('streaming')` sets `data-mode="stop"`, button enabled.
  - `setComposerStreamingMode('idle')` restores send icon, `data-mode="send"`.
- [ ] **7.4** `npm run build` + `npm test` green.
- [ ] **7.5** Manual QA checklist (below).

### Phase 8 — Documentation

- [ ] **8.1** Update `documentation/context.md` § Chat / tool loop with stop behavior and `stopped` history field.
- [ ] **8.2** Mark C1 done in product backlog when shipped.
- [ ] **8.3** Record implementer results and manual QA in [`documentation/plans/verification/feature-14.md`](../verification/feature-14.md).

---

## Verifier handoff

Create / update [`documentation/plans/verification/feature-14.md`](../verification/feature-14.md):

- **Plan review:** backlog C1 + per-agent template (problem, files, schema, AC, tests, todos).
- **Automated (on ship):** `npm run build`, `npm test` including `test/chat/stop-generation.test.mts`, `test/chat/finalize-stopped-turn.test.mts`, `test/ui/composer-send.test.mts`.
- **Manual:** M1–M8 from § Manual test plan below.
- **Sign-off:** **PASS** only if AC1–AC8 and manual checks pass after implementation.

---

## Files to touch

| File | Change |
|------|--------|
| `src/chat/stop-generation.ts` | **New** — public stop API |
| `src/chat/finalize-stopped-turn.ts` | **New** — shared abort UI + history |
| `src/ui/input.ts` | Composer mode, primary action |
| `index.html` | Stop icon span, onclick handler name |
| `src/main.ts` | Window binding |
| `src/window-globals.d.ts` | Types |
| `src/tools/loop.ts` | partial text tracking, abort finalize, tool-loop abort checks |
| `src/api/chat.ts` | Plain send parity |
| `src/types.ts` | `stopped?` on assistant messages |
| `src/ui/messages.ts` | `markMessageStopped`, history render |
| `src/styles/input.css` | Stop button styles |
| `src/styles/messages.css` (or existing msg css) | `.msg--stopped`, chip |
| `src/ui/tool-approval-modal.ts` | Restore stop mode after approval |
| `test/chat/*.mts` | Unit tests |
| `documentation/context.md` | Ship note |
| `documentation/plans/verification/feature-14.md` | Plan review + post-ship sign-off |

**No server changes** — abort is client-side `fetch` signal only; LM Studio may still complete generation server-side (acceptable).

---

## Manual test plan

1. **Basic stream** — Send short prompt; click Stop mid-token → partial text remains, stopped chip, composer send mode, status “Stopped”, can send again.
2. **Thinking phase** — Model with reasoning; stop during “Thinking…” → thought UI settles, no error bubble.
3. **Tool turn** — Prompt that triggers tool; stop during “Running tools…” → no hang; sub-agents cancelled if spawn ran.
4. **Multi-round** — Stop during second assistant stream after tools → only partial second bubble saved; first tool rows remain.
5. **Reload** — Stop, refresh page → stopped message still marked in history.
6. **Tool approval** — Trigger approval modal; confirm send/stop hidden; after allow/deny, streaming stop works on next turn.
7. **Double stop** — Click Stop twice → no throw, clean idle state.
8. **sendMessagePlain** — If dev hook still exposed, repeat test 1 on plain path.

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Debounced markdown behind partial text | Flush debounce in finalize; use accumulated `livePartialText` string, not DOM innerHTML |
| Orphan tool_calls without results | Cooperative tool loop writes “Stopped by user” for skipped tools or break before API confuses model |
| `finally` + early return ordering | Single finalize function; avoid duplicate `cancelAllForParentTurn` |
| Approval modal restores wrong btn state | Read `streaming` when restoring `sendBtn` |
| Provider ignores abort | Accept ~1s best-effort; reader abort still ends UI path |

---

## Out of scope (this feature)

- C2 message actions (edit, regenerate, delete)
- C3 smart scroll / stick-to-bottom
- C5 stream persistence across reload **during** active stream (only stopped **completed** partial persist here)
- Server-side cancel endpoint for LM Studio
- Aborting in-flight PTY/terminal commands (document as follow-up)
- Keyboard shortcut for stop (e.g. Esc) — nice-to-have later

---

## Todos (implementation checklist)

- [ ] Add `stopGeneration()` and wire composer Stop mode (Phase 1)
- [ ] Implement `finalizeStoppedTurn` + partial text tracking (Phase 2)
- [ ] Cooperative abort in tool execution loop (Phase 3)
- [ ] `stopped` type + history render (Phase 4)
- [ ] Tool approval send-button restore (Phase 6)
- [ ] Unit tests + manual QA (Phase 7)
- [ ] Update `documentation/context.md` on ship (Phase 8)

---

## Reference snippets (current behavior)

**Abort today in tool loop** (`src/tools/loop.ts`):

```811:815:src/tools/loop.ts
    if (e && e.name === 'AbortError') {
      cancelAllForParentTurn(parentTurnId);
      thoughtController?.abort();
      streamCtx.streamStatus.dispose();
      return;
```

**Send loading disables stop** (`src/ui/input.ts`):

```23:31:src/ui/input.ts
export function setSendLoading(loading: boolean): void {
  const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement;
  sendBtn.disabled = loading;
  sendBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
  document.getElementById('sendIcon')!.classList.toggle('hidden', loading);
  document.getElementById('sendSpinner')!.classList.toggle('hidden', !loading);
  const input = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  if (input) input.disabled = loading;
}
```

**Abort controller lifecycle** (`src/app-state.ts`):

```10:11:src/app-state.ts
export let chatFetchAbort: AbortController | null = null;
```

```30:32:src/app-state.ts
export function setChatFetchAbort(controller: AbortController | null): void {
  chatFetchAbort = controller;
}
```
