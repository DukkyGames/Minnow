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

**Keep (Phase 8, historical):** `src/agents/controller/` and renderer `src/agents/sub-agent-runner.ts` were kept through P6-D. **P8-G deleted both.** The loop is `server/runner/sub-agent-runner.js`; the renderer seam is `src/agents/renderer-runner-deps.ts`.

**Keep:** `src/api/board-testing.ts` (V2 Settings → Board testing). Satellites `chat-tool-batch.ts`, `turn-continuation.ts`, `tool-wrap-dom.ts`, `stream-chat-dom.ts`, `streaming-state.ts` still have other callers.

P6-D done means no second loop. A copy of `streamCompletionTurn` must not return.

## P6-C status (MIN-725) — 2026-08-31

Interface (must-land, done):

| Finding | Status |
|---------|--------|
| 1 History continuation (`messages[]` / `seedKind: 'continue'`) | **Done.** Board callers that pass only `seed` stay isolated. |
| 2 Optional report tool (`injectReportTool: false` / `reportToolName: null`) | **Done.** Default remains inject-on. No product-shaped branch in `server/runner/`. |
| 3 `TurnResult` has no `completed` | **Done as (a):** chat maps `no_report` → turn complete. No new outcome. |
| 4 Disable nudge + structured-outcome finalization | **Done.** Chat: `nudgeToolUse: false`, `finalizeStructuredOutcome: false`. Board: `finalizeStructuredOutcome: false` plus a `report_outcome` nudge (must not use the sub-agent JSON-only finalization). |
| 5 TranscriptStore suffix | **Done** as a consequence of (1), **P10-C (MIN-768):** continue persist suffixes on every settled snapshot (not once at turn end); `finally` is an idempotent backstop. Isolated persist is unchanged. |
| 6 `execute` attachments | **Done (P10-B / MIN-767).** `TurnEvent.tool_result` carries `attachments` / `codeChange` / `isError`. Emit is `onToolDone`, so parseError and abort fills fire. Live DOM is P10-H (`renderToolResult` full arity). |
| 7 Lifecycle events | **Done (P10-B / MIN-767) as round facts, not start/end/error/abort types.** `round_start` / `round_end` / `phase` / `reasoning_end` / `stream_meta` are what the inner loop already had. Promise + `crashed`/`timeout` still end the turn; Stop/fail presentation is a caller overlay (P10-E). |

Overlays around `runTurn` (not inside the runner):

| Overlay | Status |
|---------|--------|
| Mode `systemPrompt` + tool catalog | **Landed.** `composeSystemPrompt` via `resolveOutboundSystemMessages`; `getEnabledToolDefinitionsForChat`. |
| `AskCapability` | **Landed** (P6-B). Execute still refuses `ask_question`. |
| Steer | **P10-I landed:** `onRoundBoundary` splices `consumePendingSteer` at the next tool-loop boundary (same turn, chip persisted). A completed turn with no boundary still follow-ups via `resumeParentChatWithMessage` (not abort). |
| Composer queue | **Landed.** `flushPendingMessageQueue` after a normal `no_report`. |
| Goal + `/loop` | **Landed after the turn.** `maybeContinueGoalAfterTurn` / `maybeRescheduleLoopsAfterTurn`. Goal-driven turns are eligible. |
| Stream-end order | **Landed:** `setStreaming(false)` before `notifyChatStreamEnded`. |
| Usage | **Landed (P6-C + P10-G).** `recordMainChatTurnUsage` with `source.kind: 'main'`. Chat remaps `deps.recordTurnUsage` off the renderer-deps sub-agent helper. |
| Attachments / VLM `buildApiMessages` | **Re-homed (P6-D).** `src/chat/build-api-messages.ts` + overlay around `runTurn`. |
| First-turn injection notice DOM | **Landed (P10 / `runChatTurn`).** `appendInjectionNoticesForTurn` persists chips; `appendInjectionNoticesDom` paints them before the stream when the chat is visible. Prompt still carries injection text. |
| Titles | **Landed** (`scheduleChatTitleGeneration` on first user send). |
| Usage / stats / ledger | **Landed (P6-C + P10-G).** Per-round `recordMainChatTurnUsage`; live strip from `stream_meta`; `appendStats` at `round_end` and turn end. |

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
- Turn snapshots / fork history / post-turn synthesis — still caller overlays. **Stats strip, truncated, stopped presentation:** P10-G / P10-D / P10-E
- In-turn steer at a tool-loop boundary — **P10-I restored** (`onRoundBoundary` / `consumePendingSteer`; abort-on-enqueue gone)
- User-rules as a **second** system message (this path concatenates into one `systemPrompt`)
- Mid-turn thinking-budget continuation / sampler library merge / work-agent model remap
- Sub-agent **controller** (`src/agents/controller/`) — **deleted (P8-G)**

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

