---
name: Feature 05 — Interrupt and steer
overview: Let users inject a correction into the in-flight main chat turn at the next tool-loop boundary without aborting the current stream or restarting the turn from scratch.
source: documentation/plans/feature-audit-roadmap.md §5
status: shipped
todos:
  - id: schema-pending-steer
    content: Add Chat.pendingSteerMessage (+ optional UserMessage.steer flag); session persist + migration note in types
    status: pending
  - id: steer-module
    content: Create src/chat/steer-message.ts — enqueue, consume, format API/history line, DOM chip helper
    status: pending
  - id: loop-consume
    content: Consume pending steer at top of each runChatTurn tool-loop iteration; render history + scheduleSave
    status: pending
  - id: composer-ux
    content: Streaming composer — text+Enter/Send steers; empty primary action stops; update aria-labels and stream hint
    status: pending
  - id: styles-affordance
    content: Steer chip CSS (parallel to stopped-affordance); history reload paints steer rows
    status: pending
  - id: tests-steer
    content: Unit tests for consume boundary, enqueue replace, composer routing; loop integration with mocked stream
    status: pending
  - id: docs-context
    content: Update documentation/context.md and feature-audit-roadmap §5 status when shipped
    status: pending
  - id: verification-doc
    content: Add documentation/plans/verification/feature-05-interrupt-steer.md checklist
    status: pending
isProject: false
---

# Feature 05 — Interrupt and steer

**Audit ref:** [feature-audit-roadmap.md](../feature-audit-roadmap.md) item **#5** (Agent Layer Polish).  
**Architecture ref:** [context.md](../../context.md) — Stop generation (feature 14), Switch chats while waiting, Backend-owned generations, tool loop in [`src/tools/loop.ts`](../../../src/tools/loop.ts).

---

## Summary

Today, **Stop** aborts the entire turn (`stopGeneration` → `chatFetchAbort.abort()` + `cancelGeneration`). Users can draft the next message in the composer while streaming, but **Send** and **Enter** do not deliver it until the turn ends—and the primary button only **stops**, never **steers**.

This feature adds **steer**: queue user text on the active streaming chat, persist it on `Chat`, and inject it into the model context at the **next tool-loop boundary** inside `runChatTurn`—after the current SSE chunk finishes and before the next `buildApiMessages` / `streamCompletionTurn`—without cancelling the in-flight generation mid-token and without `resendFromIndex` / a new user turn from scratch.

---

## Current state

| Capability | Status | Location |
|------------|--------|----------|
| Stop in-flight main turn | **Built** | [`src/chat/stop-generation.ts`](../../../src/chat/stop-generation.ts) — `cancelGeneration` + `chatFetchAbort.abort()` |
| Tool loop (multi-round SSE + tools) | **Built** | [`src/tools/loop.ts`](../../../src/tools/loop.ts) — `runChatTurn`, `for (turn … maxToolTurns)` |
| Ephemeral API-only user line (not in history) | **Built** | `buildApiMessages` `ephemeralContinueInstruction`; [`src/tools/turn-continuation.ts`](../../../src/tools/turn-continuation.ts) `EMPTY_POST_TOOL_CONTINUE_INSTRUCTION` |
| Composer enabled while streaming | **Built** | [`src/ui/composer-send.ts`](../../../src/ui/composer-send.ts) — textarea not disabled in streaming mode |
| Primary button = Stop when active chat streams | **Built** | `handleComposerPrimaryAction` → `stopGeneration()` only |
| Enter while streaming | **No-op** | [`src/ui/input.ts`](../../../src/ui/input.ts) → `sendMessage()` → `sendMessageWithTools` returns early at `isActiveChatStreaming()` |
| Background stream in another chat | **Built** | [`src/chat/streaming-state.ts`](../../../src/chat/streaming-state.ts) — active chat keeps Send; hint in `composer-stream-hint.ts` |
| Switch chat without abort | **Built** | Stream continues; DOM gated via `isStreamDomVisible` |
| Sub-agent / Reef / title paths | **Separate** | Still use `postChatCompletions` or isolated loops — **out of v1 scope** |

**Stop path (reference):**

