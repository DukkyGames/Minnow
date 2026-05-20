# Feature 11-12 — Load / unload model — verification

| Field | Value |
|-------|-------|
| **Feature** | `feature-11-12-load-unload-model` (Epic A3) |
| **Status** | Implementation sign-off |

## Automated

- [x] `test/providers/paths.test.js` — **PASS** (3 tests)
- [x] `test/providers/proxy-mock.test.js` — **PASS** (load/unload proxy, 9 tests)
- [x] `test/api/models-load-unload.test.mts` — **PASS** (5 tests)
- [x] `npm run build` exits 0 — **PASS**

## Acceptance criteria

| # | Criterion | PASS |
|---|-----------|------|
| AC1 | LM Studio local: **Load** loads selected not-loaded model; dropdown shows loaded after refresh | Manual |
| AC2 | **Unload** on loaded model; row shows not-loaded after refresh | Manual |
| AC3 | Buttons disabled for wrong `state` or empty selection | Manual |
| AC4 | `openai-v1` / `supportsModelLoadUnload: false`: buttons hidden; no upstream POST | **PASS** (proxy-mock rejects load) |
| AC5 | Proxy mode: browser hits `/api/providers/:id/models/load\|unload` only | **PASS** (proxy-mock + resolve endpoints) |
| AC6 | Upstream failure shows error status; cache/session intact | Manual |
| AC7 | `npm test` provider + client tests pass | **PASS** |
| AC8 | `npm run build` exits 0 | **PASS** |

## Result

**PASS** (automated). Manual U1–U6 require LM Studio operator QA.

## Manual QA (requires LM Studio)

| # | Step | PASS |
|---|------|------|
| U1 | `npm start`, open Minnow, `lm-studio-local` active | |
| U2 | Pick **not-loaded** model → **Load** → loaded in LM Studio + Minnow dropdown | |
| U3 | **Unload** → not-loaded in LM Studio + dropdown | |
| U4 | OpenAI-compatible provider (`openai-v1`) → Load/Unload hidden | |
| U5 | Proxy + bearer provider → load still works (auth server-side) | |
| U6 | Stop LM Studio → Load shows connection error within timeout | |

## Plan review

Pre-implementation plan: [`documentation/plans/Build out/feature-11-12-load-unload-model.md`](../Build%20out/feature-11-12-load-unload-model.md). Uses LM Studio **v1** `POST /api/v1/models/load` and `/api/v1/models/unload` (not v0).
