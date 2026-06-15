# Minnow Goal-Driven Orchestration — Implementation Plan

## Goal

Make Minnow build software autonomously: describe a feature or app → the system plans it,
self-reviews the plan, builds it feature-by-feature, tests each feature (including in a real
browser), has another agent review it, and marks a task done **only when verification passes** —
looping until the whole thing is built and visible on the Kanban board, with minimal user input.

There is exactly **one human approval gate**: after the plan is drafted and self-reviewed, and
before auto-pilot executes it. Everything after that runs autonomously until complete or blocked.

## Core principle (non-negotiable)

**Externalize the control loop. Code owns continuation and termination; the model never does.** The
model performs bounded, single-shot steps; code decides whether to continue, stop, retry, or
escalate. **Completion is defined by passing verification, not by the model saying it is done.**

This mirrors the working pattern already in `server/research/engine.js`: a deterministic
`for (round…)` loop with a `minRounds` floor, a `maxRounds` cap, a time budget, and a code-gated stop
check. The model only does small bounded steps inside it.

## The problem being fixed

Today, continuation/termination lives in the model. A chat turn ends when the model emits prose
(`src/tools/loop.ts`), guarded only by thin safety nets in `src/tools/turn-continuation.ts`
(`resolveTurnContinuation` — one empty-retry, one prose-question retry — plus a `maxToolTurns` cap
from `src/config/chat-meta.ts`). On long multi-step work, small models (and large ones on hard tasks)
stop early or treat one tool call as completion, so the work never finishes.

---

## Architecture: where the loop runs

**The control loop runs in the Node server tier (`server/`), not the renderer and not the
`electron/` main module.**

Why the server tier:
- It already runs the proven `engine.js` loop, executes tools at `/api/tools` (files/git/code/
  `execute_command` via a PTY), drives LLM providers, and hosts PTY/STT/TTS WebSockets. It is started
  by `startInProcessServer()` (`electron/server-host.ts`) on a localhost port and runs **in-process
  to the Electron main process** in packaged builds — so it is **not subject to renderer timer
  throttling** when the window backgrounds or the machine sleeps (the requirement that motivated
  moving off the renderer).
- It already has a renderer transport (HTTP + WebSocket on localhost). We add a few endpoints rather
  than ~40 new Electron IPC channels.
- The autonomous executor's minimal toolset (read / write / edit / run-command / preview) is already
  server-side or main-side — builds need no renderer round-trips.

Today the loop is in the renderer and tightly coupled to it (`src/tools/loop.ts`,
`src/tools/client.ts`, `src/api/chat.ts` — the model stream is even read in the renderer via
`res.body.getReader()`). We do **not** rewrite all of that. Instead:

- **Renderer becomes an observer/controller client.** It subscribes to engine/board state over a new
  SSE stream and renders it read-only. It answers the one plan-approval gate and any tier-2 recovery
  prompts via an approval round-trip. The existing manual board and manual task chats keep working
  unchanged.
- **Migration is strangler-fig.** Stand up the server engine + transport and run *new* autonomous
  runs there, while the existing renderer board keeps working. Nothing is removed from the renderer
  until the server path proves out.

> **Open decision (resolve before Phase 2):** server tier (recommended, above) vs the `electron/`
> main module. The `electron/` route needs the large IPC rewrite and gains nothing over the server
> tier for throttle-survival.
>
> **Forward risk:** the server runs in-process to Electron main, so several concurrent long loops +
> JSON writes could contend on main's event loop. This is measured in Phases 3–4; if it bites, the
> Phase 6 out-of-process worker becomes required, not optional.

---

## Existing code to build on (and what is net-new)

**Reuse — already exists:**
- **Iteration pattern:** `server/research/engine.js` (round loop with `minRounds`/`maxRounds`/
  `maxTime`/`shouldStop`). Generalize this into the Goal Loop Engine.
