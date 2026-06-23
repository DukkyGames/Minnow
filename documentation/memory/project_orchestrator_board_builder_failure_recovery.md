# Orchestrator board: builder failure recovery

Linked epic: [[project_orchestrator_board_ux_epic]]

## Failure mode (2026-06)

Transient LM Studio / context-overflow errors during AFK board builder turns were misclassified as terminal task failures and destroyed recoverable work:

1. `runChatTurn` catch set `turnRunStatus = 'failed'` and called `rollbackFailedTurnHistory`, wiping assistant/tool transcript rows.
2. `resolveTaskChatStreamOutcome` inferred failure from an empty or error-shaped transcript.
3. Auto-retry used `pendingBuildSeed` + `startTask` (force-new chat), so builders restarted from scratch with no memory of half-built files left uncommitted in the worktree.
4. Concurrent task failure reports to the planner were dropped when `resumeInFlightByChat` / `isChatStreaming` blocked `deliverReport`.

Observed on board `grp_b35…` (calorie-tracker-app): W3-A and W4-A had hundreds of lines of uncommitted work in their worktrees while tasks showed terminal `failed`.

## Fix (Orchestrator-board-upgrade)

| Area | Change |
|------|--------|
| `loop.ts` | Board task chats (`Chat.boardTaskId`): skip rollback; `repairSessionHistoryTail` + persist failed-run output |
| `orchestrate-board-actions.ts` | `resolveTaskChatStreamOutcome` reads latest `TurnRunRecord.status`; auto-retry via `runTaskChatNudge` (same `chatId`); terminal failure runs `check_dirty` + `commit` on per-task worktrees |
| `server/worktree` | New `check_dirty` op (`checkWorktreeDirty`) |
| `report.ts` | Queue orchestrator failure reports while planner is busy; drain on planner stream end |

Manual **Restart** and **Continue** flows unchanged.

## Tests

- `test/orchestrate/build-failure-preserve.test.mts`
- `test/orchestrate/delegate-tasks.test.mts` (concurrent report queue)
- `test/server/worktree-ops.test.mjs` (`checkWorktreeDirty`)
