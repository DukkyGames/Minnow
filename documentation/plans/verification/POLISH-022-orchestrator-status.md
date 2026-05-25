# POLISH-022 verification — Orchestrator status detail

| Field | Value |
|-------|-------|
| **ID** | POLISH-022 |
| **Verified** | 2026-05-24 |
| **Result** | **Not implemented** (plan-only baseline) |
| **Linear** | [MIN-85](https://linear.app/minnowai/issue/MIN-85/polish-022-orchestrator-status-detail) |
| **Plan** | [`POLISH-022-orchestrator-status-detail.md`](../Bug%20Fixes/POLISH-022-orchestrator-status-detail.md) |

**Plan poll:** No 25min wait required — no implementation to soak; audit-only verification.

## Acceptance criteria (from plan)

| Criterion | Status |
|-----------|--------|
| Board view shows instrumented prompt-build for W1-A before first worker tool | ❌ |
| Worker run shows W1-A + tool name on chip or Agent activity | ❌ (partial: `liveCurrentToolName` only, no task id on rows) |
| `report_orchestrator_status` `next_action` visible on chip without completed tool in history | ❌ |
| Chat view stream-status / sub-agent cards unchanged | ✅ (no regressions from this work — not shipped) |
| Supervisor R7 semantics unchanged | ✅ (baseline) |
| Empty board: no stuck “Generating…” | ✅ (baseline: chip removed when no activity) |
| Tests: label resolver + merge priority | ❌ (modules not added) |

## Code audit summary

- **Present:** `deriveBoardHeaderStatus`, `deriveOrchestratorLastActivity`, board activity chip UI, `report_orchestrator_status` → `sup.lastReport`.
- **Absent:** `orchestrator-live-status.ts`, `orchestrator-status-labels.ts`, `liveLifecycleStep`, UI read of `lastReport.nextAction`.

## Tests run

- `test/orchestrate/**/*.test.mts` (with test-loader): **52 pass**
- `test/orchestrate/last-activity.test.mjs`: exists; **not** in `npm test` script (imports fail without test-loader)

## Manual dogfood (deferred until implementation)

1. Orchestrate + board + plan with W1-A — watch chip through board_init → spawn → prompt → worker tool.
2. Agent activity — W1-A on sub-agent rows.
3. Board during `report_orchestrator_status` — `next_action` on chip.
4. Chat view parity when switching views.
5. Plan complete — chip idle/complete.
