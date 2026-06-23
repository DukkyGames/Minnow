# MIN-275 — Worktree Isolation Testing Guide

Manual verification for [MIN-275](https://linear.app/minnowai/issue/MIN-275/parralization-improvement) (worktree + process isolation for parallel board tasks). Automated unit tests cover pure helpers; this guide covers git plumbing and live board behavior — **especially on Windows**.

**Spec:** [`documentation/specs/MIN-275-worktree-isolation.md`](../specs/MIN-275-worktree-isolation.md)  
**Broader Phase 0 guide (MIN-246, MIN-248, etc.):** [`phase-0-orchestrator-testing.md`](phase-0-orchestrator-testing.md)

---

## What is implemented (as of this branch)

| Area | Status | Notes |
|------|--------|-------|
| Pure helpers (`worktree-isolation.ts`) | ✅ Done | Mode resolution, branch/slot naming, port allocation |
| Unit tests | ✅ 12 passing | `test/orchestrate/worktree-isolation.test.mts` |
| Server git ops | ✅ Done | `server/worktree/worktree-ops.js` |
| `/api/worktree` REST API | ✅ Done | `ensure_integration`, `create`, `merge`, `remove`, `cleanup`, `list` |
| Workspace allowlist | ✅ Done | Paths under `~/.minnow/worktrees` accepted for tool cwd |
| Board wiring — create | ✅ Done | `startTask` → worktree + `chat.worktreeRoot` |
| Board wiring — tool scope | ✅ Done | `loop.ts` forwards `worktreeRoot` as `workspaceRoot` |
| Board wiring — merge | ✅ Done | On test **pass** → merge into integration **before** marking complete |
| Board wiring — sync on start | ✅ Done | `createWorktree` merges integration tip into existing slots; new branches use integration SHA |
| Board wiring — cleanup | ⚠️ Partial | `cleanupBoardIsolation()` exists but is **not wired** to board finish/delete yet (MIN-252) |
| `devPort` allocation | ⚠️ Partial | Stored on task; **not** injected into `execute_command` env (`PORT`) yet |
| Settings UI (`isolationMode`) | ❌ Not yet | MIN-218 — mode is derived from autonomy only |
| `per-wave` mode | ⚠️ Helpers only | Set `board.isolationMode = 'per-wave'` in session JSON to test |
| Conflict auto-fixer | ⚠️ Partial | Merge conflict sets task error; fixer sub-agent spawn not wired |
| Prune on board load | ❌ Not yet | Spec calls for stale worktree prune on board open |

**Isolation defaults (no settings toggle yet):**

| Autonomy / `executionMode` | Isolation |
|------------------------------|-----------|
| **Auto** | `per-task` (one worktree per running task) |
| **Sequential** / **Manual** | `off` (shared workspace, same as before) |

---

## Prerequisites

1. **Git repo** as your Code workspace — committed baseline on `HEAD` (worktrees branch from it).
2. A scratch repo is ideal so you can delete `minnow/board/*` branches afterward.
3. **LM Studio** (or another provider) loaded — needed for full board E2E, not for the API smoke test.
4. A plan with **3–4 independent tasks across 1–2 waves** under `documentation/plans/*.md`.

---

## Step 0 — Automated tests (quick sanity)

```powershell
cd C:\Users\dukky\Documents\Development\Minnow
node --experimental-test-module-mocks ./node_modules/tsx/dist/cli.mjs --import ./test/test-loader.mjs --test --test-force-exit test/orchestrate/worktree-isolation.test.mts
```

✅ All 12 tests pass.  
⚠️ `--test-force-exit` is required or the runner hangs after passing.

---

## Step 1 — API smoke test (no LLM, verifies git on Windows)

This is the fastest way to confirm `git worktree` / branch / merge work in your environment.

### 1a. Start the dev server

```powershell
npm run desktop
```

Note the port from the terminal line:

```
Tools API: http://localhost:<PORT>/api/tools/ping
```

Use that `<PORT>` below (often `5173`).

### 1b. Run the worktree lifecycle

**PowerShell** (`Invoke-RestMethod`):

```powershell
$port = 5173   # replace with your port
$base = "http://localhost:$port/api/worktree"

# 1) Integration branch + worktree
Invoke-RestMethod -Method POST -Uri $base -ContentType "application/json" `
  -Body '{"op":"ensure_integration","boardId":"smoke","branch":"minnow/board/smoke/integration"}'
# ✅ ok: true, path under ...\.minnow\worktrees\<repo>\smoke\integration, created: true

# 2) Task worktree off integration
$r2 = Invoke-RestMethod -Method POST -Uri $base -ContentType "application/json" `
  -Body '{"op":"create","boardId":"smoke","slotId":"task-1","branch":"minnow/board/smoke/task/1","baseRef":"minnow/board/smoke/integration"}'
# ✅ ok: true, path ...\smoke\task-1
$taskPath = $r2.path

# 3) Confirm git sees them (from your main repo root)
git worktree list
git branch --list "minnow/*"
# ✅ integration + task-1 worktrees; minnow/board/smoke/* branches

# 4) Commit inside the task worktree (not your main tree)
Set-Location $taskPath
"isolation works" | Out-File -Encoding utf8 MIN275-PROOF.txt
git add -A
git commit -m "task-1 change"
Set-Location C:\Users\dukky\Documents\Development\Minnow   # back to main repo

# 5) Merge task-1 into integration (runs inside integration worktree)
Invoke-RestMethod -Method POST -Uri $base -ContentType "application/json" `
  -Body '{"op":"merge","boardId":"smoke","fromBranch":"minnow/board/smoke/task/1","message":"merge task-1"}'
# ✅ ok: true — MIN275-PROOF.txt should exist on integration branch

# 6) Cleanup task worktrees (integration kept for MIN-208)
Invoke-RestMethod -Method POST -Uri $base -ContentType "application/json" `
  -Body '{"op":"cleanup","boardId":"smoke"}'
# ✅ ok: true, removed: 1, keptIntegration: true
git worktree list   # task-1 gone, integration remains
```

**curl** (Git Bash / WSL) — same ops as in [`phase-0-orchestrator-testing.md`](phase-0-orchestrator-testing.md#5a-fast-api-smoke-test-verifies-the-git-plumbing-without-a-full-board).

### 1c. Confirm main repo untouched

In your **main repo** working tree:

```powershell
git status
git branch --show-current
```

✅ Working tree clean (or only your unrelated local changes).  
✅ You are still on your original branch — merges happened inside `~/.minnow/worktrees/.../integration`, not in the main checkout.

### 1d. Teardown (when done experimenting)

```powershell
Invoke-RestMethod -Method POST -Uri $base -ContentType "application/json" `
  -Body '{"op":"remove","boardId":"smoke","slotId":"integration"}'
git branch -D minnow/board/smoke/integration minnow/board/smoke/task/1
```

---

## Step 2 — End-to-end via a real board

### 2a. Isolation turns on in Auto mode

1. Open the **Orchestrate hub** → pick your plan → **Open board**.
2. Set autonomy to **Auto** → **Start**.
3. While tasks run, in a terminal at the **main repo root**:

```powershell
git worktree list
git branch --list "minnow/*"
```

✅ Expect:
- One `.../integration` worktree for the board
- One `task-<id>` worktree **per concurrently running task**
- Matching `minnow/board/<groupId>/...` branches

Also check the filesystem:

```powershell
Get-ChildItem "$env:USERPROFILE\.minnow\worktrees" -Recurse -Directory | Select-Object FullName
```

### 2b. Tools run inside the worktree

1. Open a **running task's Builder chat** (click the task card).
2. Watch file/git tool calls in the transcript.
3. If the agent creates a file, verify:

```powershell
# Should appear under the task worktree, NOT in main repo
Get-ChildItem "$env:USERPROFILE\.minnow\worktrees" -Recurse -Filter "<filename>"

git status   # in main repo — should stay clean
```

✅ File lands under `~/.minnow/worktrees/<repo>/<boardId>/task-<id>/`.  
✅ Main repo `git status` unchanged.

**How it works:** `startTask` sets `chat.worktreeRoot`; the tool loop passes it as `workspaceRoot` to `/api/tools`, which scopes file/git/terminal tools via `runWithToolContext`.

### 2c. Merge on test pass

1. Let a task complete its **Tester** phase with verdict **pass**.
2. Inspect the integration branch:

```powershell
git log minnow/board/<groupId>/integration --oneline -5
```

Or open the integration worktree path from `git worktree list` and check files/commits there.

✅ The passed task's branch is merged into the integration branch **before** the task is marked complete, so the next task's worktree is created/synced from an up-to-date integration tip.

**Sequential / wave ordering:** Task B (wave 2 or `dependsOn` task A) should see task A's files when it starts — `createWorktree` merges the current integration branch into the task slot on every `startTask`.

**Parallel same wave (no `dependsOn`):** Tasks in the same wave intentionally branch from the **same** integration snapshot at start time; they do not see each other's in-flight changes until both merge back to integration. Use `per-wave` isolation mode (or explicit `dependsOn` edges) if tasks in a wave must build on each other.

**On merge conflict (harder to trigger):** task should show an error like *"Integration merge conflict … orchestrator will resolve"* — no user prompt. Auto-fixer spawn is not fully wired yet.

### 2d. Isolation off in Sequential / Manual

1. Set autonomy to **Sequential** or **Manual** → run tasks.
2. `git worktree list` should show **only** your main tree (no `~/.minnow/worktrees/...` entries for new tasks).

✅ Tasks use the shared Code workspace exactly as before.

### 2e. Per-wave mode (advanced / manual)

No UI yet. To test helpers + shared worktree behavior:

1. Stop the board.
2. In `~/.minnow/sessions/state.json`, find the board's `orchestrateBoard` and set `"isolationMode": "per-wave"`.
3. Reload the app, set **Auto**, **Start**.
4. Tasks in the same wave should share one `wave-<id>` worktree; different waves get separate worktrees.

---

## Step 3 — Windows-specific checks

| Check | How | Expected |
|-------|-----|----------|
| Path handling | Tool results show absolute Windows paths | No broken mixed slashes in errors |
| File locks on cleanup | Run API cleanup while a file explorer window is open on a worktree | `--force` + prune should still succeed; no orphaned dirs under `~/.minnow/worktrees` |
| `node_modules` | Task that runs `npm run build` | Worktree has **no** `node_modules` initially — agent may need `npm install` in the worktree (known follow-up) |
| Main repo safety | Full board run | Your checked-out branch and working tree stay untouched |

---

## Known gaps (do not file as regressions yet)

- **`cleanupBoardIsolation`** not called on board completion or task delete — worktrees may linger until manual API cleanup or branch delete.
- **`devPort`** allocated but not passed to shell commands — concurrent dev servers may still collide on port 3000/5173.
- **No settings toggle** for isolation mode (MIN-218).
- **No prune on board load** — stale worktrees from crashed runs may need manual cleanup.
- **Conflict fixer** — error surfaced on task; orchestrator self-heal loop not complete.

---

## Quick reference — files touched

| Layer | File |
|-------|------|
| Spec | `documentation/specs/MIN-275-worktree-isolation.md` |
| Pure helpers | `src/state/worktree-isolation.ts` |
| Client API | `src/state/worktree-service.ts` |
| Board wiring | `src/state/orchestrate-board-actions.ts` |
| Tool scope | `src/tools/loop.ts` (`chat.worktreeRoot` → `workspaceRoot`) |
| Types | `src/types.ts` (`BoardTask.worktreePath`, `Chat.worktreeRoot`, etc.) |
| Server ops | `server/worktree/worktree-ops.js` |
| Server API | `server/worktree/middleware.js` → `POST /api/worktree` |
| Allowlist | `server/chats-workspace/paths.js` |
| Tests | `test/orchestrate/worktree-isolation.test.mts` |

---

## Sign-off checklist

Use this when moving MIN-275 out of "In Review":

- [ ] API smoke test (Step 1) passes on Windows
- [ ] Auto board creates worktrees for concurrent tasks (Step 2a)
- [ ] Task file edits land in worktree, main repo stays clean (Step 2b)
- [ ] Passed task merges into integration branch (Step 2c)
- [ ] Sequential/Manual modes create no worktrees (Step 2d)
- [ ] Unit tests pass (Step 0)
- [ ] Documented gaps reviewed and tracked (MIN-252 cleanup wire-up, PORT env, MIN-218 settings)
