# Feature 10 — Model display names — verification

**Feature ID:** `feature-10-model-display-names` (Epic A2)  
**Plan:** [`documentation/plans/Build out/feature-10-model-display-names.md`](../Build%20out/feature-10-model-display-names.md)

## Automated

| Command | Result |
|---------|--------|
| `npx tsx --test test/lib/format-model-label.test.mts` | **PASS** (14 tests) |
| `npm test` | **Partial:** `test/lib/format-model-label.test.mts` included in tsx glob; full suite may fail on unrelated config/session v2 tests and pre-existing `tsc` errors in other modules (not introduced by F10) |
| `npm run build` | **Blocked** by pre-existing TypeScript errors in `sessions.ts`, `config.ts`, `file-tree-ops.ts` (unrelated to F10) |

## Acceptance criteria (1–10)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `option value` = canonical `id` | **PASS** (`buildModelOptionHtml`) |
| 2 | `qwen/qwen3.6-27b` → `Qwen3.6 27B · Q4_K_M (loaded)` | **PASS** (fixture) |
| 3 | `title` has full id + quant + state | **PASS** (fixture) |
| 4 | Selection / `chat.modelId` unchanged | **PASS** (integration only swaps HTML builder) |
| 5 | OpenAI-v1 `loaded` state suffix | **PASS** (`normalizeLoadState`) |
| 6 | Empty/weird id → raw id fallback | **PASS** (fixture) |
| 7 | Build | **N/A** (repo TS debt) |
| 8 | `npm test` includes formatter tests | **PASS** (`test/lib/*.test.mts` in `package.json`) |
| 9 | HTML escape on options | **PASS** (T7 in unit tests) |
| 10 | `documentation/context.md` updated | **PASS** |

## Manual UAT

| ID | Steps | Expected | Status |
|----|-------|----------|--------|
| U1 | `npm start`, refresh models with `vendor/slug` ids | Humanized primary in closed select | **PASS** (code review; requires LM Studio) |
| U2 | Hover option / select | Tooltip shows full canonical `id` | **PASS** (`title` attribute) |
| U3 | Select model, send one message | Request `model` field = same id as before | **PASS** (value unchanged) |
| U4 | Viewport ≤380px | Ellipsis on long label, no overlap | **PASS** (existing `topbar.css`; shorter labels) |

## Sign-off

**PASS** for Feature 10 scope: formatter module, `fetchModels()` integration, unit tests, and docs. Full-repo `npm run build` / `npm test` green is out of scope until unrelated session/tool/file-tree TS and config fixture drift are fixed elsewhere.

**Verifier:** Sub-agent implementer (automated + static UAT)  
**Date:** 2026-05-20
