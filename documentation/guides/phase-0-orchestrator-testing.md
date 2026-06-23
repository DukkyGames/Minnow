# Phase 0 (MIN-253) — Manual Testing Guide

Covers MIN-246, MIN-248, MIN-259, MIN-215, and MIN-275. Automated tests already pass;
this guide is for the behaviors that need a running app — especially **MIN-275 worktree
isolation on Windows**.

Branch: `Orchestrator-board-upgrade`. Work through top to bottom; each step lists the
**action** and the **expected result** (✅).

---

## 0. Setup

1. Install deps if needed: `npm install`
2. Launch the desktop app (server + Electron):
   ```bash
   npm run desktop
   ```
   - ✅ The terminal prints a `Tools API: http://localhost:<PORT>/api/tools/ping` line.
     **Note that `<PORT>`** — you'll need it for the MIN-275 API smoke test.
3. Open the orchestrator: pick/confirm a **Code workspace** that is a **git repo** with a
   committed baseline (worktrees branch off `HEAD`). A scratch repo is ideal so you can
   throw it away.
4. Have (or make) a plan file under `documentation/plans/*.md` with **3–4 independent
   tasks across 1–2 waves** so tasks can run in parallel.

> Re-run the automated suites any time:
> ```bash
> node --experimental-test-module-mocks ./node_modules/tsx/dist/cli.mjs --import ./test/test-loader.mjs --test --test-force-exit test/orchestrate/worktree-isolation.test.mts test/orchestrate/board-timer.test.mts test/ui/orchestrate-hub.test.mts
> ```
> The `--test-force-exit` flag is required or the runner hangs after passing.

---

## 1. MIN-246 — Stop actually stops chats

1. Start a board, set autonomy to **Auto**, press **Start**. Let 1–2 task chats begin streaming.
2. Press the board **Stop** button.
   - ✅ Streaming task/sub-agent chats **stop within a second** (no more tokens; spinners clear).
   - ✅ The queue drains — no new tasks launch after Stop.
3. Open one of the task chats that was mid-stream.
   - ✅ It is halted, not still generating in the background.

## 2. MIN-248 — Timer freezes on Stop

1. With a board running, watch the **Elapsed** timer in the header (it ticks up).
2. Press **Stop**.
   - ✅ The timer **freezes immediately** at its current value (does not keep counting).
   - ✅ Header shows the **Stopped** badge.
3. Reload the app (Ctrl+R) and reopen the board.
   - ✅ Timer is still frozen at the same value (the `userStopped` flag persisted).
4. Press **Start** again.
   - ✅ Stopped badge clears and the timer resumes.

## 3. MIN-259 — Board scrolls during a run

1. Use a plan with **enough tasks/waves to overflow the viewport** (cards below the fold).
2. Press **Start** so tasks are actively running (board re-renders ~once/second).
3. Scroll the board **down** with the wheel/trackpad.
   - ✅ The board scrolls normally and **stays** where you scrolled — it does **not** snap
     back to the top each second during the live refresh.
4. Scroll a horizontal lane (if applicable) and wait through a refresh tick.
   - ✅ Horizontal scroll position is also retained.

## 4. MIN-215 — Plan dropdown refreshes after deleting the orchestrator chat

1. Create an orchestrator (planner) chat and select/attach a plan to it.
2. Open the **Orchestrate hub** (top-bar orchestrate button) so the **"Start from plan"
   dropdown** is visible. Note its contents.
