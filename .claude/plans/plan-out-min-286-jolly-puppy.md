# MIN-286 — Phase 3: Watchdog AFK behavior + cwd/worktree fix

## Context

Phase 3 of the **Self-Healing AFK Mode** project. Two failure causes halt an unattended (AFK) board today:

- **Cause C — watchdog surfaces to an absent user.** When a mutating/shell sub-agent or a board task-chat stalls, the watchdog escalates to `tier2SurfaceSubAgent` → `syncBoardTaskOnLifecycle(..., 'blocked')` + `cancelSubAgent`. That's correct when a human is watching, but in AFK there is nobody to unblock it, so the whole board halts. The common AFK halt is a stalled board task-chat.
- **Cause G — task commands escape the per-task worktree.** `toolExecuteCommand`'s blocking path defaults `cwd` to `getEffectiveWorkspaceRoot()` (the *global* root), not the chat's worktree. A `cd <repo>` / absolute `cd` then escapes the worktree, scaffolding lands outside it, and the next file read 404s.

Outcome: a stalled mutating sub-agent in AFK auto-recovers instead of halting; a stalled board task-chat is bounded-restarted, not surfaced; task terminal commands run inside the worktree by default and absolute `cd` is redirected with a warning.

Depends on **MIN-285** (`runSelfHeal` in `src/state/orchestrate-self-heal.ts`, which already accepts `category: 'stall'` — verified). All other building blocks (`isBoardRunning`/`isBoardAutoMode`, supervision helpers, `resolveChatCwd`, board-log sink) already exist.

---

## Part 5 — Watchdog AFK behavior (cause C)

### 5a. SubAgentRun watchdog → auto-recover instead of surface/cancel in AFK

Keep `watchdog.ts` dependency-free: add the new behavior via **injected handler + predicate**, no new import edges into `watchdog.ts`.

- **`src/agents/controller/watchdog.ts`**
  - Extend the `WatchdogHandlers` interface (`watchdog.ts:33`) with:
    - `tier2AutoRecover: (runId: string, reason: string) => void`
    - `isRunAfkSupervised: (run: SubAgentRun) => boolean`
  - Add no-op defaults in `noopHandlers` (`watchdog.ts:40`).
  - In `enterSuspect` (`watchdog.ts:160`), at the surface branch (currently `handlers.tier2Surface(run.runId, reason)` at `:179`): if `handlers.isRunAfkSupervised(run)` → call `handlers.tier2AutoRecover(run.runId, reason)` instead; otherwise keep the existing `tier2Surface` call. (Tier-1 path for non-mutating runs at `:172` is unchanged.)

- **`src/agents/controller/controller.ts`**
  - Implement `isRunAfkSupervised(run)`: resolve the board via the existing path used by `syncBoardTaskOnLifecycle` (`controller.ts:290` — `findChatById(run.parentChatId)` → `getBoardGroupForChat(chat)`), then return true only when the board's execution mode is `'afk'` or `'auto'` **and** the board is actively running. Reuse `isBoardRunning` / `getBoardExecutionMode` from `src/state/orchestrate-board-store.ts` (already used elsewhere in the controller layer). Exclude `'sequential'` and `'manual'`.
  - Implement `tier2AutoRecover(runId, reason)`: bounded re-dispatch, modeled on the existing `tier1RestartSubAgent` (`controller.ts:1021`) but available to mutating/shell runs:
    - If `run.attempt` (supervision) is under the cap (reuse `resolveSelfHealMaxRounds()` / autopilot max-attempt meta), re-spawn via `spawnSubAgentInternal` with the same `type/task/category/boardTaskId/idempotencyKey`, increment `attempt`, `setRunLifecycle('dispatching')`, and `syncBoardTaskOnLifecycle(next, 'recovering', reason)` — mirroring tier-1.
    - If the cap is hit, fall back to the existing `tier2SurfaceSubAgent(runId, reason)` (block) so it can't loop forever.
  - Register both in the existing `registerWatchdogHandlers({...})` block (`controller.ts:1226`): add `tier2AutoRecover` and `isRunAfkSupervised`.

### 5b. Board task-chat stall (the common AFK halt)

The board task-chat supervision is a thin heartbeat wrapper (`startTaskChatSupervision`, `src/state/orchestrate-board-actions.ts:515`). Stream output bumps `bumpProgress(chatTaskRunId(chatId))` (`orchestrate-board-actions.ts:683`). So a **progress-stall = absence of stream output**, read via `getRunSupervision(chatTaskRunId(chatId)).lastProgressAt`.

- In the `startHeartbeat(...)` `onTick` of `startTaskChatSupervision` (`orchestrate-board-actions.ts:519`), in addition to `emitBoardChange`, detect stall:
  - Compute progress age from `getRunSupervision(chatTaskRunId(chatId))` against a **generous** `progressStallMs` (introduce a dedicated constant, e.g. a multiple of `autopilotMeta.progressStallMs`, so a long `npm ci`/test — which streams no model output while a tool runs — is not killed). Base the decision on stream-output absence, **not wall-clock**.
  - Act only when **stalled AND `isBoardRunning(group)` AND execution mode is `afk`/`auto`** (manual/sequential never auto-restart). Resolve the group via `chat.boardGroupId`.
  - On stall: stop the stuck generation (existing stop path used by `stopTaskChatSupervision` / chat-turn abort), then bounded restart:
    - Maintain a **per-chat stall-restart counter** (module-level `Map<chatId, number>`, cleared on stream end alongside `stopTaskChatSupervision`).
    - **First restart prefers `runTaskChatNudge(group, taskId, plannerChat, reason)`** (`orchestrate-board-actions.ts:1106`).
    - Subsequent restarts: relaunch via the `autoDelegateNext` path gated by `isTaskStalledForRestart` (`orchestrate-board-store.ts`), or `runSelfHeal(..., { category: 'stall' })`.
    - When the counter exceeds its cap, stop restarting (leave the existing terminal/blocked behavior).