- **Repetition detection:** `src/agents/self-healing/detector.ts` → `detectRepetition(log,
  thresholds)` is a pure function (currently unused; `src/agents/self-healing/controller.ts` is a
  no-op stub). Today it keys on tool-call argument fingerprints; we re-key it on the verify-report
  fingerprint.
- **Sub-agent scheduling/lifecycle:** `src/agents/orchestrator.ts` — `spawnSubAgent`,
  `cancelSubAgent`, `waitForSubAgent`, `recordToolCallForRun`, `getSubAgentRun`,
  `listActiveSubAgentRuns`, `resetSubAgentOrchestrator`; concurrency via `globalQueue`,
  `activeByType`, `acquireConcurrencySlot`/`releaseConcurrencySlot`, `canStart`, `drainQueue`;
  execution via `executeRun` → `getSubAgentRunner().run()` (with `onMessagesChange`); board sync via
  `syncBoardTaskOnSettle`. Per-type model config in `src/agents/sub-agent-config.ts` (each sub-agent
  type carries its own `providerId`/`modelId`); registry `src/agents/defaults/sub-agents.json`.
- **Board state:** `src/state/orchestrate-board-store.ts` → `updateTask(group, taskId, patch,
  plannerChat?)`, `recomputeWaveRollup(board)`, `rollupWaveStatus`. Plain functions over the mutable
  `OrchestrateBoardState` held on `ChatGroup.orchestrateBoard` and persisted in the sessions JSON
  (no framework). `src/state/orchestrate-board-actions.ts` → `startTask`, `startWave` (queue is the
  private `taskQueueByGroupId` with `enqueueTask`/`drainTaskQueue`); stream-end signal
  `subscribeChatStreamEnd` from `src/chat/streaming-state.ts`.
- **Types:** `src/types.ts` → `BoardTaskStatus` = `planned | in_progress | testing | complete |
  failed | blocked`; `BoardCategory` = `build | fix | test | research`; `BoardTask` already has
  `buildSpec`, `testSpec`, `assignedRunId`, `lastRunId`, `runHistory`, `chatId`.
- **Tools:** `src/tools/definitions.ts` → `ToolDefinition` (with `serverRequired`, `previewRequired`,
  `requiresKey`) and `BUILT_IN_TOOLS`; routing in `src/tools/client.ts` (`executeTool`); approval
  gate `maybeBlockToolForUserApproval` in `src/tools/permission-gate.ts`.
- **Storage:** `server/config/store.js` — JSON files in `~/.minnow/` via atomic temp-file+rename
  behind a Promise single-writer queue. Reuse this pattern for run records.
- **Preview (single visible view, capture already works):** `electron/preview-host.ts`
  (`hostsByWindowId`, `getOrCreateHost`, `registerPreviewHostIpc`, a `WebContentsView`);
  `electron/preview-guest-actions.ts` → `previewNavigateAwait`, `previewCapturePageBase64`,
  `previewExecJs`, `previewGetGuestInfo`; channels in `electron/ipc-channels.ts`; bridge in
  `electron/preload.ts` (`window.minnow.preview`).
- **Command execution:** `/api/tools` for files/git/code; PTY via `server/terminal/pty-ws.js`
  (`attachPtyWebSocketServer`). Resume-to-parent via `resumeParentChatWithMessage`
  (`sub-agent-completion-push.ts`).

**Net-new — must be added:**
- `BoardTask`: `deps?: string[]` (dependency-DAG edges) and `successCriteria?: string`.
- `BoardTask`: `testCommands?: string[]` (the runnable machine gate — see locking rule below).
- `OrchestrateBoardState`: `executionMode?: 'manual' | 'auto'` (default `'manual'`; nothing branches
  on a mode today, so this is zero-UX-change until auto-pilot is switched on).
- `ToolDefinition`: `isReadOnly`, `isDestructive`, `isConcurrencySafe`, with a resolver that **fails
  closed** (unflagged/unknown tool → destructive + concurrency-unsafe). These flags mechanically
  drive recovery tier, whether a task needs an isolated worktree, and permission gating.