```9:21:src/chat/stop-generation.ts
export function stopGeneration(): void {
  forceCloseAskQuestionModal();
  const chat = getActiveChat();
  const generationId = chat.currentGenerationId?.trim();
  if (generationId) {
    void cancelGeneration(generationId).catch(() => { /* best-effort */ });
  }
  if (chatFetchAbort) chatFetchAbort.abort();
}
```

**Tool-loop boundary (injection point):**

```760:777:src/tools/loop.ts
    for (let turn = 0; turn < maxToolTurns; turn++) {
      if (chatSignal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      // … get tools …
      const messages = buildApiMessages(chat, sysPrompt, {
        modelId: sendModelId,
        pendingUserText: pushUser ? userText || rawText : undefined,
        composedSystemPrompt: sysPrompt,
        userRulesContent: userRulesContent ?? undefined,
        ephemeralContinueInstruction: ephemeralPostToolInstruction,
      });
```

Steer consumption belongs **immediately after** the `chatSignal.aborted` check and **before** `buildApiMessages` (each loop iteration = one model round).

---

## Gap

| Desired | Today |
|---------|--------|
| User sends correction while agent is running | Composer text is ignored (early return) or button only stops |
| Current agent reads correction **without** full restart | Only stop + partial assistant persist, or wait until turn completes |
| Injection at **tool / loop boundary** | No `pendingSteerMessage`; no consume hook in loop |
| Distinct UX: **Steer** vs **Stop** | Single Stop affordance; Enter does not steer |

**Product gap (from audit):** Inject a steering message the **current** agent reads at the next tool/loop boundary — **no full restart**.

---

## Goals

1. **Steer without abort:** Queued text does not call `chatFetchAbort.abort()` or `cancelGeneration` unless the user explicitly stops.
2. **Boundary-safe injection:** Apply steer only between tool-loop rounds (after current stream/tools finish, before next model request).
3. **Durable trace:** Steer lines appear in `chat.history` (and `~/.minnow/sessions/state.json`) so reload and branch actions see them.
4. **Composer clarity:** While the **active** chat streams, non-empty composer + Send/Enter **steer**; empty composer + primary click **stops** (preserve feature 14).
5. **Coexist with multitask:** Steering targets `streamingChatId`; background-stream rules unchanged (`isBackgroundStreamBlockingSend`).
6. **v1 scope:** Main chat `runChatTurn` only; no sub-agent child loops, no mid-SSE token injection, no attachment/slash steer unless explicitly added in a later phase.

---

## Non-goals (v1)

- Cancelling the **current** upstream generation the moment steer is typed (steer waits for natural chunk end).
- Steer into a **background** chat without switching to it (user must use **Go to chat** or switch sidebar).
- Steer while `ask_question` modal is open (reuse `forceCloseAskQuestionModal` pattern from stop, or block steer with status message).
- Orchestrate board–only UX without chat DOM (steer still writes history; board refresh on consume is enough).
- Server-side generation API changes (steer is client session + message list only).
- Replacing **Stop** with steer on long-press / modifier keys (optional phase 2).

---

## Acceptance criteria

### Functional

- [ ] With active chat streaming and non-empty `#msgInput`, **Enter** and **Send** enqueue steer, clear the input, and show a brief status (e.g. “Steering at next step…”).
- [ ] With active chat streaming and **empty** input, `#sendBtn` click still calls **`stopGeneration()`** (abort + cancel generation + stopped affordance unchanged).
- [ ] Steer text is stored on the streaming `Chat` as `pendingSteerMessage` until consumed.
- [ ] At the **start of the next** `for (turn …)` iteration in `runChatTurn`, pending steer is appended to `chat.history` as a **user** message, cleared from `pendingSteerMessage`, persisted via `scheduleSaveSessions`, and included in the next `buildApiMessages` call.
- [ ] If the user steers again before consume, **last message wins** (single slot `pendingSteerMessage`, not a queue)—documented in UI status.
- [ ] Steer during an in-flight **tool execution** takes effect **after** that tool returns (next loop iteration), not mid-`executeTool`.
- [ ] Steer during token streaming takes effect **after** the current `streamCompletionTurn` completes (including `tool_calls` handling for that round).
- [ ] Stop still aborts: partial assistant, `Stopped by user.` tool skips, `cancelAllForParentTurn`, `stopped: true` — no regression in [`test/chat/stop-generation.test.mts`](../../../test/chat/stop-generation.test.mts) / finalize-stopped tests.
- [ ] `sendMessageWithTools` when **not** streaming behaves unchanged (normal new turn).
- [ ] Reload mid-turn: if `pendingSteerMessage` was saved before consume, resume path still consumes on next loop iteration after `generation-resume` re-enters `runChatTurn`.

