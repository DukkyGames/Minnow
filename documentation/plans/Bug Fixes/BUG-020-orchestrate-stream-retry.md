---
name: BUG-020 — Orchestrator stuck retrying stream JSON EOF
overview: Stop Orchestrate supervisor auto-resume loops when parent SSE/generation streams fail with ReadableStream JSON EOF; harden generation subscribe + SSE parsing; align with BUG-016 shared streaming fixes.
source: documentation/bug-hunt-session-2026-05-24.md (BUG-020)
related:
  - documentation/bug-hunt-session-2026-05-24.md
  - documentation/context.md (Stream persistence, Orchestrate supervisor)
  - documentation/plans/references/backend-owned-generations.md
  - BUG-016 (Plan mode — different JSON parse error on stream close)
  - BUG-002 (benchmark / empty stream)
  - POLISH-022 (orchestrate status visibility)
  - AGENTS.md (llmster browser SSE incompatibility)
todos:
  - id: confirm-repro
    content: Reproduce Orchestrate + board + sub-agents until parent stream fails; capture provider (LM Studio / llmster), model, console/network, generationId
    status: pending
  - id: trace-failure-path
    content: Log whether error originates in subscribeToGeneration, fetch body read, parseSsePayloads, or fetch-chat ReadableStream close
    status: pending
  - id: generation-end-error
    content: Reject streamCompletionTurn when event end status is error; surface errorMessage from server store
    status: pending
  - id: sse-parser-hardening
    content: Buffer partial data lines across blocks; optional strict mode for tool_calls JSON; document silent skip behavior
    status: pending
  - id: supervisor-stream-failure-guard
    content: After parent turn transport failure, suppress R4/R7/R8 inject_resume until user action or cooldown; bump lastTerminalAt semantics
    status: pending
  - id: retry-budget-ux
    content: When task retryCount exhausts, ensure budget_stall / escalate_user — no infinite inject_resume; board + status copy
    status: pending
  - id: unit-tests-generations
    content: Extend test/api/generations.test.mjs — terminal event status error propagates to client handler contract
    status: pending
  - id: unit-tests-supervisor
    content: Supervisor tests — failed parent stream does not schedule inject_resume within N ticks without progress
    status: pending
  - id: coordinate-bug-016
    content: Share SSE framing / parser fix with BUG-016 plan; single PR or sequenced with shared parseSsePayloads changes
    status: pending
  - id: manual-verify
    content: Orchestrate E2E — failure shows once, supervisor stops auto-resume, user can manual Resume or fix provider
    status: pending
  - id: docs-context
    content: Update documentation/context.md supervisor + stream error behavior; mark BUG-020 resolved in bug-hunt doc when shipped
    status: pending
isProject: false
---

# BUG-020 — Orchestrator stuck retrying: stream JSON EOF on close

**Tracker:** [documentation/bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) — BUG-020  
**Severity:** Major  
**Area:** **Orchestrate** mode — parent orchestrator turn streaming + supervisor auto-resume (R4/R7/R8)  
**Status:** Open (plan only — no implementation in this document)

---

## Summary

During active **Orchestrate** sessions (board + sub-agents), the parent orchestrator reply can fail when the generation/SSE stream closes with a **ReadableStreamDefaultController** JSON error (**Unexpected end of JSON input**). The UI shows *Could not complete this reply: …* while the **supervisor watchdog** may keep **injecting resume turns** (`ORCHESTRATE_RESUME_MESSAGE`), so the chat appears **stuck retrying** instead of failing closed with a clear recovery path.

---

## Problem statement

| | |
|---|---|
| **Expected** | Parent turn completes, or fails once with recoverable state; auto-resume stops after a bounded budget; user can retry manually. |
| **Actual** | Stream `close` throws JSON EOF; error banner; supervisor may repeatedly auto-send resume while the same class of stream failure recurs. |
| **Impact** | Orchestration blocked, wasted tokens/API calls, confusing “retry” status (POLISH-022), board may show stalled badge without actionable next step. |

**User-reported error**

```
Could not complete this reply: Failed to execute 'close' on 'ReadableStreamDefaultController': Unexpected end of JSON input
```

**Repro (from bug hunt)**

1. Run **Orchestrate** with board + sub-agents.
2. Let orchestrator run until failure (may involve retries).
3. Observe stuck retry behavior and error banner.

---

## Current state

