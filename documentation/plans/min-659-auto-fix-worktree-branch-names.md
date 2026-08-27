---
name: Auto-fix worktree and branch names
overview: Composer and Source Control create-worktree / create-branch flows slugify invalid names instead of erroring, preview the name that will be used, and default to a readable slug from chat title or path. Board-task worktree naming stays unchanged.
todos:
  - id: slug-helper
    content: Add shared slugifyGitRefName / suggestGitRefName helper with unit tests (Test Worktree → test-worktree)
    status: completed
  - id: popover-preview
    content: Live-preview the slug in the git name popover; submit the sanitized name
    status: completed
  - id: composer-scc-flows
    content: Wire composer New worktree, SCC New branch / Add worktree, git-panel, and git-graph Create Branch
    status: completed
  - id: server-backstop
    content: Slugify worktreeAdd, checkout-create, and createChatWorktree; leave board createWorktree alone
    status: completed
  - id: tests-docs
    content: Cover helper, popover, git-ops, chat worktree; update context.md and Code manual
    status: completed
isProject: false
---

# MIN-659 — Auto-fix worktree / branch names

## Problem

Typing `Test Worktree` in composer or Source Control fails because git rejects spaces. Empty or illegal characters are rejected rather than repaired. Default names can be the current branch (`main`) or an opaque chat id instead of a readable slug from the chat title or folder path.

## Approach

- Shared helper [`src/lib/git-branch-slug.mjs`](../../src/lib/git-branch-slug.mjs): lowercase kebab-case, preserve `/` as hierarchy, never return empty.
- The name popover shows **Will use &lt;slug&gt;** while the typed text differs, and submits the slug.
- Defaults come from chat title (if not “New chat”) or the workspace/folder basename, never `main`/`master`/the current branch.
- Server backstop on `/api/git` create (`checkout -b`, `worktreeAdd`) and `createChatWorktree`. **Do not** slugify board-task `createWorktree` (already named in `worktree-isolation.ts`).

## Non-goals

- Orchestrator board-task slot / branch naming.
- Tag names, stash messages, or switching to an existing mixed-case branch.