---

## Part 9 — cwd / worktree fix (cause G)

All in **`server/runtime/tools-middleware.js`** (`toolExecuteCommand`, `:662`). Reuse the already-proven pattern from `server/terminal/middleware.js:95-98` (`resolveChatCwd(chatId)` for agent source).

### 9a. Default to the worktree (blocking + background)

- Add a small async helper, e.g. `resolveDefaultCwd(args, chatId)`: when no explicit non-empty `args.cwd`, `await resolveChatCwd(chatId)` (`server/workspace/chat-cwd.js:19`) and use it as the base cwd; fall back to `getEffectiveWorkspaceRoot()` when it returns undefined. Use the absolute worktree path directly (do **not** route it through `resolveSafePath`, which would constrain to the global root — the terminal middleware already does this).
- **Blocking path (`:729`):** replace `let cwd = getEffectiveWorkspaceRoot()` with the worktree-aware default; keep the explicit `args.cwd` override (`:730-737`).
- **Background path (`:676-678`):** today `resolveCommandCwd(args)` defaults to `.` (→ global root) when no `args.cwd`. Apply the same worktree default when `args.cwd` is absent.

### 9b. Guard/redirect a leading absolute `cd` outside the worktree

- Add `guardCdOutsideWorktree(command, worktreeRoot, { chatId, groupId })` (best-effort, gated behind a flag/helper). Match a **leading** absolute `cd`: `/^\s*cd\s+["']?([A-Za-z]:[\\/]|\/)/`. When matched and the target is outside the worktree, rewrite to `cd <worktreeRoot> && ...` (or strip the offending `cd`) and warn via a board-log row using `appendBoardLogLine(groupId, event)` (`server/orchestrate/board-log-sink.js`), e.g. `{ type: 'cwd_redirect', chatId, from, to, reason: 'worktree_isolation' }`.
- **Document the limitation in a comment:** this is best-effort, not a hard sandbox — chained `... && cd /abs && ...` mid-command can still escape; only the leading-`cd` case is caught.

### 9c. Make the worktree explicit in task seeds

- In `buildTaskSeedMessage` (`orchestrate-board-actions.ts:814`) and the retry seeds `buildRetryBuilderSeedMessage` (`:846`) + `buildBuildRetrySeedMessage` (`:863`), when `task.worktreePath` is set, add:
  > `Working directory: <worktreePath>. Keep all file/terminal ops inside it; don't cd to the original repo or any absolute path — use relative paths.`

---

## Files touched

- `src/agents/controller/watchdog.ts` — handler interface + `enterSuspect` AFK branch.
- `src/agents/controller/controller.ts` — `isRunAfkSupervised`, `tier2AutoRecover`, handler registration.
- `src/state/orchestrate-board-actions.ts` — task-chat stall detection in supervision tick, per-chat restart counter, seed-message worktree lines.
- `server/runtime/tools-middleware.js` — worktree-default cwd (both paths), `guardCdOutsideWorktree`.
- (Reused, not modified) `server/workspace/chat-cwd.js`, `server/orchestrate/board-log-sink.js`, `src/state/orchestrate-self-heal.ts`, `src/state/orchestrate-board-store.ts`, `src/agents/controller/wrapper.ts`.

## Tests

- **`test/server/board-task-cwd-guard.test.mjs`** (new): default cwd resolves via `resolveChatCwd` in both blocking and background paths; absolute-`cd` rewrite/block when gated; assert the **leading**-`cd` case is caught and the chained-`cd` escape is documented as a known limitation. Follow `test/server/chat-cwd.test.mjs` conventions (inject minimal session state).
- **`test/agents/controller-watchdog.test.mts`** (extend): AFK-supervised run ⇒ `tier2AutoRecover` invoked instead of surface/cancel; non-AFK run ⇒ unchanged surface/cancel; `isRunAfkSupervised` predicate; injected-handler wiring (no import cycle). Follow existing deterministic-clock setup (`setHeartbeatConfig`, `setWatchdogMonotonicNow`, `tickWatchdog`, `flushAsync`).
- **Board task-chat stall** (in the orchestrate suite): no-output stall in AFK ⇒ bounded restart (`runTaskChatNudge` first, then relaunch); a long-but-active run (recent `bumpProgress`) is **not** killed; manual/sequential mode never auto-restarts. Follow `test/orchestrate/orchestrate-self-heal.test.mts` conventions (`setSessionStateForTests`, mocked deps).

## Verification

1. `npm test --test-force-exit` — full suite green; specifically the new `board-task-cwd-guard`, extended `controller-watchdog`, and the orchestrate stall tests (timer/watchdog suites need `--test-force-exit` per repo convention).
2. Manual sanity (optional): run an AFK board task whose build stalls; confirm via the board-log JSONL (`~/.minnow/logs/orchestrate/<groupId>.jsonl`) that it auto-recovers/redirects rather than going `blocked`, and that an `execute_command` with no `cwd` runs inside the task worktree.

## Done when

A stalled mutating sub-agent in AFK auto-recovers instead of halting the board; a stalled board task-chat is bounded-restarted (nudge → relaunch), not surfaced; task terminal commands default to the worktree and a leading absolute `cd` is redirected with a board-log warning; manual/sequential behavior unchanged; `npm test --test-force-exit` green.
