# Orchestrate supervisor — implementation summary

**Plan:** Cursor plan `orchestrate_supervisor_7eefeebd` (full Orchestrate Supervisor). **Context:** [`documentation/context.md`](../context.md).

## What shipped

- **`src/agents/supervisor/`** — Supervisor module: `defaults.ts`, `config.ts` (legacy `selfHealing` read-merge), `state.ts`, `detector.ts` (R1–R10 signals + `evaluateOrchestrateStall` + `detectRepetition` import), `rules.ts`, `report-types.ts`, `report-tool.ts`, `progress.ts`, `actions.ts`, `escalation.ts`, `observe-sub-agent.ts`, `loop.ts`, `runtime-stall.ts`, `index.ts`.
- **Shims** — `src/chat/orchestrate/watchdog.ts` re-exports `src/agents/supervisor`. `src/agents/self-healing/controller.ts` delegates to `observe-sub-agent.ts`; `resetSelfHealingState` clears supervisor test maps.
- **Tools** — `report_orchestrator_status` in `definitions.ts`; `client.ts` branch + `maybeRecordOrchestrateParentTool` for orchestrate parent tools (R4 timestamps).
- **Prompts** — `orchestrate.full.md` supervisor heartbeat section; `orchestrate.lite.md` one-line reminder.
- **Boot** — `main.ts` imports `startSupervisor` from `./agents/supervisor`.
- **Server** — `server/config/home.js` `supervisor` defaults; `server/config/validators.js` `mergeSupervisorConfig` + `mergeConfigMeta` `supervisor` branch; `server/config/tool-ids.js` board + report ids.
- **Settings** — `src/ui/settings-supervisor.ts`; `index.html` Features mount; `settings-sections.ts` calls `renderSupervisorSettingsSection`; self-healing checkbox removed from `settings-page.ts`.
- **Tests** — `test/supervisor/*.test.mts` (config merge, detector, rules, report-tool, escalation, integration); `test/self-healing/detector.test.mts` removed (ported); `test/orchestrate/watchdog.test.mts` unchanged (shim). `package.json` test glob includes `test/supervisor/**/*.test.mts`.

## Deviations / notes

- **`ORCHESTRATE_WATCHDOG_MAX_RETRIES_PER_TASK` in stall evaluation:** `evaluateOrchestrateStall` uses `getSupervisorConfigSnapshot().maxRetriesPerTask` (default `3`) so Settings can change the cap; exported constant remains `3` for API compatibility and test math.
- **Settings UI test:** Dropped jsdom `settings-supervisor` test (storage-mode + `detectConfigServer` coupling); merge + detectors covered in `test/supervisor/`.
- **R2 empty summary:** Handled in `subscribeSubAgentRuns` via `executeSupervisorDecision` `respawn_task` with captured payload (run cleared after handler).
- **`evaluateOrchestrateStall`:** Accepts optional `deps.stallMs` for unit tests; live path uses `supervisor.stallMs` from snapshot.

## Manual QA (from plan)

1. `npm start` → Orchestrate → confirm `report_orchestrator_status` in tool log.
2. R3 / R7 / R9 scenarios per plan thresholds.
3. Retries exhausted → **Stalled — Resume** via `isOrchestrateWatchdogStalled`.

## CI

```bash
npx tsc --noEmit
npm test
```
