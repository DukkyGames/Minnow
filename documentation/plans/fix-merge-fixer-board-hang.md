---
name: fix-merge-fixer-board-hang
overview: >
  The merge-conflict fixer chat is the only Orchestrate board chat without stall supervision
  (heartbeat/watchdog), and merge-state reconciliation only runs on page reload — so when a
  fixer commits a merge successfully but its chat stream doesn't end cleanly, the task sits in
  "merging" forever. Two independent fixes: attach merge-aware supervision to the fixer, and
  harden the fixer launch with a MERGE_HEAD pre-flight check.
todos:
  - id: w1-merge-aware-supervision
    content: "Wave 1: Add merge-aware stall supervision to startMergeConflictFixer"
    status: pending
  - id: w1-mergehead-preflight
    content: "Wave 1: Harden fixer launch — verify MERGE_HEAD exists before spawning fixer"
    status: pending
isProject: true
---

# Fix Merge-Fixer Board Hang

**Date:** 2026-06-25
**Goal:** Prevent Orchestrate board tasks from getting permanently stuck in `merging` when the fixer chat commits successfully but its stream doesn't end cleanly.
**Granularity:** medium

## Context

Three merge-conflict fixer chats ran on a board. Two completed; one committed successfully (`git commit --no-edit` exited 0, clean tree) but then lingered producing extra prose, and its stream-end event never fired. The task sat in `merging` for 44 seconds until the user hit Stop.

**Root cause:** `startMergeConflictFixer` (`src/state/orchestrate-board-actions.ts:1608`) is the only board-chat starter that calls neither `refreshHeartbeatThresholds()` nor `startTaskChatSupervision()`. Every other starter does:

| Starter | Line | Has supervision? |
|---------|------|-----------------|
| `startTask` | ~1887-1888 | ✓ `refreshHeartbeatThresholds()` + `startTaskChatSupervision(taskChat.id)` |
| `startTaskTesting` | ~1994-1995 | ✓ |
| `runTaskChatNudge` | ~1229-1230 | ✓ |
| `startFinalIntegrationTest` | ~2313-2314 | ✓ |
| `startMergeConflictFixer` | ~1654 | ✗ **missing both** |

The only reconciliation that checks actual git state (`recoverInterruptedMergesAfterReload`, line ~2719) runs solely on page reload, not during a live run. When the fixer's stream doesn't end cleanly, nothing else notices the merge is already done.

**Contributing factor:** W1-B's first fixer spawned onto a clean tree with no MERGE_HEAD — the conflicted merge state recorded at line 1476 was gone by the time the fixer looked at the shared integration worktree. The fixer seed message tells the LLM "MERGE_HEAD is set," but it wasn't. The fixer wasted its turn hunting for a non-existent merge, "failed," and forced a retry. This indicates a serialization gap on the shared integration worktree between conflict-detection and fixer-launch.

## Architecture / Key Files

| File | Role | Action |
|------|------|--------|
| `src/state/orchestrate-board-actions.ts` | Board lifecycle: `startMergeConflictFixer`, `startTaskChatSupervision`, `finalizeMergeFixerOnStreamEnd`, `recoverInterruptedMergesAfterReload` | MODIFY |
| `src/state/worktree-service.ts` | Git worktree ops: `checkMerged`, `verifyIntegrationMerge`, `mergeIntoIntegration` | READ (already has needed functions) |
| `src/state/orchestrate-self-heal.ts` | Self-heal routing; calls `startMergeConflictFixer` for merge phase | READ (no changes needed) |
| `src/agents/controller/wrapper.ts` | Heartbeat/supervision primitives: `startHeartbeat`, `stopHeartbeat`, `createRunSupervision`, `bindRunSupervision` | READ (no changes needed) |

## Wave Breakdown

### Wave 1 — Fix the hang (concurrent)

Both tasks are independent and touch different regions of `startMergeConflictFixer`.

#### Task W1-A: Add merge-aware stall supervision to `startMergeConflictFixer`

