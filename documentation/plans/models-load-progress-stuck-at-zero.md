# Models load chip stuck at 0%

## Goal

The Local Server loaded-model chip (`Loading 0%`) must move during a llama.cpp serve start, instead of sitting at 0% until `/health` succeeds.

## Diagnosis

llama.cpp does not print a weight-load percentage. The chip is modelled in `src/models/load-progress.mjs` from log phase floors plus an elapsed-time / bytes-per-ms prior.

Two bugs pin the chip at 0% for the whole load:

1. **`Number(null) === 0`.** The store always passes `reportedPercent: parseLoadProgress(logText)`. On every current llama.cpp build that is `null`. `computeLoadProgress` then does `Number(null)`, treats `0` as a real runtime percent, and that value always wins over the model.
2. **Log SSE is replaced, not accumulated.** `subscribeServeLog` emits the existing tail (`initial: true`) then appended chunks. The runtime log panel concatenates those events; `trackLoad` overwrites `loadLogText` with each chunk. Later chunks are often a row of dots with no phase marker, so `matchLoadPhase` falls back to spawning (floor 0) and the time model cannot climb inside the current phase band.

## Todos

- [x] Confirm the chip is `models-loaded__state` on the Local Server loading card
- [x] Treat `reportedPercent: null` as "none" in `computeLoadProgress`; keep a real `0` from the runtime
- [x] Cover both cases in `test/models/load-progress.test.mjs`
- [x] Fold log SSE the same way as the runtime log panel (`foldServeLogEvent`)
- [x] Show `Loading` (indeterminate bar) until the modelled percent is above 0
- [x] Note the `Number(null)` pitfall and SSE fold in `documentation/context.md`
- [x] Run the load-progress and serve-log suites

## Out of scope

- Scraping a percentage llama.cpp still does not print
- Changing phase floors, rate priors, or `-lv 4`
- MLX loads (no per-serve spawn progress)
