# Unified Board Report — Shipped

**Status:** Shipped (2026-06-27)  
**Related:** [`orchestrate-board-architecture.md`](./orchestrate-board-architecture.md), [`documentation/context.md`](../context.md) (Orchestrate board section)

## Summary

Board member chats (Builder, Tester, merge fixer, env fixer) now share a single structured completion contract. The board advances task status from **`board_report`** outcomes at stream-end instead of mixing legacy tools, prose markers, and heartbeat git polling.

---

## What shipped

### 1. Single `board_report` tool

- Replaces **`board_report_test_result`** and **`board_report_build_result`** (removed from tool registry and planner/member filters).
- Args: `task_id`, `outcome` (`pass` | `fail` | `env_blocked`), `summary`, optional `blockers`, optional `failing_tasks` (final integration test).
- Implemented in [`src/tools/board-tools.ts`](../../src/tools/board-tools.ts); exposed to board member chats via [`orchestrate-tool-filter.ts`](../../src/chat/modes/orchestrate-tool-filter.ts).
- Work-agent prompts (Builder, Tester, fixer seeds) instruct agents to call `board_report` exactly once when done.

### 2. `BoardTask.boardReport` + legacy hydration

- Primary persisted field: `task.boardReport?: BoardReport` (`outcome`, `summary`, optional `blockers`).
- **`resolveBoardReport(task)`** in [`orchestrate-board-actions.ts`](../../src/state/orchestrate-board-actions.ts) reads `boardReport` first, then hydrates from legacy mirrors on reloaded sessions:
  - `testVerdict` / `testSummary` → report outcome
  - `buildOutcome` / `buildBlockers` / `error` → report outcome
- `board_report` still mirrors into legacy fields when written (for older readers and session compatibility).

### 3. Report-driven stream-end finalizers (all phases)

| Phase | Finalizer | Routing signal |
|-------|-----------|----------------|
| Build | `finalizeBoardTaskOnStreamEnd` | `resolveBoardReport` — `pass` → `testing`; `env_blocked` → env fixer; `fail` / missing → self-heal |
| Test | `finalizeTaskTestingOnStreamEnd` | `resolveBoardReport`; Tester `VERDICT:` transcript fallback only when no report |
| Merge fixer | `finalizeMergeFixerOnStreamEnd` | `board_report` `pass` + `verifyIntegrationMerge`; failure → restore + retry or self-heal |
| Env fixer | `finalizeEnvFixerOnStreamEnd` | `board_report` `pass` → re-run build/test phase; else self-heal |
| Final test | `finalizeFinalTestOnStreamEnd` | `resolveFinalBoardReport` / `FULL_BOARD` task id |

No prose-only build advance (`READY FOR VERIFICATION` is no longer a routing signal).

### 4. Unified stall recovery (all board chats)

All board-linked chats (builder, tester, merge fixer, env fixer, final integration test) use the same **`startTaskChatSupervision`** heartbeat:

| Constant | Value | Role |
|----------|-------|------|
| `TASK_CHAT_STALL_MULTIPLIER` | 3× | Stall threshold = `progressStallMs × 3` for every supervised chat |
| `TASK_CHAT_STALL_RESTART_CAP` | 2 | Max stall-driven restarts per chat |

**On stall (AFK/auto, board running):**

1. **First stall** — `stopGeneration` + **`runTaskChatNudge(group, taskId, planner, reason, { chatId })`** nudges the **stalled chat** (not always `task.chatId`). Nudge text includes a role-specific `board_report` reminder via `boardReportNudgeLine`.
2. **Recurrence** — **`resolveStallHealPhase(task, stalledChatId, board)`** maps chat → self-heal phase (`build` | `test` | `merge`), then `runSelfHeal`.

**Removed (superseded by unified supervision + report-driven finalize):**

- Heartbeat **git poll** on merge fixers (`check_merged` each tick)
- **`reconcileMergeFixerChat`** (stop + direct finalize from heartbeat)
- **`FIXER_STALL_MULTIPLIER`** (1.5× fixer-only stall)
- **`fixerEarlyFinalizeInFlight`** (git-poll early-finalize race guard)
- Env-fixer **stop-only** stall branch (env fixers now get the same nudge/self-heal path as other chats)

### 4b. Missing-report nudge before failure (added 2026-07-18)

A chat that finished its turn **cleanly** but never called `board_report` is usually an
agent that forgot the tool, not a failed task. Before routing a missing report into
self-heal, the finalizer re-prompts the same chat:

| Constant | Value | Role |
|----------|-------|------|
| `MISSING_REPORT_NUDGE_CAP` | 2 | Max `board_report` reminders per board chat |

`tryNudgeForMissingBoardReport` in [`orchestrate-board-actions.ts`](../../src/state/orchestrate-board-actions.ts)
dispatches `runTaskChatNudge(…, { missingReport: true })` on the ended chat and returns
early, leaving the task's status, chat linkage, worktree, and phase attempt budget
untouched. Once the cap is hit the finalizer falls through to its existing
self-heal → quarantine routing.