3. Without leaving the hub, **delete the main orchestrator chat** (right-click it in the
   sidebar → Delete, or the chat's delete control).
   - ✅ The hub's **plan dropdown updates on its own** — you do **not** have to click the
     **Refresh** button for the list to reflect the change.
   - ✅ The "Recent boards" row also updates (this already worked; confirm no regression).

---

## 5. MIN-275 — Worktree + process isolation  ⚠️ needs Windows verification

Isolation turns **on automatically in Auto mode** (per-task). Manual/Sequential = off.
There is no settings toggle yet (that's MIN-218, a later phase).

### 5a. Fast API smoke test (verifies the git plumbing without a full board)

Run these against your dev-server `<PORT>` from step 0. This is the quickest way to confirm
`git worktree`/branch/merge work on **Windows** in your repo.

```bash
# 1) Create the board integration branch + its worktree
curl -X POST http://localhost:<PORT>/api/worktree -H "Content-Type: application/json" \
  -d '{"op":"ensure_integration","boardId":"smoke","branch":"minnow/board/smoke/integration"}'
# ✅ {"ok":true,"path":"...\\.minnow\\worktrees\\<repo>\\smoke\\integration","created":true}

# 2) Create a task worktree off the integration branch
curl -X POST http://localhost:<PORT>/api/worktree -H "Content-Type: application/json" \
  -d '{"op":"create","boardId":"smoke","slotId":"task-1","branch":"minnow/board/smoke/task/1","baseRef":"minnow/board/smoke/integration"}'
# ✅ {"ok":true,"path":"...\\smoke\\task-1","created":true}

# 3) Confirm git sees them
git worktree list
git branch --list "minnow/*"
# ✅ Two worktrees under ~/.minnow/worktrees/<repo>/smoke/ and the two minnow/board/smoke/* branches.

# 4) Make a change in the task worktree and commit it
#    (replace the path with the "path" from step 2)
cd "C:/Users/<you>/.minnow/worktrees/<repo>/smoke/task-1"
echo "isolation works" > MIN275-PROOF.txt && git add -A && git commit -m "task-1 change"
cd -   # back to your repo

# 5) Merge task-1 into integration (runs inside the integration worktree)
curl -X POST http://localhost:<PORT>/api/worktree -H "Content-Type: application/json" \
  -d '{"op":"merge","boardId":"smoke","fromBranch":"minnow/board/smoke/task/1","message":"merge task-1"}'
# ✅ {"ok":true,...}  — and MIN275-PROOF.txt now exists on the integration branch/worktree.

# 6) Clean up the task worktrees (integration is intentionally KEPT for MIN-208)
curl -X POST http://localhost:<PORT>/api/worktree -H "Content-Type: application/json" \
  -d '{"op":"cleanup","boardId":"smoke"}'
# ✅ {"ok":true,"removed":1,"keptIntegration":true}
git worktree list   # task-1 gone, integration remains
```

**Your main repo working tree and checked-out branch must be untouched throughout** — the
merge happens inside the integration worktree, never in your repo. Confirm with `git status`
and `git branch --show-current` in the repo.

> Teardown when done experimenting:
> `curl ... -d '{"op":"remove","boardId":"smoke","slotId":"integration"}'`
> then `git branch -D minnow/board/smoke/integration minnow/board/smoke/task/1`.

### 5b. End-to-end via a real board

1. Start a board, set autonomy to **Auto**, press **Start**.
2. While tasks run, in a terminal at the repo root:
   ```bash
   git worktree list
   git branch --list "minnow/*"
   ```
   - ✅ A `.../integration` worktree plus one `task-<id>` worktree **per concurrently
     running task** appears; matching `minnow/board/<group>/...` branches exist.
3. Open a running task chat and watch its file/terminal tool calls.
   - ✅ Files it creates/edits land **inside that task's worktree dir**, not your main repo
     working directory (check: the file shows up under `~/.minnow/worktrees/...`, and `git
     status` in your main repo stays clean).
4. Let a task **pass its test**.
   - ✅ Its branch is **merged into the integration branch** (check the integration
     worktree / `git log minnow/board/<group>/integration`).
   - ✅ On a merge **conflict**, the task surfaces an error like *"Integration merge
     conflict … orchestrator will resolve"* and you are **not** prompted (self-heal path).
5. Run two tasks at once and check their dev servers (if tasks start one).
   - ✅ Each isolated task uses a **different port** (no `EADDRINUSE` collisions).
6. Fallback check: set autonomy to **Sequential/Manual** and run.
   - ✅ No worktrees are created (`git worktree list` shows only your main tree); tasks run
     in the shared workspace exactly as before.

### 5c. Windows-specific things to watch

- **File locks on cleanup:** if a dev server or editor holds a worktree open, `worktree
  remove` should still succeed via `--force` + prune; confirm no orphaned dirs remain under
  `~/.minnow/worktrees`.
- **`node_modules`:** a worktree starts without its own `node_modules`. If a task needs to
  build/run, it may need `npm install` in the worktree (documented as a known follow-up).
- **Paths:** worktree paths are absolute Windows paths; confirm tools resolve them correctly
  (no forward/back-slash breakage in tool results).

---

## 6. Known issues (not Phase 0 regressions)

- 3 board UI tests fail on **clean HEAD too** (`wave caret collapses`, `header status
  badge`, `board header controls`) — stale tests predating this branch's WIP; **not caused
  by Phase 0**.
- 2 unrelated pre-existing `tsc` errors (`init-file-panel.ts:151`,
  `settings-memory-embeddings.ts:182`) block a green `npm run build` (tracked separately).
```
