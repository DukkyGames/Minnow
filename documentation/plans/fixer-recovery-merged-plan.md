# Fix: Fixer tasks stranding & board appearing paused (merged plan)

**Status:** Implemented (2026-06-26)  
**Supersedes:** cursor plan `merge_fixer_stall_fix`, other-agent draft, `fix-merge-fixer-board-hang.md` W1-A  
**Related:** [`orchestrator-edge-case-fixes.md`](./orchestrator-edge-case-fixes.md) Fix 1 (partially landed), [`orchestrate-board-architecture.md`](./orchestrate-board-architecture.md) § Merge & fixer loops

## Context

On the Orchestrate board, fix tasks (merge-conflict fixers and env-fixers) sometimes stop progressing, and the board looks paused even though `autoRunning === true`. Forward progress is **push-based**: something must call `autoDelegateNext` / `drainTaskQueue` while `isBoardRunning(group)` is true. Two independent failure classes exist:

1. **Live fixer, merge already done, chat still streaming** — git poll succeeds but code only calls `stopGeneration` and waits for stream-end that never arrives (`orchestrate-board-actions.ts` ~693–725).
2. **Dead fixer, task stuck in `merging`** — no live reconciler runs at runtime; only boot `recoverInterruptedMergesAfterReload` recovers (`~3186`).

This merged plan combines both diagnoses.

---

## Already implemented (do not re-land)

| Item | Location | Notes |
|------|----------|-------|
| Merge-fixer supervision | `startMergeConflictFixer` ~1931–1932 | `refreshHeartbeatThresholds` + `startTaskChatSupervision` — closes `fix-merge-fixer-board-hang.md` W1-A |
| MERGE_HEAD preflight | `startMergeConflictFixer` + tests | `merge-fixer-stall.test.mts` Part 3 |
| `boardHasActiveFixer` gates on `isTaskChatActive` | `orchestrate-board-actions.ts` ~273–279 | `orchestrator-edge-case-fixes.md` Fix 1 |
| `MAX_FIXER_WAIT_MS` timeout in `waitForNoActiveFixer` | `~262`, `~283–296` | Timeout logs and returns — **does not yet call `reconcileMergingTasks`** |
| Boot merge recovery | `recoverInterruptedMergesAfterReload` ~3186 | Uses `shouldSuperviseBoardChatOnReload` (broader than `isTaskChatActive`) |
| Env-fixer stall guard in delegation | `isTaskStalledForRestart` in store ~599–602 | Prevents builder restart while env-fixer active — **does not stop fixer-chat nudge/self-heal in heartbeat** |

**Still broken (this plan):** heartbeat git-success and stall paths are **stop-only** for merge fixers; env-fixer chats fall through to the build stall branch (nudge/self-heal); no runtime `reconcileMergingTasks`; header badge omits `merging`; shutdown sets `userStopped` → quarantine on stream-end.

---

## Comparison: two plans

| Issue | Other-agent plan | Our plan | Merged choice |
|-------|------------------|----------|---------------|
| `merging` + dead fixer | Fix 1: `reconcileMergingTasks` at `autoDelegateNext` | Fix 2: `reconcileStuckMergingTasks` + `waitForNoActiveFixer` timeout | **Both** — same function, both call sites |
| Merge done, fixer still streaming | Not covered (fixer still "active") | Fix 1: heartbeat calls `finalizeMergeFixerOnStreamEnd` directly | **Our Fix A** — required for reported symptom |
| env-fixer watchdog double-drive | Fix 2: fixer-owned stop-only branch | Out of scope | **Other Fix 2 → Fix C** |
| `pagehide`/OOM → quarantine | Fix 3: `systemPaused` flag | Not covered | **Other Fix 3 → Fix D** |
| `selfHealMaxRounds` too low | Fix 4: raise default 2→4 | Not covered | **Other Fix 4 → Fix E** |
| Premature fixer stall stop | Fix 5: 1.5× stall multiplier | Subsumed by direct finalize on git OK | **Other Fix 5 → Fix F** (optional) |
| Header "Paused" badge | Not covered | Badge: `merging` in `hasInFlight` | **Our Fix G** |
| Manual mode recovery | Fix 6 (via Fix 1, no `isBoardRunning` gate) | Partial | **Other Fix 6** — reconcile runs before `isBoardRunning` early-return in `autoDelegateNext`; manual boards still rely primarily on boot recovery unless something invokes `autoDelegateNext` / `drainTaskQueue` |

