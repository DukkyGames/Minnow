# Sync file tree to git panel worktree

## Problem

Chat switches call `syncPanelFromActiveChat()`, which sets `panelCwd` from `resolveChatWorktreeRoot()` and updates the git panel worktree dropdown. The follow-up only called `startFileTreeGitStatusPoll(cwd)` — git badge polling — not a tree reload.

The file tree always listed the **main workspace** because `fetchListing()` called `executeTool('list_directory', { path })` **without** `workspaceRoot`.

## Solution (implemented)

- [`src/ui/panel-worktree-cwd.ts`](../src/ui/panel-worktree-cwd.ts) — shared `resolvePanelWorktreeCwd`, `panelPathsEqual`
- [`src/ui/file-tree-listing-root.ts`](../src/ui/file-tree-listing-root.ts) — `listingWorkspaceRoot`, `buildFileTreeToolContext`
- [`src/ui/file-tree.ts`](../src/ui/file-tree.ts) — `syncFileTreeToPanelWorktree`, worktree-scoped listings
- Git panel call sites delegate to `syncFileTreeToPanelWorktree(panelCwd)`
- `file-tree-ops`, `file-viewer`, `file-tree-auto-refresh`, `workspace-button` updated

## Browse vs run-target (2026-07)

Two separate roots:

| Concern | Source | Affects |
| --- | --- | --- |
| **Browse** (Source Control dropdown, Git Center) | `git-panel` `panelCwd` + `panelCwdUserOverride` | File tree, terminal PTY cwd, git panel ops |
| **Run target** (composer) | `Chat.worktreeRoot` | Agent tools only |

- Manual worktree pick sets `panelCwdUserOverride = true` (dropdown, `setGitPanelCwd`, Git Center).
- **New chat** (`createChatWithMode`, desktop fresh chat) seeds composer run-target from browse override via [`new-chat-run-target-seed.ts`](../src/ui/new-chat-run-target-seed.ts) when override is on (worktree → attach; main workspace → Local), then clears browse override and syncs file tree from the new chat.
- Chat switch, composer run-target change, and workspace switch call `clearPanelCwdUserOverride()` then `syncPanelFromActiveChat({ forceFileTree: true })`.
- Composer **This PC** clears `worktreeRoot` and resets `gitBranch` to the main workspace checkout.
- Board events no longer reset panel cwd during runs (`subscribeAllBoardChanges` sync removed), except when board view is active — then browse cwd tracks the integration worktree as tasks allocate worktrees (MIN-464).
- Registered git worktree paths + repo-local `.worktrees/` are allowed `workspaceRoot` overrides without Full disk ([`server/worktree/allowlist.js`](../server/worktree/allowlist.js)).

## Todos

- [x] Add panel-worktree-cwd.ts and refactor git-panel getEffectiveCwdArg to use it
- [x] Implement listingWorkspaceRoot, syncFileTreeToPanelWorktree, and wire git-panel call sites
- [x] Pass workspaceRoot through fetchListing, file-tree-ops, file-viewer, and fix cache invalidation
- [x] Update file-tree-auto-refresh to refresh when agent writes match visible listing root
- [x] Reset file tree listing root on applyWorkspaceSwitch
- [x] Add file-tree-worktree-sync tests and update documentation/context.md
- [x] Decouple browse override from chat sync; fix composer Worktree menu + create flow
- [x] Extend server allowlist for registered git worktrees
- [x] Seed new-chat composer run-target from Source Control browse override
- [x] Reset git branch to main workspace when composer switches to This PC

## Verification (manual)

1. Open a board with isolated task worktrees; switch between planner chat and a task chat.
2. Confirm git panel worktree dropdown **and** file tree contents both reflect the task worktree.
3. Switch back to a non-worktree chat — file tree returns to main workspace.
4. Manually change worktree in git panel dropdown — file tree follows; composer run-target unchanged.
5. Open a file from worktree tree — viewer loads correct content; save works.
6. Agent mutates a file in the active task worktree — tree auto-refreshes.
7. Composer **Worktree…** lists worktrees and attaches; **New worktree** creates without reverting to Local on failure.
8. Without Full disk, browse a git-panel `+` worktree — file tree lists files (registered path allowlist).

## Tests

`npm run test -- test/file/file-tree-worktree-sync.test.mts test/server/worktree-allowlist.test.mjs`