### Parent chat streaming (backend-owned generations)

| Layer | Role |
|-------|------|
| `POST /api/generations` | Starts upstream pump; persists `chat.currentGenerationId` (main chat) |
| `server/generations/upstream.js` | Buffers raw upstream SSE bytes into `state.chunks` |
| `server/generations/store.js` | Replays chunks to subscribers; terminal `event: end` + `data: { status }` |
| `src/api/generations.ts` | `subscribeToGeneration` — block framing, `parseSsePayloads` per `data:` line |
| `src/tools/loop.ts` | `streamCompletionTurn` — subscribe; **`onEnd` always resolves** (ignores `status: 'error'`) |
| `src/providers/fetch-chat.ts` | Headless shim: synthetic `ReadableStream` over `subscribeToGenerationRaw` |

`parseSsePayloads` (`src/api/chat.ts`) **silently skips** malformed `data:` JSON (no throw). Truncated chunks at stream end can yield **partial tool JSON** or **zero finish_reason** without a client-side terminal error.

### Orchestrate supervisor auto-resume

Supervisor tick (`src/agents/supervisor/loop.ts`, ~5s) runs detectors; high-priority hits map to actions (`src/agents/supervisor/rules.ts`):

| Rule | Trigger (simplified) | Action |
|------|----------------------|--------|
| **R8** | Incomplete board, no active sub-agents, parent not streaming, idle ≥ `stallMs` since `lastTerminalAt` | `inject_resume` → auto `sendMessage()` with resume copy |
| **R4** | Parent stream ended, tool result seen, silence ≥ `parentSilenceAfterToolMs` | `inject_resume` |
| **R7** | Missed orchestrator heartbeat / report window | `inject_resume` |
| **R9** | `retryCount >= maxRetriesPerTask` (default 3) | `budget_stall` or `escalate_user` |

`inject_resume` (`src/agents/supervisor/actions.ts`):

- Increments blocking task `retryCount` on **R8** (not necessarily on R4/R7).
- Skips when `isActiveChatStreaming()` or `resumeInFlight`.
- Does **not** check whether the **last parent turn failed with a transport/parser error**.

When a parent stream **fails**:

1. `runChatTurn` catch sets error bubble + `setStreaming(false)` (`src/tools/loop.ts`).
2. `finally` clears `orchestrateBoard.activeParentTurnId`.
3. Next supervisor tick: `wasStreaming && !streaming` → `recordParentStreamEnded`.
4. If sub-agents are idle and `lastTerminalAt` is old enough → **R8** fires → **new user message** (resume) → new generation → same EOF risk → loop until retries exhausted or user stops.

```mermaid
sequenceDiagram
  participant User
  participant Loop as runChatTurn
  participant Gen as subscribeToGeneration
  participant Sup as supervisor_tick
  participant Send as sendMessage

  User->>Loop: orchestrate turn
  Loop->>Gen: subscribe SSE
  Gen-->>Loop: transport error JSON EOF
  Loop->>User: error bubble
  Loop->>Loop: setStreaming false
  Sup->>Sup: R8 stalled
  Sup->>Send: inject_resume
  Send->>Loop: new turn
  Loop->>Gen: subscribe again
  Gen-->>Loop: EOF again
  Note over Sup,Send: repeats until retryCount cap or user Stop
```

### Related environment notes

- **BUG-016:** Same `ReadableStreamDefaultController` surface, different message (*non-whitespace after JSON at position …*) — likely **shared SSE framing/parser** issue, different truncation shape.
- **AGENTS.md:** Known **llmster** headless daemon **browser** SSE incompatibility; server-side proxy/generations may still be affected depending on upstream chunk boundaries.
- **Main chat** explicitly does **not** auto-retry on stream failure (404 only); Orchestrate **supervisor** is the unintended auto-retry source.

---

## Root cause analysis

### 1. Primary — Stream transport / parse failure (shared with BUG-016)

Probable causes (investigate in order):