- Run-record JSON store under `~/.minnow/runs/<id>.json`.
- The Goal Loop Engine, the Controller (supervision), git-worktree isolation, the verify/review
  agents, the SSE state channel + approval round-trip, and (later) the headless preview pool.

**Plan-time locking rule (critical):** the **builder must never author its own pass condition.** Two
fields are locked when the plan is drafted/reviewed (Phase 5):
- `successCriteria` — human/reviewer-facing intent; the anchor the reviewer agent judges against. Not
  machine-executed.
- `testCommands` — the **machine gate**: concrete commands the verifier runs, each with an expected
  outcome. (The existing freeform `testSpec` string stays for display/seed but is not the gate, since
  a prose string is not machine-verifiable on its own.)

---

## The Goal Loop Engine

One reusable engine powers every loop (`server/goal-loop/{engine,types}`), generalizing
`engine.js`:

```
runGoalLoop({
  goal,        // { description, successCriteria, budgets }
  state,       // accumulates across rounds
  step,        // async (state, round, signal) => state'  — ONE bounded agent/LLM action
  verify,      // async (state, signal) => { passed, report, signals[] } — machine check
  decideStop,  // async (state, round) => boolean — code gate (+ optional bounded LLM yes/no)
  budgets,     // { minRounds, maxRounds, maxTimeMs, maxNoProgressRounds, maxCost, maxConsecutiveFailures }
  compact,     // async (state) => state' — first-class compaction when over token budget
  onProgress,  // emits to the board + SSE
}) => { status: 'completed' | 'exhausted' | 'failed' | 'cancelled', state }
```

Loop body each tick:
1. `for round in 1..maxRounds` — check cancel, abort signal, time budget, cost budget, and token
   overflow → `compact`.
2. `state = await step(state, round, signal)`.
3. `v = await verify(state, signal)`.
4. if `round >= minRounds && v.passed && await decideStop(...)` → break (success).
5. no-progress guard: fingerprint `v.report`; if the same failure signature repeats
   `maxNoProgressRounds` times → break (exhausted). (Fingerprint the **report**, not tool calls — a
   build legitimately calls `edit` many times.)
6. otherwise feed the compacted `v.report` into `state` and loop — the failing output becomes the
   next round's input.

`step` and `verify` receive an `AbortSignal` so a hung action can be killed (see PTY-kill in Phase 2).

---

## The three loops (target shape)

- **Plan-Review (planning; the one human gate).** A Planner drafts a plan file; diverse reviewer
  sub-agents critique it; code aggregates scores and the Planner revises; a human approves once; then
  the board is initialized and handed to orchestration.
- **Orchestration (code-driven scheduler).** The dependency DAG is the single source of truth for
  ordering. Code computes the ready set (tasks whose deps are all complete) and dispatches up to the
  concurrency limit. The orchestrator LLM is consulted only for decisions (a blocked task, a finished
  wave).
- **Build → Verify → Review (per feature; the real fix).** For each task: a bounded build step
  (architect decides the change, editor emits whole-file edits), then machine verification (run
  `testCommands` + browser screenshots/console/network), then a reviewer agent, then a code decision:
  `verify.passed && reviewer.approve` → merge → done; else feed failures back and loop, bounded by
  budgets.

---

## Phases (build inside-out; each is independently useful on today's board)

### Phase 0 — Cleanup & rename (no behavior change) — first build target
- Extract `src/agents/orchestrator.ts` into `src/agents/controller/{controller,scheduler,registry}.ts`
  (controller = dispatch/lifecycle + `executeRun`/`syncBoardTaskOnSettle`; scheduler = `globalQueue`/
  `activeByType`/`acquire|releaseConcurrencySlot`/`canStart`/`drainQueue`; registry = the run map +
  accessors). Keep `orchestrator.ts` as a thin re-export shim so all callers keep working.
- Move the no-op `src/agents/self-healing/controller.ts` to `src/agents/controller/watchdog.ts` (still
  no-op; real logic in Phase 3). Keep `detector.ts`. Clean the stale `report_orchestrator_status`
  mention in `documentation/context.md`.
