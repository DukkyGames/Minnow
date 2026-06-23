# MIN-275 — Worktree + Process Isolation (Build Spec)

Status: **in implementation** (Phase 0 of the MIN-253 Orchestrator & Board UX epic).
Scope owner: orchestrator board. Reusable by MIN-276 (per-chat worktree selector).

## Problem

Every parallel board task chat runs against the **same** working directory. The server
resolves tool cwd from a single active workspace root, so concurrent Builders/Testers
collide on files, the git index, dev servers, and ports. This adds per-task isolation
underneath the existing concurrency model.

## Existing infrastructure we build on

- **Per-request workspace scope already exists.** `server/runtime/path-access.js` uses an
  `AsyncLocalStorage` (`pathAccessStore`). `getEffectiveWorkspaceRoot()` returns
  `store.workspaceRootOverride ?? getWorkspaceRoot()`. `runWithToolContext(fn, { workspaceRoot })`
  runs a tool request scoped to an override. So if a tool request carries a worktree path,
  **all** file/git/terminal tools in that request run with the worktree as cwd.
- **The client already forwards a per-request `workspaceRoot`.** `executeServerTool`
  (`src/tools/client.ts`) sends `context?.workspaceRoot?.trim() || resolveToolWorkspaceRoot()`
  in the `/api/tools` body; the server validates it with `validateAllowedWorkspaceRoot` and
  passes it to `runWithToolContext`.
- **Server runs commands via `runProcess('git', args, { cwd })`** (`server/process-runner.js`),
  already used by `runGit` and the `git_*` tools in `server/runtime/tools-middleware.js`.
- Task chats are created in `getOrCreateBoardChat` (`src/state/orchestrate-board-actions.ts`)
  and currently inherit `plannerChat.workspacePath`.

### The one hard blocker

`isAllowedWorkspaceRoot` (`server/chats-workspace/paths.js`) only allows **four** exact roots
(Code workspace, chats, benchmark, scheduler). A worktree path is rejected. **We must extend
the allowlist** to permit paths under a dedicated worktrees root, or per-task tool execution
cannot be scoped to the worktree.

## Design

### Worktree location

`~/.minnow/worktrees/<repoKey>/<boardId>/<slotId>` where:
- `repoKey` = normalized hash/basename of the Code workspace (keeps repos separate).
- `slotId` = `task-<taskId>` (per-task mode) or `wave-<waveId>` (per-wave mode).

Living under `MINNOW_HOME` keeps worktrees out of the repo tree (no `.gitignore` churn, git
won't scan them as nested repos). `git worktree add` records a gitdir link back to the main repo.

### Branch naming

- Integration branch (board): `minnow/board/<boardId>/integration` — created off the board's
  base branch (current HEAD of the Code workspace) at board start.
- Per-task branch: `minnow/board/<boardId>/task/<taskId>`.
- Per-wave branch: `minnow/board/<boardId>/wave/<waveId>`.
  Branches are created off the **integration branch** so each task builds on merged work.

### Isolation mode (per board)

`isolationMode: 'off' | 'per-task' | 'per-wave'` stored on `OrchestrateBoardState`.
Resolution (per-board override ?? autonomy default ?? hard fallback):
- `sequential` → `off` (one task at a time; no isolation needed).
- `auto` / `afk` → `per-task`.
- `manual` → `off`.
- `per-wave`: one worktree/branch per wave; tasks in a wave share it (fewer merges).
Surfaced later in MIN-218 settings; for now resolved from execution mode with an optional
explicit `board.isolationMode` override.

### Process isolation

- **cwd:** the task chat's `workspacePath` is set to its worktree. Because the client forwards
  `context.workspaceRoot` (derived from the chat's `workspacePath`) and the server scopes the
  request via `runWithToolContext`, file/git/terminal tools run inside the worktree.
- **Ports:** each occupied isolation slot gets an allocated dev-server port from a base range
  (`MINNOW_BOARD_PORT_BASE`, default 5200) so concurrent dev servers don't collide. Port is
  stored on the task and exposed to tooling via env (`PORT`).

### Merge / integration (orchestrator-driven)

- **per-task:** when a task completes, merge its task branch into the board integration branch.
- **per-wave:** merge at wave boundaries.
- On conflict: the orchestrator resolves or spawns a fixer sub-agent — **no user prompt**
  (consistent with auto/afk self-heal, MIN-265).
- The integration branch is what MIN-208's finish dashboard commits/pushes from.

### Cleanup

- `git worktree remove --force` + delete the slot dir on task delete (ties into MIN-252) and on
  board completion. Prune stale worktrees on board load.

## Module layout

| Layer | File | Responsibility |
|---|---|---|
| Server | `server/worktree/worktree-ops.js` | `git worktree add/remove/list/prune`, `branch`, `merge` via `runProcess` with the Code-workspace repo cwd. |
| Server | `server/worktree/paths.js` | `getWorktreesRoot()`, repo/slot path builders, allow worktree paths. |
| Server | `server/chats-workspace/paths.js` | extend `isAllowedWorkspaceRoot` to accept paths under the worktrees root. |
| Server | `server/runtime/tools-middleware.js` | register `worktree_*` tool handlers. |
| Client | `src/state/worktree-isolation.ts` | **pure** helpers: mode resolution, path/branch naming, port allocation. Unit-tested. |
| Client | `src/state/worktree-service.ts` | thin async wrappers calling the `worktree_*` server tools. |
| State | `src/types.ts` | `BoardTask.worktreePath/worktreeBranch/devPort`; `OrchestrateBoardState.isolationMode/integrationBranch`. |
| State | `src/state/orchestrate-board-actions.ts` | create/attach worktree in task start; merge on complete; cleanup on delete/finish. |

## Windows concerns (must test on Windows)

- Worktree paths use `path.join`; normalize to forward slashes only for display/keys.
- `node_modules`/dev-server file locks: each worktree gets its own `node_modules` (or a shared
  store) — document that `npm install` per worktree may be required; dev servers must be stopped
  before `git worktree remove` (use `--force` as a fallback).
- Bash-tool cwd: confirmed routed through the per-request `workspaceRootOverride`, which is an
  absolute path — Windows-safe.
- `git worktree remove` can fail if a process holds the dir open; retry with `--force` then a
  manual `prune`.

## Acceptance

- Concurrent tasks do not corrupt each other's files or fight over ports.
- Mode is configurable and defaults correctly per autonomy level.
- Task branches merge into the integration branch with orchestrator-driven conflict handling.
- Worktree create/attach/cleanup is a reusable service (consumed by MIN-276).
- Verified on Windows.

## Phasing of the implementation

1. **Pure foundation** (this step): types + `worktree-isolation.ts` (mode/naming/ports) + tests.
2. **Server ops**: worktrees root + allowlist + `worktree-ops.js` + `worktree_*` tools.
3. **Client service** + wire into `getOrCreateBoardChat`/`startTask` (create + set workspacePath + port).
4. **Merge + cleanup** in board actions.
5. **Windows integration testing** (live, manual) + MIN-218 settings surface (separate issue).