**Observation (P6-A):** Chat `executeTool` also returns `attachments` (screenshots) and `codeChange`. The spike dropped them. `TurnEvent.tool_result` was string `content` only.

**P10-B:** Widen `tool_result` with optional `attachments` / `codeChange` / `isError`. Emit from `onToolDone` so parseError / abort fills are not silent. Neutral fact — the execute outcome already had these. Live paint is P10-H.

### 7. No stream lifecycle events (`start` / `end` / `error` / `abort`)

**Observation (P6-A):** The caller infers end from the `runTurn` promise. Mid-turn provider errors become `crashed`. Chat distinguishes timeout vs cancel vs generation-lost-on-restart vs truncated.

**P10-B:** Added **round facts** (`round_start` / `round_end` / `phase` / `reasoning_end` / `stream_meta`), not start/end/error/abort types. Promise + `crashed`/`timeout` still end the turn. Stop/fail presentation is P10-E (caller overlay). Stream-end order is the caller (`setStreaming(false)` before `notifyChatStreamEnded`).

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
| **Steering mid-turn** | **P10-I landed:** `runTurn({ onRoundBoundary })` splices caller rows at the next tool-loop boundary. Chat implements it with `consumePendingSteer`. Abort + follow-up is gone. |
| **Stats / tok-s strip / usage ledger for main chat** | **P10-G landed.** Inner `onUsage` / `stream_meta` / `round_end` feed the strip. Caller records via `recordMainChatTurnUsage`, not the sub-agent usage helper. |
| **Composer message queue** | `flushPendingMessageQueue` after stream end. Caller, after `runTurn` resolves. |
| **Goal + `/loop` commands** | `goalDriven`, post-turn evaluator, loop ticker. Caller before/after the turn. Spike already excludes `goalDriven`. |
| **Super Plan pipeline ownership** | `superPlanStage`, hidden user rows, deferred queue. Caller. Spike excludes it. |
| **`ask_question`** | List-presence only in the runner (P2-B). Interactive modal + AFK block live in `executeTool`. **P6-B landed:** `AskCapability` on `runTurn({ ask })` — see notes below. |
| **Sub-agent spawn from within a turn** | `spawn_sub_agent`. **Phase 8 done** — journal + effector over `runTurn()`. P10-H/K latch parent tool row; P10-L/M live cards. |
| **Stream-end ordering** | **Landed (P6-C):** `setStreaming(false)` **before** `notifyChatStreamEnded`. |
| **Context-recall tools** | `recall_chat_context` / `recall_turn_full` are catalog tools. They need the **real** chat history (finding 1). Execution stays `executeTool`. |
| **Tool approval / permission modal** | `maybeBlockToolForUserApproval`. Chat `executeTool` already does this if the spike calls it. Ensure P6-C keeps **interactive** execute, not in-process dispatch. |
| **Resume / fork / regenerate** | `resumeGenerationId`, `replaySnapshot`, `forkOverrides`. Spike excludes them. Caller: either stay on `runChatTurn` until generations persist, or teach `runTurn` a resume generation id (**that** would be an interface change — only if HTTP `/api/generations` resume cannot be done inside `postChatCompletions`). |
| **Work-agent prompts, mode tool filter, first-turn injections, titles, synthesis, library model load, UI Designer, impeccable/caveman/partymode skill bodies** | Compose `systemPrompt` + `tools` in the caller (existing `systemPrompt` finding). **Injection-notice DOM landed** in `runChatTurn` (`appendInjectionNoticesForTurn` + `appendInjectionNoticesDom`). |
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

---

## P10-A findings (2026-09-01)