- **Done when:** existing sub-agent/orchestrator tests pass unchanged; typecheck + build clean.

### Phase 1 — Goal Loop Engine (pure, server-tier)
- Implement `server/goal-loop/{engine,types}` per the signature above. Port `detectRepetition` to key
  on the verify-report fingerprint. Implement the fail-closed tool-flag resolver.
- **Tests (unit, with injected `step`/`verify`/`decideStop`/`compact`):** `minRounds` floor;
  `maxRounds` cap; time and cost budgets; no-progress break on a repeated report fingerprint;
  stop-gate; compaction trigger; tool-flag → recovery-tier/isolation resolution including the
  fail-closed default.

### Phase 2 — Build → Verify → Review, ONE task at a time (the "stops early" fix)
Runs a single task end-to-end, server-side, in its own git worktree, verifying against the **existing
single visible preview** (whose capture path already works). No parallelism and no new preview infra
here — that keeps the riskiest work out of the core fix. This phase also stands up the minimal
server-side substrate.

- **Server-side bounded build step:** port the single build turn to run server-side via `/api/tools`
  + provider calls (mirroring `engine.js`). Use the architect/editor split: a stronger/cloud model
  decides the change; an editor (may be local) emits **whole-file edits** (more reliable for local
  models). The executor is exposed only the **minimal toolset** (read/write/edit/run-command/preview).
- **Substrate:** `GET /api/orchestrate/events` (SSE) for read-only state in the renderer; an
  **approval round-trip** (server emits a pending-approval event; renderer reuses the existing
  approval UI and POSTs the decision); a **minimal server↔main bridge to the existing visible
  preview**, reusing `previewNavigateAwait`/`previewCapturePageBase64`/`previewExecJs`.
- **Per-step deadline + PTY-kill:** the engine's `maxTimeMs` is checked *between* steps, so a step
  hung inside a PTY `execute_command` would otherwise run until that command's own timeout. Add a
  **per-step deadline** that, on expiry or abort, calls `.kill()` (SIGTERM → SIGKILL) on the PTY
  child — an `AbortSignal` alone does not terminate a spawned child. Wire abort → kill in the
  server-side command runner (extend `server/terminal/`) and verify the child actually dies and
  releases the worktree.
- **Worktree per task:** `git worktree add` on a per-task branch (new `server/worktrees/` helper) for
  atomic build/rollback. Auto-clean if no diff; persist + keep the diff if changed.
- **verify (always-full):** run `testCommands` (typecheck/build/tests) via `execute_command`; capture
  browser screenshots + console/network via the visible preview; produce a structured `VerifyReport`.
  Non-previewable tasks fall back to tests + reviewer with a logged note.
- **review:** spawn a `featureReviewer` via `spawnSubAgent` (read-only; the existing slot machinery),
  on a **cloud or biggest-local model** (never the small local executor). It gets the diff +
  `VerifyReport` + screenshots and returns `approve`/`revise` with notes. Use a **score threshold**,
  bounded revise rounds, never unanimity. **Per-role model selection lands here** by reusing the
  per-sub-agent-type `providerId`/`modelId` in `src/agents/sub-agent-config.ts`.
- **Decide → merge → integration gate:** on `verify.passed && reviewer.approve`, merge the worktree
  branch into the base, then **re-run a code-driven integration verify on the base** (typecheck/build/
  tests + a previewable smoke check) — because a feature that passed in isolation can break the
  combined tree. **Merge ownership is code, not human:** a merge conflict or a post-merge integration
  failure becomes a new failing state fed back into the loop (resolve/rebase/fix), bounded by budgets.
  Exhaustion → task `blocked` with accumulated context.
- **Self-contained guards** (no Phase-3 watchdog yet): no-progress break + hard `maxTimeMs` + cost cap
  + the per-step deadline above, so it cannot run away.
