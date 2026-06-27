# Orchestrator Edge-Case Fixes

A focused remediation plan for six defects found while reviewing the orchestrator
state machine (`src/state/orchestrate-board-actions.ts` and its store / self-heal /
classifier modules). Each fix is independent except where noted; **land Fix 1 first**.

All line references are against the `AFK-Mode` branch at time of writing — re-confirm
before editing.

## Guardrails

- Preserve frozen-signature exports (MIN-285) — change function **bodies**, not exported signatures.
- Reuse existing config resolvers already imported in board-actions
  (`resolveSelfHealMaxRounds`, `resolveAfkAutoRestartStalls`, `resolveMaxMergeFixerAttempts`).
  Do not add new config unless Fix 1's timeout warrants a local constant.
- Every fix ships with a unit test under `test/orchestrate/`. Run the suite with
  `node --test --test-force-exit` (open-timers in the UI test harness otherwise hang on exit).

---

## Fix 1 — `waitForNoActiveFixer` unbounded busy-wait (deadlock) — **highest priority**

**Where:** `src/state/orchestrate-board-actions.ts:257` (`boardHasActiveFixer`) and `:264`
(`waitForNoActiveFixer`), consumed by `enqueueMergeCompletedTaskWorktree` at `:1727`.

**Symptom / cause:** `boardHasActiveFixer` returns true purely on
`status === 'merging' && fixerChatId` set — it never checks whether that fixer chat is
actually streaming. If a fixer's stream-end never delivers mid-session (and supervision was
dropped), the task stays `merging` with a stale `fixerChatId`, and **every** subsequent
sibling merge on that board blocks forever. There is no timeout and no escape;
`recoverInterruptedMergesAfterReload` only runs on reload.

**Fix:**
1. Gate `boardHasActiveFixer` on `isTaskChatActive(fixerChatId)` (exported at `:1006`) so a
   dead fixer chat does not count as active:
   ```ts
   function boardHasActiveFixer(board: OrchestrateBoardState): boolean {
     return board.tasks.some(
       (t) =>
         t.status === 'merging' &&
         Boolean(t.fixerChatId?.trim()) &&
         isTaskChatActive(t.fixerChatId!.trim()),
     );
   }
   ```
2. Add a bounded wait to `waitForNoActiveFixer`. Introduce a module const (e.g.
   `const MAX_FIXER_WAIT_MS = 60_000;`) and track elapsed time; when exceeded, log via
   `reportBackgroundError` and return so the merge proceeds rather than hanging:
   ```ts
   async function waitForNoActiveFixer(group: ChatGroup): Promise<void> {
     const board = group.orchestrateBoard;
     if (!board) return;
     const start = Date.now();
     while (boardHasActiveFixer(board)) {
       if (Date.now() - start > MAX_FIXER_WAIT_MS) {
         reportBackgroundError(
           'wait-for-fixer-timeout',
           new Error('Fixer wait exceeded cap; proceeding with merge'),
         );
         return;
       }
       await new Promise((resolve) => setTimeout(resolve, 50));
     }
   }
   ```

**Test:** new case in `test/orchestrate/merge-fixer-stall.test.mts` (or a new
`merge-deadlock.test.mts`): seed a `merging` task whose `fixerChatId` points to a
**non-streaming** chat, enqueue a sibling merge via `enqueueMergeCompletedTaskWorktree`,
and assert the sibling merge resolves (does not hang). Because the dead fixer no longer
counts as active, the wait returns immediately.

---

## Fix 2 — `selfHealRound` cap is effectively dead for non-infra failures

**Where:** `src/state/orchestrate-self-heal.ts:186` (cap check) vs `:202` (only increment,
infra path).

**Symptom / cause:** the global round cap reads `selfHealRound`, but only the infra branch
bumps it. Code / test / stall / merge paths rely on their own counters
(`buildAttempts` / `testAttempts` / `fixerAttempts`), so a task oscillating across
categories (stall→code→infra→stall) can exceed the intended global self-heal budget — the
`resolveSelfHealMaxRounds()` ceiling is never reached for those paths.

**Fix:** make `resolveSelfHealMaxRounds()` a **true global ceiling**. Increment
`selfHealRound` on every non-return self-heal path, not just infra:
- Stall path (`:222`): bump alongside the existing `lastHealCategory: 'stall'` update.
- Code path (`:245`): bump alongside the `pendingBuildSeed` / `lastHealCategory: 'code'` updates (both build and test branches).
- Merge path (`:277`): bump alongside the `lastHealCategory: 'merge'` update.

Keep the per-category counters as the inner caps (they still bound each category). The
unconditional cap at `:186` then catches cross-category oscillation. Add a one-line comment
at the cap explaining it is the global ceiling above the per-category caps.

**Test:** extend `test/orchestrate/orchestrate-self-heal.test.mts`: drive a task through
mixed-category failures (e.g. stall → code → merge) and assert it quarantines once
`selfHealRound` reaches the max, even when no single per-category counter is exhausted.

---

## Fix 3 — user-stop quarantine cascades to dependents, but Requeue does not

**Where:** quarantine at `src/state/orchestrate-board-actions.ts:497`
(`finalizeBoardTaskOnStreamEnd`, the `parkUserStop` branch) via
`quarantineTaskAndDependents` (`orchestrate-board-store.ts:530`); requeue at `:2802`
(`requeueBoardTask`) resets only the single root task.