1. **Truncated `data:` line** at upstream close (incomplete JSON object) — browser or client reader throws on `close` when internal JSON parser expected more input (Chromium fetch stream behavior vs Minnow’s line splitter).
2. **Block boundary split** — `subscribeToGeneration` splits on `\n\n` then feeds blocks to `parseSsePayloads`; a `data:` payload split across TCP chunks may be parsed **before** the closing brace arrives, then stream ends (`feedSseBlock` / tail buffer handling).
3. **Upstream provider** (LM Studio / llmster) emitting non-standard SSE or closing connection mid-chunk.
4. **`fetch-chat` shim** — `controller.close()` after partial raw replay; sub-agents use this path (`persist: false`); parent main chat uses `subscribeToGeneration` directly — confirm which path Orchestrate parent uses (**main chat → persist:true → generations.ts**).

`streamCompletionTurn` does not treat **empty `fullText` + no tool_calls + abnormal end** as failure today.

### 2. Secondary — Supervisor feedback loop (Orchestrate-specific)

Even with a **deterministic** stream bug, **R4/R7/R8** `inject_resume` retriggers full parent turns without:

- Recording “last parent turn failed: transport”
- Cooldown after repeated identical errors
- Distinguishing **user-stopped** vs **error-stopped** (user-stopped is gated; error-stopped is not)

So the product symptom **“stuck retrying”** is often **supervisor + stream**, not stream alone.

### 3. Tertiary — Ignored generation terminal errors

Server `markError` emits `event: end` with `status: 'error'` and `errorMessage`. Client `subscribeToGeneration` parses this but `streamCompletionTurn` **`onEnd` callback ignores the event** and resolves successfully — mismatch if some failures are reported only via sentinel (less likely for browser-thrown EOF, but required for correct failure semantics).

---

## Proposed fix (phased)

### Phase 0 — Repro and instrumentation (required first)

1. Reproduce with `npm start`, Orchestrate + plan + board kickoff.
2. Note **provider**, **model**, **llmster vs LM Studio GUI**, and whether failure is **parent only** or also sub-agents.
3. DevTools: failed `GET /api/generations/:id/stream` — inspect last raw SSE bytes before disconnect.
4. Server log: generation `status` / `errorMessage` when client fails.
5. Add temporary logging (implementation phase) at:
   - `feedSseBlock` / `parseSsePayloads` (last malformed payload snippet)
   - `streamCompletionTurn` catch (error name + message)
   - `executeSupervisorDecision` for `inject_resume` (rule id + retryCount)

**Deliverable:** Confirm whether EOF is client-side throw vs server `markError`.

### Phase 1 — Fail-closed streaming (shared BUG-016)

1. **`subscribeToGeneration` / `streamCompletionTurn`:** If `onEnd` receives `{ status: 'error', errorMessage }`, **reject** with that message (same as transport error path).
2. **Partial line buffer:** Keep incomplete `data:` lines in a per-subscription buffer; only `JSON.parse` when line is complete (or timeout/end with explicit error).
3. **Optional strict tail:** On stream end, if buffer non-empty and not valid JSON, reject with `Truncated SSE payload` instead of silent skip.
4. **Coordinate with BUG-016** — one parser/framing PR preferred.

### Phase 2 — Break supervisor retry loop (Orchestrate)

1. **Parent turn failure flag** on supervisor chat state, e.g. `lastParentStreamFailureAt` + `lastParentStreamFailureMessage` (set from `runChatTurn` catch when mode is orchestrate).
2. **Gate `inject_resume`:** If failure within last **N minutes** (or same `generationId` epoch) and no new sub-agent terminal progress, return `none` or `budget_stall` instead of auto-send.
3. **R8 retryCount:** Consider incrementing on **any** auto-resume injection (R4/R7/R8) for consistent R9 cap.
4. **UX:** After auto-resume budget, show existing stall badge + toast; do not inject until user clicks **Resume** on board or sends manually.
5. **`recordParentStreamEnded`:** Ensure failed/error parent end does not look like “healthy silence” for R4 — treat error like “needs user” not “resume orchestration”.

### Phase 3 — Resilience and observability

1. **Non-streaming fallback** (narrow): After EOF once per turn, optional single retry without `stream: true` for parent orchestrate turn only (feature-flagged; weigh latency).
2. **Status copy (POLISH-022):** Distinguish “Stream failed” vs “Supervisor resuming…” vs “Retries exhausted”.
3. **Settings:** Document `supervisor.autoResume` — disabling stops inject loop (existing gate).

---

## Acceptance criteria

