# Fix AFK builder idle after generation stop

AFK builder chats that stop mid-tool stay `in_progress` forever because stall recovery runs while the chat still counts as active, then nobody re-drives the board. Defer recovery until after stream teardown, count live tool output as progress, and keep the board-chat composer chrome attached.

## Problem

Two stacked bugs:

1. **False stall during a long tool.** Board supervision only bumps progress on SSE / tool-*start* activity. A long `execute_command` produces terminal chunks but no stream activity, so the watchdog fires at `3 × progressStallMs` (~4.5 min), calls `stopGeneration`, and leaves “generation stopped” on the last tool row.
2. **Recovery no-op, then silence.** The stall tick immediately calls `runTaskChatNudge`, which returns at `if (isTaskChatActive(targetChatId)) return` because the abort has not finished. Stream-end then returns early on purpose (`stallRestarts > 0` → “nudge owns recovery”), releases the slot, and only `drainTaskQueue` (empty). Heartbeat is already stopped. The card stays `in_progress` with no stream.

The composer vanishing is the same stream-end chrome refresh: Orchestrate hides `.input-bar` unless `#mainColumn` has `main-column--board-chat`. `refreshActiveBoardIfMounted` already short-circuits when the embed is open, but it never re-asserts that class or remeasures the composer box.

## Approach

1. **Own stall recovery on stream-end (builder/tester).** Match the fixer path: heartbeat kills only. Schedule continue-nudge / self-heal with `runAfterChatRelease` after the slot is actually free.
2. **Flush continuations after streaming is false.** `notifyChatStreamEnded` runs before `setStreaming(false)`. Do not invoke a queued continuation while `isTaskChatActive`. Retry on a microtask. If the task is still idle `in_progress`/`testing`, fall back to `autoDelegateNext` (uses `isTaskStalledForRestart`) — do not swap every slot-release drain for that.
3. **Defer missing `board_report` nudges** the same way (`runAfterChatRelease`).
4. **Count live tool output as progress** via `notifyChatStreamActivity` on `execute_command` stdout/stderr chunks.
5. **Re-assert board-chat composer chrome** on embed refresh so stream-end cannot drop `main-column--board-chat`.

Out of scope: changing `progressStallMs`, tool `timeout_ms` defaults, or the AFK scenario catalog.

## Todos

- [x] Save this plan at `documentation/plans/board-task-idle-after-slot-release.md`
- [x] Heartbeat: kill + mark stall-stopped only (like fixer); move nudge/self-heal to stream-end via `runAfterChatRelease`
- [x] Flush queued continuations only after `isTaskChatActive` is false (microtask + `releaseLaunchSlotAndDrive`); stall idle fallback to `autoDelegateNext`
- [x] `tryNudgeForMissingBoardReport` uses `runAfterChatRelease` instead of an immediate `runTaskChatNudge`
- [x] `notifyChatStreamActivity` on `execute_command` / terminal stdout/stderr chunks so long tools do not false-stall
- [x] `ensureBoardChatComposerChrome` on embed refresh so stream-end cannot drop `main-column--board-chat`
- [x] Update stall tests; add streaming-true recovery + missing-report + composer class + terminal activity regressions
- [x] Update `documentation/context.md` stall/recovery + terminal progress behavior
