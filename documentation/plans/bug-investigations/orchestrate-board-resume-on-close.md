# Orchestrate board resumes after app close / writes to wrong workspace

## Verification status

**CONFIRMED** (static code analysis)

Reproduces whenever:

1. A board is running in **auto** or **sequential** mode (`autoRunning: true`), and
2. The user closes the app **without** pressing **Stop** on the board, then reopens (or restarts the server and reopens).

The cross-workspace write issue additionally reproduces when isolation is **off** (manual / sequential) and the user changes the top-bar workspace while background board tasks are still running.

---

## Reported behavior

- Close Minnow with an orchestrator board still running (no Stop).
- Reopen the app (even after a full server restart).
- The board **resumes execution** automatically.
- If the user switches to a **different workspace**, the board continues and **writes files into the new workspace**.

---

## Root cause 1 — Boot resume treats abrupt close like a page reload

`autoRunning` and `executionMode` are **intentionally persisted** in session state (`~/.minnow/sessions/state.json` or `localStorage`). On every boot, `initApp()` runs:

```371:374:src/main.ts
  if (sessionState) {
    await bootGenerationResumeForChats(sessionState.chats);
    await bootOrchestrateBoardResume(sessionState);
  }
```

`bootOrchestrateBoardResume` iterates **all groups across all workspaces** and resumes any board where `isBoardRunning()` is true:

```12:18:src/chat/orchestrate/board-boot-resume.ts
export async function bootOrchestrateBoardResume(state: SessionState): Promise<void> {
  for (const group of state.groups ?? []) {
    if (!isBoardRunning(group)) continue;
    const planner = getPlannerChatForGroup(group);
    if (!planner) continue;
    await resumeBoardExecutionAfterReload(group, planner);
  }
}
```

`isBoardRunning` is simply `executionMode ∈ {auto, sequential}` **and** `autoRunning === true`:

```296:299:src/state/orchestrate-board-store.ts
export function isBoardRunning(group: ChatGroup): boolean {
  return isBoardAutoMode(group) && group.orchestrateBoard?.autoRunning === true;
}
```

`resumeBoardExecutionAfterReload` then calls `autoDelegateNext`, which restarts **stalled** `in_progress` / `testing` tasks (`isTaskStalledForRestart` — no active stream on the linked chat):

```1812:1842:src/state/orchestrate-board-actions.ts
export async function autoDelegateNext(
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  // ...
  const ready = board.tasks.filter(
    (t) =>
      isTaskReadyForAuto(board, t) ||
      isTaskStalledForRestart(board, t, isTaskChatActive),
  );
  // ...
  await resumeBoardTask(group, task.id, plannerChat);
}
```

**Pressing Stop** clears `autoRunning`, sets `userStopped`, and **immediately** flushes with `saveSessionsNow()` — so a clean stop does not resurrect on reload. **Closing the window** has no equivalent handler; `autoRunning` stays `true`.

After a **server restart**, `bootGenerationResumeForChats` may fail (404 on `currentGenerationId`), but `bootOrchestrateBoardResume` still runs afterward and treats stalled tasks as fair game for `autoDelegateNext`.

### Secondary boot path — generation resume

`bootGenerationResumeForChats` resumes **any** chat with a persisted `currentGenerationId`, including board task chats, regardless of board mode. This is a second way in-flight work can restart without an explicit user action.

---

## Root cause 2 — Auto-mode worktrees lost after reload (primary cross-workspace write bug)

**Correction:** The reporter used an **auto** board (per-task worktrees). Agents were no longer scoped to their worktree after reload — not a manual-mode-only issue.

On first `startTask`, isolation allocates a worktree and sets `task.worktreePath` + `chat.worktreeRoot`. After reload:

1. `repairBoardChatWorktreeRoots` backfills `chat.worktreeRoot` from persisted `task.worktreePath` only when that path survived in session JSON.
2. `resumeBoardExecutionAfterReload` previously **did not** call `ensureTaskWorktree` — only supervision + `autoDelegateNext`.
3. `bootGenerationResumeForChats` may continue in-flight task chats **without** `startTask` (no worktree re-bind).
4. When `worktreePath` / `worktreeRoot` are missing or stale, `resolveChatWorktreeRoot` returns `undefined` and tools fall back to **`getEffectiveWorkspaceRoot()`** (live top-bar workspace). Switching workspace routes writes into the wrong project.

`ensureTaskWorktree` is best-effort and returns `null` on server/git failure — execution continues on the shared workspace (MIN-275), worsening the symptom after restart.

### Manual/sequential (no worktree)

Same fallback when isolation is off — tools previously had no `workspaceRoot` at all.

