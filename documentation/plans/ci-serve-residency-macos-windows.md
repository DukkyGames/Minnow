# Fix CI: llama.cpp residency tests (macOS) + Windows job timeout

## Problem

- **macOS** `typecheck + tests` fails in `test/models/serve-residency.test.mjs`:
  - `two models stay resident…` sees `live.length === 1` (expected 2)
  - `third model at cap 2…` finds model B `stopped` (expected `running`)
- **Windows** `typecheck + tests` is cancelled at the **20-minute** job timeout. The test step itself can finish (~17 min) but the job has no headroom; it looks like it “never finishes.”

Ubuntu on the same commit is green.

## Root cause

`admitServe` / `pickEvictions` evicts when `remaining.length >= models_max` **or** `used + incoming > budgetBytes`.

Stub GGUFs (`"GGUF"`) have no header geometry, but `planLlamaLaunch` still writes `estimateGb` (~1 GiB of heuristic KV + overhead). `estimatePlanMemoryBytes` uses that figure.

CPU `launchBudgetBytes` is `min(availableRamGb * 0.7, totalRamGb * 0.55)`. On GitHub **macOS**, `os.freemem()` is often ~1 GB (Darwin counts cache as used), so the second stub is over-budget and LRU-evicts the first — even with `models_max: 3`. Ubuntu/Windows report free RAM more honestly, so the same tests pass there.

Windows is not hanging on these tests (`--test-force-exit`, 120s per test). The gate job `timeout-minutes: 20` is too tight for `windows-latest`.

## Approach

1. Pin generous fake `hardware` on residency `startServe` calls so cap/LRU/TTL tests are host-independent.
2. Treat `budgetBytes <= 0` as “no byte-budget constraint” (unknown probe must not evict everyone).
3. Raise the CI gate job timeout to 30 minutes.
4. Correct the `estimatePlanMemoryBytes` comment (stubs still have planner `estimateGb`).

## Todos

- [x] Diagnose macOS assertions vs Windows timeout
- [x] Pin `hardware` in `serve-residency.test.mjs`
- [x] `pickEvictions`: skip byte-budget when `budgetBytes <= 0` + unit test
- [x] Bump `.github/workflows/ci.yml` gate `timeout-minutes` to 30
- [x] Update `documentation/context.md` residency note
- [x] Re-run `serve-residency` + `admit-serve` tests locally