- **Build:**
  1. In `src/state/orchestrate-board-actions.ts`, inside `startMergeConflictFixer` (line ~1608), after the `ensureStreamEndSubscription()` call and before `reserveLaunchSlot(fixerChat.id)`, add:
     ```ts
     refreshHeartbeatThresholds();
     ```
  2. After `runChatTurn(...)` launches, attach supervision. The standard `startTaskChatSupervision` cannot be reused as-is because its stall callback runs `runTaskChatNudge` (which looks at `task.chatId`, not `task.fixerChatId`) and routes through `phase: 'build'` self-heal. Instead, create a new function `startFixerChatSupervision(chatId: string, group: ChatGroup, taskId: string)` that:
     - Calls `createRunSupervision()`, `bindRunSupervision(runId, supervision)`, `startHeartbeat(runId, callback)`.
     - The callback, on stall (`progressAge >= stallMs`), calls `stopHeartbeat(runId)`, `stopGeneration(chatId)`, then:
       - Looks up the task and planner.
       - Calls `finalizeMergeFixerOnStreamEnd(group, task, planner)` to check git state. If the merge is already committed, this advances the task to `complete`. If not, it follows the normal retry/self-heal path already inside `finalizeMergeFixerOnStreamEnd`.
     - Uses the shared `taskChatStallRestarts` map (read and increment the counter; `stopTaskChatSupervision` clears it on stream end) so the cap of `TASK_CHAT_STALL_RESTART_CAP` (2) still applies.
  3. Add the new `startFixerChatSupervision` call right after `runChatTurn(...)` in `startMergeConflictFixer`, passing `fixerChat.id`, `group`, and `task.id`.
  4. In `ensureStreamEndSubscription`'s `subscribeChatStreamEnd` handler (line ~724), the existing `stopTaskChatSupervision(endedChatId)` call works for fixer chats too because the supervision counters are stored in `taskChatStallRestarts`. However, the stop function must also handle the heartbeat: either call `stopTaskChatSupervision` (which clears the counter and stops the heartbeat) as-is, or create a parallel `stopFixerChatSupervision`. Simplest: use the same `startTaskChatSupervision`/`stopTaskChatSupervision` pair, but with a phase-aware heartbeat callback. Add an optional `phase: 'build' | 'fixer'` parameter to `startTaskChatSupervision`, defaulting to `'build'`. When `phase === 'fixer'`, the stall callback calls `finalizeMergeFixerOnStreamEnd` instead of `runTaskChatNudge`/`runSelfHeal(build)`.

  **Recommended approach (least code duplication):** Refactor `startTaskChatSupervision` to accept an optional `phase` parameter. The function signature becomes:
  ```ts
  function startTaskChatSupervision(chatId: string, phase?: 'build' | 'fixer'): void
  ```
  Default `phase` to `'build'`. In the heartbeat callback, branch on `phase`:
  - `'build'`: existing behavior (nudge on first stall, self-heal on second)
  - `'fixer'`: on stall, stop heartbeat, stop generation, then call `finalizeMergeFixerOnStreamEnd(group, task, planner)` directly (which re-checks git state and advances to complete if committed).
  
  Update the two existing call sites to pass `'build'` explicitly (or leave the default). Add the new call in `startMergeConflictFixer` with `phase: 'fixer'`.

- **Test:**
  1. Run the existing test suite: `npm test` — all existing Orchestrate board tests must pass.
  2. Unit test the new supervision variant:
     - In `test/state/orchestrate-board-hydrate.test.mts` (or a new test file), verify that `startMergeConflictFixer` now calls `refreshHeartbeatThresholds` and `startTaskChatSupervision` with `phase: 'fixer'`.
     - Mock a fixer chat that has a committed merge but no stream-end event. Trigger the heartbeat stall callback. Assert that `finalizeMergeFixerOnStreamEnd` is called and the task advances to `complete`.
  3. Manual integration test: run a board with a merge conflict, let the fixer commit successfully but have the LLM produce extra prose after committing. Verify the task advances to `complete` within the stall timeout (rather than hanging indefinitely).

- **Accept:** In auto/afk mode, a merge-conflict fixer chat whose stream does not end cleanly after a successful `git commit --no-edit` advances its task from `merging` to `complete` within `progressStallMs * TASK_CHAT_STALL_MULTIPLIER` milliseconds, without requiring a page reload or manual Stop.

#### Task W1-B: Harden fixer launch — verify MERGE_HEAD exists before spawning fixer