### UX / a11y

- [ ] Streaming mode: `aria-label` on primary button reflects dual behavior (“Stop generating” when input empty; “Send steering message” or keep Send label when text present—pick one consistent pattern and test with screen readers).
- [ ] History shows a small **Steered** chip on user rows injected via steer (mirror `msg--stopped` pattern).
- [ ] Optional: composer hint line when `pendingSteerMessage` is set (“Correction queued…”).

### Regression guards

- [ ] Background chat streaming: active chat cannot start a new turn (`isBackgroundStreamBlockingSend`); cannot steer a non-active chat from composer.
- [ ] Message actions, regenerate, resend remain blocked while streaming (`message-actions.ts` guards).
- [ ] `maxToolTurns` cap still applies; steer does not reset the turn counter (each consume does not increment a separate “steer turn” budget unless product decides otherwise—**default: no extra budget**).

---

## Architecture

### Data model

```ts
// src/types.ts — Chat
pendingSteerMessage?: string;  // trimmed non-empty while queued; cleared on consume

// Optional — UserMessage (if history typing supports flags)
steer?: boolean;  // true when row came from steer consume (UI chip)
```

Persist in existing `SessionState` blob; no new server routes. Schema version bump only if validators require it (prefer optional field, backward compatible).

### Module layout (recommended)

| Module | Responsibility |
|--------|----------------|
| `src/chat/steer-message.ts` | `enqueueSteerMessage(chat, text)`, `consumePendingSteer(chat, options)`, `formatSteerHistoryContent(text)`, guards |
| `src/tools/loop.ts` | Call `consumePendingSteer` at loop top; wire DOM append when `isStreamDomVisible` |
| `src/ui/composer-send.ts` | Branch `handleComposerPrimaryAction` (steer vs stop) |
| `src/tools/loop.ts` `sendMessageWithTools` | Early path: if `isActiveChatStreaming()` && has text → `enqueueSteerMessage` + return |
| `src/ui/input.ts` | No change if send path handles streaming steer |
| `src/ui/steer-affordance.ts` | `markMessageSteered(wrap)` (parallel to stopped-affordance) |
| `src/styles/messages.css` | `.msg--steered`, `.msg-steer-chip` |

### Consume at tool-loop boundary

```mermaid
sequenceDiagram
  participant User
  participant Composer
  participant Chat as Chat.pendingSteerMessage
  participant Loop as runChatTurn for-turn
  participant API as streamCompletionTurn

  User->>Composer: Type correction + Enter
  Composer->>Chat: enqueue (no abort)
  Loop->>API: Finish current stream/tools
  Note over Loop: Next for-iteration top
  Loop->>Chat: consume → history user row
  Loop->>API: buildApiMessages includes steer
```

**Consume algorithm (pure + side effects):**

1. If `!chat.pendingSteerMessage?.trim()` → return `{ consumed: false }`.
2. `content = formatSteerHistoryContent(trimmed)` (plain user text; v1 no skill footer).
3. `chat.history.push({ role: 'user', content, steer: true })`; `recordChatMessage`; `touchChat`.
4. `chat.pendingSteerMessage = undefined`; `scheduleSaveSessions()`.
5. If `isStreamDomVisible(chat.id)` → append user bubble + steer chip + scroll.
6. Return `{ consumed: true, content }`.

**Do not** use `ephemeralContinueInstruction` for steer in v1—history persistence is required for audit and regenerate. Reuse the same *pattern* only if we need a system hint prefix later (e.g. `[User correction before you continue]: …` as part of `content`).

### Composer routing

