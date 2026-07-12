# Orchestrate Board OOM Crash — Investigation & Fix Plan

**Status:** Shipped (2026-06-26)

## Summary

Renderer OOM during heavy AFK orchestrate runs (3 concurrent tasks + merge fixers + browser automation) killed the Electron renderer. Fixes reduce memory pressure, pause AFK auto-resume after OOM, and harden crash logging / board-log mirror reliability.

## Shipped fixes

### Phase 1 — Crash recovery + UI

- **Kanban heartbeat in-place sync** — `syncKanbanHeartbeatBadges` avoids full kanban rebuild on 1s heartbeat ticks (`src/ui/orchestrate-board.ts`).
- **OOM crash handler** — `render-process-gone` calls `flushCrashLogSync()` and writes `~/.minnow/logs/oom-pause.json` when `reason === 'oom'` (`electron/main.ts`, `electron/crash-log.ts`).
- **Pause on OOM resume** — `bootOrchestrateBoardResume` probes OOM marker and calls `pauseAllRunningBoardsForShutdown` instead of `autoDelegateNext` (`src/chat/orchestrate/board-boot-resume.ts`, `src/chat/orchestrate/oom-recovery.ts`).
- **Recovery banner** — diagnostics shows "Board auto-pilot paused after out-of-memory crash — press Start when ready." (`src/boot/diagnostics.ts`).
- **Preview exec-js safety** — guest expressions wrapped in try/catch IIFE returning `{ __execError }` (`electron/preview-guest-actions.ts`, `src/tools/browser-preview-tools.ts`).

### Phase 2 — Memory discipline

- **Task history trim** — `src/chat/orchestrate/task-history-trim.ts`; invoked from `moveTaskStatus` for terminal tasks and `testing` transition.
- **Idle trim on stream-end (MIN-407)** — `trimIdleBoardTaskChats` runs after every board task chat stream-end (build / test / fixer / final) so concurrent AFK runs do not retain full tool transcripts for every completed chat in RAM; skips active and still-streaming chats.
- **Board log caps** — `BOARD_LOG_MAX` 100, preview cap 200 (`src/state/orchestrate-board-store.ts`, `src/state/sessions.ts`).
- **OOM concurrency cap** — `resolveEffectiveMaxConcurrent` limits to 2 while OOM pause is active; header hint in board UI.

### Phase 3 — Observability

- **Board-log mirror retry** — 3× exponential backoff on 404/5xx; boot `GET /api/orchestrate/board-log` ping (`src/state/board-log-disk.ts`, `server/orchestrate/middleware.js`).

## Workaround (if issues persist)

1. After a crash, open the board and press **Stop** before restarting AFK.
2. Lower concurrency to **1–2** in the board header.
3. Avoid `browser_*` in tester tasks when not essential.

## Tests

| Area | File |
|---|---|
| Kanban heartbeat in-place | `test/ui/orchestrate-board-live-update.test.mjs` |
| OOM resume gate | `test/chat/orchestrate/board-boot-resume-oom.test.mts` |
| Task history trim | `test/orchestrate/task-history-trim.test.mts` |
| Board-log GET ping | `test/server/orchestrate-board-log-api.test.mjs` |
| Preview exec wrap | `test/electron/preview-automation.test.mjs` |
| OOM pause marker | `test/electron/crash-log.test.mjs` |

## Primary files

- `electron/main.ts`, `electron/crash-log.ts`
- `src/chat/orchestrate/board-boot-resume.ts`, `oom-recovery.ts`, `task-history-trim.ts`
- `src/state/orchestrate-board-actions.ts`, `orchestrate-board-store.ts`, `board-log-disk.ts`
- `src/ui/orchestrate-board.ts`, `src/boot/diagnostics.ts`
- `electron/preview-guest-actions.ts`, `src/tools/browser-preview-tools.ts`
