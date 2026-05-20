# Feature 11-12 — Load / unload model — verification

| Field | Value |
|-------|-------|
| **Feature** | `feature-11-12-load-unload-model` (Epic A3) |
| **Status** | Implementation sign-off |

## Automated

- [ ] `npm test` — includes `test/providers/paths.test.js`, `test/providers/proxy-mock.test.js` (load/unload), `test/api/models-load-unload.test.mts`
- [ ] `npm run build` exits 0

## Acceptance criteria

| # | Criterion | PASS |
|---|-----------|------|
| AC1 | LM Studio local: **Load** loads selected not-loaded model; dropdown shows loaded after refresh | |
| AC2 | **Unload** on loaded model; row shows not-loaded after refresh | |
| AC3 | Buttons disabled for wrong `state` or empty selection | |
| AC4 | `openai-v1` / `supportsModelLoadUnload: false`: buttons hidden; no upstream POST | |
| AC5 | Proxy mode: browser hits `/api/providers/:id/models/load\|unload` only | |
| AC6 | Upstream failure shows error status; cache/session intact | |
| AC7 | `npm test` provider + client tests pass | |
| AC8 | `npm run build` exits 0 | |

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