**Issue:** [MIN-766](https://linear.app/minnowai/issue/MIN-766) · parent [MIN-765](https://linear.app/minnowai/issue/MIN-765)  
**HEAD:** `c85c1d9c` on `henri/min-765-phase-10-chat-parity`  
**Method:** static code proof in this worktree. Live Electron was **not** exercised — a worktree must not steal port 9473 from the main checkout. Per-symptom notes below are therefore **static-only**. `src/tools/loop.ts` on `main` remains the behaviour spec (regions 1366–1460, 1940–1985, 2660–2760, 2925–3060, 3060–3210).

**P10-J (2026-09-01):** every row below is kept as the reproduction record. Resolutions landed in P10-B–I / K–M — none of these are leftovers.

Product send is `runChatTurn` → `runTurn()`. `src/api/chat.ts` still wires the old chrome (`ThinkingDurationTracker`, `endReasoningPhase`, `stopped: true`, `recordMainChatTurnUsage`) but `sendMessageWithTools` does not call it (`src/chat/messaging.ts` re-exports it only as `sendMessagePlain`).

### MIN-765 table — confirmed mechanisms

| # | Symptom | Confirmed mechanism | Evidence | Live? |
|---|---------|---------------------|----------|-------|
| 1 | Thinking timer / phase stuck on "Thinking…" | `ThinkingDurationTracker` has **no product-path caller**. `runChatTurn` constructs `ThoughtBubbleController` with only `onThinkingStart` → `streamStatus.setPhase('thinking')`. `endReasoningPhase()` is never called on this path, so `onReasoningEnded` never fires and the phase never returns to `generating`. `setThinkingElapsed` is never called. | `src/chat/run-turn-chat.ts:815–819`; `git grep` `new ThinkingDurationTracker` / `endReasoningPhase(` → definition + tests + legacy `src/api/chat.ts` only. Spec: `main:src/tools/loop.ts` ~1948–1980. | static-only |
| 2 | Thought lumping + row order | One controller for the whole turn; `TurnEvent.thinking` is a **per-round cumulative snapshot that restarts**. `thinkingDeltaFromSnapshot` prefix-diffs; when round 2 does not start with round 1's text it returns the **whole** new snapshot, which `appendReasoningDelta` appends onto the same bubble. Live DOM is one streaming wrap (`appendStreamingAssistantRow` once) plus every tool row appended to the mount (`run-turn-chat-paint.ts:226`), so order is `[one prose bubble][all tools]`. History after persist is `assistant(r1)→tools(r1)→assistant(r2)→…` (`sub-agent-runner.js:989–1034`). | `run-turn-chat.ts:813–861`; `run-turn-chat-paint.ts:84–88, 167–170, 217–226`; `messages.ts:1007–1037`. | static-only |
| 3 | History loss on Stop | **Both (a) and (b), at different Stop timings.** Neither explains a **full wipe** of pre-existing history. See the dedicated section below. | store `:38–42`; `run-turn.js:776–780`; `run-turn-chat.ts:1168–1171, 1247–1265, 1280–1291`. | static-only |
| 4 | Bad tool-arg JSON | `executeToolCallBatch` returns `parseError` **without** calling `execute` (`execute-tool-batch.ts:58–61`). Chat's `runTurn` wrapper emits `tool_result` **only** from inside that `execute` wrapper (`run-turn.js:608–623`). The painter therefore never calls `renderToolResult` and the live row spins. The **inner loop does continue**: `sub-agent-runner.js:1015–1020` still pushes a `role: 'tool'` row with the parse-error text. "Turn stalls" is the live DOM row, not the runner loop. (`chat-tool-batch.ts:107–118` *does* paint parse errors — that path is incomplete-tool resume, not `runChatTurn`.) | `execute-tool-batch.ts:58–61`; `run-turn.js:608–623`; `run-turn-chat-paint.ts:229–236`; `sub-agent-runner.js:1013–1020`. | static-only |
| 5 | Stranded tool wraps | Painter `toolWraps` is a `Map<id, HTMLElement>` filled at `tool_call` (`run-turn-chat-paint.ts:126, 225`). `retarget` rebinds wrap/bubble/cursor/mount and the "Calling…" indicator — **it does not re-resolve `toolWraps`**. Mid-batch `switchChat` rebuilds from `chat.history`. **P10-C** now persists a settled tool round before the turn ends, so a switch *after* that emit has tool cards; a switch during an unsettled stream still has none. `remountStreamDomForChat` is a **no-op while `phase === 'tools'`** (`stream-chat-dom.ts:46`). Results then fill into detached nodes. | `run-turn-chat-paint.ts:243–258`; `stream-chat-dom.ts:36–46`; `sidebar.ts:1416`. | static-only |
| 6 | Metrics | Live `publishLiveStats` defaults `streamMeta: {}` (`run-turn-chat.ts:833–860`). Coalesced paints therefore estimate from prose only; per-round `usage`/`stats` stay inside the runner (`sub-agent-runner.js:973–980`) and never reach the strip until a successful `result.usage` flush (`:1175–1178`). `deps.recordTurnUsage` is stubbed to a no-op (`:1031`). Persist writes API-shaped assistant rows **without** `stats` / `usage` / `thinkingDurationMs`, so `appendStats` (`messages.ts:574–576, 1100–1138`) draws nothing after any `renderChatFromHistory`. | `run-turn-chat.ts:833–860, 1031, 1154–1178`; `messages.ts:487–488, 574–576`. | static-only |
| 7 | Scroll jump | Live DOM and `chat.history` disagree (one streaming row vs per-round history). `renderChatFromHistory` captures a scroll anchor then restores it after a full rebuild (`messages.ts:276, 586`) — height change vs live DOM is the jump. **Code workspace does not subscribe to stream-end for a transcript rebuild.** The cited `chat-app.ts:344` rebuild is the (redirected) Chat app only. On Code, the jump is deferred until the next `renderChatFromHistory` (chat switch, overlay dismiss, etc.). | `chat-app.ts:344–351`; `run-turn-chat.ts:259–262`; `subscribeChatStreamEnd` callers listed below. | static-only |

`subscribeChatStreamEnd` product callers: `chat-app.ts`, `orchestrate-plan-screen.ts`, `email-assistant-panel.ts`, `agent-activity-panel.ts`, `super-plan/controller.ts`, `sub-agent-completion-push.ts`. None of these is the Code `#chatArea` transcript.

### History loss — (a) vs (b) vs third

**Decisive lines**

```38:42:src/agents/session-transcript-store.ts
    append(chatId, message) {
      const chat = findChatById(chatId);
      if (!chat) return;
      chat.history.push(message as (typeof chat.history)[number]);
    },
```

No `touchChat`. Continue turns persist on every settled `onMessagesChange` (P10-C / MIN-768); `finally` is an idempotent backstop. Unsettled stream clones are not appended:

```795:808:server/runner/run-turn.js
      onMessagesChange: (messages, meta) => {
        if (!isContinueTurn) {
          persistNewMessages(transcript, chatId, messages);
        } else if (meta?.settled === true && Array.isArray(messages)) {
          persistNewMessages(transcript, chatId, messages, { from: persistCursor });
          persistCursor = messages.length;
          lastSnapshot = messages;
        }
```

`persistNewMessages` (`run-turn.js`) is that `append` in a loop. Mid-stream throttled snapshots still carry a **synthetic extra assistant** on the clone (`sub-agent-runner.js` `emitProgress(streamingAssistant)`); those are `settled: false` and must not land in the store (P10-E owns a `stopped`/`failed` row).

Stop does **not** take `runChatTurn`'s `catch`. `runTurn` maps abort to a **returned** outcome:

```772:773:server/runner/run-turn.js
    if (options.signal?.aborted && isAbortError(err)) {
      return withUsage({ outcome: 'crashed', error: 'aborted' });
```

Then the post-`await` success path **does** run:

```1168:1171:src/chat/run-turn-chat.ts
    chat.currentGenerationId = undefined;
    recordAssistantReplyOnChat(chat);
    recordChatMessage(chat);
    scheduleSaveSessions();
```

`recordChatMessage` (`sessions.ts:1797–1803`) is the only `touchChat` on that path. The `catch` (`:1247–1265`) never calls it. `finally` records the run as `failed`, not `stopped` (`:1280–1291`), because `completedNormally` is only `no_report` \| `pass`.

`resolveFailedTurnPartialRow` (`server/runner/turn-continuation.js:50–59`) has **zero product callers** (tests + export only). `stopped: true` exists only in legacy `src/api/chat.ts:906`. Spec: `main:src/tools/loop.ts` ~3066–3120 (AbortError → `stopped: true` row + `touchChat` + `recordChatMessage`).

| Stop timing | What is in `chat.history` | PATCH / dirty | Mechanism |
|-------------|---------------------------|---------------|-----------|
| During thinking / before first `emitProgress` delta | User row only (pushed with `recordChatMessage` at `:633–635`). `persistNewMessages` no-ops when `lastSnapshot.length <= persistFrom`. No assistant row. | User row already dirty from send. Assistant never existed. | **(b)** |
| Mid-prose | **P10-C:** unsettled clone is not persisted. Store holds the settled prefix (often user row only). No `stopped`/`thinking[]` assistant. Then `:1170` `recordChatMessage` marks dirty if unwind completes. | Chat **is** in the delta **if** unwind completes and something new was already persisted. Kill between persist and `:1170` drops the dirty bit (a). | **(b)** for missing `stopped:true` / thoughts; **(a)** if the process dies after persist with no `touchChat` |
| After a settled tool round (`messages.push` of assistant+tools) | **P10-C:** API-shaped suffix is in memory via incremental persist before the turn ends. Same paper-over at `:1170`. | Same as mid-prose. | **(a)** is the invariant violation on every persist; **(b)** still: no `stopped`/`failed` decoration |
| Setup throw before `runTurn` (model load, etc.) | User row only. `catch` skips `recordChatMessage`. | User row from send. | **(b)** |

**(a) is confirmed as a standing violation** — every continue persist writes history without `touchChat`. The Stop-that-returns path papers over it *after* persist. P10-D must still own (a): the decorating store has to `touchChat` on every `append` (and `onGenerationId` at `:1042–1044` currently `scheduleSaveSessions()` without `touchChat` too).

**(b) is confirmed** — there is no stopped/failed partial writer on the product path. P10-E must own (b). Do **not** skip P10-E because `:1170` runs on abort-return; that call saves whatever persist already wrote (often nothing, never a `stopped: true` row).

**Third mechanism for a full wipe of pre-existing history: not found.** `ensureChatHistoryLoaded` is a no-op when `historyLoaded !== false` (`sessions.ts:767`). Switching away mid-turn rebuilds from in-memory history (user row + any already-persisted suffix); it does not refetch. A *felt* empty transcript is (b) plus `removeOrphanStreamingRow` (`run-turn-chat.ts:1192–1193`) dropping the live shell when persist wrote no assistant prose, or a rebuild that cannot draw `thinking[]` / `stats` from wire `reasoning` / `reasoning_content` fields.

### MIN-765 "also gone, not yet reported"

| Item | Classification at P10-A | Resolution |
|------|-------------------------|------------|
| `noteRunOutputIndex` / `noteRunGeneration` | confirmed-from-code — zero callers outside `runs-store.ts` | **P10-D.** Decorating store calls `noteRunOutputIndex` on every append; `onGenerationId` calls `noteRunGeneration`. |
| `syncTurnContextUsage` | confirmed-from-code | **P10-I restored** — coalesced paint + `tool_call`. |
| `setContextInFlightOverlay` | confirmed-from-code | **P10-I restored** — cleared in `runChatTurn` `finally`. |
| `applyClassifiedStreamEnd` / `resolveFinalAssistantContent` | confirmed-from-code (chat effect; runner discarded the return) | **P10-D.** Decorating store applies both on persist. |
| `consumePendingSteer` | confirmed-from-code | **P10-I restored** — `createChatRoundBoundary`. |
| Inner-loop control rows persisted as visible user bubbles | confirmed-from-code | **P10-D.** Decorating store drops nudge / empty-post-tool / prose-question retries. |
| Wire reasoning fields persisted instead of `thinking: string[]` | confirmed-from-code | **P10-D.** Strip wire fields; write `thinking[]` / duration / signature. |
| `buildOpeningTranscript` duplicate user row | confirmed-from-code (`seed: userText` vs `historyContent`) | **P10-D.** Chat passes `seed: historyContent`. |
| `recordMainChatTurnUsage` bypassed | confirmed-from-code (`deps.recordTurnUsage` no-op) | **P10-G.** Remapped to `recordMainChatTurnUsage`; per-round ledger + strip. |
| `attachMessageActions` / `attachVoicePlayButton` / `attachShellKillUi` / `notifyMemorySavedFromTool` never on **live** rows | confirmed-from-code | **P10-F / P10-H.** Turn-end attaches actions/voice; painter reuses `chat-tool-batch` helpers for shell-kill / memory toast. |
| Tool `attachments` / `codeChange` dropped on live events | confirmed-from-code (`tool_result` was `content` only) | **P10-B / P10-H.** Widened `tool_result`; full-arity `renderToolResult`. |

### P10-D / P10-E handoff — **landed**

- **P10-D** treated (a) as confirmed and shipped `createChatTranscriptStore`: every `append` into `chat.history` calls `touchChat` via `recordChatMessage`.
- **P10-E** treated (b) as confirmed and shipped `settleStoppedTurn` / `settleFailedTurn`: handles the **returned** `{ outcome: 'crashed', error: 'aborted' }` path, a thrown `AbortError`, and provider failures. User Stop records run status `stopped`.
- Both were required. No third full-wipe mechanism was found.

### Todos (P10-A)

- [x] Reproduce each MIN-765 table symptom at the code (file:line) level
- [x] Identify history-loss as (a) and (b) by Stop timing; no third full-wipe
- [x] Classify MIN-765 "also gone" as confirmed-from-code or not-found
- [x] Record live-vs-static: all static-only (worktree must not bind 9473)
- [x] Leave `src/` / `server/` / `test/` clean (no leftover instrumentation)

