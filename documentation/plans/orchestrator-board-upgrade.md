# Orchestrator Board: fix self-completion, integration merge, worktree perms & DAG scheduling

## Context

A live test run ("Calorie 2", board `grp_6ae…`) surfaced four linked failures in the
auto-pilot orchestrate board. Forensics on `~/.minnow/sessions/state.json` + the worktree
git state confirmed the root causes:

- **Builders self-complete.** `board_update_task` is callable by any board-linked chat, so
  Builder chats moved themselves `in_progress → complete` (W1-A, W1-C ended `complete` with
  **no tester and no verdict**). Only W1-B went through the real tester path.
- **Integration never accumulates work.** The only code that merges a task branch into the
  integration branch runs on the tester **pass** path. Self-completed tasks skip it. On top of
  that, **nothing commits** — the merge folds *committed* branch tips, but builders don't
  reliably commit. Result: `integration` held only W1-B's commit.
- **Later tasks miss upstream work.** W2 worktrees branched off `integration` (which had only
  W1-B), so W2-A re-scaffolded from scratch.
- **False permission prompts.** `toolSecurity.filesystemAccess = "workspace"`; worktrees live
  under `~/.minnow/worktrees`, outside the Code workspace. The client approval gate flags those
  paths as "outside the workspace" and tells the user "the server will reject these" — but the
  server **already allowlists** worktree roots, so the copy is wrong.

**Decisions locked with the user:**
- Board **auto-commits** each task worktree before merge; Builders do not run git.
- Merge conflicts **auto-spawn a fixer** chat that resolves + commits, then the board retries.
- **DAG-first scheduling:** a task is ready when its `dependsOn` are complete+merged; wave
  ordering is a fallback for tasks that declare no `dependsOn`.
- **Global integration branch**, gated by deps (a task branches off integration only once all
  its `dependsOn` are merged in).

Intended outcome: every task's work is committed and merged into integration through the single
completion path; downstream tasks branch from an integration tip that contains their real
upstreams; independent DAG branches run in parallel; and board worktree paths stop prompting.

> **Note on line numbers.** Symbols below are verified against branch
> `Orchestrator-board-upgrade`, but line numbers drift. Current anchors:
> `mergeCompletedTaskWorktree` → [orchestrate-board-actions.ts:655](src/state/orchestrate-board-actions.ts);
> the merge call → ~:998; `finalizeTaskTestingOnStreamEnd` → :969; `ensureStreamEndSubscription` → :306;
> `ensureTaskWorktree` → :577; `startTask` → :696; `startTaskTesting` → :799; `taskQueueByGroupId` → :76.
> `isTaskReadyForAuto` → [orchestrate-board-store.ts:225](src/state/orchestrate-board-store.ts).
> Trust the symbol names, not the numbers.

---

## Workstream 1 — Lock task status changes to the orchestrator (fixes self-completion)

`board_update_task` must only mutate status from the **orchestrate planner** chat. The auto-pilot
flow already advances cards programmatically via `moveTaskStatus`, so this does not affect normal
operation.

- **`src/tools/board-tools.ts`**
  - `executeBoardUpdateTask` ([:521](src/tools/board-tools.ts)) currently resolves via the
    *permissive* `resolveBoardPlannerChat` ([:79](src/tools/board-tools.ts)) — which accepts any
    chat with `boardTaskId`. Switch it to require the strict orchestrate resolver
    `resolveOrchestratePlannerChat` ([:67](src/tools/board-tools.ts), already enforces
    `modeId === 'orchestrate'`). When the caller is a board task/tester chat, return a clear
    error: *"Builders/testers don't move cards — report completion via your output
    (READY FOR VERIFICATION); the board advances the task."*
  - Leave `board_get_state` (`resolveBoardPlannerChat`) and `board_report_test_result`
    (`resolveBoardGroupFromChat`) resolvers **unchanged** — task/tester chats still need them.

