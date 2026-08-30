---
name: orchestrator-v2-implementation
overview: Implementation plan for Orchestrator V2 — a clean-room, server-side, journal-and-reconcile board engine that replaces the V1 renderer orchestrator. Ten phases from a pure decision core through V1 deletion, normal chat and sub-agents adopting the same runner, coalesced stream paint so the UI stays live mid-generation, and the Boards surface finished to parity with what V1's Orchestrate did.
isProject: true
---

# Orchestrator V2 — Implementation Plan

**Date:** 2026-08-28
**Goal:** Replace the V1 board engine with a server-side journal + reconcile engine whose state is a pure fold, so multi-agent runs are as reliable as today's sequential single-agent path.
**PRD:** [`orchestrator-v2.md`](./orchestrator-v2.md) — read it first. This document plans the build; it does not restate the design.
**Linear:** [Orchestrator V2](https://linear.app/minnowai/project/orchestrator-v2-97ced8c22ad8) (team Minnow AI) — 8 phase parents, `MIN-677`–`MIN-683` plus `MIN-727`, with sub-issues `MIN-684`–`MIN-726` and `MIN-728`–`MIN-731`. Each sub-issue carries its own full plan. Phase 9 is filed as `MIN-741` with sub-issues `MIN-742`–`MIN-750`. Phase 8 is planned below but **not yet filed** — its ids are proposals.

## Context

V1 works in exactly one configuration — a single agent at concurrency 1 — because that is the one path with no concurrency in it. The PRD settles the root cause (no state machine; a mutable struct plus event listeners) and locks eight decisions. This plan turns those decisions into ordered, testable work.

## Decisions resolved during this planning pass

The PRD left four questions open (§13) and this pass raised four more. All eight are settled:

| # | Question | Resolution |
|---|---|---|
| 1 | Phase 2 runner: build or extract? | **Extract `src/agents/sub-agent-runner.ts`** into a shared package. It is already headless (see finding B). |
| 2 | §13.3 `touches` overflow | **Journal it, let the merge queue decide.** `touches` stays a *scheduling* gate; a `touches.overflow` event is recorded and the run continues. The serialized rebase-before-merge is the real conflict authority. |
| 3 | §13.4 save-time validation | **Hard reject at `save_file`.** A plan that does not parse cannot be written, so the Planner fixes it while still in context. |
| 4 | Linear structure | **Phase parents + sub-issues.** |
| 5 | V1/V2 coexistence | **Swap the board UI at Phase 1.** V1 becomes unreachable from Phase 1; Phase 4 is pure code removal. Accepted cost: no usable orchestrator between Phase 1 and Phase 2. *Superseded in practice:* P1-E built a new surface beside V1 rather than retrofitting `orchestrate-board.ts`, V1 is still reachable, and Phase 9 is what closes the parity gap that created. |
| 6 | §13.2 Final Tester | **Static ladder at Phase 3, browser at Phase 5.** Multi-agent runs are verified end-to-end *before* V1 is deleted. |
| 7 | Project scope | **Phases 0–9.** Phase 6 issues stay unscheduled until Phase 5 lands. Phase 7 (stream UI lag) can start now — it does not wait on the runner. Phase 8 (sub-agents) is blocked only on Phase 2 and should land *before* Phase 6. Phase 9 (finish the Boards surface) is blocked on nothing and must land *before* Phase 4, which deletes what it ports from. |
| 8 | §13.1 journal retention | **Keep forever + periodic snapshot.** The fold is memoised against a snapshot written every N events. Raw history is never compacted — §11 needs it to measure bad abandonments. |

## Findings that change the PRD's risk model

Five things were verified in the codebase. Two materially de-risk Phase 2; one adds work to Phase 3; one constrains the module format; one adds Phase 8.

**A. Provider streaming is already server-side.** The PRD's §12 top risk — *"provider streaming must move server-side — the largest single piece"* — is largely already done. `server/generations/upstream.js` (`pumpUpstream`) owns the upstream SSE connection; `server/generations/store.js` owns subscriber fan-out, `cancel`, `markComplete`/`markError`, and fallback roles. The renderer's `src/providers/fetch-chat.ts` is a thin client that POSTs `/api/generations` and replays bytes back through a synthetic `Response`. A server-side runner calls that store **in-process** — no HTTP hop, no new provider plumbing. Phase 2's real work is the *turn loop*, not the transport.

**B. A zero-UI headless turn loop already exists.** `src/agents/sub-agent-runner.ts` (1,375 lines, *"isolated sub-agent completion + tool loop, no parent chat history"*) has **no `../ui/` imports and no `document.` / `window.` references** across its 46 import sources. It already handles SSE parsing, constrained tool calls, XML tool calls, inline/Harmony thinking routing, context-budget policy, vision gating, and structured outcomes. This — not `src/tools/loop.ts` (3,773 lines, heavily UI-coupled) — is the port target. Its one real coupling is `src/state/sessions.ts` (2,206 lines, 10 browser-global hits), which is broken behind an injected transcript store in P2-A.

**C. There was no rebase operation.** `server/worktree/worktree-ops.js` had `ensureIntegration`, `createWorktree`, `mergeIntoIntegration`, `checkMerged`, `abortMerge`, `restoreIntegration`, `verifyIntegrationMerge` — but nothing that rebased. §5.6's *"rebase before merge"* is P3-B (`rebaseOntoIntegration`, MIN-706 — done).

**D. The shared core must be `.js` + `.d.ts`, not `.ts`.** The server ships and runs as raw JavaScript (`npm start` → `node server.js`; no transpile step covers `server/**`). The existing TS bridge, `server/orchestrate/board-testing/ts-import.js`, lazily registers `tsx` and is explicitly dev-only — it cannot work in a packaged app. The repo already has the right pattern: `server/tools/output-cap.js` + `output-cap.d.ts`, imported from the renderer by `src/ui/terminal-panel.ts`. The V2 core follows it.

**E. The sub-agent controller is V1’s disease in miniature.** `src/agents/controller/` (3,089 lines) reproduces every fault the PRD diagnoses in V1: a mutable `SubAgentRun` struct; a **last-write-wins mirror** of it to disk (`persistence.ts` — *“coalesced registry mirror queue”*) instead of an append-only log; a watchdog inferring liveness from heartbeat and progress ages; boot reconciliation that marks in-flight runs `failed` / `interrupted` (`controller.ts:1357`); and counters — `attempt`, `progressSeq`, `tier1Attempted`, `handlingSuspect` — mutated from several places. It carries three faults the boards never had: a wall-clock `setTimeout` that cancels a *healthy* run at 5 minutes (`defaultTimeoutMs` in `src/agents/defaults/sub-agents.json`); a finalization that settles a run `failed` when the model’s closing JSON does not parse, unless it both produced prose and called a tool (`sub-agent-runner.ts:1318`); and `enqueueToolApproval` with no abort signal, so a cancelled run still executes its tool once the modal is answered. PRD §10 lists none of it for deletion. V2 solves this exact problem and then does not apply the solution to its closest neighbour — hence Phase 8.

## Architecture / Key Files

| Path | Role | Action |
|------|------|--------|
| `server/orchestrator/core/*.js` + `*.d.ts` | Pure decision core: events, `derive`, `plan`, policy, `parsePlan`. No I/O. Imported by both server and renderer. | CREATE |
| `server/orchestrator/journal.js` | Append-only JSONL store + snapshot writer, atomic temp-then-rename | CREATE |
| `server/orchestrator/engine.js` | Reconcile loop, tick triggers, effector diffing | CREATE |
| `server/orchestrator/effector-*.js` | `scripted` (Phase 1) and `runner` (Phase 2) effectors behind one interface | CREATE |
| `server/orchestrator/merge-queue.js` | Serialized rebase → merge → journal | CREATE |
| `server/orchestrator/middleware.js` | `/api/boards/*` REST + SSE | CREATE |
| `server/runner/*.js` | Extracted headless turn loop (`runTurn`) | CREATE |
| `server/worktree/worktree-ops.js` | Add `rebaseOntoIntegration` | MODIFY |
| `server/generations/store.js` | In-process generation binding for the runner | MODIFY |
| `src/ui/orchestrate-board.ts` (3,720) | Board UI — data source swapped to SSE, all mutation removed | MODIFY |
| `src/chat/prompts/work-agents/planner/agent.full.md` | Add `- **Touches:**` to the required plan schema | MODIFY |
| `server/tools/plan-write-guard.js` | Hard-reject plans that fail `parsePlan` | MODIFY |
| `server/sub-agents/*.js` + `*.d.ts` | Sub-agent graph: events, fold, `plan`, policy — the runless shape | CREATE (Phase 8) |
| `server/sub-agents/effector-runner.js` | Sub-agent attempts over `runTurn()` | CREATE (Phase 8) |
| `server/sub-agents/middleware.js` | `/api/agents/*` REST + SSE | CREATE (Phase 8) |
| `server/orchestrator/engine.js`, `journal.js` | Take `{ fold, plan }` and a journal namespace as arguments | MODIFY (Phase 8) |
| `src/agents/controller/*.ts` (3,089) | Watchdog, heartbeats, timers, registry mirror, boot reconcile | DELETE (Phase 8) |
| `src/agents/sub-agent-runner.ts` (1,375) | Client copy of the loop, superseded by `server/runner/` | DELETE (Phase 8) |
| `src/state/orchestrate-*.ts`, `src/state/board-*.ts` (~9.9k) | V1 engine | DELETE (Phase 4) |
| `src/chat/orchestrate/*.ts` (~3.3k) | V1 lifecycle repair + planner-chat glue | DELETE (Phase 4) |
| `src/tools/board-tools.ts` (1,107) | `board_init` / `board_update_task` / `board_set_autonomy` / `delegate_tasks` | DELETE (Phase 4) |
| `server/session/engine-bundle/` (19 MB) | Orphan from the reverted MIN-354 v1 | DELETE (Phase 4) |
| `test/orchestrate/*` (52 files, ~17k lines) | V1 tests | DELETE + selectively port (Phase 4) |

## Phase Breakdown

Each task below is one Linear sub-issue carrying its own full plan. Phases are sequential; tasks within a phase are largely parallel except where `Depends on` says otherwise.

### Phase 0 — Pure core (no I/O)
*Proves: the whole decision surface is unit-testable as a table.*

**MIN-677** · MIN-684 P0-A Core package + shared-module strategy · MIN-685 P0-B Journal event schema + versioned envelope · MIN-686 P0-C `derive()` fold · MIN-687 P0-D `plan()` scheduler · MIN-688 P0-E Policy table · MIN-689 P0-F Plan schema + `parsePlan()` · MIN-690 P0-G Snapshot + memoised fold

### Phase 1 — Server engine, SSE, renderer as view
*Proves: the scheduler is correct with zero model calls.*

**MIN-678** · MIN-691 P1-A Journal store · MIN-692 P1-B Reconcile loop + effector interface · MIN-693 P1-C `/api/boards/*` REST + SSE · MIN-694 P1-D Scripted fake effector · MIN-695 P1-E Renderer as view (UI swap) · MIN-696 P1-F Scheduler conformance suite · MIN-697 P1-G Crash / restart / reload recovery proof

#### Phase 1 status

All seven sub-issues are built. Two review passes over Phase 1 found six defects
between them; all six are fixed with regression tests that were each verified to
fail against the old code. The ones worth remembering, because they are the
shapes to watch for again:

- **A torn journal tail bricked the board.** `readEvents` dropped a half-written
  final line but nothing repaired the file, so the next append concatenated onto
  the fragment and every read of that board threw from then on. A crash made the
  board permanently unopenable — the one failure an append-only journal exists
  to rule out. The test that missed it asserted on the `seq` the append returned
  rather than on a re-read.
- **`getEngine` published the engine before `load()` resolved**, so a second
  caller during the load got one with `state === null`. Every first page load
  after a server restart hit it.
- **`startTask` on a stopped board** spawned work, journaled it, and had the
  next tick stop it. Fixing it is what made PRD §6's Manual mode real: the fold
  marks an attempt begun while stopped as `manual`, `plan()` keeps those desired,
  and `board.stopped` clears the flag so Stop still means stop. A manual start
  overrides the concurrency cap and **nothing else** — dependencies, one attempt
  per task and `touches` exclusion are correctness constraints, not preferences.

MIN-696's invariant 1 was also mis-stated. "At no tick do more than N attempts
exist" is false in the product, because the cap gates *starting* and not
*continuing*; it now reads "no tick starts work that would push attempts above
N" and is checked against the cap the driver commanded rather than against
`state.concurrency`. A new generator dimension moves concurrency, stop/start and
manual starts mid-run, and found the `startTask` dependency hole within seconds.

**Open against decision 5.** V2's surface is a new one at `#/app/code/boards`
(`src/orchestrator/`), built beside V1 rather than by retrofitting
`orchestrate-board.ts` — V1's `BoardTask` has ~50 fields against `TaskState`'s
17, and each of the 45 sites reading a deleted field needs a decision rather
than a substitution. V1's Orchestrate entry point is therefore **still
reachable**, where decision 5 says V1 becomes unreachable at Phase 1. Hiding it
is a one-line change; doing it properly is not, because V1's hub is wired into
onboarding, chat groups, kickoff and the plan screen. Left as a call to make
rather than made silently.

### Phase 2 — Headless runner, concurrency 1
*Proves: real builds run server-side.*

**MIN-679** · MIN-698 P2-A Extract the runner · MIN-699 P2-B `runTurn()` interface · MIN-700 P2-C In-process generation binding · MIN-701 P2-D Server-side tool dispatch · MIN-702 P2-E Builder/Tester contracts + seed kinds · MIN-703 P2-F Runner effector with typed exits · MIN-704 P2-G Real single-agent board end to end

#### Phase 2 status

Orchestration started 2026-08-29 from branch `Orchestrator-V2` (Phase 0–1 Done). Work is sequential inside the phase because P2-B/C/D all land in `server/runner/` and cannot share one worktree in parallel.

**Phase 2 complete (verified).** All seven sub-issues independently verified PASS. The phase gate (P2-G) is a 3-task fixture board at concurrency 1, UI closed, fake host emitting real `save_file` then `report_outcome`: **10/10 completions, 0 retries, 0 abandonments** (`test/orchestrator/p2g-reliability.json`). That number is the deterministic-host ceiling, not a live-LLM measurement — Phase 3 should not treat it as “agents never retry.”

Deferred into later phases (not fail):

- Merge/final are still instant-pass (P3-C owns the real merge queue).
- Worktrees are engine-owned (P3-A): allocated on start, journaled on `task.attempt.started`, reclaimed on boot.
- `runTurn` gained `parseReport` and `systemPrompt` — Phase 6 findings.
- Headless tool schemas are name-only stubs until a server-side definitions bridge exists.
- V2 board live tool line was unit-tested; it was not exercised in Electron.
- V1 Orchestrate remains reachable (open from Phase 1).

| Todo | Issue | Depends on | Status |
| ---- | ----- | ---------- | ------ |
| P2-A Extract `sub-agent-runner` into `server/runner/` | MIN-698 | — | done |
| P2-B `runTurn()` board-agnostic interface | MIN-699 | P2-A | done |
| P2-C In-process generation binding | MIN-700 | P2-A | done |
| P2-D Server-side tool dispatch | MIN-701 | P2-A | done |
| P2-E Builder/Tester contracts + six seed kinds | MIN-702 | P2-B | done |
| P2-F Runner effector with typed exits | MIN-703 | P2-B, P2-C, P2-D, P2-E | done |
| P2-G Real single-agent board end to end | MIN-704 | P2-F, P1-E | done |

#### P2-B (MIN-699) — done

- [x] `server/runner/run-turn.js` + `.d.ts` wrapping the P2-A loop
- [x] Six-way object `TurnResult` (core keeps the string `AttemptResult`; P2-F maps `.outcome`)
- [x] Parameters: `chatId` (opaque), `seed`, `tools`, `model`, `onEvent`, `cwd`, `transcript`, `signal`, `limits`, `deps`
- [x] Injected report tool (`reportToolName`, default `report_outcome`) — not a role name
- [x] `pass` / `fail` / `blocked` verbatim from a valid report-tool payload only
- [x] Runner-produced `no_report` / `crashed` / `timeout` (`maxTurns` and `wallClockMs`)
- [x] Never scrape assistant prose (`tryParseStructuredOutcomeFromAssistantProse` is not imported)
- [x] `onEvent` is presentation-free typed events
- [x] `ask_question` is list-presence only — no product branch in `run-turn.js`
- [x] UUID `chatId` works with no board in existence
- [x] README: any signature change is a Phase 6 finding
- [x] Tests in `test/runner/run-turn.test.mjs`; package guard extended; `npx tsc --noEmit`

#### P2-C (MIN-700) — done

- [x] `server/runner/generation-binding.js` + `.d.ts`: `createCompletionStream` + `postChatCompletionsInProcess`
- [x] In-process subscriber API on `server/generations/store.js` (`addLocalSubscriber` / `removeLocalSubscriber`); HTTP `addSubscriber` unchanged
- [x] `persist: false`; fallback role `sub-agent` (agent family, not `NON_AGENT_FALLBACK_ROLES`); abort → `cancel(state)`
- [x] Server default wired from `server/runner/index.js`; renderer adapter still HTTP `/api/generations`
- [x] Tests: `test/runner/generation-binding.test.mjs`, `test/generations/local-subscriber.test.mjs`

#### P2-D (MIN-701) — done

- [x] `server/runner/tool-dispatch.js` + `.d.ts`: `executeInProcessTool` / `createInProcessToolDispatch`
- [x] Calls `executeServerTool` (same handlers as POST `/api/tools`); loader + `validate.js` on plugin names
- [x] HTTP-layer guards preserved: plan-write, plan-mode `update_settings`, `validateAllowedWorkspaceRoot`, cwd-guard rewrite
- [x] Handler guards unchanged: host-kill, host-port-bind, windows-pipe, output-cap
- [x] `cwd` required (no silent workspace-root default)
- [x] Allowed subset is an argument; `DEFAULT_HEADLESS_TOOL_IDS` helper (no roles in the loop)
- [x] Batching ported from `execute-tool-batch.ts` (`MAX_PARALLEL_READ_TOOLS = 6`)
- [x] Renderer-only enumeration in `server/runner/tool-set.md` (port vs exclude)
- [x] Named exports from `index.js`; renderer keeps `src/tools/headless-tool-batch.ts`
- [x] Tests: `test/runner/tool-dispatch.test.mjs`, `test/runner/tool-batch.test.mjs`; package guard extended

#### P2-E (MIN-702) — done

- [x] V2 Builder/Tester prompts in `server/orchestrator/prompts/{builder,tester}/` (full + lite). V1 `work-agents/builder|tester` (`board_report` / `env_blocked`) untouched
- [x] Builder prompt states the `blocked` criterion (environment cannot support the work — not a hard build). Tester is `pass` | `fail` only
- [x] Neither V2 prompt mentions boards, waves, delegation, or lifecycle reporting; no "do not call `delegate_tasks`" leftover
- [x] `server/orchestrator/report-tool.js` — `report_outcome` with role-specific schemas; malformed rejected at the tool boundary with an actionable `Error:` message
- [x] Hooked into `runTurn({ reportToolName, parseReport })`. A rejected report is not `no_report`. **Phase 6 finding:** `parseReport` added so the runner still does not know Builder vs Tester
- [x] Six seed builders in `server/orchestrator/seeds.js` (pure; golden-filed at `test/orchestrator/seeds.golden/`)
- [x] Unit wiring: `blocked` → `TurnResult.outcome === 'blocked'` → `decide({ role: 'builder', outcome: 'blocked', attemptCount: 0 })` is a same-worktree repair retry. Engine+effector E2E is P2-F

#### P2-F (MIN-703) — done

- [x] `server/orchestrator/effector-runner.js` + `.d.ts` implementing `inspect` / `start` / `stop` / `onEnd`
- [x] `start()` resolves as soon as the attempt is in the live map (licenses `task.attempt.started`)
- [x] Inspect-until-onEnd-resolved contract (engine.js comment)
- [x] Model binding server-side (`model-binding.js`; `board-model-binding.ts` is the behaviour reference, no DOM)
- [x] Seeds via `buildSeed`; V2 prompts injected as `runTurn({ systemPrompt })` (**Phase 6 finding**)
- [x] `DEFAULT_HEADLESS_TOOL_IDS` + `report_outcome`; cwd is the attempt worktree (P3-A)
- [x] `createInProcessToolDispatch` + `postChatCompletionsInProcess` + `runTurn`
- [x] `TurnResult.outcome` mapped to engine `AttemptEnd`; `needs`/`blockers`/`evidence`/`testOutput` on `evidence`
- [x] Limits in `attempt-limits.js` (`timeout` on wall-clock or max-turns)
- [x] Live `onEvent` on a parallel SSE (`event: live`, no seq) via `live-events.js`; tokens never journaled
- [x] Uncaught throw → `crashed`; engine keeps ticking
- [x] Restart: `inspect()` empty at boot; `cancelOrphanedRunnerGenerations` at process start
- [x] Production factory via `setEffectorFactory` in `server/runtime/middlewares.js`; scripted remains the middleware default and the Phase 1 suite injects it
- [x] Merge/final are instant pass (scripted default) until P3 owns a real merge
- [x] Tests in `test/orchestrator/effector-runner.test.mjs` against the fake model host; `engine.js` unchanged

#### P2-G (MIN-704) — done

- [x] Fixture plan `test/fixtures/orchestrator-v2-p2g/plan.md` (3 tasks, `parsePlan` golden format)
- [x] Sandbox workspace — agents write `src/greet.js`, `src/add.js`, `src/index.js`; Minnow product source is not the target
- [x] Fake host programmed to emit `save_file` then `report_outcome`; tools execute in-process (P2-D)
- [x] HTTP `/api/boards` drive with UI closed, concurrency 1, runner effector, Autopilot model binding
- [x] Reload: GET state mid-run matches `derive(journal)`; new engine on the same journal completes
- [x] Restart: `inspect()` empty → tick reaps crashed → retry; run completes
- [x] Induced failures: fail build → `failure-aware`; fail test → `fix`; `blocked` → `repair`; killed host → `crashed` then `continue`
- [x] 10-run reliability recorded at `test/orchestrator/p2g-reliability.json`
- [x] Live tool names on the V2 board from SSE `event: live` (not journaled)
- [x] Zero renderer in the E2E file

### Phase 3 — Worktrees, merge queue, parallelism
*Proves: multi-agent works.*

**MIN-680** · MIN-705 P3-A Engine-owned worktree lifecycle · MIN-706 P3-B `rebaseOntoIntegration` · MIN-707 P3-C Serialized merge queue · MIN-708 P3-D `touches` gate + overflow journaling · MIN-709 P3-E Concurrency > 1 · MIN-710 P3-F Final Tester static ladder · MIN-711 P3-G End-of-run report writer · MIN-712 P3-H Dead-end handling + evidence capture

#### Phase 3 status

Orchestration started 2026-08-29 from branch `Orchestrator-V2` (Phases 0–2 Done) in worktree `orchestrator-v2-a7c3e91f`. Sequential inside the phase except where Linear `Depends on` allows overlap; one worktree, so implement → verify per sub-issue.

**Phase 3 complete (verified in this worktree as of P3-G).** P3-A–H are done (worktrees, rebase, merge queue, `touches` gate, concurrency default 2 + Running/Stopped, Final Tester static ladder, dead-end evidence, end-of-run report).

**Phase gate (met in tests):** a fixture board completes at concurrency 2 with isolated worktrees and the merge queue (P3-E); an induced merge conflict re-opens the owning task on the same worktree (P3-C); an induced unbuildable task is abandoned, genuine dependents skipped, everything else reaches `run.finished` (P3-H). Fake-host 10/10 at N=2 is the deterministic-host ceiling, not a live-LLM measurement.

| Todo | Issue | Depends on | Status |
| ---- | ----- | ---------- | ------ |
| P3-A Engine-owned worktree lifecycle | MIN-705 | P2-F | done |
| P3-B `rebaseOntoIntegration` | MIN-706 | — | done |
| P3-C Serialized merge queue | MIN-707 | P3-A, P3-B | done |
| P3-D `touches` gate + overflow journaling | MIN-708 | P0-F, P3-A | done |
| P3-E Concurrency > 1 + autonomy model | MIN-709 | P3-C, P3-D | done |
| P3-F Final Tester static ladder | MIN-710 | P3-C | done |
| P3-G End-of-run report writer | MIN-711 | P3-F, P3-H | done |
| P3-H Dead-end handling + evidence | MIN-712 | P0-E, P3-A | done |

#### P3-A (MIN-705) — done

- [x] `server/orchestrator/worktree-lifecycle.js` allocates via existing `worktree-ops.js` (`ensureIntegration` once per board, then `createWorktree`)
- [x] `start()` returns `{ attemptId, worktree }` after the tree exists; engine journals it on `task.attempt.started`
- [x] `runTurn` and `createInProcessToolDispatch` receive the worktree path as `cwd` — runner stays board-agnostic
- [x] Pass commits via `commitWorktree`
- [x] Same worktree for `repair`, `continue`, and `rebase`; fresh for `failure-aware` and `fix` (`wantsSameWorktree` / `SAME_WORKTREE_SEED_KINDS` next to the seed kinds)
- [x] Engine `load()` reclaims `git worktree list` minus journal-live; never removes a live path; dirty removals journal opaque `worktree.discarded`
- [x] `refreshIntegrationDepsAfterMerge` exported as the P3-C hook; merge is P3-C, final is P3-F
- [x] Tests in `test/orchestrator/worktree-lifecycle.test.mjs` (isolation, reuse, live restart, orphan reclaim, dirty discard, no registry)

#### P3-B (MIN-706) — done

- [x] `rebaseOntoIntegration({ boardId, slotId })` on `server/worktree/worktree-ops.js` (JSDoc; no `.d.ts` — module style is JSDoc)
- [x] Discriminated result `{ ok: true, sha }` or `{ ok: false, conflicts: string[] }` — conflict is not an exception; never thrown
- [x] On conflict: capture `git diff --name-only --diff-filter=U` before abort; `git rebase --abort` verified by status / leftover dirs, not exit code
- [x] Failure path never leaves `.git/rebase-merge` or `.git/rebase-apply` (worktree-aware via `git rev-parse --git-path`)
- [x] Empty / already-up-to-date: `{ ok: true, sha }` with the unchanged sha; no-commits does not start a rebase
- [x] Board-keyed in-process mutex shared with `mergeIntoIntegration` / `abortMerge` / `restoreIntegration` (not a second lock file; `mergeInProgress` remains a MERGE_HEAD probe plus lock-held)
- [x] Exported for P3-C; tests in `test/server/worktree-ops.test.mjs` cover every MIN-706 bullet
- [x] Control plane / this op: zero LLM calls

#### P3-C (MIN-707) — done

- [x] `server/orchestrator/merge-queue.js` + `.d.ts`: rebase → merge → verify; AttemptEnd only (engine still journals `merge.succeeded` / `merge.conflicted`)
- [x] Snapshot `beforeSha` on the AttemptEnd and as an optional field on those events — no second event type
- [x] Last builder/tester worktree from the journal (`task.attempt.started`); slot via `slotIdFromWorktreePath`
- [x] Rebase conflict → AttemptEnd with `files`; no fixer; P3-B already aborted
- [x] Verify failure → `restoreIntegration(beforeSha)`; treated as conflicted
- [x] After success, `refreshIntegrationDepsAfterMerge({ boardId, sinceSha: beforeSha })`
- [x] MERGE_HEAD on restart is aborted so journal and git agree (never half)
- [x] Runner effector calls `runMerge` when `role === 'merge'` and worktrees are isolated; Final is P3-F; scripted stays instant-pass
- [x] Zero LLM / generation / runner imports (static test)
- [x] Tester pass keeps the worktree (`shouldKeepWorktree` advances to merge); the runner effector releases it only after a successful merge — a conflict keeps the tree for the rebase-seeded owner (MIN-707)
- [x] Tests in `test/orchestrator/merge-queue.test.mjs`

#### P3-D (MIN-708) — done

- [x] Board creation expands declared globs against the workspace repo and journals `touchesExpanded` / `emptyTouchesGlobs` on `board.created` (middleware + [`touches.js`](../../server/orchestrator/touches.js)). Empty match is a warning, not a blocker.
- [x] `plan()` / `manualStart()` use `footprintsClash`: declared glob overlap **or** frozen expanded file intersection. Replay does not re-walk the disk; a file created after board start cannot change past scheduling.
- [x] Empty expansion overlaps nothing extra (same empty-list rule as `touchesOverlap`); overlapping declared globs still serialise.
- [x] Engine journals `touches.overflow` after a passing builder whose worktree diff sits outside declared globs. Attempt still passes. One event path (engine append after `task.attempt.ended`).
- [x] `summarizeTouchesOverflow(events)` aggregates frequency and hottest files (pure, for later “should this gate have teeth”).
- [x] V2 board: overflow is informational (`--mn-accent-*`); unmatched globs stay a creation warning.
- [x] Tests in `test/orchestrator/touches.test.mjs` plus expansions in `plan.test.mjs` / `derive.test.mjs`. Core stays I/O-free.

#### P3-E (MIN-709) — done

- [x] Default start concurrency is **2** (`DEFAULT_BOARD_CONCURRENCY`). Fold pre-start stays 1 until `board.started`. POST `/start` omitting `concurrency` uses 2. UI stepper shows 2 on a created board.
- [x] Autonomy is Running/Stopped + integer N. Sequential = Running at N=1. AFK = Running, no `ask_question` in the headless allow-list. Manual = Stopped + `POST /tasks/:id/start`.
- [x] Cap still gates *starting* only (`plan()` keeps in-flight desired above N). Engine stop-diff comment matches that. Lowering N does not kill in-flight attempts.
- [x] V2 board UI: Running/Stopped pair, concurrency stepper, resource hint (N agents = N model calls + N worktrees, no hard cap). No V1 boolean toggles. V1 `orchestrate-board.ts` fields untouched (P4-F).
- [x] Real fixture board completes at N=2 with two builders overlapping on journal `seq` windows **and isolated worktrees** (`buildersOverlapBySeq`; merge via `startMerge` / queue, not `cwd`-sandbox instant pass). Shared-cwd tests remain for seq/cap/AFK/reliability speed.
- [x] Reliability: 10 runs at N=2 vs P2-G N=1 baseline → `test/orchestrator/p3e-reliability.json`. Fake host; 10/10 is not “agents never retry.”
- [x] Tests: `p3e-e2e.test.mjs`, `board-state-schema.test.mjs`, `api.test.mjs`, existing `plan.test.mjs` / `engine.test.mjs` cap proofs.

#### P3-H (MIN-712) — done

- [x] `deadEnded` / `pendingSkips` name the **abandoned root** on `blockedBy`, not the immediate skipped parent. Genuine dependents only (`dependsOn` DAG). Wave-sharing and adjacent `touches` never skip.
- [x] Diamond DAG (A→B, A→C, B→D, C→D): abandoning A skips B, C, and D — and nothing else. Independent work still desired on the next tick.
- [x] Abandoning the last runnable task journals `run.finished` (V1 quarantine-last silent stall).
- [x] `task.abandoned.evidence` carries full attempt history (never truncated as a list): outcomes, seeds, `testOutput`, `needs[]` / `blockers[]`, capped per-attempt diffs. Policy `decide()` stays last-attempt-only; `nextAction` attaches the bundle. Zero LLM in the control plane.
- [x] Diff capture is I/O in [`touches.js`](../../server/orchestrator/touches.js) (`captureWorktreeDiff`); the engine attaches it to `task.attempt.ended` then the bundle copies it.
- [x] `queryAbandonments(events)` / `loadAbandonments(boardId)` reconstruct history from the journal alone (thin pre-P3-H evidence still works).
- [x] V2 board: skipped is `--warn` and copy says it is waiting on something that failed, not that this task failed.
- [x] Tests: `plan.test.mjs`, `derive.test.mjs`, `evidence.test.mjs`, `engine.test.mjs`.

#### P3-F (MIN-710) — done

- [x] [`final-test.js`](../../server/orchestrator/final-test.js) + `.d.ts`: typecheck → lint → unit → build, each gating the next; stop at first failure
- [x] Ladder runs in the **integration worktree** (`getWorktreeSlotPath(boardId, 'integration')`), never the workspace or a task tree
- [x] `final.test.ended { outcome, runInstructions }` — `runInstructions` is `command:` + `cwd:` lines (reproducible, not a narrative)
- [x] Failure does **not** re-open / retry / abandon tasks (`plan()` is empty once `finalTest` is set)
- [x] Commands from the plan `## Verification Checklist` when present, else package.json scripts / repo defaults (`npx tsc --noEmit`, `npm run lint` if a lint script exists, `npm test`, `npm run build`)
- [x] Known-failing suites: `documentation/plans/final-test-baseline.json` (or `.minnow/final-test-baseline.json`) records `expectedExitCode` + `failingPatterns` so a matching non-zero unit exit is not a regression. **Do not** point this ladder at Minnow's own `npm test` from unit tests
- [x] Runner effector runs the mechanical ladder when worktrees are isolated and `runTurn` is not injected; `runFinalLadder` is the test hook; scripted / explicit-`cwd` / fake-`runTurn` stay instant-pass
- [x] Final Tester prompt under `server/orchestrator/prompts/final/` (agent may run the same fixed commands via `execute_command`); tests drive the ladder with no model
- [x] Merge queue stays LLM-free (does not import `final-test.js`)
- [x] Tests in `test/orchestrator/final-test.test.mjs` plus `plan.test.mjs` / `prompts-v2.test.mjs`

#### P3-G (MIN-711) — done

- [x] [`report.js`](../../server/orchestrator/report.js) + `.d.ts`: one stateless `complete()` over journal + derived state
- [x] Triggered from the engine only, after `run.finished` (and after a user stop); idempotent `run.report.written`
- [x] Covers shipped, abandoned (evidence + next step), skipped, merge conflicts, `touches.overflow`, final test + `runInstructions`
- [x] Artifact at `~/.minnow/boards/<id>/report.md`; GET `/api/boards/:id/report`; V2 finish view
- [x] Report markdown never imported by plan / derive / policy / merge-queue
- [x] Tests in [`test/orchestrator/report.test.mjs`](../../test/orchestrator/report.test.mjs); `complete` is injectable

### Phase 4 — Delete V1
*Proves: there is one engine.*

**MIN-681** · MIN-713 P4-A Delete the V1 engine · MIN-714 P4-B Delete the lifecycle-repair subsystem · MIN-715 P4-C Delete the orchestrator agent, planner chat, and board tools · MIN-716 P4-D Retire V1 tests, port the real ones · MIN-717 P4-E Delete `engine-bundle/` · MIN-718 P4-F Collapse the autonomy model

### Phase 5 — Browser driver
*Proves: fully unattended verification.*

**MIN-682** · MIN-719 P5-A Server-side browser driver · MIN-720 P5-B Driver tool surface · MIN-721 P5-C Browser step in the Final Tester ladder · MIN-722 P5-D Unattended overnight run proof

### Phase 6 — Normal chat adopts the runner
*Proves: one engine for all chat. Written now, scheduled after Phase 5.*

**MIN-683** · MIN-723 P6-A Non-board `runTurn()` spike · MIN-724 P6-B `ask_question` as an injected capability · MIN-725 P6-C Strangle the client loop · MIN-726 P6-D Delete the client loop

### Phase 7 — Chat-stream UI stays responsive mid-generation
*Proves: typing, scrolling, and clicking stay live while a chat streams, without giving back local tok/s. Can start now.*

**MIN-727** · MIN-728 P7-A Measure stream long tasks · MIN-729 P7-B Coalesce `handleChunk` onto one paint · MIN-730 P7-C Cheap thinking stats + ticked-motion rescan · MIN-731 P7-D `STEP_HZ` hygiene and accept

Full research plan: [`chat-stream-ui-lag.md`](./chat-stream-ui-lag.md). Phases 1 and 6 do not fix this: upstream SSE is already server-side; the freeze is token→DOM on the renderer. P6-A may later batch `onEvent`; until then P7-B is required on whatever loop owns the transcript.

### Phase 8 — Sub-agents adopt the runner
*Proves: the journal + reconcile that fixed boards fixes every background agent. Blocked only on Phase 2, which is done — this can start now, and should land before Phase 6.*

**MIN-732 (to file)** · P8-A Stabilize the client loop · P8-B Engine + journal over an injected graph shape · P8-C Sub-agent graph — events, fold, `plan`, policy · P8-D Sub-agent effector over `runTurn()` · P8-E Parent delivery becomes a fold · P8-F Renderer as view · P8-G Delete the controller · P8-H E2E + reliability proof

- **P8-A — Stabilize the client loop (interim, ships to `main`).** Blocked on nothing; superseded by P8-G except the last item, which normal chat needs too. Reset the dispatch timeout on progress instead of firing on wall-clock (`armRunTimers`, `src/agents/controller/registry.ts`). Drop the `toolTurns > 0` condition on the prose fallback (`sub-agent-runner.ts:1318`) so a JSON parse failure with real prose completes degraded instead of `failed`. Retry non-ok HTTP with backoff and return the partial transcript on terminal failure (`sub-agent-runner.ts:337`). Give `enqueueToolApproval` an `AbortSignal` (`src/tools/approval-queue.ts`) so a cancelled run cannot execute its tool when the modal is answered minutes later.

- **P8-B — Engine + journal over an injected graph shape.** `engine.js` statically imports `plan` from `core/plan.js` and `foldInto` from `core/derive.js`; `journal.js` is pathed on `boardDir(boardId)`. Both take `{ fold, plan }` and a journal namespace as arguments instead. Pure refactor — `BoardState` is untouched and the Phase 1 conformance suite is the regression test.

- **P8-C — Sub-agent graph: events, fold, `plan`, policy.** Runs are independent: no `dependsOn`, no waves, no `touches`, no merge queue. Six events (`run.requested`, `attempt.started`, `attempt.ended`, `run.abandoned`, `run.cancelled`, `result.delivered`), one journal per parent chat at `~/.minnow/agents/<parentChatId>/journal.jsonl`. `plan()` is three rules: a non-terminal run with nothing in flight should be running, respect the concurrency cap, never two attempts on one run. The policy table takes the outcomes that kill runs today — `crashed | timeout | no_report` retry with a continue seed; `fail` past the cap abandons with evidence.

- **P8-D — Sub-agent effector over `runTurn()`.** Same shape as `effector-runner.js`. `sub-agents.json` stops being read by a client controller and becomes effector arguments: the per-type allow-list is `tools`, `summarySchema` is `parseReport`, the type prompt is `systemPrompt`, and `cwd` is finally passed — closing the gap where a sub-agent was never told which workspace it was in. `limits.wallClockMs` replaces the `setTimeout` kill, so a timeout is a typed exit routed through the policy table rather than a cancel that discards the work.

- **P8-E — Parent delivery becomes a fold.** `sub-agent-completion-push.ts` holds `pendingCompletionByChat`, `deliveredRunIds`, and `nudgedRunIds` in renderer memory, so a reload loses the delivery queue MIN-639 built to never drop a result. Delivery becomes `result.delivered` in the journal: MIN-639's property is kept, and now survives restarts.

- **P8-F — Renderer as view.** `/api/agents/*` REST + SSE mirroring `/api/boards/*`; the sub-agent drawer and run cards render derived state; spawn and cancel are POSTs. Live tokens ride the parallel `event: live` channel from P2-F and are never journaled.

- **P8-G — Delete the controller.** `src/agents/controller/` (3,089 lines — watchdog, heartbeats, timers, registry mirror, boot reconcile) and the client `src/agents/sub-agent-runner.ts` (1,375). `sub-agent-config.ts` stays; it is configuration, and the effector reads it.

- **P8-H — E2E + reliability proof.** Mirrors P2-G: spawn from a real chat with the UI closed, reload mid-run, restart mid-run, induce `fail` / `blocked` / killed host, record a 10-run reliability file. The gate is that a sub-agent survives what kills one today.

Ordering note: this belongs *before* Phase 6, not after. Sub-agents force `ask_question` as an injected capability (MIN-724) on a background surface instead of on the composer, and they give `runTurn()` real non-board traffic before normal chat bets on it. Signature changes found here are recorded as Phase 6 findings, on the same list P2-E and P2-F write to — one interface, one findings log.

### Phase 9 — Complete the Boards surface
*Proves: Boards is the orchestrator, not a debug view of one. Blocked on nothing; **must land before Phase 4**.*

**MIN-741** · MIN-742 P9-A Engine failures reach the screen · MIN-743 P9-B Kanban restored · MIN-744 P9-C Per-board model binding · MIN-745 P9-D Attempt transcripts · MIN-746 P9-E Board lifecycle · MIN-747 P9-F Twin-shape shell · MIN-748 P9-G Finish report · MIN-749 P9-H Command parity · MIN-750 P9-I States, a11y, tests

Phase 1's P1-E deliberately built the smallest surface that proves "the renderer is a view" — a wave-grouped list of rows, a merge queue, a raw journal. That was the right shape for proving the property and the wrong shape for using the product. This phase closes the gap against what V1's Orchestrate actually does, without giving back the property: **every item below is either a read, a POST, or new engine surface — none of them is a renderer-owned write.**

- **P9-A — Engine failures reach the screen.** A rejected `effector.start()` is a `console.warn` in `startAttempt` (`engine.js:392`) and nothing else: no journal line (correct — nothing happened), no SSE frame, no UI. `resolveAttemptModel` throwing "no model bound for this attempt" therefore presents as *Start does nothing* — the board reads `running`, every tick retries, and the only evidence is a server log the user never sees. Two fixes, both needed. (1) **Validate at the command boundary:** `POST /api/boards/:id/start` resolves the model binding and the effector's prep preconditions before it answers, so a missing binding is a 400 with a message on the button, not a silent loop. (2) **A non-journaled `event: error` frame** on the P2-F live channel — `{ role, taskId, message, consecutive }` — because preconditions can also fail on tick 40 of a 6-hour run. Consecutive failures are a counter in the runhead, not one toast per tick. Deliberately *not* journaled: a start that never happened is not a completed side effect, and putting it in the fold would make replay disagree with reality.

- **P9-B — Kanban restored.** `renderTaskList` becomes waves × columns. The column defs port straight from `src/chat/orchestrate/board-kanban-columns.ts`, re-keyed from `BoardTaskStatus` to `TaskPhase`: `idle`→Planned (Blocked when `dependsOn` has an unmerged entry), `building` + `merging`→In Progress, `testing`→Testing, `merged` + `abandoned` + `skipped`→Complete. The compact wave-strip lane defs port the same way. **Drag-and-drop does not port.** V1's drop *was* a status write (`orchestrate-board-dnd.ts`), and there is no such thing here — a card's column is derived from the fold. The keyboard grid (`orchestrate-board-keyboard.ts`) ports as navigation only; Ctrl/Cmd+Arrow lane moves go with the drag.

- **P9-C — Per-board model binding.** V2 resolves a model from Settings → Autopilot planner or the active chat's menubar binding (`model-binding.js`), both invisible from the board and neither addressable per board. Journal `board.model.set { providerId, id }` as an override the effector reads first, and put V1's header chip (`orchestrate-board-model-select.ts`) and reasoning controls (`orchestrate-board-reasoning.ts`) back in the runhead. This is what makes P9-A's failure mode fixable in place rather than three screens away.

- **P9-D — Attempt transcripts.** A running task shows one live line and a finished one shows a `summary` string; there is no way to read what an agent actually did, which is the first thing anyone asks when a task fails. Persist per-attempt transcripts beside the journal at `~/.minnow/boards/<id>/attempts/<attemptId>.jsonl` — **not** in the journal, for the same unbounded-replay reason P2-F keeps tokens off it — with `GET /api/boards/:id/attempts/:attemptId` and a panel in the task detail. V1's equivalent was a whole board-owned chat (`orchestrate-board-chat.ts`); this is the read-only half of it, which is the half that was load-bearing.

- **P9-E — Board lifecycle.** `ROUTES` has no delete, no rename, no archive, so boards accumulate forever and a typo'd board id is permanent. Add `DELETE /api/boards/:id` and `PATCH /api/boards/:id { name }`. Delete removes the journal — say so in the confirm, because the journal is the only record of the run.

- **P9-F — Twin-shape shell.** The surface is an `<aside>` and a `<section>`; Orchestrate is a confirmed page family (`ob-shell` / rail / `ob-runhead` / mono sections, [`orchestrator-boards-sp-research-twin-shape.md`](./orchestrator-boards-sp-research-twin-shape.md), landed except its visual pass). Adopt that vocabulary rather than inventing a second one, and reuse `ob-page.css` where the markup matches. Container queries, not media queries — app surfaces live inside MinnowOS windows, where `@media` never matches the pane width. Rail collapse and the 4→2→swipe column breakpoints come with the brief.

- **P9-G — Finish report.** `run.finished` carries a summary string that renders as one paragraph. V1 had a finish dashboard (`orchestrate-finish-dashboard.ts`, MIN-208). P3-G writes the real end-of-run report; this renders it — per-task outcomes, attempt counts, evidence, what was abandoned and why, the integration sha, and the Final Tester's run instructions.

- **P9-H — Command parity.** The engine exposes `startBoard`, `stopBoard`, `setConcurrency`, `startTask`; the board can therefore be started, stopped, re-paced, and hand-started, and nothing else. V1 could also retry, skip, and abandon a task by hand. **Open decision:** manual abandon/skip is new engine surface, not new UI — the policy table owns automatic routing (decision 7), and a human override has to be a journaled command (`task.abandoned { reason: 'user' }`) or it breaks replay. Decide before building; do not add a button that writes state locally.

- **P9-I — States, a11y, tests.** Loading skeletons instead of "Loading the board…", a real empty state, the error states P9-A now has something to show, focus management across repaints (the surface calls `replaceChildren` on every frame — anything focused is lost), and DOM tests over the column mapping and the failure frames. `test/ui/orchestrator-boards-create.test.mts` is the pattern.

Ordering note: **before Phase 4.** Phase 4 deletes `orchestrate-board.ts` and its satellites — the kanban column defs, the model chip, the reasoning controls, the finish dashboard, and the `ob-*` shell the twin-shape brief landed. Anything in this phase that ports from V1 has to be ported while V1 still exists. P9-A is not a port and should not wait for the rest of the phase: it is a live bug on the branch today.
## Verification Checklist

- [ ] `npm test` passes
- [ ] `npm run build` passes
- [x] The scheduler suite runs to completion with **zero model calls** (Phase 1 gate)
- [x] Killing the server mid-run and restarting reproduces identical derived state (Phase 1 gate)
- [x] A 3-task board completes at concurrency 1 with the UI closed, in-process tools, and typed exits (Phase 2 gate; fake host, 10/10)
- [x] A real multi-task board completes at concurrency 2 with worktrees and a merge queue (Phase 3 gate)
- [ ] No file under `src/state/orchestrate-*` or `src/chat/orchestrate/` remains (Phase 4 gate)
- [ ] `grep -r "board_init\|board_set_autonomy\|delegate_tasks" src server` returns nothing (Phase 4 gate)
- [ ] An overnight AFK run finishes, reports once, and stalls on nothing (Phase 5 gate)
- [ ] Cloud and local streams leave composer/scroll/clicks responsive; local tok/s not regressed (Phase 7 gate)
- [ ] A sub-agent spawned from a chat survives a renderer reload and a server restart, and finishes (Phase 8 gate)
- [ ] A sub-agent that runs past its wall-clock limit is retried by policy, not cancelled with its work discarded (Phase 8 gate)
- [ ] Starting a board with no model bound fails at the button with a readable message, and never enters a silent retry loop (Phase 9 gate)
- [ ] Every failure that stops work from starting is visible on the board without opening a server log (Phase 9 gate)
- [ ] Tasks render as waves × kanban columns, and no column a card sits in is written by the renderer (Phase 9 gate)
- [ ] A failed task's attempt transcript is readable from the board (Phase 9 gate)
- [ ] `grep -rn "lastHeartbeatAt\|tier1Attempted\|progressStallMs" src/` returns nothing (Phase 8 gate)

## Notes for Build Agents

- **The control plane makes zero LLM calls.** If a change would put a model call inside `plan()`, `derive()`, the policy table, or the merge queue, it is wrong. Determinism is what makes `state = fold(journal)` a working crash-recovery mechanism.
- **Every journal event records a completed side effect, never an intent.** Log `task.attempt.started` *after* the process exists.
- **Never add a retry counter.** Attempt counts are derived by filtering the journal. A counter is a second source of truth and will desynchronise.
- **The core is plain `.js` + `.d.ts`.** See finding D. Do not introduce a build step for `server/**`.
- **The runner must not know what a board is.** No board imports in `server/runner/`. Board specifics arrive as arguments. From Phase 8 it has a second caller, so "board-agnostic" stops being a discipline and becomes a fact the tests hold.
- **Never reintroduce a supervisor.** Phase 8 deletes the sub-agent watchdog, heartbeats, and stall timers for the same reason Phase 1 deleted the board ones: an idempotent reconcile tick over `actual` already restarts what died. A heartbeat is a second source of truth about liveness.
- Worktrees have no `node_modules`; ~11 extra test failures there are not regressions. `npm test` rewrites `test/fixtures`, and three suites fail on clean `main` — a non-zero exit is not automatically your regression.
