# Orchestrator Flow E2E Harness

The 25 existing tests under `test/orchestrate/` are all **single-transition** unit tests —
each asserts one state-machine edge in isolation. There is no test that drives a board through
its **whole lifecycle**: `board_init` → build → test → merge → final integration test →
plan-complete. This plan adds a reusable flow harness plus a first set of scenarios, so
regressions in cross-transition behavior (wave gating, concurrency, self-heal, merge
serialization, reload recovery) are caught automatically.

## Why this is feasible (existing seams to reuse)

The codebase already exposes everything the harness needs — no new production code required:

- **Deterministic launch suppression:** `skipBackgroundBoardChatLaunch()`
  (`orchestrate-board-actions.ts:912`, gated on `MINNOW_TEST=1`) stops real chat turns from
  firing, so the state machine is driven purely by injected outcomes.
- **Exported finalizers:** `finalizeBoardTaskOnStreamEnd`, `finalizeTaskTestingOnStreamEnd`,
  `finalizeFinalTestOnStreamEnd`, and `finalizeMergeFixerOnStreamEndForTests`; plus
  `notifyChatStreamEnded`, `triggerFixerStallReconcileForTests`,
  `simulateUnmatchedFixerStreamEndForTests`.
- **Test setters:** `setSessionStateForTests`, `setBoardNowForTests`,
  `setLocalServerAvailableForTests`, `clearTaskQueuesForTests`, `releaseLaunchSlotForTests`,
  `clearTaskChatStallRestartsForTests`.
- **Slot / queue introspection:** `listRunningBoardTaskSlots`, `countRunningTaskChats`,
  `getTaskQueueForTests`.
- **Auto-pilot entry points:** `startBoardAutoRun`, `autoDelegateNext` — drive these (not the
  finalizers directly) so the harness exercises real delegation + wave/dep gating.
- **Worktree mock:** the `mockWorktreeOps(responses)` pattern in
  `merge-fixer-stall.test.mts:126` stubs `/api/worktree` calls by `op` field. Lift it into a
  shared helper.

## New files

- `test/orchestrate/_board-flow-helpers.mts` — shared fixtures + harness.
- `test/orchestrate/board-flow-e2e.test.mts` — scenarios.

## Shared helpers (`_board-flow-helpers.mts`)

Extract the duplicated fixture builders currently copy-pasted across the merge-fixer tests:

- `makePlanner(overrides?)`, `makeGroup(tasks, opts?)`, `seedBoard(spec, mode)` — build a
  planner chat, a board group via `initBoard`, set `integrationBranch` / `executionMode` /
  `autoRunning`, and register via `setSessionStateForTests`.
- `mockWorktreeOps(responses)` — the by-`op` fetch stub (returns a restore fn).
- `injectChatOutcome(chat, outcome)` — populate a launched chat so the matching finalizer reads
  the scripted result:
  - `build: 'complete' | 'fail' | 'stopped'` → push assistant message and/or a `runs` entry
    (`status: 'stopped' | 'failed'`) matching `resolveTaskChatStreamOutcome`
    (`orchestrate-board-actions.ts:400`).
  - `test: 'pass' | 'fail'` → set `task.testVerdict` / `task.testSummary` (the structured
    `board_report_test_result` result), or a `VERDICT:` marker for the fallback path.
  - `merge: 'clean' | 'conflict'` and `fixer: 'resolve' | 'fail'` → drive via `mockWorktreeOps`
    responses (`check_merged`, `verify_integration`, `merge`, `merge_in_progress`,
    `ensure_integration`, `refresh_integration_deps`, `restore_integration`).
- Assertion utils: `assertTaskStatus(group, id, status)`,
  `assertBoardConverged(group)` (every task terminal: `complete` | `quarantined`),
  `getUnresolvedIssues(group)`.

## Harness (`driveBoardToConvergence`)

```
driveBoardToConvergence(group, planner, script, { maxIterations = 50 })
```

- **Input `script`:** per-task outcome plan, e.g.
  `{ 'W1-A': { build: 'complete', test: 'pass', merge: 'clean' },
     'W1-B': { build: 'fail-then-heal', test: 'pass', merge: 'conflict', fixer: 'resolve' } }`,
  plus an optional `finalTest: 'pass' | 'fail'`.
- **Loop** (bounded by `maxIterations`, throw on overflow so non-convergence fails fast):
  1. `await autoDelegateNext(group, planner)`.
  2. Read `listRunningBoardTaskSlots(board)` → newly launched chats not yet resolved.
  3. For each slot: look up its scripted step, `injectChatOutcome`, set `mockWorktreeOps` for
     this step, then fire the matching stream-end (`notifyChatStreamEnded(chatId)` or the
     phase finalizer). Release the launch slot.
  4. If the board has a pending final test, inject its outcome and finalize.
  5. Stop when `assertBoardConverged` holds or no slot advanced this iteration.
- Drive **through** `startBoardAutoRun` / `autoDelegateNext` so wave barriers, dependency
  gating, and the concurrency cap are all real.

## Scenarios (`board-flow-e2e.test.mts`)

1. **Happy path:** 3 tasks across 2 waves, all `build:complete / test:pass / merge:clean` →
   all `complete` → final integration test `pass` → assert `maybeEmitOrchestratePlanComplete`
   fired (board reaches plan-complete).
2. **Wave barrier:** assert no W2 slot ever appears in `listRunningBoardTaskSlots` until all
   W1 tasks are `complete` / `quarantined` (snapshot slots each iteration).
3. **Mixed convergence:** one task fail→self-heal→pass, one conflict→fixer→complete, one
   quarantines (exhausts retries). Assert the board still converges and the quarantined task
   surfaces in `board.unresolvedIssues`.
4. **Fixer-deadlock regression (pairs with edge-case Fix 1):** seed a sibling task whose
   `fixerChatId` points to a dead (non-streaming) chat while another task tries to merge.
   Pre-fix this hangs; post-fix the sibling merge resolves. Mark `{ todo }` until Fix 1 lands,
   then flip to a hard assertion.
5. **Reload mid-flight:** snapshot session state with tasks in `in_progress` / `testing` /
   `merging`, re-run `bootOrchestrateBoardResume`
   (`src/chat/orchestrate/board-boot-resume.ts`), and assert no double-launch (slot count
   stable) and that supervision / merge recovery re-attach.

## Notes

- Set `process.env.MINNOW_TEST = '1'` and `setLocalServerAvailableForTests(true)` in
  `beforeEach`; restore in `afterEach` (mirror the existing merge-fixer test lifecycle).
- Use `setBoardNowForTests` for deterministic timestamps where assertions touch timing.
- Always restore the `fetch` stub and clear queues / launch slots / stall counters in
  `afterEach` to keep scenarios isolated.

## Verification

- `node --test --test-force-exit test/orchestrate/board-flow-e2e.test.mts` — new suite green.
- `node --test --test-force-exit test/orchestrate/` — no regressions in the existing suite.
- Scenario 4 stays `todo`/skipped until edge-case Fix 1 lands, then becomes a passing
  regression test.
