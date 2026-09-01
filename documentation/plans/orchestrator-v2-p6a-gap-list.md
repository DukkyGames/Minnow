# P6-A Gap list — non-board `runTurn()` spike (MIN-723)

**Date:** 2026-08-31  
**Parent:** MIN-683 / Phase 6  
**Spike, not a migration.** P6-A did not patch `server/runner/` to make interactive chat look native. P6-C (MIN-725) closed the interface findings. **P6-D (MIN-726) deleted `src/tools/loop.ts`.** Product send is `runChatTurn` → `runTurn()`. There is no dual-path flag.

## P6-D status (MIN-726) — 2026-08-31

Leftovers re-homed as caller overlays around `runTurn()`:

| Overlay | Owner |
|---------|--------|
| Super Plan (`superPlanStage`, hidden user rows) | `runChatTurn` |
| Resume / fork / regenerate | HTTP `/api/generations` resume inside wrapped `postChatCompletions` (first call only). No `runTurn` option. Fork/replay via `replaySnapshot` / `forkOverrides` around `createRun` |
| Attachments / VLM | `src/chat/build-api-messages.ts` + `overlayMultimodalHistoryForRunTurn` |
| Exclusive skill compose + UI Designer | `composeRunTurnChatSystemPrompt` / `chatToolDefinitionsForTurn` |
| `suppressUserEcho` / hidden user rows | `runChatTurn` push-user overlay |
| Queue / goal / `/loop` / steer | already P6-C; still after `runTurn` |
| User-rules | concatenated into one `systemPrompt` |
| Library model auto-load, titles, synthesis, stats | caller before/after |
| "Calling {tool}…" while args stream + remount | `TurnEvent.tool_streaming` (inner `onToolCallDelta`) → painter `attachToolStartIndicator` |

**Keep (Phase 8):** `src/agents/controller/` and renderer `src/agents/sub-agent-runner.ts`. Sub-agents spawn *within* a turn; they are not the board scheduler.

**Keep:** `src/api/board-testing.ts` (V2 Settings → Board testing). Satellites `chat-tool-batch.ts`, `turn-continuation.ts`, `tool-wrap-dom.ts`, `stream-chat-dom.ts`, `streaming-state.ts` still have other callers.

P6-D done means no second loop. A copy of `streamCompletionTurn` must not return.

## P6-C status (MIN-725) — 2026-08-31

Interface (must-land, done):

| Finding | Status |
|---------|--------|
| 1 History continuation (`messages[]` / `seedKind: 'continue'`) | **Done.** Board callers that pass only `seed` stay isolated. |
| 2 Optional report tool (`injectReportTool: false` / `reportToolName: null`) | **Done.** Default remains inject-on. No product-shaped branch in `server/runner/`. |
| 3 `TurnResult` has no `completed` | **Done as (a):** chat maps `no_report` → turn complete. No new outcome. |
| 4 Disable nudge + structured-outcome finalization | **Done.** `nudgeToolUse: false`, `finalizeStructuredOutcome: false`. Board omits (defaults on). |
| 5 TranscriptStore suffix | **Done** as a consequence of (1): continue persist suffixes once at turn end (skips the leading system; does not splice). Isolated persist is unchanged. |
| 6 `execute` attachments | **Caller wrap.** Adapter returns `attachments` on the execute payload for inner vision follow-ups; `TurnEvent` is not widened. DOM screenshot painting beyond `executeTool` side effects is leftover. |
| 7 Lifecycle events | **Not added.** Promise + `crashed`/`timeout`. Stream chrome stays in the caller. |

Overlays around `runTurn` (not inside the runner):