**Critical gap in other-agent Fix 2 for merge fixers:** it keeps "stop-only — stream-end owns finalize" for merge fixers on stall. That is the same bug as today when stream-end is lost. Merged plan **replaces** stop-only with `reconcileMergeFixerChat` (stop + direct finalize + drain) on both git-success and stall paths for **merge** fixers only.

---

## Fix A — Direct merge-fixer reconciliation (heartbeat; highest impact)

Add `reconcileMergeFixerChat(group, planner, taskId, chatId)` in `orchestrate-board-actions.ts`:

1. `stopTaskChatSupervision(chatId)` + `stopGeneration(chatId)`
2. Re-read task; bail if not `merging` or `fixerChatId !== chatId`
3. `await finalizeMergeFixerOnStreamEnd(group, task, planner)`
4. `await drainTaskQueue(group, planner)` when `isBoardRunning(group)`

Wire into merge-fixer heartbeat (`startTaskChatSupervision`, `status === 'merging'` branch, ~693–725):

- **Git early-finalize** (`check_merged` + `verify_integration` OK): call `reconcileMergeFixerChat` (replace stop-only at ~712–713).
- **Stall** (`progressAge >= progressStallMs`): call `reconcileMergeFixerChat` (replace stop-only at ~722–724).

Use fire-and-forget `.catch(reportBackgroundError)` — same pattern as `runSelfHeal` in the build branch.

---

## Fix B — Live `reconcileMergingTasks` safety net

Extract shared logic from `recoverInterruptedMergesAfterReload`:

```ts
export async function reconcileMergingTasks(group, plannerChat): Promise<void>
```

For each task with `status === 'merging'`:

- Fixer chat **active** (`isTaskChatActive(fixerChatId)` or `shouldSuperviseBoardChatOnReload` on boot — prefer unifying on `isTaskChatActive` for runtime, keep reload helper for boot edge cases with `currentGenerationId`) → ensure supervision attached.
- Fixer **not** active (or no `fixerChatId`) → `finalizeMergeFixerOnStreamEnd` + `drainTaskQueue` when board is running.

Call sites:

1. **Top of `autoDelegateNext`** — call **before** `if (!board || !isBoardRunning(group)) return` so reconciliation runs even when auto-run is off but something invoked delegation (manual recovery path).
2. **`waitForNoActiveFixer` timeout branch** — after logging `wait-for-fixer-timeout`, call `reconcileMergingTasks` then return (today timeout only proceeds; dead fixer may remain `merging`).
3. **`recoverInterruptedMergesAfterReload`** → thin wrapper calling `reconcileMergingTasks`.

Handles: crashed fixer, launch `.catch` only setting `error`, stream-end never delivered after chat died.

Does **not** handle: fixer still streaming after merge — that is Fix A.

---

## Fix C — env-fixer watchdog (other-agent Fix 2)

In `startTaskChatSupervision`, branch when `stallTask?.fixerChatId?.trim() === chatId`:

| Task status | Fixer kind | Stall / git behavior |
|-------------|------------|----------------------|
| `merging` | merge | Git poll gated on `status === 'merging'`; on success or stall → **Fix A** `reconcileMergeFixerChat` |
| `in_progress` | env (`fixerKind === 'env'`) | On stall (`progressAge >= progressStallMs`): **stop-only** + return; never `runTaskChatNudge` / build self-heal on fixer-owned chat |
| other | — | Fall through to existing build/test stall logic |

Today env-fixers (`in_progress` + `fixerChatId`) miss the merge-only branch and incorrectly hit the build nudge/self-heal path at ~728–750.

---

## Fix D — `systemPaused` vs user Stop (other-agent Fix 3)

