# Feature 12-13 — Model picker right dots — verification

| Field | Value |
|-------|-------|
| **Feature** | `feature-12-13-model-picker-right-dots` (Epic A4) |
| **Plan** | [`documentation/plans/Build out/feature-12-13-model-picker-right-dots.md`](../Build%20out/feature-12-13-model-picker-right-dots.md) |
| **Verified** | 2026-05-20 |

## Result

**PASS** — Model picker in `.topbar-end` with `#modelStateDot`; status `Ready` after fetch; no model inventory count in status pill.

## Automated

| Command | Result |
|---------|--------|
| `node --import ./test/test-loader.mjs ./node_modules/tsx/dist/cli.mjs --test test/ui/model-state-dot.test.mts test/ui/topbar-layout.test.mjs` | **PASS** (12 tests) |
| `node --test test/api/models-status.test.mjs` | **PASS** |
| `npm run build` | **PASS** |

## Acceptance criteria (1–10)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Model control rightmost before status pill in `.topbar-end` | **PASS** (`topbar-layout.test.mjs` T4–T5) |
| 2 | Green dot when `loaded`; grey when not loaded / unknown | **PASS** (`model-state-dot.test.mts`) |
| 3 | Status pill never shows `N models, M loaded` after fetch | **PASS** (`models-status.test.mjs`) |
| 4 | Operational status messages unchanged | **PASS** (code review) |
| 5 | `onModelSelectChange` / `syncModelSelectForActiveChat` sync dot | **PASS** (wired in `models.ts` / `sidebar.ts`) |
| 6 | Option labels omit `(loaded)` suffix (A2 formatter) | **PASS** |
| 7 | `aria-label` / `title` reflect load state | **PASS** (`model-state-dot.test.mts` DOM wiring) |
| 8 | `npm run build` exits 0 | **PASS** |
| 9 | `npm test` includes `model-state-dot` tests | **PASS** |
| 10 | `documentation/context.md` updated | **PASS** |

## Manual UAT (U1–U8)

Requires `npm start` + LM Studio. Not run in this verification pass (operator QA).

| ID | Status |
|----|--------|
| U1–U8 | Pending operator |

## Sign-off

**PASS** for automated scope (layout, dot state, status side effects, build). Manual U1–U8 pending.