| Overlay | Status |
|---------|--------|
| Mode `systemPrompt` + tool catalog | **Landed.** `composeSystemPrompt` via `resolveOutboundSystemMessages`; `getEnabledToolDefinitionsForChat`. |
| `AskCapability` | **Landed** (P6-B). Execute still refuses `ask_question`. |
| Steer | **Landed as abort + follow-up** (`resumeParentChatWithMessage`). In-turn tool-boundary consume + steer chip on the user row remain caller overlays (P6-D; no second loop). |
| Composer queue | **Landed.** `flushPendingMessageQueue` after a normal `no_report`. |
| Goal + `/loop` | **Landed after the turn.** `maybeContinueGoalAfterTurn` / `maybeRescheduleLoopsAfterTurn`. Goal-driven turns are eligible. |
| Stream-end order | **Landed:** `setStreaming(false)` before `notifyChatStreamEnded`. |
| Usage | **Landed.** `recordChatCompletionUsage` with `source.kind: 'main'`. Renderer deps `recordTurnUsage` is a no-op on this path. |
| Attachments / VLM `buildApiMessages` | **Re-homed (P6-D).** `src/chat/build-api-messages.ts` + overlay around `runTurn`. |
| First-turn injection notice DOM | **Leftover.** Prompt still carries injection text. |
| Titles | **Landed** (`scheduleChatTitleGeneration` on first user send). |

**Flag (historical P6-C):** dual-path `MINNOW_DEBUG` + `localStorage['minnow.p6c.runTurnChat']`. **Deleted in P6-D.**

### Leftover exclusive `loop.ts` behaviour — **re-homed (P6-D)**

`src/tools/loop.ts` is deleted. Dual-path flag deleted. All rows below are caller overlays around `runTurn()` (or Phase 8).

- Dual-path flag itself (`MINNOW_DEBUG` + `localStorage['minnow.p6c.runTurnChat']`) — **deleted** with `loop.ts`
- Super Plan (`superPlanStage`)
- Resume / fork / regenerate (`resumeGenerationId`, `replaySnapshot`, `forkOverrides`)
- Attachments / VLM multimodal history (`buildApiMessages`, design-ref turn linking)
- Impeccable / caveman / partymode / git-setup skill compose (and UI Designer work-agent remap)
- `suppressUserEcho` / hidden user rows (sub-agent completion resume)
- Library model auto-load / ensure-serve
- Turn snapshots / fork history / post-turn synthesis / stats strip / truncated / stopped presentation
- In-turn steer at a tool-loop boundary (this path aborts + follow-up instead)
- User-rules as a **second** system message (this path concatenates into one `systemPrompt`)
- Mid-turn thinking-budget continuation / sampler library merge / work-agent model remap
- Sub-agent **controller** (`src/agents/controller/`) — Phase 8

The dual-path flag is deleted (P6-D). Every send is `runChatTurn` → `runTurn()`.

---

## How the P6-A spike worked (historical)

- **Flag (off by default):** `MINNOW_DEBUG=1` **and** `localStorage['minnow.p6a.runTurnChat'] === '1'`. Same maintainer gate as Settings → Advanced → Board testing. No new Settings chrome.
- **Simple shape only:** fresh user send, no attachments, no resume/fork/regenerate, no Super Plan, no goal, no skill, no ephemeral context. Anything else stays on `runChatTurn` even with the flag on.
- **Adapter:** [`src/chat/run-turn-chat.ts`](../../src/chat/run-turn-chat.ts) calls `runTurn` from [`server/runner/index.js`](../../server/runner/index.js) (isomorphic — not `node.js` / `tool-dispatch.js`). Completions: HTTP `/api/generations` via `postChatCompletions`. Tools: existing `executeTool` / `runHeadlessToolBatch`.
- **Transcript:** P2-A `createSessionTranscriptStore` is shared ([`src/agents/session-transcript-store.ts`](../../src/agents/session-transcript-store.ts)). The spike **wraps** it with an isolated buffer because passing the raw session store would splice `[system, seed]` into a live multi-turn `chat.history`. That wrap is evidence, not a fix.
- **DOM:** `onEvent` (`delta` / `thinking` / `tool_call` / `tool_result`) maps onto existing helpers (`scheduleAssistantBubbleRender`, `ThoughtBubbleController.appendReasoningDelta`, `renderToolCall` / `renderToolResult`).
- **Honest outcome:** a successful assistant reply without `report_outcome` is `TurnResult.outcome === 'no_report'`. The spike does not pass `systemPrompt` (default remains the report reminder) and does not omit the injected report tool.

