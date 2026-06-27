# Sync file tree to git panel worktree

## Problem

Chat switches call `syncGitPanelFromOrchestrator()`, which sets `panelCwd` from `resolveChatWorktreeRoot()` and updates the git panel worktree dropdown. The follow-up only called `startFileTreeGitStatusPoll(cwd)` — git badge polling — not a tree reload.

The file tree always listed the **main workspace** because `fetchListing()` called `executeTool('list_directory', { path })` **without** `workspaceRoot`.

## Solution (implemented)

- [`src/ui/panel-worktree-cwd.ts`](../src/ui/panel-worktree-cwd.ts) — shared `resolvePanelWorktreeCwd`, `panelPathsEqual`
- [`src/ui/file-tree-listing-root.ts`](../src/ui/file-tree-listing-root.ts) — `listingWorkspaceRoot`, `buildFileTreeToolContext`
- [`src/ui/file-tree.ts`](../src/ui/file-tree.ts) — `syncFileTreeToPanelWorktree`, worktree-scoped listings
- Git panel call sites delegate to `syncFileTreeToPanelWorktree(panelCwd)`
- `file-tree-ops`, `file-viewer`, `file-tree-auto-refresh`, `workspace-button` updated

## Todos

- [x] Add panel-worktree-cwd.ts and refactor git-panel getEffectiveCwdArg to use it
- [x] Implement listingWorkspaceRoot, syncFileTreeToPanelWorktree, and wire git-panel call sites
- [x] Pass workspaceRoot through fetchListing, file-tree-ops, file-viewer, and fix cache invalidation
- [x] Update file-tree-auto-refresh to refresh when agent writes match visible listing root
- [x] Reset file tree listing root on applyWorkspaceSwitch
- [x] Add file-tree-worktree-sync tests and update documentation/context.md

## Verification (manual)

1. Open a board with isolated task worktrees; switch between planner chat and a task chat.
2. Confirm git panel worktree dropdown **and** file tree contents both reflect the task worktree.
3. Switch back to a non-worktree chat — file tree returns to main workspace.
4. Manually change worktree in git panel dropdown — file tree follows.
5. Open a file from worktree tree — viewer loads correct content; save works.
6. Agent mutates a file in the active task worktree — tree auto-refreshes.

## Tests

`npm run test -- test/file/file-tree-worktree-sync.test.mts`
