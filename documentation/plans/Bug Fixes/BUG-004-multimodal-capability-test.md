---
name: BUG-004 — Multimodal capability test not run
overview: Fix the Capability suite `cap-multimodal` test so vision-capable models are detected via catalog metadata (not ID regex) and receive a real image+text probe that reports pass/fail instead of always skipping.
source: documentation/bug-hunt-session-2026-05-24.md (BUG-004)
status: shipped
severity: major
area: Benchmark — Capability suite (`src/benchmark/suites/capability.ts`)
related:
  - BUG-002 (streaming empty text may affect probe pass criteria)
  - feature-11-model-capability-detection (future persisted capability matrix)
  - POLISH-004 (benchmark test descriptions)
todos:
  - id: bug004-root-cause-verify
    content: Reproduce on a catalog-typed VLM (LM Studio `type: vlm`) and a false-negative model (vision without regex keywords); capture `cap-multimodal` card state
    status: completed
  - id: bug004-shared-vlm-detect
    content: Add shared `isVisionModel(modelId)` using `modelCache` + optional catalog lookup fallback; remove duplicate regex-only gate in capability suite
    status: completed
  - id: bug004-probe-fixture
    content: Add deterministic inline probe image + prompt constants (small base64 PNG/JPEG, known answer heuristic)
    status: completed
  - id: bug004-run-probe
    content: Implement real multimodal `runOneShot` in `cap-multimodal` with pass/fail scoring and clear details text
    status: completed
  - id: bug004-tests
    content: Add unit tests for VLM detection + multimodal test branches (mock `runOneShot` / `modelCache`)
    status: completed
  - id: bug004-manual-verify
    content: Manual QA on VLM + text-only model; run `npm run test:benchmark`
    status: completed
  - id: bug004-context-doc
    content: Update `documentation/context.md` benchmark section after fix ships
    status: completed
isProject: false
---

# BUG-004 — Multimodal capability test not run

**Tracker:** [bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) · **BUG-004**  
**Primary file:** [`src/benchmark/suites/capability.ts`](../../../src/benchmark/suites/capability.ts)  
**Test id:** `cap-multimodal` · **Label:** Multimodal request

---

## Verification (2026-05-24)

| Check | Result |
|-------|--------|
| Plan vs `capability.ts` | **Match** — dual root cause confirmed in source |
| Chat VLM detection (`isVlmModel`) | Uses `modelCache` `type === 'vlm'`; benchmark does **not** |
| `runOneShot` multimodal support | `messages: ApiMessage[]` — no image probe wired |
| `npm run test:benchmark` | Pass (scoring + page HTML only; **no** `cap-multimodal` tests) |
| Manual `#/benchmark` on VLM | **Pending** — requires LM Studio VLM + model refresh |