| Finalizer | Behaviour on missing report |
|-----------|-----------------------------|
| `finalizeBoardTaskOnStreamEnd` | Nudge (task stays `in_progress`), then self-heal `build` |
| `finalizeTaskTestingOnStreamEnd` | Nudge after the `VERDICT:` fallback fails (task stays `testing`), then self-heal `test` |
| `finalizeEnvFixerOnStreamEnd` | Nudge before the linkage is cleared, then self-heal `infra` |
| `finalizeMergeFixerOnStreamEnd` | **Unchanged** — the git fallback + bounded re-merge retry is already recovery, not a hard fail |

Gates (all must hold to nudge):

- `isBoardRunning(group)` — a paused/stopped board records the failure and lets the resume sweep re-drive it.
- `resolveTaskChatStreamOutcome(chat) === 'completed'` — **`stopped`** (user Stop, stall kill) and
  **`failed`** (provider error, `Maximum tool turns reached`) keep their existing park / retry /
  quarantine owners. Max-turn and cancel paths are therefore unaffected.

The per-chat counter is deliberately **not** cleared by `stopTaskChatSupervision`: every nudge
produces another stream-end and the subscriber stops supervision before the finalizer runs, so
clearing there would reset the budget each pass and nudge forever. It resets only in
`getOrCreateBoardChat`, i.e. when a genuinely new phase run is launched.

### 5. Report-driven `reconcileMergingTasks` for dead fixers

[`reconcileMergingTasks`](../../src/state/orchestrate-board-actions.ts) remains the live safety net for `merging` tasks:

- Active fixer → re-attach `startTaskChatSupervision`
- Dead fixer (no live stream) → **`finalizeMergeFixerOnStreamEnd`** (reads `boardReport` / legacy fields; does not depend on heartbeat git success)

**Git fallback in `finalizeMergeFixerOnStreamEnd`:** When the fixer dies without calling `board_report` (OOM/crash), stream-end still runs **`tryCompleteVerifiedMerge`** (`check_merged` + `verify_integration`) before retry/self-heal. Recovery-only — does not replace the normal `board_report` pass path.

Call sites unchanged: top of `autoDelegateNext`, `waitForNoActiveFixer` timeout (60s), boot `recoverInterruptedMergesAfterReload`, manual **`recoverMergingBoardTask`**.

A per-task **`fixerFinalizeInFlight`** set still prevents double-finalize races when stream-end and reconcile overlap.

### 6. MERGE_HEAD preflight (kept)

`startMergeConflictFixer` still guards fixer launch with **`checkMergeInProgressOp`**:

| Preflight result | Action |
|------------------|--------|
| Already merged (no `MERGE_HEAD`, branch merged) | Synthetic `boardReport: { outcome: 'pass', summary: '…' }` → `finalizeMergeFixerOnStreamEnd` (no fixer chat) |
| Clean re-merge succeeds | Same synthetic pass report |
| Fresh conflict | Spawn fixer with updated conflict list |
| Otherwise | Block or error |

Fixer seed still assumes merge in progress; agents finish with `git commit --no-edit` and `board_report`.

---

## Module touchpoints

| File | Change |
|------|--------|
| `src/tools/board-tools.ts` | `board_report` handler; legacy tools removed |
| `src/tools/definitions.ts` | Single `board_report` definition |
| `src/state/orchestrate-board-actions.ts` | `resolveBoardReport`, report-driven finalizers, unified supervision |
| `src/types.ts` | `BoardReport`, `BoardTask.boardReport` |
| `src/chat/modes/orchestrate-tool-filter.ts` | Member allowlist: `board_report` only |
| Work-agent prompts | Builder / Tester / orchestrator copy updated |

---

## Tests

- `test/orchestrate/task-stream-end.test.mts` — build/test report routing, missing-report nudge → quarantine
- `test/orchestrate/task-testing.test.mts` — Tester nudge before a verdict-less fail
- `test/orchestrate/merge-fixer-finalize.test.mts` — report-driven merge finalize
- `test/orchestrate/merge-fixer-stall.test.mts` — unified stall + MERGE_HEAD preflight
- `test/orchestrate/board-task-chat-stall.test.mts` — 3× stall nudge/self-heal across chat roles
- `test/orchestrate/fixer-recovery.test.mts` — `reconcileMergingTasks`, dead fixer, env/merge fixer stalls
- `test/tools/board-member-tool-filter.test.mts` — `board_report` in member allowlist

---

## Related docs

- [`orchestrate-board-architecture.md`](./orchestrate-board-architecture.md) — updated merge/fixer and tools sections
- [`fixer-recovery-merged-plan.md`](./fixer-recovery-merged-plan.md) — historical; git-poll / `reconcileMergeFixerChat` paths superseded by this ship
