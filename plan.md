# Orchestrator Board — Manual Test Plan

Hands-on test plan for the orchestrator board on branch `Orchestrator-board-upgrade`.
Covers planning → delegation → execution → stop/resume → worktree isolation → persistence.

## Setup

1. Start the app: `npm start` (or the desktop shell). Open MinnowOS desktop.
2. Have a real git repo open as the workspace — worktree isolation (MIN-275) needs git.
3. Pick a fast/cheap model in the top-bar picker so multi-task runs don't burn time.
4. Open an Orchestrate chat / board (the Orchestrator hub → new board).

> Tip: keep a terminal on `git worktree list` and `git branch --list 'minnow/board/*'`
> to watch isolation create/clean up branches and worktrees live.

---

## 1. Planning & board shape

- [ ] Start a board with a multi-step goal; planner produces a plan with **waves** and **tasks**.
- [ ] Each task shows wave assignment; waves roll up status (planned → in_progress → complete).
- [ ] Tasks in a later wave stay **gated** until all prior-wave tasks are `complete`
      (wave ordering — see `isPriorWavesComplete`).
- [ ] Edit / re-plan from the hub refreshes board plans without losing existing state.

## 2. Execution modes

Test each mode (`getBoardExecutionMode` → `manual` / `sequential` / `auto`):

- [ ] **Manual** — no task auto-starts; user delegates each task explicitly.
- [ ] **Sequential** — pressing Start runs ready tasks one at a time, in wave order.
- [ ] **Auto** — pressing Start runs ready tasks up to the concurrency cap in parallel.
- [ ] Auto/sequential only execute **after Start is pressed** (not on plan creation).

## 3. Delegation & task lifecycle

- [ ] A delegated task spawns a Builder chat; status moves `planned → in_progress`.
- [ ] On Builder completion, a **Tester** chat runs against the same workspace/worktree.
- [ ] Task reaches `complete`; its wave's `completeCount` increments; next wave unlocks.
- [ ] **Final test** (board-level) runs after all tasks complete and shows pass/fail.
- [ ] Open each task's chat from the board card — transcript and tools are scoped correctly.

## 4. Stop & resume (MIN-246 / MIN-248)

- [ ] Press **Stop** mid-run:
  - [ ] Header timer **freezes immediately** (does not keep ticking).
  - [ ] **Stopped** badge appears right away, even if task statuses lag.
  - [ ] All active Builder/Tester/planner generations abort.
  - [ ] Sub-agent runs for the active parent turn are cancelled (no lingering heartbeats).
- [ ] Press **Start** again:
  - [ ] `userStopped` clears, Stopped badge disappears, timer resumes.
  - [ ] Delegation picks up the next ready task.

## 5. Worktree isolation (MIN-275 / MIN-276)

Isolation mode resolves from `board.isolationMode` override, else execution mode
(`auto → per-task`, `sequential`/`manual → off`). See `resolveIsolationMode`.

- [ ] **Off** (manual/sequential, no override): tasks run in the main workspace; no
      `minnow/board/*` branches created.
- [ ] **Per-task** (auto): each task gets its own worktree + branch
      `minnow/board/<id>/task/<taskId>`; verify with `git worktree list`.
- [ ] Integration branch `minnow/board/<id>/integration` is minted **once** per board.
- [ ] **Per-wave** override: tasks in the same wave **share** one worktree/branch
      `minnow/board/<id>/wave/<waveId>`; a sibling task reuses the already-created worktree.
- [ ] Each isolated task chat's tools operate inside its `worktreeRoot` (not the main repo).
- [ ] Dev ports are allocated without collision when multiple isolated tasks run
      (base `5200`, lowest free port — `allocateDevPort`).
- [ ] On task/wave completion, branch **merges into the integration branch**.
- [ ] **Graceful fallback**: if any git/worktree step fails, the task falls back to the
      main workspace rather than erroring out the board.
- [ ] **Teardown / delete board**: per-task/per-wave worktrees are removed; the
      integration branch + worktree are **kept** (for commit/push later — MIN-208).

## 6. Persistence & reload (MIN-275 state)

- [ ] Reload the app mid-run: board, waves, task statuses, and worktree assignments
      (`worktreePath` / `worktreeBranch` / `devPort`) all rehydrate.
- [ ] Reload **after Stop**: auto execution does **not** resurrect (stop state flushed
      via `saveSessionsNow`); board stays Stopped.
- [ ] Board scroll position and timer state survive reload (MIN-248 / scroll preserve).

## 7. Edge cases

- [ ] Stop with no active tasks (nothing running) — no error, badge still toggles.
- [ ] Delete a board while tasks are in progress — generations stop, worktrees clean up.
- [ ] Re-plan after some tasks complete — completed task state preserved, new tasks gated.
- [ ] Run two boards concurrently — branches/ports/worktrees don't collide across boards.
- [ ] Non-git workspace with auto mode — isolation falls back to off cleanly.

## 8. Automated suites (run before/after manual passes)

```bash
# Orchestrate/board state + UI suites
npm test                       # full suite (may include unrelated known failures)
# Targeted (faster):
npx tsx --import ./test/test-loader.mjs --test --test-force-exit \
  test/orchestrate/*.test.mts \
  test/state/orchestrate-board-*.test.mts \
  test/sub-agents/orchestrator-*.test.mts \
  test/ui/orchestrate-board-*.test.mjs
```

> Use `--test-force-exit` — Minnow UI runs hang on open timers after passing.

---

## Notes / observed issues

_(record results, failures, and screenshots here as you go)_

| # | Area | Result | Notes |
|---|------|--------|-------|
| 1 | Planning | | |
| 2 | Exec modes | | |
| 3 | Delegation | | |
| 4 | Stop/resume | | |
| 5 | Isolation | | |
| 6 | Persistence | | |
| 7 | Edge cases | | |