- **`src/tools/client.ts`** — defense in depth. **CORRECTION vs. original plan:** the strip
  cannot go "alongside `applyOrchestrateAutoToolFilter`". Board member chats are mode **`build`**
  (set in `getOrCreateBoardChat`), and `getEnabledToolDefinitionsForChat`
  ([:542](src/tools/client.ts)) **returns early at line 547 for non-orchestrate chats**, before
  the orchestrate-only filter (`applyOrchestrateAutoToolFilter` lives in
  [orchestrate-tool-filter.ts](src/chat/modes/orchestrate-tool-filter.ts), not client.ts). Build
  mode is `toolPolicy: { default: 'allow' }` ([registry.ts:50](src/chat/modes/registry.ts)), so
  build chats currently receive `board_init`, `board_update_task`, and `delegate_tasks` — exactly
  how builders self-completed.
  - Add a new `applyBoardMemberToolFilter(defs, chat)` and apply it to `defs`
    **unconditionally** (before the line-547 early return): for any chat with `chat.boardTaskId`,
    strip `board_init`, `board_update_task`, `delegate_tasks`. Keep `board_get_state` and
    `board_report_test_result`.

## Workstream 2 — Auto-commit + always-merge through the single completion path (fixes integration)

The merge lives in `finalizeTaskTestingOnStreamEnd` → `mergeCompletedTaskWorktree`. With
Workstream 1, this becomes the *only* way a task reaches `complete`. Make it robust:

- **`server/worktree/worktree-ops.js`** — add ops:
  - `commitWorktree({ boardId, slotId, message })`: `git add -A` then `git commit -m …` in the
    task worktree; if nothing is staged, return `{ ok: true, committed: false }` (no empty commit).
  - `checkMerged({ boardId, fromBranch })`: `git merge-base --is-ancestor <fromBranch>
    <integration>` → `{ ok, merged: boolean }`. Confirms a merge (incl. post-fixer) landed.
  - Have `mergeIntoIntegration` ([:142](server/worktree/worktree-ops.js)) return the conflicted
    file list on conflict (parse `git diff --name-only --diff-filter=U` **before** `--abort`).
- **`server/worktree/middleware.js`** — register `commit` and `check_merged` in the `OPS` map
  ([:43](server/worktree/middleware.js)) and import the new fns.
- **`src/state/worktree-service.ts`** — add client wrappers `commitWorktree` and `checkMerged`
  (same best-effort `postWorktree` pattern, [:21](src/state/worktree-service.ts)).
  **CORRECTION (C4):** the conflicted-files list must thread through **all three layers** — the
  server op, the `worktree-service` wrapper return type (`conflictedFiles`), and the
  action-level merge call — so `mergeCompletedTaskWorktree` can seed the fixer. Today only raw
  git text is returned.
- **`src/state/orchestrate-board-actions.ts`**
  - In the completion path, before merging: call `commitWorktree` for the task's slot. Derive
    `slotId` via `worktreeSlotId(mode, task)` ([worktree-isolation.ts:79](src/state/worktree-isolation.ts)),
    resolving `mode` from the **persisted isolation state**, not an assumed value.
  - **CORRECTION (C3) — per-wave commit semantics.** In per-wave mode `worktreeSlotId` returns a
    *shared* `wave-<id>` slot; auto-committing on one task's completion would capture sibling
    tasks' in-flight work. Restrict auto-commit+merge to **per-task** isolation (the MIN-275
    intent); if the board is per-wave or off, skip the auto-commit and log. Confirm with user if
    per-wave auto-commit is ever expected.
  - Make `mergeCompletedTaskWorktree` ([:655](src/state/orchestrate-board-actions.ts)) **return a
    result** (`merged | conflict | error`) instead of `void`. Only `moveTaskStatus(…, 'complete')`
    when the merge is confirmed.
  - **Serialize merges per board:** a `mergeQueueByBoardId` promise chain mirroring
    `taskQueueByGroupId` ([:76](src/state/orchestrate-board-actions.ts)). Keep the key consistent
    with the existing pattern (group id) to avoid two keyspaces.

## Workstream 3 — Merge-conflict fixer (auto-heal, no user prompt)

When `mergeCompletedTaskWorktree` reports a conflict, spawn a fixer instead of marking complete.