- Add `board.systemPaused?: boolean` to `OrchestrateBoardState` (`types.ts`).
- `stopBoardAutoRun(group, planner, { reason: 'user' | 'system' })` — default `'user'`.
- `pauseAllRunningBoardsForShutdown` / OOM pause pass `reason: 'system'` → set `systemPaused`, do **not** set `userStopped` (or set both with `systemPaused` taking precedence in finalize).
- `startBoardAutoRun` clears `userStopped` and `systemPaused`.
- `finalizeBoardTaskOnStreamEnd`:  
  `parkUserStop = stopReason === 'user' || (board.userStopped && !board.systemPaused)`  
  System pause → `planned` + `stopRetries`, not quarantine.

---

## Fix E — `selfHealMaxRounds` ceiling (other-agent Fix 4)

- Raise `DEFAULT_AUTOPILOT_META.selfHealMaxRounds` from `2` to `4` in `autopilot-meta.ts` (currently `68`).
- Comment at ceiling check in `orchestrate-self-heal.ts` that per-category caps are primary.

---

## Fix F — Fixer stall multiplier (other-agent Fix 5, optional)

- Apply `FIXER_STALL_MULTIPLIER` (e.g. 1.5×) to `progressStallMs` for merge-fixer stall branch only.
- Low priority if Fix A lands first; reduces spurious restore before git confirms merge.

---

## Fix G — Header badge

In `deriveBoardHeaderStatus` (`orchestrate-board.ts` ~813):

- Include `merging` in `hasInFlight` (today only `in_progress` \| `testing` at ~827–829).
- When any task is `merging` and `countRunningTaskChats(board) === 0`, return `{ variant: 'active', label: 'Merging' }` before the generic `Paused` fallback (~867–868).

---

## Tests — `test/orchestrate/fixer-recovery.test.mts` (new)

1. **Fix A:** merge committed, fixer chat still "active" in history; heartbeat git poll or stall triggers `reconcileMergeFixerChat` → `complete` without relying on `notifyChatStreamEnded`.
2. **Fix B:** `merging` + dead fixer → `reconcileMergingTasks` (via `autoDelegateNext` or direct) → task **advances out of** `merging`.
3. **Fix C:** env-fixer stall stops fixer chat only — no `runTaskChatNudge` / build self-heal on the fixer chat (`isTaskStalledForRestart` stays false for the task slot).
4. **Fix D:** `systemPaused` → `planned`, not quarantined; `userStopped` without `systemPaused` → quarantine.
5. **Fix E:** two-category self-heal does not quarantine at round 2 with new ceiling.
6. **Fix G:** header badge tests in `orchestrate-board-header-status.test.mjs`.

Also keep existing suites green:

- `test/orchestrate/merge-fixer-stall.test.mts` (supervision, MERGE_HEAD guard, dead-fixer merge queue)
- `test/orchestrate/merge-fixer-resume.test.mts` (`recoverInterruptedMergesAfterReload`)

---

## Verification

```bash
node --test --test-force-exit test/orchestrate/fixer-recovery.test.mts test/orchestrate/merge-fixer-stall.test.mts test/orchestrate/merge-fixer-resume.test.mts
node --test --test-force-exit test/ui/orchestrate-board-header-status.test.mjs
npx tsc --noEmit
```

Manual: AFK board, merge conflict, fixer commits + prose → task completes without Stop/reload.

---

## Suggested implementation order

1. **A + B** — unblocks the primary "merge done, board stuck" and "dead fixer" paths.
2. **C** — prevents env-fixer double-drive regressions.
3. **G** — UX clarity (cheap).
4. **D** — shutdown/OOM quarantine false positives.
5. **E** — AFK self-heal headroom.
6. **F** — optional polish.

---

## Implementation todos

- [x] A: `reconcileMergeFixerChat` + heartbeat wiring (replace stop-only at ~712–724)
- [x] B: `reconcileMergingTasks` + `autoDelegateNext` (before `isBoardRunning` gate) + `waitForNoActiveFixer` timeout + boot wrapper
- [x] C: env-fixer watchdog branch (`fixerChatId === chatId`, split merge vs env)
- [x] D: `systemPaused` + `stopBoardAutoRun` reason param
- [x] E: raise `selfHealMaxRounds` default
- [ ] F: (optional) fixer stall multiplier — deferred
- [x] G: header badge (`merging` in `hasInFlight` + Merging label)
- [x] Tests + docs (`context.md`; architecture doc follow-up recommended)
