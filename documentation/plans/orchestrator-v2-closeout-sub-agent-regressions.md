# Orchestrator V2 — close out remaining sub-agent and test regressions

**Status:** In progress · **Date:** 2026-09-01 · **Branch:** Orchestrator-V2

Closes the remaining defects from the V2 review against `main`. The blocking live-SSE session-token defect is already fixed (`56b41dc4`, `1928dc04`). This plan covers ship blockers, model binding, UI placement/delivery, planner titles, and greening the 13 branch-only test failures.

## Todos

- [x] **A1** — Ship `src/agents/defaults/sub-agents.json` in Electron `build.files`; add it to `REQUIRED_RUNTIME_PATHS`; scan `new URL(..., import.meta.url)` in the packaged-runtime validator.
- [x] **A2** — Call `resetSubAgentServerConfigCache()` after Settings PUT and profile apply write `sub-agents.json`.
- [x] **B** — In `spawnSubAgent`, fill `providerId`/`modelId` from `resolveSubAgentModelBinding` when the caller did not override.
- [x] **C1** — Restore `appendChatTranscriptNode` as the spawn-card placement fallback.
- [x] **C2** — Stop discarding orchestrate-mode parent completions in `resumeDeliverFrame`.
- [x] **D** — Restore `planner-chat-title.ts` under `src/chat/plans/` and call it from `linkPlannerChatToBoardFolder`.
- [x] **E1** — Add missing Super Plan mock namedExports (`hydrateSubAgentTranscript`, `honestTerminalSummary`, `lastNonSystemPreview`).
- [x] **E2** — Drop deleted `board_*` / `delegate_tasks` entries from `expected-tools.json`.
- [x] **E3** — Add `workspacePath` to `BOARD_STATE_KEYS`.
- [x] **E4** — Remove dangling board capability ids; update catalog counts (59→56, auto 55→52, agents-tasks 8→5).
- [x] **E5** — Rewrite V1 board-worktree assertions to the new contract; drop unused `resolvePanelBrowseCwd` params.
- [x] **Verify** — `npx tsc --noEmit`, `npm test` (restore fixture rewrites), `node scripts/validate-packaged-runtime-files.mjs`.

## Out of scope

- Restoring board-scoped cwd for V2.
- Four suspected-environmental failures (MCP secrets, memory vector-sync, models serve-reconcile, terminal run-index) unless a clean re-run keeps them red.
