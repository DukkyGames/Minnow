---
name: orchestrator-v2-implementation
overview: Implementation plan for Orchestrator V2 — a clean-room, server-side, journal-and-reconcile board engine that replaces the V1 renderer orchestrator. Eight phases from a pure decision core through V1 deletion, normal chat adopting the same runner, and coalesced stream paint so the UI stays live mid-generation.
isProject: true
---

# Orchestrator V2 — Implementation Plan

**Date:** 2026-08-28
**Goal:** Replace the V1 board engine with a server-side journal + reconcile engine whose state is a pure fold, so multi-agent runs are as reliable as today's sequential single-agent path.
**PRD:** [`orchestrator-v2.md`](./orchestrator-v2.md) — read it first. This document plans the build; it does not restate the design.
**Linear:** [Orchestrator V2](https://linear.app/minnowai/project/orchestrator-v2-97ced8c22ad8) (team Minnow AI) — 8 phase parents, `MIN-677`–`MIN-683` plus `MIN-727`, with sub-issues `MIN-684`–`MIN-726` and `MIN-728`–`MIN-731`. Each sub-issue carries its own full plan.

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
| 5 | V1/V2 coexistence | **Swap the board UI at Phase 1.** V1 becomes unreachable from Phase 1; Phase 4 is pure code removal. Accepted cost: no usable orchestrator between Phase 1 and Phase 2. |
| 6 | §13.2 Final Tester | **Static ladder at Phase 3, browser at Phase 5.** Multi-agent runs are verified end-to-end *before* V1 is deleted. |
| 7 | Project scope | **Phases 0–7.** Phase 6 issues stay unscheduled until Phase 5 lands. Phase 7 (stream UI lag) can start now — it does not wait on the runner. |
| 8 | §13.1 journal retention | **Keep forever + periodic snapshot.** The fold is memoised against a snapshot written every N events. Raw history is never compacted — §11 needs it to measure bad abandonments. |

## Findings that change the PRD's risk model

Three things were verified in the codebase during planning. Two of them materially de-risk Phase 2; one adds work to Phase 3.

**A. Provider streaming is already server-side.** The PRD's §12 top risk — *"provider streaming must move server-side — the largest single piece"* — is largely already done. `server/generations/upstream.js` (`pumpUpstream`) owns the upstream SSE connection; `server/generations/store.js` owns subscriber fan-out, `cancel`, `markComplete`/`markError`, and fallback roles. The renderer's `src/providers/fetch-chat.ts` is a thin client that POSTs `/api/generations` and replays bytes back through a synthetic `Response`. A server-side runner calls that store **in-process** — no HTTP hop, no new provider plumbing. Phase 2's real work is the *turn loop*, not the transport.

**B. A zero-UI headless turn loop already exists.** `src/agents/sub-agent-runner.ts` (1,375 lines, *"isolated sub-agent completion + tool loop, no parent chat history"*) has **no `../ui/` imports and no `document.` / `window.` references** across its 46 import sources. It already handles SSE parsing, constrained tool calls, XML tool calls, inline/Harmony thinking routing, context-budget policy, vision gating, and structured outcomes. This — not `src/tools/loop.ts` (3,773 lines, heavily UI-coupled) — is the port target. Its one real coupling is `src/state/sessions.ts` (2,206 lines, 10 browser-global hits), which is broken behind an injected transcript store in P2-A.

**C. There is no rebase operation.** `server/worktree/worktree-ops.js` has `ensureIntegration`, `createWorktree`, `mergeIntoIntegration`, `checkMerged`, `abortMerge`, `restoreIntegration`, `verifyIntegrationMerge` — but nothing that rebases. §5.6's *"rebase before merge"* is new code (P3-B).

**D. The shared core must be `.js` + `.d.ts`, not `.ts`.** The server ships and runs as raw JavaScript (`npm start` → `node server.js`; no transpile step covers `server/**`). The existing TS bridge, `server/orchestrate/board-testing/ts-import.js`, lazily registers `tsx` and is explicitly dev-only — it cannot work in a packaged app. The repo already has the right pattern: `server/tools/output-cap.js` + `output-cap.d.ts`, imported from the renderer by `src/ui/terminal-panel.ts`. The V2 core follows it.

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

### Phase 3 — Worktrees, merge queue, parallelism
*Proves: multi-agent works.*

**MIN-680** · MIN-705 P3-A Engine-owned worktree lifecycle · MIN-706 P3-B `rebaseOntoIntegration` · MIN-707 P3-C Serialized merge queue · MIN-708 P3-D `touches` gate + overflow journaling · MIN-709 P3-E Concurrency > 1 · MIN-710 P3-F Final Tester static ladder · MIN-711 P3-G End-of-run report writer · MIN-712 P3-H Dead-end handling + evidence capture

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

## Verification Checklist

- [ ] `npm test` passes
- [ ] `npm run build` passes
- [x] The scheduler suite runs to completion with **zero model calls** (Phase 1 gate)
- [x] Killing the server mid-run and restarting reproduces identical derived state (Phase 1 gate)
- [ ] A real multi-task board completes at concurrency 2 with worktrees and a merge queue (Phase 3 gate)
- [ ] No file under `src/state/orchestrate-*` or `src/chat/orchestrate/` remains (Phase 4 gate)
- [ ] `grep -r "board_init\|board_set_autonomy\|delegate_tasks" src server` returns nothing (Phase 4 gate)
- [ ] An overnight AFK run finishes, reports once, and stalls on nothing (Phase 5 gate)
- [ ] Cloud and local streams leave composer/scroll/clicks responsive; local tok/s not regressed (Phase 7 gate)

## Notes for Build Agents

- **The control plane makes zero LLM calls.** If a change would put a model call inside `plan()`, `derive()`, the policy table, or the merge queue, it is wrong. Determinism is what makes `state = fold(journal)` a working crash-recovery mechanism.
- **Every journal event records a completed side effect, never an intent.** Log `task.attempt.started` *after* the process exists.
- **Never add a retry counter.** Attempt counts are derived by filtering the journal. A counter is a second source of truth and will desynchronise.
- **The core is plain `.js` + `.d.ts`.** See finding D. Do not introduce a build step for `server/**`.
- **The runner must not know what a board is.** No board imports in `server/runner/`. Board specifics arrive as arguments.
- Worktrees have no `node_modules`; ~11 extra test failures there are not regressions. `npm test` rewrites `test/fixtures`, and three suites fail on clean `main` — a non-zero exit is not automatically your regression.
