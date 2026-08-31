# V2 boards: scope lists and worktrees to the current workspace

**Status:** implemented  
**Date:** 2026-08-30  
**Register:** product  
**Linear:** [MIN-752](https://linear.app/minnowai/issue/MIN-752)

## Goal

V2 boards and user-facing worktree pickers only show (and start) work for the current Code workspace. Workspace switch confirm-and-stops running V2 boards, matching V1.

## Todos

- [x] Add optional `workspacePath` to `board.created`, fold into `BoardState`, stamp `getWorkspaceRoot()` on create, 409 mutating commands on mismatch
- [x] Filter `GET /api/boards` with `boardBelongsToWorkspace` (stamped path + legacy worktree/plan inference)
- [x] Extend workspace-switch-guard to confirm-and-stop running V2 boards; refresh Boards list and git/SCC worktree chrome on switch
- [x] Add `filterUserFacingWorktrees` and use it in git-panel, SCC, composer, and dev-server pickers
- [x] API/derive/events/switch-guard/worktree-filter tests; `context.md` + this plan; Linear bug MIN-752

## Why

Journals live in a **global** `~/.minnow/boards/<boardId>/` tree. `board.created` had no `workspacePath`. `GET /api/boards` returned every id. Workspace switch still only dismissed V1 board DOM. Git/SCC pickers called `git worktree list` with no path filter, and `applyWorkspaceSwitch` never refreshed that chrome.

Starting a leaked board is worse than a list bug: create/start/worktree ops all use live `getWorkspaceRoot()`, so a board from workspace A can run git against workspace B.

This was not covered by remaining Orchestrator V2 phases (4–7). Closest historical work is V1's `ChatGroup.workspacePath` + MIN-344 switch guard.

## Locked decisions

- **Display:** only the current workspace's boards and worktrees.
- **Switch:** V1 behavior — confirm, then stop running V2 boards in the workspace you are leaving, then switch.
- **Do not rewrite old journals.** Infer workspace for existing boards at list time.
- **Engine keep-alive across switch is out of scope.** Stop, then retarget is not needed if we always stop first.
- **Do not partition storage** (`boards/<repoKey>/`) — ids stay stable; filtering is enough.

## What shipped

- Optional `workspacePath` on `board.created` (same additive pattern as `merge.succeeded.beforeSha`).
- [`boardBelongsToWorkspace`](../../server/orchestrator/workspace-scope.js): stamped path, else a slot under this repo's worktrees, else never-run with a plan file here and no other-repo slot.
- Mutating `/api/boards/:id/*` commands 409 when the board belongs to another workspace.
- [`filterUserFacingWorktrees`](../../src/lib/worktree-list-parse.ts) next to `filterUserFacingBranches`.
- Switch guard lists running V2 boards, reuses the V1 confirm copy, `POST /stop`, then refreshes Boards + git/SCC/dev-server worktree chrome.