- **`src/state/orchestrate-board-actions.ts`**
  - `startMergeConflictFixer(group, task, plannerChat, conflictedFiles)`: create a board chat via
    `getOrCreateBoardChat` with **new role `'fixer'`**, set its `worktreeRoot` to the
    **integration** worktree path, persist `task.fixerChatId`, set status to a transient
    (`'merging'`) so the wave doesn't advance. Seed: *"Resolve the git merge of `<taskBranch>`
    into integration. Conflicted files: … Resolve markers, `git add`, `git commit`. Touch only
    conflicted regions."* The fixer runs `git merge <taskBranch>` itself in the integration
    worktree — keeps the server stateless.
  - **CORRECTION (C5) — `getOrCreateBoardChat` extension.** It currently knows roles
    `'build'`/`'tester'` and `taskChatField` `'chatId'|'testChatId'`. Add `'fixer'` to its role
    union and `'fixerChatId'` to `taskChatField`.
  - Route fixer stream-end in `ensureStreamEndSubscription` ([:306](src/state/orchestrate-board-actions.ts)):
    add a **third match arm** for `task.fixerChatId` → `finalizeMergeFixerOnStreamEnd`. That calls
    `checkMerged`; if merged → clear `fixerChatId`, `moveTaskStatus('complete')`, drain queue; if
    still unmerged → `git merge --abort` (new `abort_merge` op or reuse), `moveTaskStatus('blocked')`
    with the conflict summary (single fixer attempt, then surface).
  - **CORRECTION (C2) — merge lock.** The fixer's `git merge` runs in a chat stream, **outside**
    `mergeQueueByBoardId`, so a concurrent tester-pass merge can collide in the same integration
    worktree. Add a per-board "fixer active" gate: while any `task.fixerChatId` is set (status
    `merging`), the merge queue must **block** new merges into integration until the fixer's
    stream-end resolves it.
- **`src/types.ts`** — add `fixerChatId?: string` to `BoardTask` and `'merging'` to
  `BoardTaskStatus` ([:273](src/types.ts)). **CORRECTION (C5):** audit every `status ===` /
  switch over `BoardTaskStatus` — board UI rendering and the reportable-status list in
  `moveTaskStatus` — so `merging` renders and is **not** treated as terminal/reportable.
  (`merging` is correctly non-`complete`, so `isDepsComplete`/`isPriorWavesComplete` keep
  downstream tasks blocked during the merge — desirable.)

## Workstream 4 — DAG-first scheduling, waves as fallback (fixes serialized branches + correct base)

- **`src/state/orchestrate-board-store.ts`** — change `isTaskReadyForAuto`
  ([:225](src/state/orchestrate-board-store.ts)):
  ```ts
  if (task.status !== 'planned') return false;
  if (isTaskInDependencyCycle(board, task.id)) return false;
  if (!isDepsComplete(board, task)) return false;
  // DAG-first: explicit edges satisfied → ready now. Wave barrier only when the
  // task declares no dependsOn (keeps legacy wave-only plans working).
  if (task.dependsOn?.length) return true;
  return isPriorWavesComplete(board, task.wave);
  ```
  `isDepsComplete` ([:143](src/state/orchestrate-board-store.ts)) already requires every
  `dependsOn` to be `complete` — and with Workstreams 1–2, `complete` now means "merged into
  integration", so branching a ready task off the integration tip is guaranteed to contain its
  upstreams. **Safe only once WS1/WS2 make `complete` reliably mean merged — sequence WS4 after.**
- **Worktree base is already correct:** `ensureTaskWorktree`
  ([:577](src/state/orchestrate-board-actions.ts)) branches off `integrationBranch`; the only
  change needed was guaranteeing deps are merged before a task becomes ready (above).
- **`src/chat/prompts/modes/orchestrate.full.md` / `orchestrate.lite.md`** — instruct the planner
  to emit explicit `dependsOn` edges in `board_init` (not just wave numbers), so the DAG is dense
  enough to parallelize. Note waves are a fallback/visual grouping.

## Workstream 5 — Stop false permission prompts for board worktrees

- **`src/state/worktree-isolation.ts`** — add a pure helper `boardWorktreesRootsFromState(groups)`
  deriving the board worktrees root from session state (any task `worktreePath` → slice to the
  `…/worktrees` segment), returning the set of in-scope roots. Mirror `resolveChatWorktreeRoot`
  ([:135](src/state/worktree-isolation.ts)).