## Classification key

| Bucket | Meaning for P6-C |
|--------|------------------|
| **belongs in the runner** | Shared loop should own this for every caller (boards, chat, later sub-agents). |
| **belongs in the caller** | Chat / Super Plan / composer should keep this outside `runTurn`. |
| **needs an interface change** | `runTurn` / `TurnEvent` / `TurnResult` / `TranscriptStore` / `execute` cannot express this today. **This is a finding against Phases 2–5.** |

Already recorded (not new): `parseReport`, `systemPrompt` on `runTurn()` options.

**P6-A introduced no `runTurn` / `TurnEvent` / `TurnResult` signature changes.** The rows below are what P6-C would have to add or work around.

---

## Needs an interface change (Phases 2–5 findings)

These are the only rows that reopen the runner contract. P6-C should decide each one explicitly before strangling `loop.ts`.

### 1. `seed: string` starts an isolated transcript, not a chat continuation

**Observation:** Inner `createSubAgentRunner().run()` always begins `messages = [system, user(seed)]`. `TranscriptStore.load` is used for **meta** (thinking mode), not for prior turns. A second user message in an existing chat never reaches the model.

**P6-C:** Add `messages?: TranscriptMessage[]` (or `seedKind: 'continue'` that loads `transcript.load(chatId).messages` and appends the new user row). Until then the caller cannot implement multi-turn chat on `runTurn`.

### 2. `report_outcome` is always injected

**Observation:** `withReportTool()` appends `report_outcome` when missing. Chat does not use that tool. The default `systemPrompt` tells the model to call it. A normal reply is `no_report`. A model that obeys the prompt ends the turn as `pass` / `fail` / `blocked` and the user sees a report-tool row.

**P6-C:** Allow omitting the report tool (`reportToolName: null` / `injectReportTool: false`). Do **not** add `if (isBoard)` — the flag is “does this caller want a report tool?”, which boards pass and chat does not.

Covered by `test/runner/run-turn.test.mjs` (“report_outcome stays injected even when the caller passes chat tools”).

### 3. `TurnResult` has no “replied” outcome

**Observation:** Chat success is an assistant message. The six-way union is a report-tool contract. The spike treats `no_report` as the successful chat end.

**P6-C:** Either (a) caller maps `no_report` → chat complete (no signature change), or (b) add `outcome: 'completed'` once report injection is optional so “agent forgot to report” and “chat finished with prose” are not the same symbol. (b) is the interface change; prefer (a) until (2) lands, then decide.

### 4. Inner loop is still a sub-agent loop (tool-use nudge + structured-outcome finalization)

**Observation:** After prose with `tools.length > 0` and zero tool turns, the loop injects `SUB_AGENT_TOOL_USE_NUDGE_INSTRUCTION` as a **user** row and requests another completion. After tools+prose it still runs `requestStructuredOutcome` (JSON summary schema). `runTurn` ignores that structured parse and returns `no_report` — extra tokens, extra latency, and continuation user rows that must not appear in the product transcript.

**P6-C:** Gate nudge + finalization on an injected option (`nudgeToolUse`, `summarySchema` already exists on the inner runner — thread it through `runTurn` so chat passes neither). This is the largest hidden cost of adopting the current wrapper.

### 5. `TranscriptStore` assumes chatId’s transcript **is** the turn

**Observation:** `persistNewMessages` appends the isolated `[system, seed, …]` tail by index. Pointing that at `chat.history` duplicates the user row and inserts a system prompt row chat never stores.

**P6-C:** Either (1) lands so `load` returns the real history and persist is a suffix, or add `appendMode: 'replace-turn' | 'suffix'`. The spike’s isolated wrap is a caller workaround, not a store contract.

### 6. `execute` result is `{ content: string }` only

**Observation:** Chat `executeTool` also returns `attachments` (screenshots) and `codeChange`. The spike drops them. `TurnEvent.tool_result` is string `content` only.