**Linear:** [MIN-65](https://linear.app/minnowai/issue/MIN-65/bug-004-multimodal-capability-test-not-run) — priority High, labels Bug + benchmark.

**Manual QA still needed:** Run Quick bench on (1) catalog `type: vlm` model, (2) text-only `llm`, (3) optional VLM id without regex keywords — confirm skip vs deferred vs run per table in [Reported behavior](#reported-behavior).

---

## Summary

During benchmark runs (Quick or Full presets), the **Multimodal request** capability test does not execute a real vision probe for models that support image input. Users see the test **skipped** even when the active model is multimodal.

Two separate issues combine into one user-visible bug:

1. **Wrong detection signal** — the suite gates on a **model-id regex** instead of provider catalog metadata.
2. **Deferred implementation** — even when the regex matches, v1 code **always skips** with “VLM probe deferred” and never sends an image.

---

## Reported behavior

| Field | Value |
|-------|-------|
| **Severity** | Major |
| **Expected** | Multimodal probe runs for vision models; result is pass or fail based on model response |
| **Actual** | Test skipped (`not a VLM model` or `VLM probe deferred`) for multimodal models |
| **Repro** | Select a vision model → Benchmark → Capability suite → inspect **Multimodal request** card |

---

## Root cause analysis

### 1. Regex-only VLM gate (false negatives)

[`modelLooksMultimodal()`](../../../src/benchmark/suites/capability.ts) matches only:

```text
/vlm|vision|llava|bakllava|moondream|multimodal/
```

against `ctx.modelId`.

The **chat send path** already uses catalog type:

```typescript
// src/tools/loop.ts — isVlmModel()
modelCache.get(modelId)?.type === 'vlm'
```

LM Studio exposes `type: 'vlm'` via `GET /api/providers/:id/models` → [`fetchModelsForProvider`](../../../src/providers/fetch-models.ts) → [`modelCache`](../../../src/app-state.ts). A model can be **`type: 'vlm'`** in the catalog while its **id** contains none of the regex tokens (e.g. vendor-specific naming, quantized suffixes, or upstream renames).

**Result:** Benchmark skips with `skipReason: 'not a VLM model'` for genuinely multimodal models.

### 2. Intentional v1 stub (never runs)

When the regex *does* match, the suite still records:

| Field | Value |
|-------|-------|
| `skipped` | `true` |
| `skipReason` | `VLM probe deferred` |
| `details` | `skipped deep image probe in v1` |
| `passed` | `true` (ignored because skipped) |

No `runOneShot` call with `ContentPart[]` / `image_url` is made. The test is present in results but **never exercises multimodal API wiring**.

### 3. Score accounting (secondary)

Skipped tests are excluded from suite score numerator ([`capability.ts` L246–250](../../../src/benchmark/suites/capability.ts)). That is correct for text-only models, but misleading when vision models are skipped due to bugs rather than capability absence.

---

## Current code map

| Piece | Role |
|-------|------|
| [`runCapabilitySuite`](../../../src/benchmark/suites/capability.ts) | Test 7 — multimodal branch |
| [`runOneShot`](../../../src/benchmark/llm-driver.ts) | Already accepts `ApiMessage[]`; supports multimodal `user.content` arrays |
| [`buildVlmUserApiContent`](../../../src/tools/loop.ts) | Private helper for chat attachments → `ContentPart[]` |
| [`isVlmModel`](../../../src/tools/loop.ts) | Private; catalog `type === 'vlm'` |
| [`LmModelRecord.type`](../../../src/types.ts) | `'llm' \| 'vlm'` from provider models API |
| Capability suite test 6 | Already calls `fetchModelsForProvider` — could resolve `type` for active `modelId` |

---

## Goals

1. **Detect vision models reliably** using the same signal as chat (catalog `type === 'vlm'`), with a narrow fallback when cache is cold.
2. **Run a lightweight multimodal probe** for detected vision models — not skip.
3. **Skip only text-only models** with an accurate reason (`not a vision model`).
4. **Report pass/fail** with actionable `details` (response snippet or error message).
5. **Keep scope minimal** — do not block on Feature 11 (`capabilities.json` persistence).

### Non-goals (this bug fix)

- Full capability matrix / persisted probes ([Feature 11](../Build%20out/feature-11-model-capability-detection.md)).
- Vision **quality** scoring (LLM judge, object-detection ground truth).
- Probing multiple image formats, PDF vision, or video.
- Fixing **BUG-002** streaming empty text (note dependency; may cause false fails until BUG-002 is fixed).

---

## Proposed solution

### Phase A — Shared vision detection

**Add** a small shared helper (recommended location: `src/providers/vision-model.ts` or `src/lib/vision-model.ts`):

```typescript
/** True when the model accepts image_url multimodal user content. */
export function isVisionModel(modelId: string, catalog?: LmModelRecord[]): boolean
```

**Resolution order:**

1. `modelCache.get(modelId)?.type === 'vlm'` (primary — matches chat).
2. If cache miss and `catalog` provided (from suite’s models-list fetch): find row by `id`, check `type === 'vlm'`.
3. **Optional last-resort fallback:** existing regex on `modelId` **only** when cache and catalog both unavailable (document as best-effort; prefer false skip over false run for text-only).

**Refactor consumers (follow-up, not required for BUG-004 closure):**

- Replace private `isVlmModel` in [`loop.ts`](../../../src/tools/loop.ts) with shared import (single source of truth).

**Remove** standalone `modelLooksMultimodal()` from capability suite in favor of shared helper.

### Phase B — Multimodal probe fixture

**Add** `src/benchmark/fixtures/multimodal-probe.ts` (or inline constants in capability suite if fixture file is overkill):

| Constant | Purpose |
|----------|---------|
| `MULTIMODAL_PROBE_IMAGE_DATA_URL` | Tiny deterministic image (e.g. 2×2 or 8×8 solid-color PNG as `data:image/png;base64,...`) |
| `MULTIMODAL_PROBE_PROMPT` | Short instruction, e.g. “What is the dominant color in this image? Reply with one word only.” |
| `MULTIMODAL_PROBE_SYSTEM` | Optional: “You are a vision assistant. Answer briefly.” |

**Design constraints:**

- **Inline base64 only** — no filesystem reads, no network fetches, works in browser benchmark UI and headless smoke.
- **Deterministic color** (e.g. solid red) so future optional strict scoring (`regex: /red/i`) is possible; v1 pass criterion stays lenient (see Phase C).
- Keep payload **small** (under ~4 KB) to avoid context bloat and slow runs.

**Message shape** (OpenAI-compatible):

```typescript
{
  role: 'user',
  content: [
    { type: 'text', text: MULTIMODAL_PROBE_PROMPT },
    { type: 'image_url', image_url: { url: MULTIMODAL_PROBE_IMAGE_DATA_URL, detail: 'low' } },
  ],
}
```

Reuse logic from [`buildVlmUserApiContent`](../../../src/tools/loop.ts) via export or thin shared builder — avoid duplicating `ContentPart` assembly rules.

### Phase C — Execute probe in `cap-multimodal`

Replace the current skip-only branch with:

```text
if (!isVisionModel(ctx.modelId, modelsFromList)) {
  → skipped, skipReason: 'not a vision model'
} else {
  → runOneShot({ messages, maxTokens: 64, ... })
  → passed: no throw AND stream.text.length > 0
  → details: first 80 chars of response OR error message
}
```

**Pass criteria (v1):**

| Condition | Result |
|-----------|--------|
| HTTP/stream success + non-empty assistant text | **Pass** |
| Provider returns 4xx/5xx or throws | **Fail** with error in `details` |
| Success but empty `stream.text` | **Fail** (`empty vision response`) — may overlap BUG-002; document in test details |

**Optional v1.1 (not required for closure):** soft pass if response contains expected color token (`red`) — reduces false passes on models that ignore the image but still reply “hello”. Defer unless manual QA shows high false-pass rate.

**Skip criteria:**

| Condition | Result |
|-----------|--------|
| `type !== 'vlm'` and no vision signal | **Skip** — text-only model |
| User aborted benchmark (`ctx.signal`) | Propagate / fail like other tests |

**Remove** `skipReason: 'VLM probe deferred'` path entirely once probe ships.

### Phase D — Optimize models-list reuse

Test 6 (**Models list**) already fetches models. Refactor suite to **fetch once** at suite start (or pass models array from test 6 into test 7) to avoid duplicate `fetchModelsForProvider` calls and to supply catalog for `isVisionModel` when `modelCache` is stale.

---

## Files to change (implementation)

| File | Change |
|------|--------|
| [`src/benchmark/suites/capability.ts`](../../../src/benchmark/suites/capability.ts) | Vision gate + real probe |
| `src/providers/vision-model.ts` (new) | Shared `isVisionModel` |
| `src/benchmark/fixtures/multimodal-probe.ts` (new) | Image + prompt constants |
| [`src/tools/loop.ts`](../../../src/tools/loop.ts) | Optional: import shared `isVisionModel`; export or relocate VLM content builder |
| `test/benchmark/capability-multimodal.test.mts` (new) | Unit tests |
| [`documentation/context.md`](../../context.md) | Note multimodal probe behavior after fix |

---

## Test plan

### Automated

| Test | Assert |
|------|--------|
| `isVisionModel` with cached `type: 'vlm'` | `true` without regex in id |
| `isVisionModel` with cached `type: 'llm'` | `false` |
| `isVisionModel` with catalog array fallback | Matches row by id |
| Multimodal branch — text-only | `skipped: true`, `skipReason` mentions vision |
| Multimodal branch — VLM + mock `runOneShot` success | `skipped: false`, `passed: true` |
| Multimodal branch — VLM + mock empty text | `passed: false` |
| Multimodal branch — VLM + mock HTTP error | `passed: false`, error in `details` |

Run: `npm run test:benchmark`

### Manual QA

1. **LM Studio VLM** (catalog `type: vlm`, e.g. LLaVA / Moondream / Qwen-VL):
   - Refresh models (`#btnRefreshModels`).
   - Run Benchmark Quick (includes capability).
   - **Multimodal request** shows **Pass** or **Fail** — not Skipped.
   - Details contain response snippet or error (not “deferred”).

2. **Text-only LLM** (catalog `type: llm`):
   - Same run.
   - **Multimodal request** shows **Skipped** with reason **not a vision model** (wording TBD).

3. **Edge case — vision model without regex keywords** (if available):
   - Confirm test **runs** (validates Phase A).

4. **Regression — other capability tests** unchanged (provider, stream, tools schema, etc.).

---

## Acceptance criteria

1. For an active model with **`type: 'vlm'`** in `modelCache` or fresh models list, `cap-multimodal` is **not skipped** and issues a multimodal API request.
2. For **`type: 'llm'`** models, `cap-multimodal` is **skipped** with an accurate reason.
3. Pass/fail reflects probe outcome; no “VLM probe deferred” in shipped code.
4. Unit tests cover detection + probe branches.
5. `npm run test:benchmark` passes.
6. `documentation/context.md` updated to describe multimodal benchmark probe (post-merge).

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| **BUG-002** empty streamed text causes false fail on working VLMs | Document cross-link; accept fail-with-details until streaming fix; consider non-stream fallback in probe only if BUG-002 persists |
| OpenAI-v1 providers mark all models `type: llm` | Regex fallback or skip with `vision capability unknown`; full fix belongs in Feature 11 probes |
| Large base64 image slows benchmark | Use minimal PNG; `detail: 'low'` |
| Provider rejects `image_url` format | Fail with HTTP body in `details` — still valuable signal |
| Duplicating VLM content builder | Extract shared helper from `loop.ts` in same PR or immediate follow-up |

---

## Relationship to Feature 11

[Feature 11 — Model capability detection](../Build%20out/feature-11-model-capability-detection.md) will add persisted `capabilities.json` with probed `vision` flags for OpenAI-v1 providers. BUG-004 should:

- **Use catalog `type` now** (LM Studio path — majority of Minnow users).
- **Leave a hook** for merged capabilities later: `isVisionModel` checks `capabilities.vision` when Feature 11 lands, then catalog, then regex.

Do **not** block BUG-004 on Feature 11 schema work.

---

## Implementation order

1. Reproduce and capture baseline screenshots / result JSON.
2. Add `isVisionModel` + tests.
3. Add probe fixture constants.
4. Wire probe in `capability.ts`; remove deferred skip.
5. Refactor models fetch (single call) if low effort in same PR.
6. Manual QA on VLM + LLM.
7. Update `context.md`.

---

## Open questions (resolve before coding)

1. **Shared export from `loop.ts`:** Export `buildVlmUserApiContent` vs inline two-part message in benchmark — prefer shared export?
2. **Skip reason copy:** `not a vision model` vs `text-only model` — align with POLISH-004 descriptions?
3. **Strict color check in v1:** Lenient (non-empty text) vs require color keyword in response?
4. **OpenAI-v1 vision models:** Skip with `vision capability unknown` or attempt probe anyway (may fail loudly)?

Default recommendations if product owner silent: shared export yes; skip copy `not a vision model`; lenient pass v1; attempt probe for unknown types only when regex fallback matches (conservative).

---

## References

- Bug hunt: [BUG-004](../../bug-hunt-session-2026-05-24.md#bug-004--multimodal-capability-test-not-run-for-multimodal-models)
- Benchmark architecture: [context.md § Benchmark](../../context.md) · plan [benchmark-system-implementation.md](../benchmark-system-implementation.md)
- Chat multimodal path: [`buildApiMessages`](../../../src/tools/loop.ts), [`buildVlmUserApiContent`](../../../src/tools/loop.ts)
- Related bugs: BUG-002 (streaming), BUG-003 (empty text pass)


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-65](https://linear.app/minnowai/issue/MIN-65/bug-004-multimodal-capability-test-not-run)
