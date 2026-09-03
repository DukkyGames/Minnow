# MIN-780 — Main / master worktree missing from Source Control

**Status:** implemented  
**Linear:** [MIN-780](https://linear.app/minnowai/issue/MIN-780/main-master-worktree-missing)  
**Date:** 2026-09-01

## Problem

- Sidebar Source Control worktree dropdown sometimes omits the git **principal** checkout (the main/master worktree).
- Composer **Worktree…** can still list that checkout, but the row is not usable as “go back to main” (disabled / wrong attach).
- Repro context: Code workspace is often a **linked worktree** (composer New worktree / attach), not the principal folder.
- Desired: picking the principal worktree restores **browse + composer Local** on that checkout.

## Root causes

1. **“Main worktree” == Code workspace path** — UI treats `path === getWorkspacePath()` as the principal. When the workspace folder *is* a linked worktree, that linked slot gets the `— workspace` label and the real git principal is easy to miss or mis-handled.
2. **Case-sensitive path compares** — `panelPathsEqual` / composer `norm !== repoRoot` do not normalize Windows drive letters. Git porcelain often has `C:/…` while the workspace is `c:\…`, so the principal is not recognized as Local and can appear as a fake “extra” worktree.
3. **Composer attach vs Local** — selecting the principal via Worktree… calls `attachChatToWorktree` instead of `setChatRunTargetLocal` when path equality fails.

## Todos

- [x] Plan + align with repro (sidebar dropdown, Worktree… disabled/unusable, workspace = linked wt)
- [x] Principal-worktree helpers + case-insensitive path equality in shared parse/panel helpers
- [x] Sidebar + SCC: always list principal; label `main worktree`; select → browse Local when principal is the Code workspace, else browse principal path
- [x] Composer: Worktree… selecting workspace twin → Local; when workspace is a linked slot, Run on lists **Main worktree** (never grayed)
- [x] Tests for path equality, principal labeling, filter always keeping principal
- [x] Update `documentation/context.md`

## Locked decisions

- Git’s **first** `git worktree list --porcelain` entry is the principal worktree (same rule as `resolveMainWorktreePath` on the server).
- “Local” means the Code workspace folder with no `chat.worktreeRoot`. Selecting the principal when it **is** the Code workspace must clear worktree mode (not re-attach the same path).
- When the Code workspace **is** a linked worktree, the principal still appears in pickers so the user can browse/run there; labeling uses **main worktree**, not `— workspace` (that label stays for the Code workspace path only).