**P6-C:** Widen `execute` / `tool_result` with optional `attachments` / `codeChange`, **or** keep painting those in the caller by wrapping execute (caller-owned side channel). Widening the event is an interface change; a caller wrap is not.

### 7. No stream lifecycle events (`start` / `end` / `error` / `abort`)

**Observation:** The caller infers end from the `runTurn` promise. Mid-turn provider errors become `crashed`. Chat today distinguishes timeout vs cancel vs generation-lost-on-restart vs truncated, and `notifyChatStreamEnded` vs `setStreaming(false)` ordering.

**P6-C:** Promise + `crashed`/`timeout` is enough if the caller keeps stream chrome. Adding `TurnEvent` lifecycle types would be an interface change — only do it if P7 coalescing needs a discrete end tick.

---

## Belongs in the runner

Shared mechanics every caller will want. Not board-shaped.

| Gap | Why the runner |
|-----|----------------|
| Context-budget application per completion | Inner loop already calls `applyContextPolicy` via deps. Chat’s work-agent policy should be passed in `limits.contextBudget` (already on `TurnLimits`). |
| Thinking-budget watchdog / continuation | Inner loop already has `ThinkingBudgetTracker`. Chat should pass budget via existing thinking deps, not reimplement in `loop.ts`. |
| Tool batching / parallel reads | Already `runHeadlessToolBatch`. Do not invent a second bus. |
| Constrained / XML / Harmony tool-call parsing | Already inside the inner stream. Chat’s `streamCompletionTurn` duplicates this — P6-C should delete the copy, not extend `TurnEvent`. |
| AbortSignal | Already `options.signal`. Composer Stop should abort that signal (caller wires the controller). |

---

## Belongs in the caller

Product behavior `runTurn` should not learn. P6-C keeps these in chat / composer / mode code.

| Gap | Notes for P6-C |
|-----|----------------|
| **Attachments / image parts** | `buildVlmUserApiContent`, `[image:]` history placeholders, design-ref turn linking. Needs multimodal `seed` or caller-built `messages[]` (ties to finding 1). |
| **Steering mid-turn** | `pendingSteerMessage` cancels the live generation at a tool-loop boundary. Runner has no steer hook. Caller: abort + enqueue a follow-up turn, or a later `onEvent` / signal flavor. |
| **Composer message queue** | `flushPendingMessageQueue` after stream end. Caller, after `runTurn` resolves. |
| **Goal + `/loop` commands** | `goalDriven`, post-turn evaluator, loop ticker. Caller before/after the turn. Spike already excludes `goalDriven`. |
| **Super Plan pipeline ownership** | `superPlanStage`, hidden user rows, deferred queue. Caller. Spike excludes it. |
| **`ask_question`** | List-presence only in the runner (P2-B). Interactive modal + AFK block live in `executeTool`. **P6-B landed:** `AskCapability` on `runTurn({ ask })` — see notes below. |
| **Sub-agent spawn from within a turn** | `spawn_sub_agent` / controller. **Phase 8.** Classify only. |
| **Context-recall tools** | `recall_chat_context` / `recall_turn_full` are catalog tools. They need the **real** chat history (finding 1). Execution stays `executeTool`. |
| **Stream-end ordering** | `notifyChatStreamEnded` then `setStreaming(false)` (known inversion, PRD §1.3). Spike copies `loop.ts` order so measurement is honest. Fix in the caller (or P7) — not `TurnEvent`. |
| **Tool approval / permission modal** | `maybeBlockToolForUserApproval`. Chat `executeTool` already does this if the spike calls it. Ensure P6-C keeps **interactive** execute, not in-process dispatch. |
| **Resume / fork / regenerate** | `resumeGenerationId`, `replaySnapshot`, `forkOverrides`. Spike excludes them. Caller: either stay on `runChatTurn` until generations persist, or teach `runTurn` a resume generation id (**that** would be an interface change — only if HTTP `/api/generations` resume cannot be done inside `postChatCompletions`). |
| **Work-agent prompts, mode tool filter, first-turn injections, titles, synthesis, library model load, UI Designer, impeccable/caveman/partymode skill bodies** | Compose `systemPrompt` + `tools` in the caller (existing `systemPrompt` finding). Spike uses two utility tools and the default report reminder on purpose. |
| **Stats / tok-s strip / usage ledger for main chat** | Inner `onUsage` exists. Caller should record via `recordMainChatTurnUsage`, not the sub-agent usage helper the shared renderer deps still use (attribution leak — swap `recordTurnUsage` in chat deps). |
| **Per-token UI lag** | `onEvent` `delta` is a **cumulative snapshot** (from `onMessagesChange`), not a raw token. Painting it through `scheduleAssistantBubbleRender` is the same full-markdown path chat already uses. Coalescing paints is **Phase 7 (MIN-727)** — do not change `TurnEvent` grain in P6-C to fix lag. |

