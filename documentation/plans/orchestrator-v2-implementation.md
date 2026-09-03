---
name: orchestrator-v2-implementation
overview: Implementation plan for Orchestrator V2 — a clean-room, server-side, journal-and-reconcile board engine that replaces the V1 renderer orchestrator. Ten phases from a pure decision core through V1 deletion, normal chat and sub-agents adopting the same runner, coalesced stream paint so the UI stays live mid-generation, and the Boards surface finished to parity with what V1's Orchestrate did.
isProject: true
---

# Orchestrator V2 — Implementation Plan

**Date:** 2026-08-28
**Goal:** Replace the V1 board engine with a server-side journal + reconcile engine whose state is a pure fold, so multi-agent runs are as reliable as today's sequential single-agent path.
**PRD:** [`orchestrator-v2.md`](./orchestrator-v2.md) — read it first. This document plans the build; it does not restate the design.
**Linear:** [Orchestrator V2](https://linear.app/minnowai/project/orchestrator-v2-97ced8c22ad8) (team Minnow AI) — phase parents `MIN-677`–`MIN-683`, `MIN-727`, `MIN-741`, `MIN-753`, `MIN-765`. Phase 8 is filed as `MIN-753` with sub-issues `MIN-754`–`MIN-761`. Phase 9 is `MIN-741` with `MIN-742`–`MIN-750`. Phase 10 is `MIN-765` with `MIN-766`–`MIN-778`. Each sub-issue carries its own full plan.

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
| 5 | V1/V2 coexistence | **Swap the board UI at Phase 1.** V1 becomes unreachable from Phase 1; Phase 4 is pure code removal. Accepted cost: no usable orchestrator between Phase 1 and Phase 2. *Superseded in practice:* P1-E built a new surface beside V1; Phase 9 closed the parity gap; **Phase 4 (MIN-681) deleted V1.** Live boards are `server/orchestrator/` + `src/orchestrator/` at `#/app/code/boards`. |
| 6 | §13.2 Final Tester | **Static ladder at Phase 3, browser at Phase 5.** Multi-agent runs are verified end-to-end *before* V1 is deleted. |
| 7 | Project scope | **Phases 0–9.** Phase 6 issues stay unscheduled until Phase 5 lands. Phase 7 (stream UI lag) can start now — it does not wait on the runner. Phase 8 (sub-agents) is blocked only on Phase 2 and should land *before* Phase 6. Phase 9 (finish the Boards surface) is blocked on nothing and must land *before* Phase 4, which deletes what it ports from. |
| 8 | §13.1 journal retention | **Keep forever + periodic snapshot.** The fold is memoised against a snapshot written every N events. Raw history is never compacted — §11 needs it to measure bad abandonments. |

## Findings that change the PRD's risk model

Five things were verified in the codebase. Two materially de-risk Phase 2; one adds work to Phase 3; one constrains the module format; one adds Phase 8.

**A. Provider streaming is already server-side.** The PRD's §12 top risk — *"provider streaming must move server-side — the largest single piece"* — is largely already done. `server/generations/upstream.js` (`pumpUpstream`) owns the upstream SSE connection; `server/generations/store.js` owns subscriber fan-out, `cancel`, `markComplete`/`markError`, and fallback roles. The renderer's `src/providers/fetch-chat.ts` is a thin client that POSTs `/api/generations` and replays bytes back through a synthetic `Response`. A server-side runner calls that store **in-process** — no HTTP hop, no new provider plumbing. Phase 2's real work is the *turn loop*, not the transport.

**B. A zero-UI headless turn loop already exists.** The extract target was `src/agents/sub-agent-runner.ts` (1,375 lines at planning time, *"isolated sub-agent completion + tool loop, no parent chat history"*) — **no `../ui/` imports and no `document.` / `window.` references** across its 46 import sources. It already handled SSE parsing, constrained tool calls, XML tool calls, inline/Harmony thinking routing, context-budget policy, vision gating, and structured outcomes. This — not `src/tools/loop.ts` (3,773 lines, heavily UI-coupled) — was the port target. Its one real coupling was `src/state/sessions.ts` (2,206 lines, 10 browser-global hits), broken behind an injected transcript store in P2-A. **P8-G deleted that `.ts`.** The loop is hand-maintained `server/runner/sub-agent-runner.js`. The renderer seam is `src/agents/renderer-runner-deps.ts`.

**C. There was no rebase operation.** `server/worktree/worktree-ops.js` had `ensureIntegration`, `createWorktree`, `mergeIntoIntegration`, `checkMerged`, `abortMerge`, `restoreIntegration`, `verifyIntegrationMerge` — but nothing that rebased. §5.6's *"rebase before merge"* is P3-B (`rebaseOntoIntegration`, MIN-706 — done).

**D. The shared core must be `.js` + `.d.ts`, not `.ts`.** The server ships and runs as raw JavaScript (`npm start` → `node server.js`; no transpile step covers `server/**`). The existing TS bridge, `server/orchestrate/board-testing/ts-import.js`, lazily registers `tsx` and is explicitly dev-only — it cannot work in a packaged app. The repo already has the right pattern: `server/tools/output-cap.js` + `output-cap.d.ts`, imported from the renderer by `src/ui/terminal-panel.ts`. The V2 core follows it.

**E. The sub-agent controller is V1’s disease in miniature.** `src/agents/controller/` (3,089 lines) reproduces every fault the PRD diagnoses in V1: a mutable `SubAgentRun` struct; a **last-write-wins mirror** of it to disk (`persistence.ts` — *“coalesced registry mirror queue”*) instead of an append-only log; a watchdog inferring liveness from heartbeat and progress ages; boot reconciliation that marks in-flight runs `failed` / `interrupted` (`controller.ts:1357`); and counters — `attempt`, `progressSeq`, `tier1Attempted`, `handlingSuspect` — mutated from several places. It carries three faults the boards never had: a wall-clock `setTimeout` that cancels a *healthy* run at 5 minutes (`defaultTimeoutMs` in `src/agents/defaults/sub-agents.json`); a finalization that settles a run `failed` when the model’s closing JSON does not parse, unless it both produced prose and called a tool (originally `src/agents/sub-agent-runner.ts:1318`; **P8-A landed** the ungated prose fallback in `server/runner/sub-agent-runner.js` — `returnProseFallbackOutcome`, no `toolTurns > 0` gate); and `enqueueToolApproval` with no abort signal, so a cancelled run still executes its tool once the modal is answered. **P8-A** also moved non-ok HTTP retry into `server/runner/transient-fetch-retry.js` (wrap at `streamSubAgentTurn`, originally the `.ts` `:337` path). PRD §10 lists none of it for deletion. V2 solves this exact problem and then does not apply the solution to its closest neighbour — hence Phase 8.

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
| `src/state/orchestrate-*.ts`, `src/state/board-*.ts` (~9.9k) | V1 engine | DELETE (Phase 4) |
| `src/chat/orchestrate/*.ts` (~3.3k) | V1 lifecycle repair + planner-chat glue | DELETE (Phase 4) |
| `src/tools/board-tools.ts` (1,107) | `board_init` / `board_update_task` / `board_set_autonomy` / `delegate_tasks` | DELETE (Phase 4) |
| `server/session/engine-bundle/` (18.04 MB on disk) | Orphan from the reverted MIN-354 v1 | DELETED (P4-E / MIN-717) |
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

- [x] `server/orchestrator/worktree-lifecycle.js` allocates via existing `worktree-ops.js` (`ensureIntegration` once per board for the git round-trip, then `createWorktree`). Later allocates still re-run `ensureDependencyDirs` on integration; `createWorktree` falls back to the main workspace if that source is a dangling/looping link (see `plans/worktree-dep-source-stall.md`).
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

**Status:** **done** (orchestrated from worktree `orchestrator-v2-7e3b9c1a` on `Orchestrator-V2` @ `c0ce41f7`; all six sub-issues verify PASS)

| Todo | Issue | Depends on | Status |
|------|-------|------------|--------|
| P4-A Delete the V1 engine | [MIN-713](https://linear.app/minnowai/issue/MIN-713) | P3-E, P1-E (done) | **done** (verify PASS; −10,262 lines in `src/state/`; V1 UI gone) |
| P4-B Delete the renderer lifecycle-repair subsystem | [MIN-714](https://linear.app/minnowai/issue/MIN-714) | P1-G, P4-A | **done** (verify PASS; keepers in `src/chat/plans/` + `src/orchestrator/task-category-badge.ts`; `src/chat/orchestrate/` removed in P4-C) |
| P4-C Delete orchestrator agent, planner chat, board tools | [MIN-715](https://linear.app/minnowai/issue/MIN-715) | P4-A | **done** (verify PASS; 7 V1 board tools gone; catalog 113/8/105; Orchestrate opens Boards, no chat) |
| P4-F Collapse autonomy to Running/Stopped + N | [MIN-718](https://linear.app/minnowai/issue/MIN-718) | P3-E, P4-A | **done** (verify PASS; six flags gone from live types/UI/settings; leftover hydrate + Autopilot fold onto `status` + N) |
| P4-D Retire V1 tests, port real behaviour | [MIN-716](https://linear.app/minnowai/issue/MIN-716) | P4-A, P4-B, P4-C | **done** (verify PASS; `test/orchestrate/` gone; keepers in V2 journal tests; only `board:scenario-contract` remains and runs) |
| P4-E Delete orphaned `engine-bundle/` | [MIN-717](https://linear.app/minnowai/issue/MIN-717) | nothing | **done** (verify PASS; `server/session/` gone; −18.04 MB on disk; `package:dir` PASS; asar has no `engine-bundle`) |

**Ordering:** P4-A first (unblocks B/C/F). P4-B before leftover autonomy sweep in P4-F. P4-D last among the deletion tasks so tests are rewritten against the surviving surface. P4-E is independent and can land any time.

### Phase 5 — Browser driver
*Proves: fully unattended verification.*

**MIN-682** · MIN-719 P5-A Server-side browser driver · MIN-720 P5-B Driver tool surface · MIN-721 P5-C Browser step in the Final Tester ladder · MIN-722 P5-D Unattended overnight run proof

#### Phase 5 status

**P5-A is built.** The reusability assessment MIN-719 required is
[`orchestrator-v2-browser-driver-assessment.md`](./orchestrator-v2-browser-driver-assessment.md);
it is the file to read before touching `server/browser-driver/`. Three things
worth carrying forward:

- **No new dependency was taken.** `ws` is already a runtime dependency and a
  working CDP client already existed in this repo's history (`86cc513f^:server/cdp/client.js`,
  dropped when browser tools moved to the Electron preview). Playwright was
  rejected on packaging grounds, `puppeteer-core` because it does not solve
  browser *discovery* — which has to be written either way. The driver finds an
  installed Chrome/Edge/Brave/Chromium; it never ships one.
- **`server/cdp/` was never a CDP client.** What lives there today is allowlist,
  settings, and screenshot paths — all reused untouched. Everything in
  `src/tools/browser-*.ts` is renderer-side and Electron-IPC-bound; none of it
  was ported, and the interactive browser panel still uses it.
- **The a11y snapshot had a tree-killing bug** in the code that was restored:
  an `ignored` unnamed node returned `null`, and Chromium's `<html>` wrapper is
  exactly that, so every snapshot came back as a lone `RootWebArea`. Ignored
  nodes now hoist their children. There is a regression test.

P5-B should wrap `server/browser-driver/index.js` as tools rather than reaching
into the modules under it. Interaction (click/fill against snapshot uids) was
deliberately left to P5-B, which owns the tool shape.

**P5-B is built.** Eight tools, `browser_drive_{navigate,read_page,click,type,
read_console,read_network,screenshot,resize}`, live in
`server/tools/browser-driver-tools.js` and are registered in
`SERVER_TOOL_HANDLERS` like any other server tool, so they arrive through P2-D's
dispatch with its guards intact. Four things P5-C needs to know:

- **The gate is `headlessToolIdsForRole()`** in `server/runner/tool-set.js`.
  Only role `final` gets `FINAL_TESTER_TOOL_IDS`; every other role gets
  `DEFAULT_HEADLESS_TOOL_IDS`, which contains no browser tool. Ask that function
  rather than assembling a list — it is the one place the rule lives.
- **The names are `browser_drive_*`, not `browser_*`.** The renderer's
  `browser_navigate` / `browser_click` are Electron-bound and listed in
  `RENDERER_ONLY_TOOL_IDS`; reusing those names would make a headless list look
  renderer-poisoned. The two sets are asserted disjoint.
- **Degradation is a string prefix, not an exception.**
  `BROWSER_UNAVAILABLE_PREFIX` (no Chromium, or `browser.enabled = false`) and
  `BROWSER_BLOCKED_PREFIX` (allowlist) are exported for the rung to match on.
  A machine with no browser must skip the rung, never fail the run.
- **Reads are deterministic by construction, and tested as such.** Console
  timestamps, CDP request ids, and response timings are dropped; network rows
  are sorted by (url, method, status). `browser_drive_screenshot` is evidence
  for a human and nothing asserts on it. Session lifetime is one browser per
  attempt root; call `closeBrowserToolSession()` when the rung ends.

Not done here, and left to P5-C: the ladder rung itself, and any mention of the
browser in `prompts/final/agent.full.md`.

**P5-C is built.** `server/orchestrator/browser-rung.js` is the fifth rung, and
`runFinalLadder` reaches it only after typecheck, lint, unit and build are all
green — the gate is asserted by process count, not by comment. What P5-D needs
to know:

- **Assertions are compiled from the plan, never invented.** Each task's
  `Accept:` sentence and each non-command `## Verification Checklist` bullet
  goes through `compileAcceptCriterion()`, whose vocabulary is small and closed:
  quoted visible text, absent text, document title, HTTP status, clean console.
  A criterion it cannot read — "the helper rounds half to even" — is reported in
  `notObservable` and asserts nothing. A guessed assertion that passes is worse
  than no assertion, so nothing is guessed.
- **`blocked` is a third outcome and it is load-bearing.** No browser, a driver
  crash, a dev server that will not start, an occupied pinned port, or a plan
  with nothing browser-observable all mean *the check could not run*. Those
  journal as `evidence.browser.status = 'blocked'` with a `reason`, leave the
  run's outcome at the static ladder's, and deliberately do **not** add
  `browser` to `evidence.ran`. Only an assertion that executed and did not hold
  is `fail`.
- **The rung waits for its own port.** `stopDevServerById` kills the process
  tree and returns without waiting for the socket to close, so on a pinned port
  a stop races the next start: the new child fails to bind, the health probe is
  answered by the *dying* predecessor, and the browser meets a connection error
  partway through. This cost exactly one wrong verdict in the first ten-run
  measurement. `waitForPortFree()` closes it, on both the start and the stop
  side; the tell-tale signature, if it ever returns, is a positive text
  assertion failing while an absence assertion on the same page passes.
- **Ten consecutive runs give one verdict**, measured against real Chrome and a
  real dev server, not asserted. That is the flakiness bar P5-D inherits.
- Screenshots are captured as evidence for the human report and nothing asserts
  on them. `runInstructions` gains `url:` and numbered `steps:` for the browser
  rung; `command:` and `cwd:` keep their P3-F meaning so every existing reader
  still works.
- The Final Tester *agent* is told not to drive the browser itself. It shares
  the `final` role, so it has the tools; the rung is mechanical and owns them.

**P5-D is built, and the runs are outstanding.** This is the one task in Phase 5
whose acceptance cannot be reached by writing code: it is three multi-hour runs
on a real machine with a real provider, one of them allowed to sleep. The
procedure, and the honest statement of what is and is not done, is
`documentation/plans/orchestrator-v2-p5d-overnight-proof.md`.

Built and tested:

- **The plan**, `test/fixtures/orchestrator-v2-p5d/plan.md` — 18 tasks, 5 waves,
  10 files touched by more than one task, so the merge queue contends instead of
  fast-forwarding. It is the *subject* of the run, not its implementation.
- **Token accounting**, which did not exist. `TurnResult` now carries `usage`,
  and `task.attempt.ended` carries it onto the journal. The collection point is
  an `onUsage` callback on the inner runner rather than its return value,
  because a successful attempt ends when `report_outcome` throws to unwind the
  loop — the return is the path taken *least*. Without this, "what did the run
  cost" had no answer, and the Co-Coder trade of +60% cost for +3.2% correctness
  could not be checked.
- **`server/orchestrator/p5d-instrument.js`** — journal size, fold duration,
  attempt distribution (tail, not mean), token cost (including the tokens spent
  on attempts that produced nothing), orphan census, and the report count. All
  derived from the journal, so an induced server kill does not take the first
  two hours of measurement with it.
- **`scripts/p5d-overnight.mjs`** — the harness: runs the board, samples it,
  induces the scheduled failures (`--induce kill-server@2h`), compares against
  the P2-G and P3-E baselines, and writes the record and the human report.

Two defects were found by writing a realistic plan and running the criterion
rather than asserting it, both fixed here:

- **The browser rung fabricated assertions on non-UI plans.** A quoted
  identifier — `the barrel exports "journalSize"` — compiled into "the page at
  `/` shows this string". Eight false assertions on the 18-task plan, every one
  of which would have failed against a working app. `compileAcceptCriterion`
  now requires an anchor: a route, or a UI noun. A plan with no UI reports
  `blocked` / `no-observable-criteria` and asserts nothing.
- **The 20-cycle orphan check** allowed a fixed second for Windows to reap
  process trees — enough idle, not enough under suite load. It polls now.

### Phase 6 — Normal chat adopts the runner
*Proves: one engine for all chat. Scheduled after Phase 5 (Linear: Done 2026-08-31).*

**MIN-683** · MIN-723 P6-A Non-board `runTurn()` spike · MIN-724 P6-B `ask_question` as an injected capability · MIN-725 P6-C Strangle the client loop · MIN-726 P6-D Delete the client loop

#### Phase 6 status

**Phase 6 complete in this worktree** (2026-08-31). All four sub-issues verify PASS. Chat send is a caller around `runTurn()`; `src/tools/loop.ts` is deleted. Dual-path flag is gone.

Orchestration was from worktree `Orchestrator-V2-7b4e9c2a` on detached `HEAD` `901726b7` (Phases 0–5 and 9 Done in Linear). Not committed. Not pushed.

**Known findings (do not re-discover):** `parseReport`, `systemPrompt`, `AskCapability` / `askTimeoutMs`, `seedKind: 'continue'` / `messages`, `injectReportTool`, `nudgeToolUse` / `finalizeStructuredOutcome`, `TurnEvent.tool_streaming`, resume as a `postChatCompletions` wrap (not a `runTurn` option), SSE `\n\n` framing on `subscribeToGenerationRaw`. Boards still inject `report_outcome` and pass `ask: null`. No `isBoard` in `server/runner/`.

**Phase 8 is filed** as [MIN-753](https://linear.app/minnowai/issue/MIN-753) (`MIN-754`–`MIN-761`). The sub-agent controller is **kept** until P8-G. Orchestration started 2026-08-31 from worktree `Orchestrator-V2-a7f3c291` on detached `HEAD` `6cd75c0a` (Phases 0–7 and 9 Done in Linear).

**Open sibling:** MIN-752 (workspace switch leak) is In Progress on this branch; not folded into Phase 6.

**Open sibling:** MIN-752 (workspace switch leak) is In Progress on this branch. Do not fold it into Phase 6.

| Todo | Issue | Depends on | Status |
| ---- | ----- | ---------- | ------ |
| P6-A Non-board `runTurn()` spike | [MIN-723](https://linear.app/minnowai/issue/MIN-723) | P5-D (done) | **done** (verify PASS 2026-08-31; Electron flag-on QA still remaining in this worktree) |
| P6-B `ask_question` as an injected capability | [MIN-724](https://linear.app/minnowai/issue/MIN-724) | P6-A | **done** (verify PASS 2026-08-31; 53 tests) |
| P6-C Strangle the client loop | [MIN-725](https://linear.app/minnowai/issue/MIN-725) | P6-A, P6-B | **done** (verify PASS 2026-08-31; 97 scoped tests) |
| P6-D Delete the client loop | [MIN-726](https://linear.app/minnowai/issue/MIN-726) | P6-C | **done** (verify PASS 2026-08-31; tsc + 82 handoff tests + build) |

#### P6-A (MIN-723) — done

- [x] One simple non-board chat (user message, model reply, 1–2 tool calls, no attachments, no steering) routes through `runTurn()` behind an **off-by-default** flag (`MINNOW_DEBUG` + `localStorage['minnow.p6a.runTurnChat']`)
- [x] Renderer session store passed as `TranscriptStore` (P2-A seam extracted to `src/agents/session-transcript-store.ts`; chat wraps it with an isolated buffer — see gap list)
- [x] `onEvent` drives the **existing** chat DOM (streaming / thinking / tool rows) via `src/chat/run-turn-chat-paint.ts`
- [x] Classified gap list at [`orchestrator-v2-p6a-gap-list.md`](./orchestrator-v2-p6a-gap-list.md) — each gap is *belongs in the runner* / *belongs in the caller* / *needs an interface change*
- [x] **No `runTurn` / `TurnEvent` / `TurnResult` signature change.** Interface findings for P6-C: optional report-tool injection; `seed` as history continuation; skip inner sub-agent nudge/finalization; `execute` attachments; transcript suffix vs replace
- [x] Tests: simple turn through `runTurn()`; default path still uses `runChatTurn`; flag on asserts `runTurn` is invoked

**Todos**

- [x] Extract shared `createSessionTranscriptStore` + renderer `RunnerDeps`
- [x] Flag + simple-shape gate in `runChatTurn`
- [x] Adapter maps `onEvent` onto existing DOM helpers without forking a painter
- [x] Gap list complete enough to scope P6-C
- [x] Record findings; do not quietly patch the runner
- [x] Verify PASS (tsc + 43 scoped tests). Live Code-chat with the flag on was not run against this worktree (main checkout holds port 9473).

#### P6-B (MIN-724) — done

- [x] `AskCapability` `{ ask(question) -> Promise<Answer> } | null` on `runTurn()` options (record as the PRD §9 Phase 6 finding)
- [x] Capability present → `ask_question` in the resolved tool list and routed to the handler
- [x] Capability `null` → tool **absent** from the resolved list (injection, not `if (isBoard)`)
- [x] Board / headless effector injects `null`; fabricated `ask_question` call is an immediate tool error, not a hang
- [x] Chat spike (P6-A flag path) injects a handler backed by `src/tools/ask-question-queue.ts`
- [x] Unanswered interactive question times out; the turn resolves
- [x] Audit: approval queue / destructive confirm — document out of scope ([`orchestrator-v2-p6b-human-tools.md`](./orchestrator-v2-p6b-human-tools.md))
- [x] Tests covering the MIN-724 bullets; grep runner for no board-vs-chat branch
- [x] Verify PASS (tsc + 53 scoped tests). Approval-queue hangs remain documented out of scope.

#### P6-C (MIN-725) — done

Scope from [`orchestrator-v2-p6a-gap-list.md`](./orchestrator-v2-p6a-gap-list.md), not from Linear's "every mode including Super Plan" sentence. Super Plan, resume/fork, and replacing the sub-agent controller stay on `runChatTurn` / Phase 8.

- [x] Interface finding 1: continue from prior transcript (`messages[]` / `seedKind: 'continue'`) — not an isolated `[system, seed]` every turn
- [x] Interface finding 2: optional report-tool injection (`reportToolName: null` / `injectReportTool: false`); boards still inject `report_outcome`; **no** product-shaped branch in `server/runner/`
- [x] Interface finding 4: chat can disable inner sub-agent tool-use nudge + structured-outcome finalization
- [x] Chat caller: compose `systemPrompt` + mode tool catalog; `AskCapability` from P6-B; interactive `executeTool`
- [x] Eligible shapes (flag still forceable both ways, default **off**): General/Build/Debug/Plan text+tools; queue, goal, `/loop`, steer-as-abort+follow-up as **overlays** around `runTurn`. Attachments and exclusive skill compose stay on `loop.ts` (listed leftovers).
- [x] Stream-end order on the `runTurn` path: `setStreaming(false)` **before** `notifyChatStreamEnded`
- [x] `src/tools/loop.ts` kept; excluded shapes still use it; leftover exclusive behavior listed for P6-D in the gap list
- [x] Board `runTurn` callers unchanged in behaviour (report tool, `ask: null`, nudge/finalization as today)

**Todos**

- [x] Runner interface 1 + 2 + 4 with unit tests; board default proven
- [x] Chat adapter: real history, no report tool, no nudge/finalization, mode catalog, composed system prompt
- [x] Stream-end order test
- [x] Gap list + this plan + `documentation/context.md` + `server/runner/README.md`
- [x] Verify PASS (tsc + 97 scoped tests). Live Electron on port 9473 is the main checkout — not used.

#### P6-D (MIN-726) — done

One turn loop for chat. Leftover exclusive `loop.ts` behaviour is a **caller overlay** around `runTurn()`, then the second implementation is deleted.

- [x] Every previous exclusive shape is a caller overlay (or a moved helper), not a second stream/tool loop: Super Plan, resume/fork, attachments/VLM, skill compose, `suppressUserEcho`, queue/goal/`/loop`, steer
- [x] Delete `src/tools/loop.ts` as the turn loop. Keepers (`buildApiMessages`, `buildHistoryUserContent`, `sendMessageWithTools`, …) live in `src/chat/build-api-messages.ts` / `src/chat/run-turn-chat.ts` / `src/chat/messaging.ts`. `grep` for `tools/loop` under `src/` returns nothing
- [x] Delete the P6-A/P6-C dual-path flag — one path
- [x] Satellites verified: keep `chat-tool-batch.ts`, `turn-continuation.ts` (re-export of server), `tool-wrap-dom.ts`, `stream-chat-dom.ts`, `streaming-state.ts` (other callers). Keep `src/api/board-testing.ts` (V2 Settings → Board testing)
- [x] **Keep** `src/agents/controller/` and the renderer `sub-agent-runner.ts` adapter — Phase 8 (this was the P6-D decision). **P8-G deleted both.** The loop is `server/runner/sub-agent-runner.js`; the renderer seam is `src/agents/renderer-runner-deps.ts`
- [x] Resume uses HTTP `/api/generations` re-subscribe inside wrapped `postChatCompletions` (first call only; later tool rounds POST). No `runTurn` resume option. No `isBoard`
- [x] Forward inner `onToolCallDelta` / `onLiveActivity.currentToolName` as `TurnEvent.tool_streaming` so chat can paint "Calling {tool}…" without a second SSE parser (Phase 6 finding: the wrapper was dropping a name the inner loop already had)
- [x] Update `documentation/context.md`; AGENTS.md / DESIGN.md / user manual did not describe a client turn loop as the engine
- [x] Tests: adapter / flag-removed / stream-end / resume / build-api-messages; `npx tsc --noEmit`
- [x] Verify PASS (tsc + 82 handoff tests + package-guard + effector `ask: null` + `npm run build`). `package:dir` skipped. Live Electron on port 9473 is the main checkout — not used.

**Phase 6 finding (resume):** boot resume is a caller wrap of `postChatCompletions({ resumeGenerationId })`, not a `runTurn` option. Later tool-loop rounds still POST a new generation (MIN-187).

**Phase 6 finding (tool name while args stream):** `runTurn` now forwards inner `onLiveActivity.currentToolName` as `{ type: 'tool_streaming', name }`. Chat's painter maps that onto `attachToolStartIndicator` (including remount). This is not a second stream parser — the inner loop already had `onToolCallDelta`. Boards that omit `onEvent` are unchanged.

**Phase 6 finding (SSE framing through `/api/generations`):** `subscribeToGenerationRaw` must forward each upstream block with a trailing `\n\n`. A single newline left `feedSseEventBuffer` unparsed until the generation ended, so mid-stream `tool_streaming` never fired.

**Phase 6 findings (chat parity):** P10-B / P10-C / P10-I changed `runTurn` / `TurnEvent` / `TurnResult`. The canonical list — every new event member, `onMessagesChange` meta, `onRoundBoundary`, and why each is a neutral fact rather than a product branch — lives under **Phase 10** below. Caller overlays (decorating store, Stop/fail partials, metrics, tool-row chrome) are recorded there too; they are not runner signature changes.

### Phase 7 — Chat-stream UI stays responsive mid-generation
*Proves: typing, scrolling, and clicking stay live while a chat streams, without giving back local tok/s. Can start now.*

**MIN-727** · MIN-728 P7-A Measure stream long tasks · MIN-729 P7-B Coalesce painter `onEvent` onto one paint · MIN-730 P7-C Cheap thinking stats + ticked-motion rescan · MIN-731 P7-D `STEP_HZ` hygiene and accept

Full research plan: [`chat-stream-ui-lag.md`](../archive/chat-stream-ui-lag.md). Phases 1 and 6 do not fix this: upstream SSE is already server-side; the freeze is token→DOM on the renderer. P6-A batched `TurnEvent` grain to cumulative snapshots (~80 ms `delta`); it did **not** coalesce renderer paints.

**P7-A PASS (static, 2026-08-31).** `loop.ts` is gone. Insertion point is `src/chat/run-turn-chat-paint.ts` (`createChatTurnEventPainter.onEvent`). At measure time `acquireTickedMotion` had no production caller — P7-C re-wired it. Live Chromium profiles were deferred and remain **manual QA** (see P7-D).

**P7-B PASS.** Delta/thinking presentation coalesces onto one rAF in `createChatTurnEventPainter` (latest snapshot wins; thinking prefix-diffs against last painted). `scrollChatIfPinned` once per tick; live `appendReasoningDelta` does not scroll. `tool_call` / `tool_result` / `tool_streaming` stay immediate. `subscribeToGeneration` / `Raw` yield every 8 SSE blocks in one `read()`.

**P7-C PASS.** `runChatTurn` calls `acquireTickedMotion` for local providers only (released in `finally`). Mid-turn discovery is MutationObserver on `<html>` + capture-phase `animationstart` — no 250 ms `getAnimations()` timer. Live stats schedule from the painter snapshot (thinking **length**, not `getJoinedDisplayText()`). Exhaustive document parking kept (no chat-chrome-only narrowing without a tok/s measurement).

**P7-D PASS (automated, 2026-08-31).** `STEP_HZ` remains 20; comments/JSDoc in `motion-ticker.ts` (`acquireTickedMotion`) and `provider-host.ts` (`isLocalProvider`) match. Historical “8 Hz was cheap but visibly choppy” rationale kept. `npx tsc --noEmit` + ticker + markdown incremental + P7-B/C tests. Live Chromium / tok/s / mid-stream typing on cloud+local is **manual QA** — the worktree cannot steal port 9473 from the main-checkout Electron. Human: Code + Chat app, collapsed thinking, long reply with a fenced code block, cloud and local, `MINNOW_DEBUG=1` `[minnow:longtask]`.

### Phase 8 — Sub-agents adopt the runner
*Proves: the journal + reconcile that fixed boards fixes every background agent. Blocked only on Phase 2, which is done — this can start now, and should land before Phase 6.*

**[MIN-753](https://linear.app/minnowai/issue/MIN-753)** · [MIN-754](https://linear.app/minnowai/issue/MIN-754) P8-A Stabilize the client loop · [MIN-755](https://linear.app/minnowai/issue/MIN-755) P8-B Engine + journal over an injected graph shape · [MIN-756](https://linear.app/minnowai/issue/MIN-756) P8-C Sub-agent graph — events, fold, `plan`, policy · [MIN-757](https://linear.app/minnowai/issue/MIN-757) P8-D Sub-agent effector over `runTurn()` · [MIN-758](https://linear.app/minnowai/issue/MIN-758) P8-E Parent delivery becomes a fold · [MIN-759](https://linear.app/minnowai/issue/MIN-759) P8-F Renderer as view · [MIN-760](https://linear.app/minnowai/issue/MIN-760) P8-G Delete the controller · [MIN-761](https://linear.app/minnowai/issue/MIN-761) P8-H E2E + reliability proof

#### Phase 8 status

Orchestration started 2026-08-31. Worktree: `C:\Users\dukky\.cursor\worktrees\Orchestrator-V2-a7f3c291` on detached `HEAD` `6cd75c0a`. **Phase 8 complete** (all eight sub-issues verify PASS 2026-08-31). Not committed. Not pushed.

| Todo | Issue | Depends on | Status |
| ---- | ----- | ---------- | ------ |
| P8-A Stabilize the client loop | [MIN-754](https://linear.app/minnowai/issue/MIN-754) | — | **done** (verify PASS 2026-08-31) |
| P8-B Engine + journal over an injected graph | [MIN-755](https://linear.app/minnowai/issue/MIN-755) | — | **done** (verify PASS 2026-08-31) |
| P8-C Sub-agent graph | [MIN-756](https://linear.app/minnowai/issue/MIN-756) | P8-B | **done** (verify PASS 2026-08-31) |
| P8-D Sub-agent effector | [MIN-757](https://linear.app/minnowai/issue/MIN-757) | P8-C | **done** (verify PASS 2026-08-31) |
| P8-E Parent delivery as a fold | [MIN-758](https://linear.app/minnowai/issue/MIN-758) | P8-C | **done** (verify PASS 2026-08-31) |
| P8-F Renderer as view | [MIN-759](https://linear.app/minnowai/issue/MIN-759) | P8-D, P8-E | **done** (verify PASS 2026-08-31) |
| P8-G Delete the controller | [MIN-760](https://linear.app/minnowai/issue/MIN-760) | P8-F | **done** (verify PASS 2026-08-31) |
| P8-H E2E + reliability | [MIN-761](https://linear.app/minnowai/issue/MIN-761) | P8-G | **done** (verify PASS 2026-08-31) |

- **P8-A — Stabilize the client loop (interim, ships to `main`).** Blocked on nothing; superseded by P8-G except the last item, which normal chat needs too. The loop fixes landed in `server/runner/sub-agent-runner.js` (the `.ts` was already the extract source, then P8-G deleted it). Do not re-apply them against a resurrected `src/agents/sub-agent-runner.ts`.
  - [x] Reset the dispatch timeout on progress instead of firing on wall-clock (`armRunTimers`, `src/agents/controller/registry.ts` — deleted with the controller in P8-G). Check-in nudge stays one-shot (`run.nudged`).
  - [x] Drop the `toolTurns > 0` condition on the prose fallback (`server/runner/sub-agent-runner.js` `returnProseFallbackOutcome`, originally `.ts:1318`) so a JSON parse failure with real prose completes degraded instead of `failed`.
  - [x] Retry non-ok HTTP with backoff (`server/runner/transient-fetch-retry.js`, wrap at `streamSubAgentTurn`; originally `.ts:337`) and return the partial transcript on terminal failure.
  - [x] Give `enqueueToolApproval` an `AbortSignal` (`src/tools/approval-queue.ts`) so a cancelled run cannot execute its tool when the modal is answered minutes later.

- **P8-B — Engine + journal over an injected graph shape.** `engine.js` statically imports `plan` from `core/plan.js` and `foldInto` from `core/derive.js`; `journal.js` is pathed on `boardDir(boardId)`. Both take `{ fold, plan }` and a journal namespace as arguments instead. Pure refactor — `BoardState` is untouched and the Phase 1 conformance suite is the regression test.
  - [x] `createEngine` graph injection; `engine.js` has no static import from `core/plan.js` or `core/derive.js`
  - [x] Journal namespace (`entryDir`); boards thin binding keeps `boardDir` / `journalPath` / `loadState` and `~/.minnow/boards/<id>/journal.jsonl`
  - [x] `live-events.js` opaque subscribe key (`key ?? boardId`); payload `boardId` stays for the board SSE contract
  - [x] Engine registry keyed on `(namespace, id)`; default namespace `'boards'` so `peekEngine(boardId)` still works
  - [x] Throwaway two-event fake graph ticks through the same `createEngine` (`test/orchestrator/p8b-injected-graph.test.mjs`)
  - [x] `.d.ts` files move with their modules

- **P8-C — Sub-agent graph: events, fold, `plan`, policy.** Runs are independent: no `dependsOn`, no waves, no `touches`, no merge queue. Seven events (`run.requested`, `attempt.started`, `attempt.ended`, `run.abandoned`, `run.cancelled`, `result.delivered`, `run.nudged` — the last added in P8-E), one journal per parent chat at `~/.minnow/agents/<parentChatId>/journal.jsonl`. `plan()` is three rules: a non-terminal run with nothing in flight should be running, respect the concurrency cap, never two attempts on one run. The policy table takes the outcomes that kill runs today — `crashed | timeout | no_report` retry with a continue seed; `fail` past the cap abandons with evidence.
  - [x] `server/sub-agents/*.js` + `*.d.ts` — events, fold, `plan`, policy, evidence, Graph object. Envelope matches P0-B (`v`, seq, ts, unknown types tolerated); payload union is new and is **not** in board `EVENT_SCHEMAS`. Product type is `agentType` on `run.requested` because envelope `type` is the discriminant.
  - [x] Fold is a pure function of the event list — replay twice is byte-identical (`serializeState`). Attempt counts are a journal filter; no retry counter field.
  - [x] `plan(state, caps)` — two caps as arguments (global default 3, per-type default 2). Core never reads `sub-agents.json`. Caps gate **starting**, not continuing; lowering mid-run does not kill in-flight work.
  - [x] Worker role is `'sub-agent'` (`isAgentRole`); type names live on the run record. `eventsForStart` / `eventsForAttemptEnd` map to `attempt.started` / `attempt.ended`. Board-only hooks omitted.
  - [x] Policy table is data (`POLICY_TABLE`), not a chain of ifs. `decide()` is last-attempt-only; the caller attaches the evidence bundle (full attempt list, never truncated; last transcript tail).
  - [x] `result.delivered` is declared and folded so pending vs delivered is derivable. P8-E owns the write.
  - [x] Purity guard `test/sub-agents/core-purity.test.mjs` — zero `node:fs` / `node:path` / `server/runner/`, no `Date.now` / `Math.random` / `fetch`.
  - [x] Conformance `test/sub-agents/conformance.test.mjs` — generated spawn/cancel/end + cap moves, start-gate invariant after every `plan()`; fetch trap; `createEngine` + memory journal smoke.

- **P8-D — Sub-agent effector over `runTurn()`.** Same shape as `effector-runner.js`. `sub-agents.json` stops being read by a client controller and becomes effector arguments: the per-type allow-list is `tools`, `summarySchema` is `parseReport`, the type prompt is `systemPrompt`, and `cwd` is finally passed — closing the gap where a sub-agent was never told which workspace it was in. `limits.wallClockMs` replaces the `setTimeout` kill, so a timeout is a typed exit routed through the policy table rather than a cancel that discards the work.

#### P8-D (MIN-757) — in progress (implementer)

- [x] `server/sub-agents/effector-runner.js` + `.d.ts` — `inspect` / `start` / `stop` / `onEnd`; `start()` resolves as soon as the attempt is in the live map
- [x] Inspect-until-onEnd-resolved contract
- [x] Map `sub-agents.json` onto `runTurn()` (tools once per type, `parseReport`, `systemPrompt`, `limits.wallClockMs`, context-budget deps, sampler/thinking)
- [x] `cwd` required from `run.requested` (spawning workspace; no worktree; no silent default)
- [x] Wall clock via `attempt-limits.js`; timeout is a typed exit, retryable with continue seed + transcript
- [x] `headlessToolIdsForRole('sub-agent')` then per-type allow/deny; no `browser_drive_*`; spawn tools denied
- [x] `ask: null` (MIN-724 on a background surface); no `isBoard` / `isSubAgent` in `server/runner/`; documented in `server/runner/README.md`
- [x] Model binding server-side; live `onEvent` on opaque-keyed live channel; tokens never journaled
- [x] Uncaught throw → `crashed`; `inspect()` empty at boot; `cancelOrphanedSubAgentGenerations` does not steal board `r-` ids
- [x] `TurnResult.usage` on `attempt.ended`
- [x] Engine wiring via `createEngine` / `getEngine(..., { namespace: 'agents', graph })` — **`engine.js` unmodified**
- [x] Server config `config.js` (shipped JSON + `~/.minnow/sub-agents.json`); journal thin binding `journal.js`
- [x] Tests in `test/sub-agents/effector-runner.test.mjs` against the fake model host
- [x] No `runTurn` signature change (Phase 6 finding: none)

- **P8-E — Parent delivery becomes a fold.** `sub-agent-completion-push.ts` held `pendingCompletionByChat`, `deliveredRunIds`, and `nudgedRunIds` in renderer memory, so a reload lost the delivery queue MIN-639 built to never drop a result. Delivery is now `result.delivered` / `run.nudged` in the journal: MIN-639's property is kept, and now survives restarts.

#### P8-E (MIN-758) — in progress (implementer)

- [x] Queue lives in the journal fold: pending = terminal without `result.delivered`; delivered = has one; nudged = `run.nudged` (added to the vocabulary + fold)
- [x] `result.delivered` appended AFTER inject resolves, never before (same rule as `attempt.started`)
- [x] Idempotency: `deliverToParent` once per `(runId, parentChatId)` per fold state
- [x] Product behaviour kept: coalesce while parent streams, retry backoff, notify-and-persist when the parent can never accept a resume
- [x] `buildSubAgentParentResumeMessage` copy unchanged
- [x] Skip / undeliverable parent reaches a terminal journal state (`result.delivered` + `skipReason`)
- [x] Server module `server/sub-agents/delivery.js` — injectable `deliverToParent` seam; boot `tickAll` re-offers pending
- [x] Renderer `sub-agent-completion-push.ts` is a thin adapter (Sets removed; fold is the source of truth)
- [x] Purity skip for `delivery.js`; not imported by derive / plan / policy
- [x] Tests in `test/sub-agents/delivery.test.mjs` (journal, not a Set)

- **P8-F — Renderer as view.** `/api/agents/*` REST + SSE mirroring `/api/boards/*`; the sub-agent drawer and run cards render derived state; spawn and cancel are POSTs. Live tokens ride the parallel `event: live` channel from P2-F and are never journaled.

#### P8-F (MIN-759) — done (implementer)

- [x] `server/sub-agents/middleware.js` ROUTES table + MUTATING_ROUTES; wired in `server/runtime/middlewares.js`
- [x] POST spawn preflight (P9-A): unresolvable model is 400 at the spawn site
- [x] SSE journal frames with `seq`; `event: live` / `error` / `deliver` never journaled; Last-Event-ID resume
- [x] `src/agents/orchestrator.ts` SSE-backed store; same read API; spawn/cancel POST
- [x] Drawer/cards/live-status render derived state; start-error is a counter
- [x] Production completion-push uses server journal + SSE `event: deliver` (no `createMemoryJournal` in production); `bootAgentsRuntime()` ticks at boot
- [x] HTTP tests `test/sub-agents/api.test.mjs`; DOM card states; grep gate `renderer-view-purity.test.mjs`
- [x] `documentation/context.md` + this plan

- **P8-G — Delete the controller.** `src/agents/controller/` (3,089 lines — watchdog, heartbeats, timers, registry mirror, boot reconcile) and the client `src/agents/sub-agent-runner.ts` (1,375). `sub-agent-config.ts` stays; it is configuration, and the effector reads it.

#### P8-G (MIN-760) — done (implementer)

- [x] `src/agents/controller/` deleted (controller, persistence, report, watchdog, wrapper, registry, scheduler, types)
- [x] `src/agents/sub-agent-runner.ts` deleted (`server/runner/sub-agent-runner.js` stays)
- [x] Super Plan abort POSTs cancel via `src/agents/orchestrator.ts` (no dynamic import of the controller)
- [x] Dead config removed: `heartbeatIntervalMs`, `heartbeatDeadMs`, `progressStallMs`, `duplicateToolCallThreshold`. Keep `defaultTimeoutMs` / per-type `timeoutMs` as `limits.wallClockMs`
- [x] Settings Watchdog copy describes journal reconcile + Sub-agents wall-clock, not heartbeat/stall
- [x] Registry decision: **leave** existing `~/.minnow/runs/registry/` files. Do not import (no last-write-wins). Journal is the record. PUT/POST return 410; `writeRegistryRecord` is gone
- [x] Controller-only tests retired; spawn/cancel/wait ported to `test/sub-agents/orchestrator-store.test.mts`; runner tests wire `createSubAgentRunner(createRendererRunnerDeps())`
- [x] `grep -rn "lastHeartbeatAt\|tier1Attempted\|progressStallMs" src/` returns nothing
- [x] `documentation/context.md` + this plan

- **P8-H — E2E + reliability proof.** Mirrors P2-G: spawn from a real chat with the UI closed, reload mid-run, restart mid-run, induce `fail` / `blocked` / killed host, record a 10-run reliability file. The gate is that a sub-agent survives what kills one today. Leftover from P8-G: leftover registry files stay on disk until a user deletes them.

#### P8-H (MIN-761) — in progress (implementer)

- [x] HTTP `/api/agents/*` drive, UI closed, **zero renderer** in [`test/sub-agents/p8h-e2e.test.mjs`](../../test/sub-agents/p8h-e2e.test.mjs)
- [x] Reload: GET state mid-run equals `derive(journal)`; run finishes
- [x] Server restart: `vanishAll` (p5d `kill-server` analogue) → `inspect()` empty → tick reaps `crashed` → continue seed → completes
- [x] Killed model host → `crashed` → retry
- [x] `wallClockMs` → typed `timeout` → retry with continue seed (work is not discarded)
- [x] `fail` past the cap → `run.abandoned` with the full evidence bundle
- [x] Cancel while a tool waits on `AbortSignal` → the tool does not execute (P8-A re-asserted)
- [x] Completion while parent is streaming, then reload → `result.delivered`
- [x] Two runs at once exercise `globalMaxConcurrent` and the per-type cap against the live effector
- [x] Ten-run reliability at [`test/sub-agents/p8h-reliability.json`](../../test/sub-agents/p8h-reliability.json) — ceiling stated in-file; live provider recorded separately (skipped when unreachable, never faked)
- [x] No `runTurn` signature change (Phase 6 finding: none)
- [x] `grep lastHeartbeatAt|tier1Attempted|progressStallMs src/` re-asserted empty

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

- **P9-H — Command parity.** The engine exposes `startBoard`, `stopBoard`, `setConcurrency`, `startTask`; the board can therefore be started, stopped, re-paced, and hand-started, and nothing else. V1 could also retry, skip, and abandon a task by hand. **Decision, taken:** a manual override is a journaled command and nothing else — `engine.abandonTask()` appends the same `task.abandoned` the policy table appends, with `reason: 'user'` distinguishing it, and downstream tasks are stranded by the next tick's `pendingSkips` exactly as they would be by an automatic abandonment. There is **no** manual skip: `task.skipped` means *stranded by a dependency*, which is a fact about the graph a person cannot assert, and the fold already treats both as terminal-and-unmerged. Retry is not a new command either — retrying *is* `startTask`, because `nextAction()` reads the journal and picks the seed, so the button only changes its label.

- **P9-I — States, a11y, tests.** Loading skeletons instead of "Loading the board…", a real empty state, the error states P9-A now has something to show, focus management across repaints (the surface calls `replaceChildren` on every frame — anything focused is lost), and DOM tests over the column mapping and the failure frames. `test/ui/orchestrator-boards-create.test.mts` is the pattern.

Ordering note: **before Phase 4.** Phase 4 deletes `orchestrate-board.ts` and its satellites — the kanban column defs, the model chip, the reasoning controls, the finish dashboard, and the `ob-*` shell the twin-shape brief landed. Anything in this phase that ports from V1 has to be ported while V1 still exists. P9-A is not a port and should not wait for the rest of the phase: it is a live bug on the branch today.

### Phase 10 — Chat parity after the runner migration
*Proves: one turn loop can carry the whole product chat surface, not just a board attempt. Blocked on nothing. Merge gate for `Orchestrator-V2`.*

**MIN-765** · [issue](https://linear.app/minnowai/issue/MIN-765/phase-10-chat-parity-after-the-runner-migration)

Phase 6 deleted `src/tools/loop.ts` and routed every product send through `runTurn()`. The replacement caller (`src/chat/run-turn-chat.ts` + `run-turn-chat-paint.ts`) did not rebuild the per-round transcript rows or stream chrome `loop.ts` owned — that was the merge-gate bug this phase closed. Invariants: `loop.ts` stays deleted; the runner does not know what a chat is; `server/runner/sub-agent-runner.js` is hand-maintained source of truth; board callers stay byte-identical; nothing writes `chat.history` without `touchChat`. `scripts/extract-sub-agent-runner.mjs` is deleted (P10-J) — `SRC` pointed at the gone `.ts`.

K–M added 2026-09-01 from live symptoms. A–E close data loss. F–H close visible chrome. I restores in-turn steer and the live context ring. J is docs + the automated parity gate.

**Phase 10 complete except the live Electron gate** (2026-09-01). A–I and K–M verify PASS on this branch. P10-J records the findings, flips the gap list, deletes the dead extractor, and runs the scoped automated gate. The ten-step MIN-765 QA **cannot** pass in this worktree (must not steal port 9473; main checkout is a different tree). Remaining human QA is after `/apply-worktree` — list copied below so it is not lost.

| Todo | Issue | Depends on | Status |
| ---- | ----- | ---------- | ------ |
| P10-A Reproduce and instrument the chat regressions | MIN-766 | — | **done** (findings in orchestrator-v2-p6a-gap-list.md, 2026-09-01) |
| P10-B `TurnEvent` contract: rounds, stream meta, phase, full tool results | MIN-767 | P10-A | **done** |
| P10-C Settled, incremental transcript persistence | MIN-768 | P10-A | **done** |
| P10-D Chat transcript parity: the decorating store | MIN-769 | P10-B, P10-C | **done** |
| P10-E Stopped and failed turns persist their partial | MIN-770 | P10-C, P10-D | **done** |
| P10-F Per-round transcript rows, the thinking timer, and stream phases | MIN-771 | P10-B, P10-D | **done** |
| P10-G Metrics parity: live strip, per-message stats, token ledger | MIN-772 | P10-B, P10-D | **done** |
| P10-H Tool row parity: args, attachments, code change, shell kill, re-strand | MIN-773 | P10-B, P10-D | **done** |
| P10-I In-turn steer and the live context ring | MIN-774 | P10-B, P10-F | **done** |
| P10-J Docs, findings, and the parity gate | MIN-775 | all | **done** (automated half; live Electron remaining) |
| P10-K Sub-agent spawns lose their parent context | MIN-776 | — | **done** |
| P10-L Sub-agent card freezes on "Generating response…" | MIN-777 | P10-B (label half) | **done** |
| P10-M Live frames not filtered per run | MIN-778 | — | **done** |

#### Phase 6 findings (chat parity)

Phase 6's rule: any change to `runTurn({ … })` / `TurnEvent` / `TurnResult` is a recorded finding, not a quiet patch. P10-B, P10-C, and P10-I changed that surface. Each addition is a **neutral fact** the inner loop already computed (or a caller-injected seam with the same shape as `AskCapability`). None of them is an `isChat` / `isBoard` / `isSubAgent` branch in `server/runner/`.

| Addition | Why it is a fact, not a product branch |
| -------- | -------------------------------------- |
| `TurnEvent.phase` (`generating` \| `thinking` \| `tools`) | Forward of inner `onLiveActivity.phase`. The wrapper used to discard it. Mapping onto "Generating response…" is a **caller** job (chat painter P10-F; sub-agent `onLive` P10-L). |
| `TurnEvent.reasoning_end` | Once per round, when the inner loop leaves the reasoning channel (first prose, first tool-call streaming, or end of stream). Chat uses it to `endReasoningPhase`. |
| `TurnEvent.stream_meta` | Throttled (~80 ms) forward of merged `streamMeta` from `handleChunk` (`usage`, `stats`, llama.cpp `runtime`, `model`, `finishReason`). Chat folds it into a `StreamMetaAccumulator` (P10-G). |
| `TurnEvent.round_start` / `round_end` | Per-model-round boundary. `round_end` carries `text`, `reasoning`, `toolCallCount`, `usage`, `stats`, `finishReason`, `t0` / `tFirst` / `tEnd`, and fires **after** the last `tool_result` of that round (including a report-tool throw that unwinds the loop). Chat opens a new assistant row when `toolCallCount > 0` (P10-F). Boards that omit `onEvent` are unchanged. |
| `tool_result` widened (`attachments?`, `codeChange?`, `isError?`) | The execute outcome already had these. Emit moved onto `onToolDone` so parseError and abort fills are not silent. Chat paints them (P10-H); a sink that only reads `content` still works. |
| `onMessagesChange(messages, meta?: { settled: boolean })` | Forced emits after a real `messages.push` are `settled: true`; throttled stream clones (synthetic partial assistant) are `false`. Existing callers that ignore the second argument stay valid. Continue-mode persist suffixes each settled snapshot via a monotonic `persistCursor`; `finally` is an idempotent backstop. Isolated/board persist is unchanged. Sub-agent retries are continue turns against `createMemoryTranscriptStore()` (persist is a no-op). |
| `RunTurnOptions.onRoundBoundary?: () => TranscriptMessage[] \| null` | Same injection shape as `AskCapability`. The inner loop consults it at the top of every tool-loop iteration; returned rows splice into the in-memory transcript. Chat implements it (`consumePendingSteer`). Board and sub-agent callers **omit** it. A throwing hook is swallowed. |

**Event-type filter is a `server/runner/` contract.** Any `TurnEvent` sink must classify through this package — do not invent a second exclusion list in an effector.

- [`isHighFrequencyTurnEvent`](../../server/runner/turn-event.js) — **disk** drop list: `stream_meta`, `phase`, `round_start`, `reasoning_end`, `token`, `delta`, `reasoning_delta`. `round_end` is **not** high-frequency; it is recorded. Board attempt transcripts (`transcripts.js`) and board live SSE use this predicate so a 12 Hz `stream_meta` cannot cap a P9-D log.
- [`shouldEmitSubAgentLiveTurnEvent`](../../server/runner/turn-event.js) — sub-agent **live** SSE allow-list (P10-L): forwards `phase` (a handful of times per turn, not 12 Hz) and otherwise matches the disk drop. Cards need `phase` to leave the generating fallback before the first `tool_call`.

This is **not** a board detail. It is **not** something P8-F already consumes: the sub-agent effector records **no** attempt transcript (`recordTranscriptEvent` is board-only / P9-D). P8-F forwards `TurnEvent`s to `emitLive` only. Sub-agent live SSE forwards `phase` (P10-L); disk still drops it.

Order within a model round:

```
round_start → (phase / thinking / delta / stream_meta)* → reasoning_end
  → tool_streaming → tool_call* → tool_result* → round_end
```

**Caller overlays (not runner signature changes):** decorating store + `touchChat` (P10-D); stopped/failed partial rows (P10-E); per-round live chrome (P10-F); metrics strip / ledger (P10-G); tool-row args/attachments/shell-kill (P10-H); spawn-card re-anchor (P10-K); live vs terminal + cancel origin (P10-L); per-run live-frame filter (P10-M).

**P10-B accept (MIN-767) — implementer**

- [x] New `TurnEvent` members (`phase`, `reasoning_end`, `stream_meta`, `round_start`, `round_end`) emitted from the inner loop and forwarded by `runTurn`
- [x] Ordering: `round_start` → (`phase` / `thinking` / `delta` / `stream_meta`)* → `reasoning_end` → `tool_streaming` → `tool_call*` → `tool_result*` → `round_end`
- [x] `tool_result` carries full outcome (`attachments` / `codeChange` / `isError`) and fires for parseError and abort fills via `onToolDone`
- [x] One `isHighFrequencyTurnEvent` predicate for **disk** (and board live SSE). Sub-agent live uses `shouldEmitSubAgentLiveTurnEvent` so `phase` reaches cards (P10-L). P8-F records no transcript.
- [x] `round_end` recorded and labelled `'Round'` in `LOG_LABEL`
- [x] README + `context.md` + this plan record the signature change
- [x] Unit test per new member in `test/runner/turn-event.test.mjs`; package-guard and untouched effector-runner stay green
- [x] No product-shaped chat branch, no extractor run, no P8-A re-application

**P10-C accept (MIN-768) — implementer**

- [x] `onMessagesChange(messages, meta?: { settled })` — forced emits `true`, throttled stream clones `false`
- [x] Continue turns persist on every settled snapshot via a monotonic `persistCursor`; `finally` is an idempotent backstop
- [x] A tool round is readable in the store after the first settled emit, not only at turn end
- [x] Killing the turn mid-stream leaves the settled prefix persisted and no synthetic partial assistant row
- [x] Isolated/board persist unchanged; `test/orchestrator/effector-runner.test.mjs` untouched
- [x] Sub-agent retries still `createMemoryTranscriptStore()`; `test/sub-agents/effector-runner.test.mjs` untouched
- [x] `test/runner/opening-messages-fold.test.mjs` covers seed-equality + `persistFrom` past the prior transcript
- [x] README + `context.md` + this plan record the `onMessagesChange` signature change
- [x] No decorating store / `touchChat` (P10-D); no stopped/failed partial rows (P10-E); no TurnEvent regression; no extractor; no P8-A re-application

**P10-D accept (MIN-769) — implementer**

- [x] New `src/chat/chat-transcript-store.ts` wraps `createSessionTranscriptStore()` (not a fork)
- [x] Inner-loop control user rows never land in `chat.history`
- [x] Wire `reasoning` / `reasoning_content` stripped; `thinking[]` / `thinkingDurationMs` / `thinkingSignature` written
- [x] `stats` / `usage` from `round_end` (or `stream_meta`) on the assistant row
- [x] `role:'tool'` rows carry `attachments` / `codeChange` from `tool_result`
- [x] Every append: `noteRunOutputIndex` + `recordChatMessage` (`touchChat`)
- [x] `noteRunGeneration` from `onGenerationId`; `seed: historyContent` (ephemeral continue still wins)
- [x] `applyClassifiedStreamEnd` + `resolveFinalAssistantContent` on persist
- [x] `load()` still the same UI-only filter as `overlayMultimodalHistoryForRunTurn`
- [x] Tests: `test/chat/chat-transcript-store.test.mts` + `test/chat/run-turn-chat.test.mts`
- [x] No P10-E Stop/fail branches; no P10-F live chrome rewrite; no board/sub-agent effector edits; no extractor

**P10-E accept (MIN-770) — implementer**

- [x] Stop mid-reply persists `{ stopped: true }` (thinking included) and survives a simulated session save/reload
- [x] Triggered from the **returned** `{ outcome: 'crashed', error: 'aborted' }` path (the real Stop) **and** a thrown `AbortError`
- [x] Provider error mid-reply persists `{ failed: true }` via `resolveFailedTurnPartialRow` *before* triage; error bubble below; Continue can resume
- [x] `GENERATION_LOST_ON_RESTART_MESSAGE` leaves the transcript and drops only an orphan tool tail
- [x] A turn that produced nothing rolls back to the user row (no stray empty assistant)
- [x] `finalizeRun` records `stopped` + captured `stopReason` (`user` / `timeout` / `system`)
- [x] `test/chat/failed-turn-partial.test.mts` and `test/chat/finalize-stopped-turn.test.mts` revived against `runChatTurn`
- [x] Helpers used, not rewritten: `resolveFailedTurnPartialRow`, `resolveFinalAssistantContent`, `rollbackFailedTurnHistory`, `repairSessionHistoryTail`, `turnProducedOutput`, `markMessageStopped` / `markMessageFailed`
- [x] No P10-F live timer UI; `abortThinking` on the decorating store is a tick-stop only
- [x] P10-B/C/D not reverted; `loop.ts` stays deleted

**P10-F accept (MIN-771) — implementer**

- [x] `run-turn-chat-paint.ts` is round-aware: `round_end` with `toolCallCount > 0` finalizes the current assistant row and opens a fresh streaming shell (`painter.retarget`)
- [x] One `ThoughtBubbleController` consume + Thoughts toggle per round; tool rows stay under the assistant that called them
- [x] P7-B rAF coalescing kept (`schedulePaintTick`, one `scrollTranscript()` per tick)
- [x] `ThinkingDurationTracker` in `runChatTurn` ticks `setThinkingElapsed` on the thought controller and stream status while the stream DOM is visible
- [x] `ThoughtPhaseCallbacks` ported from `loop.ts`; `endReasoningPhase` driven from `reasoning_end`; `patchMainTurnActivity` thinking/generating driven from `phase`
- [x] Turn-end attaches message actions, voice play, truncation chip, `renderSidebar()`, `setStatus('ok', 'Ready')`; `wrap.dataset.historyIndex` from `lastAssistantHistoryIndex()`
- [x] `test/chat/run-turn-chat-paint.test.mts` covers round boundaries, one thought group per round, and row order
- [x] P10-B/C/D/E not reverted; no P10-G metrics strip; no P10-H tool-row extras; `loop.ts` stays deleted

**P10-G accept (MIN-772) — implementer**

- [x] Live strip feeds `streamingStatsPublisher` a real `StreamMetaAccumulator` from P10-B `stream_meta` (not `streamMeta: {}`)
- [x] P7-C kept: schedule from coalesced paint using thinking **length**, never `getJoinedDisplayText()`
- [x] Each `round_end` pushes `usage`/`stats` into `priorSegments` / `priorStatsSegments`; 3-round weighting covered in `test/chat/streaming-stats.test.mts`
- [x] `appendStats` on the live row at tool-bearing `round_end` (`onRoundFinalized`) and at turn end
- [x] `chat.lastStats` via `buildLastStatsSnapshot` and `chat.modelInfo` via `resolveModelInfo` from `aggregateTurnMetaSegments` / `finalizeResponseMeta`
- [x] `recordMainChatTurnUsage` per round (`source.kind: 'main'`); `deps.recordTurnUsage` remapped off the sub-agent helper; end-of-turn `recordChatCompletionUsage` kept as a fallback when no round recorded
- [x] `stream_meta.runtime` mapped through `llamaRuntimeStatusView` onto `setRuntimeDetail` / `prompt_processing` (`test/chat/turn-stream-meta.test.mts`)
- [x] P10-B–F not reverted; no P10-H tool-row extras; `loop.ts` stays deleted

**P10-H accept (MIN-773) — implementer**

- [x] Display args via `parseToolArguments` (no `{ raw }` fallback); malformed args paint an error row and the turn continues
- [x] Full-arity `renderToolResult(wrap, content, attachments, args, codeChange)` from P10-B's widened `tool_result`
- [x] `resolveLiveToolWrap` exported from `chat-tool-batch.ts` and used by the painter (MIN-649 remount)
- [x] `attachShellKillUi` on tool-row create and on result; `notifyMemorySavedFromTool` after result
- [x] `runChatTurn` `execute` sets `setSubAgentExecutorContext` / `setBugBoardExecutorContext` and `assertUiDesignerToolAllowed`; **clears** `setSubAgentExecutorContext(null)` on every exit path
- [x] `parallelToolsActivityLabel(n)` on a parallel-safe `tool_call` streak (`patchMainTurnActivity`)
- [x] P10-B–G not reverted; no P10-I steer/context ring; no P10-K card re-anchor; `loop.ts` stays deleted

**Phase 10 finding (P10-H / MIN-773 — tool-row chrome is a caller overlay):** the painter is the live view of `TurnEvent.tool_call` / `tool_result`; `chat-tool-batch.ts` remains the incomplete-tool-resume path and the helper source (`parseToolArguments`, `resolveLiveToolWrap`, `attachShellKillUi`, `notifyMemorySavedFromTool`). Do not fork those. Executor context is module-level — set around `execute`, clear in `runChatTurn` `finally`, never per-tool (a parallel batch would wipe a sibling's parent). Card re-anchor is P10-K (`sub-agent-cards.ts`).

**P10-I accept (MIN-774) — implementer**

- [x] `runTurn({ onRoundBoundary?: () => TranscriptMessage[] | null })` — AskCapability-shaped hook, not an `isChat` branch (Phase 6 finding: signature change)
- [x] Inner loop consults the hook at the top of every tool-loop iteration; returned rows splice into the in-memory transcript
- [x] `runChatTurn` implements it with `createChatRoundBoundary` (`consumePendingSteer` + `syncComposerMessageQueue`)
- [x] Abort-on-enqueue is gone (`setSteerEnqueuedListener` / `controller.abort()` / `abortedForSteer` not in `runChatTurn`)
- [x] Mid-turn steer continues the same turn; the run is not marked failed; transcript shows one turn (original send + steered user)
- [x] Steer chip on the user row survives `renderChatFromHistory` (`steer: true` persisted; `markMessageSteered`)
- [x] Board and sub-agent effectors omit the hook; `test/orchestrator/effector-runner.test.mjs` and `test/sub-agents/effector-runner.test.mjs` untouched
- [x] Continue persist: wrapper advances `persistCursor` by spliced length so suffix persist does not duplicate the product row
- [x] Live context ring: `syncTurnContextUsage` driven from coalesced paint (once per rAF, never per token) and once per `tool_call` with serialized calls; cleared in `runChatTurn` `finally`
- [x] `streamSubAgentTurnOnce` HTTP-status throw unchanged (P8-A retry)
- [x] Tests: `test/chat/steer-*.test.mts`, `test/chat/context-usage.test.mts`, `test/chat/run-turn-chat.test.mts`, `test/runner/run-turn.test.mjs` P10-I describe
- [x] README + `context.md` + this plan record the `onRoundBoundary` signature change
- [x] P10-B–H not reverted; no P10-K/L/M/J; `loop.ts` stays deleted

**Phase 6 finding (P10-I / MIN-774 — in-turn steer is an injected hook):** P6-C reduced mid-turn steer to abort + follow-up. That killed the live turn, marked the run failed, and split one turn into two. P10-I restores the `loop.ts` behaviour with `onRoundBoundary` on `runTurn` — same injection shape as `AskCapability`, not an `isChat` / `isBoard` branch. Chat implements it; board and sub-agent callers omit it. A steer with no tool-loop boundary this turn still becomes a follow-up via `resumeParentChatWithMessage` (not abort). The live context ring is a caller overlay (`syncTurnContextUsage` from coalesced paint + `tool_call`), never a runner concern.

**P10-K accept (MIN-776) — implementer**

- [x] Card placement is upsert-resilient in `sub-agent-cards.ts`: re-anchor when the element is detached or the spawn tool row exists and the card is not already adjacent
- [x] P10-H `setSubAgentExecutorContext` / `finally` clear left in place (not duplicated, not undone)
- [x] `parentToolCallId`, `parentTurnId`, `modeId` non-null on the execute latch; `parentTurnId` matches the turn `cancelAllForParentTurn` indexes
- [x] Context is null after success, returned Stop (`crashed`/`aborted`), and a thrown error
- [x] `resolveParentChatId` prefers the execute latch over `getActiveChat()`; the active-chat fallback is documented, not a hard error (issue expand can still omit `parentChatId`)
- [x] Tests: `test/ui/sub-agent-cards.test.mts`, `test/chat/run-turn-chat.test.mts`, `test/sub-agents/orchestrator-store.test.mts`
- [x] P10-B–I not reverted; no P10-L/M/J; `loop.ts` stays deleted

**Phase 10 finding (P10-K / MIN-776 — spawn cards re-anchor on upsert):** P10-H set the execute latch so `parentToolCallId` reaches the journal. Placement was still creation-only (`if (!el)`), so a live card created before the tool row existed, or a registry node detached by `renderChatFromHistory`, stayed at the bottom of the transcript. `upsertSubAgentCardForRun` now re-anchors whenever the card is detached or the `[data-tool-call-id]` row exists and the card is not already the next sibling. `resolveParentChatId` reads the same latch before guessing `getActiveChat()` so a mid-POST chat switch cannot journal the run under B. The fallback itself is not an error yet: `runIssueExpandWithAgent` can pass `parentChatId: null`.

**P10-M accept (MIN-778) — implementer**

- [x] `onLive` ignores frames whose `taskId` is not this `runId`
- [x] A stale `attemptId` after retry does not paint onto the current attempt
- [x] `/api/agents/:runId/events` does not forward sibling live frames (`taskId` filter)
- [x] P10-B `isHighFrequencyTurnEvent` disk drop unchanged; sub-agent live forwards `phase` (P10-L)
- [x] Tests: `test/sub-agents/live-frame-isolation.test.mts` (two runs, one parent, fake stream) + SSE sibling assertion in `test/sub-agents/api.test.mjs`
- [x] `context.md` + this plan
- [x] P10-B–K not reverted; no P10-L/J; `loop.ts` stays deleted

**Phase 10 finding (P10-M / MIN-778 — live frames are parent-keyed):** `emitLive` is keyed on `parentChatId` by design (P8-B). Each card opens `/api/agents/:runId/events`, which drops `taskId !== runId` so sibling token traffic never leaves the server, and `onLive` ignores a sibling `taskId` or a stale `attemptId` after retry. Boards still dispatch by `taskId` on the parent stream. Disk transcripts still drop high-frequency types including `phase` (P10-B). Sub-agent live SSE forwards `phase` (P10-L).

**P10-L accept (MIN-777) — implementer**

- [x] Live guard drops **replayed** frames (stale `seq` / attempt ended with an outcome), not because the fold is terminal. An open attempt after `run.cancelled` still paints
- [x] `phaseOf`: open attempt + `cancelledReason` → `cancelling`; no open attempt → `cancelled`. Commented. Replay of cancel+`attempt.ended` is cancelled
- [x] Sub-agent live SSE forwards `phase`; disk `isHighFrequencyTurnEvent` still drops it from transcripts; board live SSE still drops it
- [x] `onLive` translates `phase` so the pre-tool window is not the generating fallback
- [x] Zero-attempt cancel does not sit on generating
- [x] Cancel origin named: `waitForSubAgent` `onAbort` POSTs cancel only when **its** signal aborts (Super Plan timeout). Chat spawn does not pass `chatSignal`. `cancelAllForParentTurn` is not on the Stop path
- [x] Tests: `test/sub-agents/live-frame-isolation.test.mts` (open attempt after cancel; replay after genuine end; phase; zero-attempt cancel), derive/plan/graph, turn-event split, orchestrator-store wiring
- [x] `context.md` + this plan
- [x] P10-B–K/M not reverted; P10-J records this; `loop.ts` stays deleted

**Phase 10 finding (P10-L / MIN-777 — live vs terminal, cancel origin):** The card froze because `onLive` treated a terminal fold as "ignore every live frame," and `cancelledReason` won (then `closeOpenAttempts`) the instant cancel was journaled — while the effector was still running. `phase` never reached the card because P10-B listed it as high-frequency for **both** disk and live. Disk still drops it; sub-agent live forwards it. Fold phase `cancelling` overlays `livePhase: stopping` on the card. The "0 tool turns" parent line was delivery-on-`run.cancelled` with `toolTurns` still 0, not a mysterious second cancel writer. `run.cancelled` is only the cancel route. The MIN-777 suspect (`chatSignal` → `waitForSubAgent`) is real **if** a signal is passed, and is **not** wired for `spawn_sub_agent` (`executeSubAgentTool` ignores `context.signal`; `wait:true` calls `waitForSubAgent(runId)` only). Super Plan review timeout is the intentional `parent_abort` path. `cancelAllForParentTurn` can index P10-K `parentTurnId` but Stop / `runChatTurn` never call it.

**P10-J accept (MIN-775) — implementer**

- [x] Phase 10 section complete; **Phase 6 findings (chat parity)** block lists every `runTurn` / `TurnEvent` / `TurnResult` addition and why it is a neutral fact
- [x] Event-type filter documented as a `server/runner/` contract any sink must use — not a board detail, not something P8-F already consumes (no transcript recorder). Sub-agent live forwards `phase` (P10-L); disk still drops it
- [x] File-table row for `src/agents/sub-agent-runner.ts` (1,375) **removed**; P8-A file/line refs point at `server/runner/sub-agent-runner.js`
- [x] Gap list: findings 6 and 7 plus leftover rows flipped to P10 resolutions; P10-A folded; no stale leftover P10 closed
- [x] `server/runner/README.md` event contract, ordering, `onRoundBoundary`, settled persist, `isHighFrequencyTurnEvent`, `shouldEmitSubAgentLiveTurnEvent`
- [x] `documentation/context.md` chat send path current
- [x] `scripts/extract-sub-agent-runner.mjs` deleted; `ADAPTER_ENTRY` stays `src/agents/renderer-runner-deps.ts`; package-guard asserts the extractor is gone
- [x] Extractor **not** run
- [x] Automated gate: `npx tsc --noEmit` PASS. Scoped `test/chat` + `test/runner` + `test/tools` + `test/ui` via `test/run-all.mjs` runner profiles (`--test-force-exit`): **2,521 tests, 2,520 pass, 1 fail**. The fail is `test/ui/panel-worktree-cwd.test.mts` *planner resolves the integration worktree once board state is active* (`C:/repo` vs `C:/wt/board-1/integration`) — **MIN-752 worktree resolution**, not a P10 regression. Full `npm test` re-measure remains for CI/main checkout (this worktree skipped a >15 min full run).
- [ ] Live Electron ten-step QA on MIN-765 — remaining after `/apply-worktree` (this worktree must not steal port 9473)

#### `npm test` baseline (MIN-775)

Linear recorded **8,784 tests — 8,759 pass, 21 fail** on `Orchestrator-V2` @ `c85c1d9c` (2026-09-01, main checkout, Windows). P10-J did **not** re-run full `npm test` in this worktree (expected >15 minutes; scoped gate run instead). Full re-measure remains for CI / the main checkout after `/apply-worktree`. Do not treat these clusters as a P10 regression:

| Cluster | Suites | Cause |
| -- | -- | -- |
| Windows privilege | `isResolvedPathUnderRoot` (2), `orchestrate board-testing API` → `tails bounded board logs` | `EPERM` — symlink creation needs elevation / Developer Mode. Environmental. |
| Stale config fixtures | `config API CRUD` → `PUT tools with brave key`, `config migration` → `POST migrate` | Fixtures still expect `board_init` / `board_update_task` / `board_set_autonomy` / `board_get_state` / `board_report` / `board_provision_infra` / `delegate_tasks`, which **P4-C deleted**. Real debt, pre-dates Phase 8. |
| `BoardState` schema | `V2 BoardState autonomy shape` | `BOARD_STATE_KEYS` lacks `workspacePath`. [MIN-752](https://linear.app/minnowai/issue/MIN-752). |
| Worktree resolution | `chat groups`, `resolvePanelBrowseCwd`, `buildComposeContext cwd` | Board/planner worktree precedence. Also [MIN-752](https://linear.app/minnowai/issue/MIN-752). Reproduced in this worktree's scoped UI gate (`panel-worktree-cwd.test.mts`). |
| Benchmark catalog drift | `capability catalog`, `capability-matrix suite`, `benchmark test catalog coverage` | 59-row spreadsheet / 13-band counts out of sync. Unrelated to V2. |

**Known flakes:** browser driver 20-cycle orphan (19 vs 20); `report-wiring.test.mjs` libuv `UV_HANDLE_CLOSING` teardown under `--test-force-exit` (assertions pass); `cascade-propagation.test.mjs` intermittent.

#### Remaining human QA (MIN-765, after `/apply-worktree`)

Run in the **main checkout** on port 9473 (`Minnow Full-Stack` launch config, `MINNOW_DEBUG=1`). A worktree cannot run Electron here.

1. Reasoning model, plain reply → timer ticks, flips to "Generating response…", Thoughts toggle shows a duration, metrics strip fills live, per-message stats survive the stream-end re-render.
2. Build mode, 3+ tool calls across 2 rounds → each round has its own assistant row with its own thought group; tool rows sit under their round; code-change badges and tool screenshots render; the transcript does not jump.
3. Malformed tool argument → the row shows the parse error and the turn continues.
4. Stop mid-reply → partial persists with the stopped marker, survives a full app restart.
5. Kill the server mid-turn → the error bubble lands under the preserved partial; Continue works.
6. Switch chats mid-tool-batch and back → results fill into the redrawn rows.
7. Leave the chat, return, restart the app → transcript, thoughts, stats and tool rows identical to what was on screen.
8. Steer mid-turn → the turn continues in place with the steer chip on the user row.
9. Context ring moves during the turn.
10. Local-model turn → tok/s not worse than P7's parked baseline.

## Verification Checklist

- [ ] `npm test` passes (see Phase 10 baseline table in P10-J / Linear MIN-775 — 21-fail cluster on `c85c1d9c`; full re-measure is CI/main checkout if the worktree skip applies)
- [x] `npm run build` passes (Phase 4 worktree; re-run PASS in Phase 6 worktree)
- [x] The scheduler suite runs to completion with **zero model calls** (Phase 1 gate)
- [x] Killing the server mid-run and restarting reproduces identical derived state (Phase 1 gate)
- [x] A 3-task board completes at concurrency 1 with the UI closed, in-process tools, and typed exits (Phase 2 gate; fake host, 10/10)
- [x] A real multi-task board completes at concurrency 2 with worktrees and a merge queue (Phase 3 gate)
- [x] No file under `src/state/orchestrate-*` or `src/chat/orchestrate/` remains (Phase 4 gate)
- [x] `board_set_autonomy` / `delegate_tasks` gone from `src` + `server`; `board_init` remains only as leftover V1 session-log vocabulary in `session-schema.mjs` (hydrate, not a live tool) (Phase 4 gate)
- [ ] An overnight AFK run finishes, reports once, and stalls on nothing (Phase 5 gate)
- [x] A normal chat turn runs through `runTurn()`; `src/tools/loop.ts` is deleted; `ask_question` is injection-only (Phase 6 gate)
- [x] Cloud and local streams leave composer/scroll/clicks responsive; local tok/s not regressed (Phase 7 gate — **automated half:** tsc + ticker + markdown + P7-B/C tests PASS. **Live half deferred:** Chromium / tok/s / mid-stream typing on cloud+local; worktree cannot steal port 9473 from the main-checkout Electron)
- [x] A sub-agent spawned from a chat survives a renderer reload and a server restart, and finishes (Phase 8 gate)
- [x] A sub-agent that runs past its wall-clock limit is retried by policy, not cancelled with its work discarded (Phase 8 gate)
- [x] Starting a board with no model bound fails at the button with a readable message, and never enters a silent retry loop (Phase 9 gate)
- [x] Every failure that stops work from starting is visible on the board without opening a server log (Phase 9 gate)
- [x] Tasks render as waves × kanban columns, and no column a card sits in is written by the renderer (Phase 9 gate)
- [x] A failed task's attempt transcript is readable from the board (Phase 9 gate)
- [x] `grep -rn "lastHeartbeatAt\|tier1Attempted\|progressStallMs" src/` returns nothing (Phase 8 gate)
- [x] Chat turn: thinking timer, "Generating response…", live metrics, per-message stats survive stream-end re-render (Phase 10 gate — **automated half:** painter / thinking-duration / stream-meta / stats tests. **Live Electron remaining:** MIN-765 step 1)
- [x] Multi-round Build turn: per-round assistant rows, tool rows under their round, no transcript jump (Phase 10 gate — **automated half:** `run-turn-chat-paint` round-boundary tests. **Live Electron remaining:** MIN-765 step 2)
- [x] Stop mid-reply and server-kill persist the partial; leave/return/restart keeps transcript (Phase 10 gate — **automated half:** `settle-interrupted-turn` / failed-turn-partial tests. **Live Electron remaining:** MIN-765 steps 4–5, 7)
- [x] Malformed tool args resolve with a parse error and the turn continues (Phase 10 gate — **automated half:** painter parse-error + `onToolDone`. **Live Electron remaining:** MIN-765 step 3)
- [x] `src/tools/loop.ts` stays deleted; `test/runner/package-guard.test.mjs` green; board effector suite untouched (Phase 10 gate)
- [x] A chat turn's transcript, thoughts, stats and tool rows are byte-identical after a reload (Phase 10 gate — **automated half:** decorating store + settled persist + round_end stats/thinking on history rows. **Live Electron remaining:** MIN-765 step 7)
- [x] A stopped or failed turn keeps what it streamed, across an app restart (Phase 10 gate — **automated half:** P10-E settle + `touchChat` on append. **Live Electron remaining:** MIN-765 steps 4–5)

## Notes for Build Agents

- **The control plane makes zero LLM calls.** If a change would put a model call inside `plan()`, `derive()`, the policy table, or the merge queue, it is wrong. Determinism is what makes `state = fold(journal)` a working crash-recovery mechanism.
- **Every journal event records a completed side effect, never an intent.** Log `task.attempt.started` *after* the process exists.
- **Never add a retry counter.** Attempt counts are derived by filtering the journal. A counter is a second source of truth and will desynchronise.
- **The core is plain `.js` + `.d.ts`.** See finding D. Do not introduce a build step for `server/**`.
- **The runner must not know what a board is.** No board imports in `server/runner/`. Board specifics arrive as arguments. From Phase 8 it has a second caller, so "board-agnostic" stops being a discipline and becomes a fact the tests hold.
- **Never reintroduce a supervisor.** Phase 8 deletes the sub-agent watchdog, heartbeats, and stall timers for the same reason Phase 1 deleted the board ones: an idempotent reconcile tick over `actual` already restarts what died. A heartbeat is a second source of truth about liveness.
- Worktrees may junction `node_modules` to the main checkout — that is fine. `npm test` rewrites `test/fixtures`. A non-zero full-suite exit is not automatically a regression: known clusters on this branch (Windows `EPERM`, stale `board_init` fixtures, `BoardState.workspacePath` / worktree resolution MIN-752, capability catalog drift, known flakes) are recorded in Linear MIN-775. Do not treat those as yours.
- **`server/runner/sub-agent-runner.js` is hand-maintained.** Do not run a resurrected `scripts/extract-sub-agent-runner.mjs`. `ADAPTER_ENTRY` is `src/agents/renderer-runner-deps.ts`.