- **Board status** via `updateTask`: `in_progress` (build) → `testing` (verify+review) →
  `complete` | `blocked`.
- **Tests (integration, mocked runner via streaming hooks):** never-passes → bounded retries →
  `blocked`; passes round 2 → `complete`; reviewer rejects then approves; post-merge integration
  failure → task re-enters the loop (not silently passed); per-step deadline → PTY child killed and
  worktree freed.

### Phase 3 — Controller supervision (server tier)
Makes each dispatched unit observable and recoverable.
- **Registry:** a `RunRecord` state machine (`queued → dispatching → running → suspect → recovering →
  completed | done_unacked | failed | cancelled | interrupted`).
- **Heartbeat (in memory):** ~7s tick plus progress-aware bumps from `recordToolCallForRun`,
  `onMessagesChange`, and streaming events; a monotonic `progressSeq`. **Not persisted** — heartbeats
  are never read by reconciliation, and per-tick writes would churn the single-writer queue.
- **Watchdog (~5s tick):** heartbeat fresh + progress fresh → running; fresh + progress stale → use
  `detectRepetition` → suspect; heartbeat stale → check for a committed result (present →
  `done_unacked → completed`; absent → suspect → fail/recover). On suspect/deadline, fire the engine
  `AbortSignal` (→ the PTY kill from Phase 2).
- **Tiered recovery, driven by tool flags:** tier-1 = auto-retry on a fresh context, allowed only when
  every step is read-only/idempotent; tier-2 = surface to human for any run that touched a destructive
  tool (avoids duplicate writes). Fail closed.
- **Persistence + reconciliation:** persist **only state transitions + a write-ahead result commit
  keyed `(boardTaskId, attempt)`** to `~/.minnow/runs/`. On startup, a non-terminal record with a
  committed result → finalize `completed`; otherwise `interrupted` + tier policy. Derive board
  sub-status from the `RunRecord` (single writer, no divergence).
- **Tests:** state transitions; reconciliation (committed-result present vs absent); abort propagation
  → child death; destructive failure → tier-2 surface with no duplicate write.

### Phase 4 — Orchestration + parallelism + auto-pilot
- **Dependency-aware scheduler tick:** ready set = `planned` tasks whose `deps[]` are all `complete`;
  dispatch up to the concurrency limit, each task a Phase-2 loop **in its own concurrent worktree**.
  The DAG governs ordering; waves are a UI rollup via `recomputeWaveRollup`.
- **Headless preview pool (the one genuinely risky piece), gated by a spike:** generalize
  `electron/preview-host.ts` from `hostsByWindowId` to an instance-id-keyed set of **offscreen**
  `WebContentsView`s plus a server↔main bridge, each navigated to a worktree's own dev-server port.
  **Run the spike first:** if offscreen `capturePage` is unreliable on the target OS, **fall back to
  serial previewable verify on the visible view** — still correct, just no parallel-throughput win.
  The "stops early" fix never depends on this.
- **Built-app runtime isolation:** parallel previewable verify needs more than separate ports. If
  Minnow builds **full-stack** apps, each worktree's app needs an isolated runtime DB / data dir /
  migrations, not just a port. (See open decision below.)
- **Serialized merges + integration gate at scale:** merges take a lock and run one at a time; each
  re-runs the integration verify; a conflict or post-merge break becomes a failing state back in that
  task's loop — no human in auto mode.
- **Auto-pilot:** add the `executionMode: 'auto'` toggle + board badge; an `orchestrate-auto` prompt
  + a `delegate_tasks` capability; the orchestrator LLM consulted on decisions only via
  `resumeParentChatWithMessage`.
- **Safety before enabling `auto`:** model-generated shell must run cwd-jailed or against an
  allowlist, and project files (AGENTS.md / CLAUDE.md / .cursorrules / plan files) must be scanned for
  prompt-injection before their content is loaded into context.
- **Tests:** DAG ready-set ordering; concurrency cap; two parallel worktrees editing the same file →
  both build and the serialized merge + integration gate catch the conflict as a failing state (no
  clobber, no human); offscreen spike pass/fail → correct path chosen; blocked-task escalation.