| State | Input | Action |
|-------|-------|--------|
| Active chat streaming | Non-empty text | `enqueueSteerMessage(getActiveChat(), text)` — **must** resolve chat by `streamingChatId`, not only active, if we ever allow steering from a dedicated panel; **v1: only when `isActiveChatStreaming()`** |
| Active chat streaming | Empty text | `stopGeneration()` |
| Idle | Any | existing `sendMessageWithTools` |

Update `setComposerStreamingMode` labels: consider `data-mode="stop-or-steer"` and derive label from input `input` event (debounced) for accessibility.

### Interaction with abort

If user **Stop** while `pendingSteerMessage` is set:

- **Recommended:** clear `pendingSteerMessage` on abort (steer irrelevant after stop).
- Persist cleared state on `scheduleSaveSessions` in abort handler in `loop.ts` `catch (AbortError)`.

If user **Stop** during `executeTool`, existing cooperative skip remains; queued steer is dropped.

### `sendMessageWithTools` vs `runChatTurn`

Roadmap wording says “top of each `sendMessageWithTools` round”; the actual multi-round driver is **`runChatTurn`’s `for` loop**. Implementation: consume in **`runChatTurn` only**. `sendMessageWithTools` only **enqueues** when streaming. `resendFromIndex` / `generation-resume` already call `runChatTurn` and inherit consume automatically.

---

## Key files

| File | Change |
|------|--------|
| [`src/types.ts`](../../../src/types.ts) | `Chat.pendingSteerMessage`; optional `UserMessage.steer` |
| [`src/state/sessions.ts`](../../../src/state/sessions.ts) | Ensure serialize/deserialize passes through optional fields |
| [`src/chat/steer-message.ts`](../../../src/chat/steer-message.ts) | **New** — enqueue / consume / format |
| [`src/tools/loop.ts`](../../../src/tools/loop.ts) | Consume at loop top; abort clears pending; `sendMessageWithTools` steer entry |
| [`src/ui/composer-send.ts`](../../../src/ui/composer-send.ts) | Steer vs stop on primary action |
| [`src/chat/stop-generation.ts`](../../../src/chat/stop-generation.ts) | Optional: `clearPendingSteer(getActiveChat())` helper call |
| [`src/ui/messages.ts`](../../../src/ui/messages.ts) | `renderChatFromHistory` paints steer chip when `steer: true` |
| [`src/ui/steer-affordance.ts`](../../../src/ui/steer-affordance.ts) | **New** — DOM chip |
| [`src/styles/messages.css`](../../../src/styles/messages.css) | Steer styles |
| [`documentation/context.md`](../../context.md) | New section after ship |
| [`documentation/plans/feature-audit-roadmap.md`](../feature-audit-roadmap.md) | §5 → **Built** when done |

**Reference patterns:** `ephemeralContinueInstruction` in `buildApiMessages` ([`loop.ts` L361–364](../../../src/tools/loop.ts)); stopped chip [`src/ui/stopped-affordance.ts`](../../../src/ui/stopped-affordance.ts); streaming guards [`src/chat/streaming-state.ts`](../../../src/chat/streaming-state.ts).

---

## Implementation phases

### Phase 1 — Schema and pure helpers

- Add types and `steer-message.ts` with unit-testable `consumePendingSteer` / `enqueueSteerMessage`.
- Document last-write-wins for repeated steer.
- No UI yet; tests for consume/no-op/trim.

### Phase 2 — Tool loop integration

- Import consume in `runChatTurn` at loop top (before `buildApiMessages`).
- On consume with visible DOM, append user bubble (reuse `appendBubble` + affordance).
- Clear pending on `AbortError` path.
- Manual test: steer between two tool rounds on a long task.

### Phase 3 — Composer and send entry

- `sendMessageWithTools`: if `isActiveChatStreaming()` && trimmed text → enqueue, clear input, status, return.
- `handleComposerPrimaryAction`: streaming + empty → stop; streaming + text → enqueue (same as send).
- Adjust `aria-label` / optional dynamic `data-mode` when input non-empty.
- Verify Enter path via `sendMessage()` re-export.

### Phase 4 — History reload and polish

