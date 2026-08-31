# Fix: worktree allocate stalls on a broken integration `node_modules`

**Status:** In progress  
**Date:** 2026-08-30  
**Related:** MIN-628 (ELOOP dep links, Done), MIN-705 (P3-A worktree lifecycle)

## Problem

V2 Boards fail to start the next task with:

```
runner effector: worktree allocate failed: dependency source
~/.minnow/worktrees/<repo>/<board>/integration/node_modules does not resolve
```

`start()` throws, the journal records nothing, and the reconcile loop retries the same allocate forever.

## Root cause

Task worktrees seed `node_modules` from the board **integration** checkout. If that source exists but is a dangling/looping symlink, `createWorktree` fail-closes.

Two holes make the MIN-628 repair miss this path:

1. **`ensuredBoards` skips dep repair.** After the first successful `ensureIntegration`, later allocates skip `ensureDependencyDirs` entirely (the cache is only meant to skip a git round-trip).
2. **No fallback, and fail-closed on an unusable *source*.** A broken integration link is not copied (correct), but the allocate still fails even when the *target* is clean. The agent never starts.

## Fix

- [x] When the source is missing or broken, still remove a broken *target* link (do not leave ELOOP behind).
- [x] On `ensureBoardIntegration` cache hit, re-run `ensureDependencyDirs` from the workspace into integration.
- [x] `createWorktree`: if seeding from integration fails, fall back to the main workspace. Fail the allocate only when the task tree still has a broken dep link.
- [x] Tests: source-broken target cleanup; createWorktree fallback; second allocate after a cached board with a corrupted integration link.
- [x] Update `documentation/context.md`.

## Todos

- [x] Repair broken target when source is missing/broken in `ensureDependencyDirs`
- [x] Always refresh integration dep links on allocate (cache must not skip repair)
- [x] `createWorktree`: fall back to workspace; fail only if target still broken
- [x] Add tests for cached allocate + broken integration source
- [x] Update `context.md`