### Phase 5 — Plan-Review + the one human gate
- A Planner drafts `documentation/plans/<slug>.md`: waves; tasks with `id/title/category/build/test`,
  explicit `deps[]`, and **locked `successCriteria` + runnable `testCommands`**. Later rounds spawn N
  **diverse** `planReviewer` sub-agents with different rubrics (one checks the dependency DAG, one
  testability, one scope/feasibility — not N copies of one model). Code aggregates verdicts to a score
  ≥ threshold; the Planner revises. **verify:** structural validation (well-formed tasks, deps form a
  DAG, file parses) + reviewer score. **Human gate:** present a plain-English per-task summary of what
  will be built → on approval, `board_init` populates the board and sets `executionMode: 'auto'`, then
  hands off to Phase 4.
- **Tests:** malformed or cyclic-dependency plans rejected; reviewer score gating; approval →
  `board_init` populates tasks/deps/successCriteria/testCommands.

### Phase 6 — Hardening / out-of-process worker (conditional)
- Provider/model-routing polish: a thin transport-adapter layer that normalizes tool-call formats and
  provider quirks (LM Studio / OpenAI-compatible / Anthropic) so the loop sees one model surface;
  route by role (orchestrator/reviewers → cloud or biggest local; executors → local).
- A forked **out-of-process worker** for true cross-reload live-agent survival and to remove
  main-event-loop contention. **Promoted from optional to required if** the Phase 3–4 measurements
  show contention under concurrent runs.

---

## Verification plan

- **Unit:** engine budgets and breakers (Phase 1 list); tool-flag → tier/isolation including
  fail-closed; Controller state transitions; reconciliation; abort → PTY-child death.
- **Integration (mock runner/chat via streaming hooks):** never-passes → `blocked`; passes round 2 →
  `complete`; reviewer reject → approve; post-merge integration failure → re-enters the loop; per-step
  deadline → PTY child killed + worktree freed; destructive-tool failure → tier-2 (no duplicate
  write); committed result then dropped delivery → reconciles to `completed`; two parallel worktrees
  on one file → serialized merge + integration gate surfaces the conflict as a failing state.
- **Spike (Phase 4):** offscreen `WebContentsView.capturePage` reliability on the target OS; the pool
  is gated on it, else serial-on-visible-view.
- **End-to-end (`lm-studio-local` executor + a cloud reviewer):** one-line description → plan-review →
  approve → auto-pilot builds a 2–3 task app → each feature passes `testCommands` + browser
  screenshots + review → merges pass the integration gate → all `complete`; open a running task chat
  and steer it mid-run; stop a task → watchdog aborts, kills the PTY child, and recovers per tier;
  reload the renderer mid-run → reconciliation marks tasks correctly.
- **After every phase:** typecheck + build + the test suite, plus a manual-board smoke test to confirm
  zero regression on the existing manual flow.

---

## Open decisions to resolve

1. **Loop home:** Node server tier (recommended) vs `electron/` main module. Affects all of Phase 2+.
2. **Build targets:** does Minnow build frontend-previewable apps only (port isolation suffices) or
   full-stack apps (each worktree's app needs isolated DB/data dir in Phase 4)?

## Standing constraints (do not violate)

- Code + verification decide done — never the model.
- Never run parallel builds in a shared working tree; never share one preview/dev-server/app-DB across
  parallel tasks.
- The builder never writes its own pass condition; the reviewer never runs on a small local model and
  can only block, never falsely-pass (`verify.passed && reviewer.approve`).
- Keep the executor's prompt and toolset minimal (local tool-calling reliability).
- Use a reviewer **score threshold**, never unanimity (avoids deadlock on correlated local-model
  nitpicks).
- Map recovery tier by per-tool `isDestructive`, fail closed — never by agent category.
- Do not enable `executionMode: 'auto'` until shell is sandboxed/allowlisted and project files are
  injection-scanned.