- `renderChatFromHistory` steer chip.
- CSS tokens aligned with `--elevated-fg` / existing chips.
- Optional queued hint in `composer-stream-hint.ts` when pending set on active streaming chat.

### Phase 5 — Docs and verification

- `documentation/plans/verification/feature-05-interrupt-steer.md` manual QA script.
- Update `context.md` and audit roadmap status.

---

## Dependencies

| Dependency | Reason |
|------------|--------|
| Feature 14 Stop generation | Steer must not break abort semantics |
| Backend-owned generations (`currentGenerationId`) | Stream continues until chunk end; steer between POST rounds |
| `runChatTurn` / tool loop | Sole consume location |
| Session persistence (`state/sessions.ts`) | Survive reload with pending steer |
| Switch chats while waiting | DOM may be hidden; history + consume still work |

**Soft dependency:** Feature #1 trace/replay would later record steer events as first-class run inputs (not required for v1).

**Blocks:** None for other audit items.

---

## Tests

| Suite | Path | Cases |
|-------|------|-------|
| Steer consume (pure) | `test/chat/steer-message.test.mts` | empty pending; trim; history push + flag; clear pending; last-write-wins enqueue |
| Loop boundary (integration) | `test/chat/steer-loop-boundary.test.mts` | mock `streamCompletionTurn` / stub turn loop: steer before round 2 appears in `buildApiMessages` input; not consumed mid-round |
| Composer routing | `test/ui/composer-steer.test.mjs` | happy-dom: streaming + text → enqueue not abort; streaming + empty → abort called |
| Regression | existing `test/chat/stop-generation.test.mts`, `finalize-stopped-turn`, `composer-send.test.mjs` | all pass |

**Test data:** fixed chat id `11111111-1111-1111-1111-111111111111`; static steer string `"Use pnpm not npm"`; no `Date.now()` in assertions.

**Manual QA (verification doc):**

1. Start a tool-heavy prompt (e.g. list files then edit); while tools run, steer “only read, do not write”; agent follows on next round.
2. Steer during prose streaming; confirm tokens finish, then steer appears, then model responds.
3. Double-steer quickly; only latest text applied.
4. Stop with queued steer; pending cleared, no steer row after stop.
5. Switch away and back during stream; steer still consumed; history shows steer row when returning.
6. Reload with pending steer + `currentGenerationId`; resume consumes steer on next iteration.

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| User expects **instant** interrupt mid-token | Feels laggy if model streams long prose | Status copy: “Queued — applies after current step”; future phase: optional abort-then-steer |
| Steer during long **server tool** (e.g. terminal) | Correction delayed until tool returns | Document; consider tool cancellation in v2 |
| `maxToolTurns` exhausted right after steer | Model never sees steer | If consume happens on last allowed iteration, steer is in history but no new round—set status “Steer applied; turn limit reached” |
| Race: steer + stop same tick | Undefined behavior | Process stop first; clear pending in abort handler |
| Duplicate user rows in DOM when not visible | Duplicate on remount | Use same `appendBubble` path as `pushUser` with history index; `renderChatFromHistory` idempotent |
| Slash / attachments on steer | Ambiguous parsing | v1: strip slash handling—steer is raw text only; reject attachments in steer enqueue with status err |
| Sub-agent parent turn | Child unaware of parent steer | v1 acceptable; sub-agents use parent history only on next parent round |
| Session schema drift | Old clients drop field | Optional field; default `undefined` |

---

## Open questions (resolve before Phase 3)

1. **Prefix in model context:** Plain user text vs wrapped `[Steering correction]: …` system-visible prefix?
2. **Steer + skill:** If user types `/skill`, treat as plain text or block?
3. **Orchestrate board view:** Show toast only, or also flash in chat when `viewMode === 'board'`?
4. **Increment `turn` counter** when consume only adds history without a new model call in the same iteration—ensure consume happens **before** `streamCompletionTurn`, not after an empty continue.

---

## Related links

- Audit: [feature-audit-roadmap.md §5](../feature-audit-roadmap.md)
- Stop: [context.md § Stop generation](../../context.md)
- Multitask: [context.md § Switch chats while waiting](../../context.md)
- Build folder index: [Build out/](.)