### Fixes shipped

- **`rehydrateAllBoardWorktreeRoots`** at boot (before generation/board resume) + **`rehydrateBoardWorktreeRoots`** in `resumeBoardExecutionAfterReload`.
- **`resolveChatToolWorkspaceRoot`** in the tool loop: worktree → else board member `chat.workspacePath` (never top-bar workspace).

---

## Root cause 3 — Workspace switch does not pause foreign boards

`applyWorkspaceSwitch` → `applyWorkspaceScopedSession` only remaps `activeId` to a chat in the new workspace. It does **not**:

- call `stopBoardAutoRun` for boards bound to other workspaces,
- clear `activeBoardGroupId`,
- or block `autoDelegateNext` / background `runChatTurn` for boards in another workspace.

Board execution is global; workspace filtering applies only to sidebar visibility (`getGroupsForWorkspace`).

---

## UI note — Board view may also reappear on boot

If `activeBoardGroupId` and `group.viewMode === 'board'` were persisted, `renderChatFromHistory` mounts the kanban again:

```159:166:src/ui/messages.ts
  const boardGroup = codeMount ? getActiveBoardGroup() : null;
  if (boardGroup?.viewMode === 'board') {
    teardownHub();
    void import('./orchestrate-board').then((m) => {
      m.renderBoardView(boardGroup);
```

This is separate from task execution but matches the user perception that “the board restarts.”

---

## Proposed fixes (recommended order)

### Fix A — Pause running boards on app close (shipped)

`registerOrchestrateBoardShutdownHandler` on `pagehide` → `pauseAllRunningBoardsForShutdown` (mirrors **Stop**).

### Fix B — Worktree rehydrate + board chat workspace fallback (shipped)

- Boot: `rehydrateAllBoardWorktreeRoots` before generation/board resume.
- Board resume: `rehydrateBoardWorktreeRoots` inside `resumeBoardExecutionAfterReload`.
- Tools: `resolveChatToolWorkspaceRoot` in the tool loop.

### Fix C — Pause boards when switching away from their workspace (safety net)

In `applyWorkspaceScopedSession` or `onWorkspaceChanged`, stop auto-run for any board where `normalizeWorkspacePath(group.workspacePath) !== normalizeWorkspacePath(newPath)`.

### Fix D — Boot resume guardrails (optional UX)

Alternatives or additions to Fix A:

- Only call `bootOrchestrateBoardResume` for boards whose `group.workspacePath` matches the **current** server workspace.
- Require user confirmation (“Resume orchestration?”) when `autoRunning` was persisted without `userStopped`.
- Skip generation resume for chats with `boardGroupId` unless the board is still running.

---

## Test plan

1. **Auto mode, close without Stop:** start board → close Electron → reopen → assert `autoRunning` is false (after Fix A) or tasks do not launch without user Start.
2. **Server restart:** same, plus assert no new `runChatTurn` for task chats after boot without user action.
3. **Cross-workspace write:** manual board, task in progress, switch workspace → assert `POST /api/tools` payload `workspaceRoot` equals original board workspace (Fix B).
4. **Workspace switch pause:** auto board in workspace A, switch to B → assert `autoRunning` false for board A (Fix C).
5. Regression: explicit **Stop** still persists; **Start** after reload still works when user opts in.

Run: `node --test test/chat/orchestrate/board-boot-resume.test.mts test/state/orchestrate-board-hydrate.test.mts` plus new cases.

---

## Estimated effort

| Fix | Size | Risk |
|-----|------|------|
| A — shutdown pause | S (~1–2 h) | Low; mirrors existing Stop |
| B — workspace scoping | S (~1 h) | Low; localized to tool loop |
| C — pause on workspace switch | S (~1 h) | Medium; verify user expects pause not background |
| D — boot guardrails | M (~2–3 h) | UX decision |

**Recommended minimum:** A + B (addresses both reported symptoms).

---

## Key files

| File | Role |
|------|------|
| `src/main.ts` | Boot order: generation resume → board resume |
| `src/chat/orchestrate/board-boot-resume.ts` | Resume entry point |
| `src/state/orchestrate-board-actions.ts` | `stopBoardAutoRun`, `autoDelegateNext`, `resumeBoardExecutionAfterReload` |
| `src/tools/loop.ts` | Tool `workspaceRoot` forwarding |
| `src/state/worktree-isolation.ts` | Worktree-only scoping today |
| `src/tools/client.ts` | Fallback to server effective workspace |
| `src/ui/workspace-button.ts` | Workspace switch without board pause |
| `documentation/context.md` | Documents intentional boot resume (line ~545) |