- **Build:**
  1. In `src/state/orchestrate-board-actions.ts`, inside `startMergeConflictFixer` (line ~1608), after verifying the integration worktree exists and before `moveTaskStatus(group, task.id, 'merging', plannerChat)`, add a pre-flight check:
     - Use the existing `checkTaskBranchMerged` function (from `worktree-service.ts`, imported as `checkTaskBranchMerged`) to test whether the task's branch is already merged into integration.
     - If the result indicates the merge is already complete (`merged.ok && merged.merged`), skip the fixer entirely: call `finalizeMergeFixerOnStreamEnd` directly (or inline the advance to `complete`).
     - If the merge is not merged and not in-progress (no MERGE_HEAD), the conflict state has vanished. Instead of launching a fixer onto a clean tree, call `enqueueMergeCompletedTaskWorktree(group, task, plannerChat)` to re-run the merge. If the re-merge produces a conflict, recursively call `startMergeConflictFixer` with the fresh conflicted files. If it succeeds, advance to `complete`. If it errors, log and move to `blocked`.
     - Only proceed with the fixer spawn if MERGE_HEAD is confirmed present (the merge is in-progress with conflicts). The `checkTaskBranchMerged` result should indicate this (e.g. `merged: false` with an in-progress state).
  2. Check whether `checkTaskBranchMerged` returns enough detail to distinguish "not merged, no in-progress merge" from "not merged, merge in progress (MERGE_HEAD set)". If not, add a lightweight shell invocation (e.g. `git rev-parse --verify MERGE_HEAD` via the existing worktree-service shell dispatch) to explicitly check for MERGE_HEAD.
  3. Update the fixer seed message in `buildMergeFixerSeedMessage` to remove the absolute claim "MERGE_HEAD is set" and replace with a conditional: "Check `git status` to confirm MERGE_HEAD is set. If the merge is not in progress, report the situation." This makes the fixer resilient even if a future race slips through.

- **Test:**
  1. Unit test: mock the worktree service to simulate three scenarios:
     - MERGE_HEAD is set → fixer spawns normally.
     - Merge already committed (clean tree, branch merged) → task moves to `complete` without spawning a fixer.
     - No MERGE_HEAD, no merge (conflict state vanished) → `mergeCompletedTaskWorktree` is re-run instead of spawning a fixer.
  2. Run `npm test` to ensure no regressions in existing board tests.
  3. Integration test: Create a race condition where conflict-detection stores a conflict but the merge is resolved before the fixer launches (e.g., another process commits the merge). Verify the fixer doesn't waste a turn hunting for a non-existent merge.

- **Accept:** When `startMergeConflictFixer` is called but MERGE_HEAD does not exist in the integration worktree, no fixer chat is spawned. Instead, the merge is re-run or the task advances directly, and the board log records the recovery action.

## Verification Checklist

- [ ] `npm test` passes with no regressions
- [ ] `npm run build` passes
- [ ] In auto mode, a hung fixer chat (stream doesn't end cleanly after successful commit) advances to `complete` within the stall timeout
- [ ] A fixer launched onto a clean tree (no MERGE_HEAD) does not spawn a wasted fixer turn; merge is re-run or task advances
- [ ] `recoverInterruptedMergesAfterReload` still works correctly on page reload (existing behavior unchanged)

## Notes for Build Agents

- The `startTaskChatSupervision` function uses `chatTaskRunId(chatId)` which relies on `chat.runs[0]` being the active run. The fixer chat's run is set by `runChatTurn`, which is called right before supervision attaches — same pattern as the other starters.
- The heartbeat callback in supervision uses `performance.now()` — it's browser-only. Tests running under Node must mock or skip heartbeat logic (the existing pattern is `skipBackgroundBoardChatLaunch()` which checks `process.env.MINNOW_TEST`).
- The `taskChatStallRestarts` map is shared across all chat types. Its `delete` in `stopTaskChatSupervision` already handles fixer chat IDs (the stream-end handler calls `stopTaskChatSupervision(endedChatId)` for all chats before dispatching to per-type finalizers).
- When adding the `phase` parameter to `startTaskChatSupervision`, use a string union type (`'build' | 'fixer'`) with a default of `'build'` to keep existing call sites source-compatible. The two existing callers in `startTask` and `startTaskTesting` can omit the parameter or pass `'build'` explicitly.
- The `finalizeMergeFixerOnStreamEnd` function is async; the heartbeat callback should fire-and-forget it (`.catch()` log) since heartbeats are synchronous callbacks. This matches the pattern already used for `runSelfHeal` in the existing build-phase heartbeat.