---

## Suggested P6-C sequence

1. **Interface (must decide before strangle):** findings **1** (history/seed), **2** (optional report tool), **4** (disable sub-agent nudge/finalization). Without these, every chat turn is an isolated one-shot that may call `report_outcome` or spend a finalization completion.
2. **Caller migration, mode by mode:** General simple text → Build/Debug with full tool catalog → Plan (write guard is already in `executeTool`) → attach/steer/queue/goal as overlays around `runTurn`, not inside it.
3. **P6-B** before enabling `ask_question` on this path.
4. **Do not** migrate Super Plan, resume/fork, or sub-agent spawn until 1–4 and Phase 8 are explicit.
5. **P6-D** only after the client loop has no remaining exclusive behavior (or that behavior has a documented owner in the caller).

## How to turn the adapter on (manual)

1. Build/run with `MINNOW_DEBUG=1`.
2. In DevTools: `localStorage.setItem('minnow.p6c.runTurnChat', '1')` (or the legacy `minnow.p6a.runTurnChat`).
3. Send a plain text message (no attachments, not Super Plan, not resume/fork).
4. Expect streaming/thinking/tool rows from `onEvent`. Expect `no_report` as the successful chat end. The model should not see `report_outcome`.
5. Default users: leave the key unset — `runChatTurn` is unchanged.

## P6-B notes (MIN-724) — do not rewrite the P6-A findings above

`AskCapability` is the intended PRD §9 signature change. `runTurn({ ask, askTimeoutMs })`:

- `ask.ask` present → `ask_question` is on the resolved list and routed to the handler (not `executeServerTool`).
- `ask: null` / omitted → tool stripped even if the caller passed it in `tools`. Fabricated call → immediate `Error:` tool result; the turn continues. No wait on `askTimeoutMs`.
- Chat spike injects `createChatAskCapability` (`enqueueAskQuestion`). Board effector passes `ask: null`.
- Default timeout 60 min (`DEFAULT_ASK_TIMEOUT_MS`, same as Watchdog generation idle). Test hook: `askTimeoutMs`.
- Approval queue / destructive confirm: **out of scope** — [`orchestrator-v2-p6b-human-tools.md`](./orchestrator-v2-p6b-human-tools.md).
- Findings 1, 2, 4 (history/seed, optional report tool, nudge/finalization) stay P6-C. Not implemented here.

## Tests

- `test/chat/run-turn-chat-flag.test.mts` — flag default off; simple-shape predicate.
- `test/chat/run-turn-chat-paint.test.mts` — `onEvent` mapping.
- `test/chat/run-turn-chat.test.mts` — flag off does not call `runTurn`; flag on + simple `runChatTurn` **does** invoke `runTurn`.
- `test/runner/run-turn.test.mjs` — chat-shaped `get_datetime` + prose is `no_report`; report tool remains injected (no silent patch).
- `test/runner/run-turn.test.mjs` (P6-B) — capability ask/answer; null strips the tool; fabricated call is an immediate error (hanging `ask` is not called); unanswered ask times out; no `isBoard` in `server/runner/`.
- `test/chat/run-turn-chat-ask.test.mts` — spike injects capability, does not hardcode `ask_question` in the tool list.