- [ ] Parent stream JSON EOF (or truncated SSE) shows **one** clear error bubble; `currentGenerationId` cleared appropriately.
- [ ] Supervisor does **not** auto-send resume messages in a tight loop after the same class of stream failure (manual Resume still works).
- [ ] After `maxRetriesPerTask`, user sees **budget stall** or **ask_question** escalation — not infinite turns.
- [ ] Server terminal `status: 'error'` propagates to failed turn (not silent success).
- [ ] Unit tests cover generation end error + supervisor gating (no live LLM required).
- [ ] Manual Orchestrate session: sub-agents can still run; parent failure does not wedge board in “streaming” forever.
- [ ] `npx tsc --noEmit` clean; targeted tests pass (`test/api/generations.test.mjs`, `test/supervisor/**/*.test.mts`).

---

## Files to touch (implementation)

| File | Change |
|------|--------|
| `src/api/generations.ts` | Propagate end `error`; optional partial-line buffer |
| `src/api/chat.ts` | `parseSsePayloads` / shared SSE buffer helper |
| `src/tools/loop.ts` | `streamCompletionTurn` onEnd error; orchestrate failure → supervisor flag |
| `src/agents/supervisor/actions.ts` | Gate `inject_resume` on recent parent stream failure |
| `src/agents/supervisor/state.ts` | New failure timestamps / counters |
| `src/agents/supervisor/rules.ts` | Optional detector tweak for R4 after error |
| `src/agents/supervisor/loop.ts` | Wire failure flag from loop |
| `src/providers/fetch-chat.ts` | Align close/error handling with generations client |
| `server/generations/upstream.js` | Only if repro shows upstream hang without `markError` |
| `test/api/generations.test.mjs` | End event error contract |
| `test/supervisor/*.test.mts` | No resume storm after simulated failure |
| `documentation/context.md` | Stream + supervisor failure semantics |
| `documentation/bug-hunt-session-2026-05-24.md` | Status when fixed |

---

## Testing strategy

| Layer | Action |
|-------|--------|
| **API** | Mock upstream truncated SSE fixture → generation store → client rejects with explicit message |
| **Supervisor** | Pure detector/action tests: after `lastParentStreamFailureAt`, `scanTickDetectors` does not return R8 `inject_resume` until cooldown cleared |
| **Integration** | Orchestrate board test hooks — simulate `setStreaming` false + failure flag; assert no second `sendMessage` from supervisor within M ticks |
| **Manual** | Full Orchestrate board run with LM Studio; verify stop/retry behavior; capture provider in bug-hunt env table |
| **Regression** | Plan mode (BUG-016) — same parser change should reduce both error strings |

---

## Risks and open questions

1. **Shared root with BUG-016** — Fix parser once; validate both Plan long replies and Orchestrate tool-heavy turns.
2. **llmster** — Browser-only issue may remain; document workaround (LM Studio GUI server) if server buffer is intact but browser fetch fails.
3. **Disabling auto-resume** — Users with `supervisor.autoResume: false` may still see stream error but not loop; confirm acceptable.
4. **Board view hidden stream DOM** — `isStreamDomVisible` false in board view; errors must still surface in board header/status (POLISH-022).
5. **False stall after legitimate pause** — Cooldown must not block user-initiated Resume.

### Questions for product / QA

- Should **one** automatic stream retry (non-streaming) be allowed before supervisor gives up?
- After failure, should board mark blocking task `failed`/`blocked` automatically?
- Is auto `inject_resume` ever desired after a **transport** error, or only after true orchestrator idle?

---

## Out of scope

- Rewriting backend-owned generations architecture (see `backend-owned-generations.md`).
- Sub-agent runner tool-loop changes (unless repro shows shim-only failure).
- Benchmark suite fixes (BUG-002/003).
- Full llmster upstream patch (document only unless Minnow-owned).

---

## References

- Bug report: [documentation/bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) — BUG-020
- Architecture: [documentation/context.md](../../context.md) — Stream persistence, Orchestrate supervisor
- Generations design: [documentation/plans/references/backend-owned-generations.md](../references/backend-owned-generations.md)
- Related: BUG-016 (Plan stream JSON on close), POLISH-022 (status visibility), AGENTS.md (llmster streaming note)
- Resume copy: `src/chat/orchestrate/resume-message.ts`
- Supervisor defaults: `src/agents/supervisor/defaults.ts` (`stallMs`, `maxRetriesPerTask`)


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-84](https://linear.app/minnowai/issue/MIN-84/bug-020-orchestrator-stuck-retrying-stream)
