# Capability matrix — revive Benchmarking into Settings

**Status:** Complete  
**Plan path:** `documentation/plans/capability-matrix-settings.md`

## Success criteria

- Settings → Advanced → Capability matrix: roster, run, grid, manual cells, xlsx export/import.
- `bench` stays `releaseState: 'hidden'`; `capability-matrix` is an additive suite only.
- 67 capabilities in spreadsheet order; **62 auto / 5 manual**; hybrid scoring with visible source tags.
- Load failure ⇒ skipped row (never failed aggregate).

## Locked decisions

See user plan § Context (hybrid scoring, Settings only, auto load/unload, keep existing suites).

## Phase checklist

| Phase | Title | Status |
|-------|--------|--------|
| 0 | Catalog (pure modules + tests) | ✅ Done |
| 1 | Suite registration, all-skipped | ✅ Done |
| 2 | Auto probes (2a–2f waves) | ✅ Done (2f) |
| 3 | Model lifecycle | ✅ Done |
| 4 | Persistence (roster, manual, campaign cap fixes) | ✅ Done |
| 5 | Settings surface (5a read-only, 5b run) | ✅ Done |
| 6 | xlsx export, then import | ✅ Done |
| 7 | Polish | ✅ Done |
| 8 | Manual→auto sweep + probe fixes | ✅ Done |

## Todos (by phase)

### Phase 0 — Catalog

- [x] `src/benchmark/capabilities/` — types, catalog (67), groups, house-rules, probes, score, host-group
- [x] Port definitions from scratchpad (`build_matrix.py` / `prompts.py`) or `documentation/minnow-model-capability-matrix.xlsx`
- [x] Tests: `test/benchmark/capability-*` (shape, score math, host grouping)

### Phase 1 — Suite registration

- [x] Register `capability-matrix` suite; manual caps skipped; full preset unchanged

### Phase 2 — Auto probes

- [x] 2a driver telemetry · [x] 2b text/stream (6) · [x] 2c workspace + git (14) · [x] 2d emit-only · [x] 2e conditional · [x] 2f derived/delegated

### Phase 3 — Model lifecycle

- [x] `load-lock.ts`, `model-lifecycle.ts`, campaign hooks (`manageModelLifecycle` default false)

### Phase 4 — Persistence

- [x] Manual verdicts, roster store, middleware routes, campaign size fixes

### Phase 5 — Settings UI

- [x] 5a read-only grid (roster, grid, manual cells, history, disabled run)
- [x] 5b run controls

### Phase 6 — xlsx

- [x] Export then import (client SheetJS)

### Phase 7 — Polish

- [x] Container queries (`capmatrix` @ 620cqi card rows)
- [x] Grid arrow-key navigation
- [x] Resume banner + `completedProbeKeys` / `skipCapabilityIds`
- [x] Fail/partial transcript drill-down (drawer)
- [x] Collapsible roster host bands (`<details>`)

### Phase 8 — Manual→auto sweep + probe fixes

- [x] 18 manual rows automated: browser ×3, sub-agent control, board ×2, recall, email ×3,
      calendar (wave 2d, emit-only) and the 7 remaining modes rows (wave **2g**, run under
      the mode's real system prompt with `trapToolIds` for tools the mode denies)
- [x] Manual set is now research, compare, MCP, and voice (no model-side signal) plus
      `modes-desktop` — Desktop mode was stripped out of Minnow, so nothing scores it and
      the column only stays for spreadsheet order
- [x] Authored probe prompts (`probe-prompts.ts`) replace the generated
      "Exercise: …" descriptions that asked the model to introspect instead of perform
- [x] Probe fixes: catalog tool ids (`brain_ingest_source`, `brain_list`, `issue_add`,
      `issue_get_state`), `core-reasoning` empty-alternation regex, `core-long-context`
      giveaway prompt (haystack now inline, ~34k tokens), `core-no-hallucinated-tools`
      no-op verdict, `core-tool-loop` / `core-json-args` `get_datetime`-only tool set,
      `mode-impeccable`, background-command tools, `code-execute-command` /
      `code-run-js-py` output verification via `executedResults`
- [x] Run output carries `contentText` / `reasoningText` / `executedResults` /
      `offeredToolNames`; dead `expectArgs` / `verifyExec` / `expectTools` removed
- [x] Per-run `stubToolIds` so a tool that is emit-only for one row still executes for another
- [x] Stub payloads (`stub-fixtures.ts`) return ids chain probes can act on

## Notes

- Source workbook: `documentation/minnow-model-capability-matrix.xlsx` (not committed by default).
- Critical files listed in original plan §10.
- Probes must never name a tool id outside `BUILT_IN_TOOLS` — a missing id is dropped from
  the request, so the model gets scored on a tool it was never offered. Guarded by
  `test/benchmark/capability-probe-specs.test.mts`.