- **`src/tools/permission-gate.ts`** ([:52](src/tools/permission-gate.ts)) — when the acting chat
  is board-linked (or a board is active), treat paths under those worktree roots as in-scope
  (don't flag), in addition to `context.workspaceRoot`. **CORRECTION (C6):** `permission-gate`
  has no board awareness today (`ToolApprovalContext` has no boardId and no session access) —
  thread either the worktree roots or session groups into the gate so the helper can run.
  - Fix the misleading copy at [permission-gate.ts:77](src/tools/permission-gate.ts) — the server
    **allows** worktree roots ([chats-workspace/paths.js:61](server/chats-workspace/paths.js)), so
    drop "the server will reject these" for worktree paths. **Also fix the second stale copy** at
    [chats-workspace/paths.js:20-27](server/chats-workspace/paths.js), which likewise omits
    worktrees.
- **Ensure every board chat is scoped:** `startTask`/`startTaskTesting` reliably set
  `worktreeRoot` ([:755, :857](src/state/orchestrate-board-actions.ts)); the fixer chat (WS3) must
  set `worktreeRoot` to the integration worktree.

## Workstream 6 — Stop in-worktree re-scaffolding / nested workspaces

Largely resolved by WS2 & WS4 (downstream tasks now see upstream work). Plus:

- **Builder prompt** (`src/chat/prompts/work-agents/builder/agent.full.md`): add an explicit
  rule — *do not run `git add/commit/push` or re-scaffold project structure; the board handles
  version control and your worktree already contains upstream work.*
- **Nested `.minnow/`**: the brain-code feature wrote `.minnow/brain-jsconfig.json` into the
  worktree. Lower priority — either point that writer at the real Minnow home or add `.minnow/`
  to the worktree `.gitignore`. **Flag; confirm with user before changing brain-code behavior.**

## Workstream 7 — Refresh the stale Orchestrator prompt

- **`src/chat/prompts/work-agents/orchestrator/agent.full.md`** (and `.lite.md`) currently
  describe a different paradigm (spawn Builder/Verifier sub-agents, track a progress `.md`, mark
  complete in that file) — no mention of the board, worktrees, auto-commit/merge, or that testers
  own verdicts. Rewrite to match the implemented board flow: planner uses `board_init` (with
  `dependsOn` edges) / `board_get_state`; the board auto-commits, merges, and advances cards on
  tester `pass`; the orchestrator does **not** call `board_update_task` to complete tasks or run
  git.

---

## Recommended implementation order

1. **WS1** (strict resolver + corrected client filter) — stops self-completion; everything else
   assumes the single completion path.
2. **WS2** (commit + checkMerged ops, C4 conflict plumbing, merge returns result,
   `mergeQueueByBoardId`).
3. **WS3** (fixer role/status + C2 merge lock + C5 routing/UI audit).
4. **WS4** (DAG-first `isTaskReadyForAuto`) — safe only once `complete` reliably means "merged".
5. **WS5** (perms + C6) and **WS6/WS7** (prompts) — independent, can run in parallel.

## Verification

1. **Unit tests** (`node --test --test-force-exit` per project convention):
   - `isTaskReadyForAuto`: explicit-deps-satisfied task ready even when a sibling in its wave is
     incomplete; a no-`dependsOn` task still respects the wave barrier.
   - `executeBoardUpdateTask`: rejected from a task/tester chat; succeeds from an orchestrate chat
     (extend `board-tools` tests).
   - `getEnabledToolDefinitionsForChat`: a build-mode chat **with** `boardTaskId` no longer
     exposes `board_update_task`/`board_init`/`delegate_tasks` but keeps `board_get_state`
     (locks the C1 correction).
   - `commitWorktree` / `checkMerged` ops (extend worktree-ops tests): commit captures untracked
     files; `checkMerged` true only after a real merge.
2. **End-to-end smoke** using `documentation/plans/orchestrator-board-smoke.md` with `dependsOn`
   edges, run via auto-pilot (`npm start`):
   - After each task passes: its slot has a commit AND `git -C <integration> log` contains it.
   - A downstream task's worktree, when created, contains its upstream's files (no re-scaffold).
   - Force a conflict (two tasks editing the same file) → a fixer chat appears, resolves, and the
     task lands `complete` with the merge in integration; an unresolvable conflict lands `blocked`,
     and the wave does not advance.
   - No "outside the workspace" prompt fires for tool calls touching `~/.minnow/worktrees/…`.
3. **Regression**: a builder chat attempting `board_update_task` gets the rejection message and
   the card still advances normally through the tester path.
