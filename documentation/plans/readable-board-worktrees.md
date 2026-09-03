# Readable board worktree and branch names

**Status:** Implemented

Stop naming orchestrator task worktrees and branches after attempt UUIDs. Use the board’s display name plus wave and task id so Source Control and git pickers show which board and card a checkout belongs to.

## Todos

- [x] Add `slotIdForTask(state, taskId)` and switch `allocateAttemptWorktree` new creates off attempt UUIDs; keep reuse of existing paths.
- [x] Assert board+wave+task slot/branch names; update fresh-retry test to stable path + clean checkout.
- [x] Update `context.md` and the `getWorktreeSlotPath` comment to the real naming formula.

## Naming

- **board slug:** `sanitizePathSegment(state.name || boardId)`
- **wave:** `state.tasks.get(taskId).wave`, default `1`
- **slotId:** `{boardSlug}-wave{n}-{taskId}` (one directory; no slashes)
- **branch:** `minnow/board/{boardId}/{slotId}`

Integration stays `integration` / `minnow/board/{boardId}/integration`. Existing UUID checkouts are not renamed; reuse keeps their path until release.

## Out of scope

- Per-wave shared worktrees (`isolationMode`)
- Renaming leftover UUID worktrees on disk
- Changing journal `boardId`
