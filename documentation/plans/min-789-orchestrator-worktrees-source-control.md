# MIN-789 — Orchestrator worktrees missing from Source Control

**Status:** implemented  
**Linear:** [MIN-789](https://linear.app/minnowai/issue/MIN-789/orchestrator-work-trees-dont-show-in-source-control)  
**Date:** 2026-09-02

## Problem

Orchestrator (board) git worktrees no longer appear in Source Control — the Worktrees section, the sidebar git-panel dropdown, and composer **Worktree…**. Board branches (`minnow/board/…`) still show in History but not in the branch dropdown.

## Root causes

1. **Worktree pickers over-filter.** [`filterUserFacingWorktrees`](../../src/lib/worktree-list-parse.ts) (MIN-752) drops `~/.minnow/worktrees/<repoKey>/` slots unless a client-side repo key matches the Code workspace path. `git worktree list` is already scoped to this repository, so that drop hid *this* repo's board slots when:
   - The Code workspace is a **linked worktree** (basename ≠ original repo folder) — same setup MIN-780 fixed for the principal checkout.
   - **Windows:** the client lowercases the folder name before hashing (`minnow-…`) while the server creates `Minnow-…`, and it hashes posix slashes vs the server's backslashes, so both exact-key and basename fallback fail.
2. **Branch pickers blank all board refs.** [`filterUserFacingBranches`](../../src/lib/worktree-list-parse.ts) and [`server/git/git-ops.js`](../../server/git/git-ops.js) drop every `minnow/board/` name, even after the worktree is gone. Locked-elsewhere already hides refs git will refuse to check out.

## Todos

- [x] Plan + align with repro (Worktrees missing; History shows board refs; branch dropdown empty of them)
- [x] Keep every git-listed worktree (do not drop this-repo `.minnow/worktrees/` slots by reconstructed repo key)
- [x] Branch pickers: hide only refs checked out in another worktree; stop the blanket `minnow/board/` omit
- [x] Tests: Windows mixed-case + linked-workspace board slots kept; board branch visible unless locked
- [x] Update `documentation/context.md` (MIN-752 / MIN-789)

## Locked decisions

- Switching to a live board checkout is a **worktree** pick, not a branch checkout (git will not check out a branch already used in another worktree).
- After a board worktree is removed, leftover `minnow/board/…` branches are valid checkout targets and must appear in the dropdown.
- Do not change on-disk `repoKeyForWorkspace` (would orphan existing slots). Repo-key matching is simply no longer used to hide git-listed worktrees.