**Symptom / cause:** a deliberate user-stop quarantines the whole transitive dependent
subtree (dependents get the auto-payload
`{ category: 'stall', summary: 'blocked by quarantined <root>', resolutionSteps: [] }`).
Requeuing the root resets only that one task, leaving dependents stuck `quarantined`
indefinitely.

**Fix (chosen: cascade the requeue — also fixes genuine-failure requeues):** in
`requeueBoardTask`, after resetting the root to `planned`, walk the board and reset every
task whose quarantine payload is the auto-generated "blocked by quarantined `<root>`" shape
back to `planned` (clearing `quarantine`). Detect the shape by matching
`quarantine.summary === \`blocked by quarantined ${taskId}\`` (the exact string produced at
`orchestrate-board-store.ts:562`). Use the existing `logTaskStatus` + `updateTask` calls per
task so wave rollup and persistence stay consistent. Then the existing
`if (isBoardRunning(group)) await autoDelegateNext(...)` re-drives the freed subtree.

Note: only release dependents quarantined **solely** because of this root — a dependent with
its own distinct quarantine summary must stay quarantined.

**Test:** `test/orchestrate/orchestrate-quarantine-completion.test.mts` (or `task-recovery`):
quarantine a root + dependent chain via `quarantineTaskAndDependents`, call
`requeueBoardTask` on the root, and assert the dependents return to `planned` with
`quarantine` cleared, while an independently-quarantined sibling stays `quarantined`.

---

## Fix 4 — `stopRetries` never cleared on success

**Where:** `src/state/orchestrate-board-actions.ts` `finalizeBoardTaskOnStreamEnd`
stopped-branch (`:524`); `stopRetries` is only deleted via quarantine or explicit reset
(store `updateTask` undefined-handling at `orchestrate-board-store.ts:895`).

**Symptom / cause:** the count accumulates across unrelated stop episodes. A task that stops
once, succeeds, then is later reopened (e.g. by a failed final integration test) carries the
stale count and can quarantine earlier than intended.

**Fix:** clear `stopRetries` on the success transition. In the `outcome === 'completed'`
branch, the task is patched at `:592` with
`{ endedAt, error: undefined, testVerdict: undefined, testSummary: undefined }` before
moving to `testing` — add `stopRetries: undefined` to that same patch.

**Test:** extend `test/orchestrate/task-stream-end.test.mts`: drive stop → retry → complete
and assert `stopRetries` is `undefined` after the success transition.

---

## Fix 5 — `parseTesterVerdictMarker` only inspects the single most-recent assistant message

**Where:** `src/state/orchestrate-board-actions.ts:2335` (`parseTesterVerdictMarker`),
consumed by `finalizeTaskTestingOnStreamEnd` at `:2374`.

**Symptom / cause:** the loop returns as soon as it sees the first non-empty assistant
message; if that message lacks a `VERDICT:` marker it returns `null`, even when an earlier
assistant message reported `VERDICT: pass`. A tester that reports the verdict and then emits
trailing prose is treated as a failure → routed into self-heal. This is a fallback-only path
(the structured `board_report_test_result` call is primary), but the asymmetry is a latent
false-fail.

**Fix:** scan backward and return the **most recent assistant message that contains** a
`VERDICT:` marker, rather than stopping at the first non-empty assistant message. If no
assistant message contains a marker, return `null` (unchanged). Add a clarifying comment that
the structured report remains the primary signal and this is the prose fallback.

**Test:** extend `test/orchestrate/task-testing.test.mts`: tester history =
`[assistant "VERDICT: pass", assistant "all good!"]`, assert the verdict resolves to `pass`
(and the task merges rather than self-heals).

---

## Fix 6 — `mergeQueueByGroupId` leak + implicit drain re-entrancy

**Where:** `src/state/orchestrate-board-actions.ts:249` (`mergeQueueByGroupId`), `:272`
(`enqueueBoardMerge`); double-drain in `safeDrain` (`:827`) and `drainTaskQueue` (`:1497`).

**Symptom / cause:** merge-queue entries are never deleted (a bounded leak — one resolved
promise retained per board). `drainTaskQueue` is async with an `await` inside its `while`
loop and is invoked twice by `safeDrain` (immediate + microtask), relying on per-tick
atomicity of `shift()` rather than an explicit guard.

**Fix (low-risk, keep minimal to protect the serialized-merge invariant):**
1. Add an explicit per-group re-entrancy guard to `drainTaskQueue`: a
   `Set<string>` of group ids currently draining; if a drain for the group is already in
   flight, return early. Clear the flag in a `finally`. This coalesces overlapping drains
   instead of racing on `shift`.
2. Optional / document-only: prune resolved `mergeQueueByGroupId` entries, or leave a comment
   that the retained-promise bound (one per board) is acceptable. Do **not** restructure the
   merge serialization.

**Test:** extend `test/orchestrate/delegate-tasks.test.mts` (or a merge test): enqueue more
tasks than the concurrency cap, fire two concurrent `drainTaskQueueForTests` calls, and
assert each queued task is started exactly once (no double-launch).

---

## Sequencing

1. **Fix 1** + its regression test (highest value; also underpins the e2e deadlock scenario
   in the harness plan).
2. Fixes 2–6 independently, in any order. Each is a small body change plus one focused test.

## Verification

- `node --test --test-force-exit test/orchestrate/` — full orchestrate suite green.
- Targeted: run each touched test file individually while iterating.
- Typecheck / lint per project scripts before finishing.
