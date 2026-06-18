# Orchestrator Hardening Plan

Phased PRs by severity. Each phase is independently reviewable and testable.

## Phase 1 — Correctness bugs (PR1) — **shipped**

### 1a. Run timeout & check-in nudge must not count queued wait
- `armRunTimers` in `src/agents/controller/registry.ts`; called from `executeRun` at the `running` transition.
- Removed timer arming from `spawnSubAgentInternal` (queued wait no longer consumes `defaultTimeoutMs` / `checkInNudgeMs`).

### 1b. Dependency-cycle detection for auto/sequential boards
- `detectDependencyCycles` / `detectCycleTaskIds` in `src/state/orchestrate-board-store.ts`.
- `initBoard` marks cyclic tasks `blocked` with `dependency cycle: …` error.
- `isTaskReadyForAuto` / `isDepsComplete` refuse cycle participants.

**Tests:** `test/orchestrate/board-store.test.mts`, `test/sub-agents/orchestrator-spawn.test.mts` (queued timeout).

## Phase 2 — Robustness & persistence (PR2) — **shipped**

- 2a. Throttled `console.warn` on persistence fetch/PUT failures (`persistence.ts`)
- 2b. `trimRunMessagesOnSettle` + `scheduleRunEviction` (60s; skipped under `MINNOW_TEST=1`)
- 2c. Coalesced `mirrorRegistryEntry` (microtask batch, last-write-wins); removed redundant settle mirror
- 2d. `POST /api/config/runs/supersede` + client no-op when `attempt <= 1`

## Phase 3 — Efficiency (PR3) — **shipped**

- 3a. Event-driven `waitForSubAgent` via `subscribeSubAgentRuns`; 3s fallback only for eviction/persistence races
- 3b. `structuredClone` for transcript copies; coalesced forced `emitProgress` via microtask

## Phase 4 — Minor cleanups (PR4) — **shipped**

- 4a. Single `running` transition in `executeRun` only
- 4b. `getOrCreateBoardChat` helper in `orchestrate-board-actions.ts`

## Verification

```bash
node --experimental-test-module-mocks ./node_modules/tsx/dist/cli.mjs --import ./test/test-loader.mjs --test test/sub-agents/*.mts test/orchestrate/*.mts test/agents/controller-watchdog.test.mts test/state/orchestrate-board-*.mts
```
