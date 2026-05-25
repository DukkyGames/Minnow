---
name: POLISH-004 — Benchmark per-test descriptions
overview: Add static helper copy to each benchmark test card so users understand purpose, method, and pass criteria—not only short labels and runtime details.
source: documentation/bug-hunt-session-2026-05-24.md § POLISH-004
status: planned
scope: plan-only (no implementation in this item)
todos:
  - id: catalog-schema
    content: Define BenchmarkTestDescription type and test-catalog module keyed by testId (incl. dynamic patterns)
    status: pending
  - id: catalog-content
    content: Author descriptions for all static tests; templates for tool-*, skill-*, mode-* probes
    status: pending
  - id: catalog-validation
    content: Add test/benchmark/catalog-coverage.test.mts asserting every emitted testId resolves in catalog
    status: pending
  - id: ui-render
    content: Render description on cards in benchmark-page.ts (live + history); separate from runtime details
    status: pending
  - id: ui-styles-a11y
    content: Style .benchmark-test-card-desc; optional details/summary expand; aria-labelledby on cards
    status: pending
  - id: suite-intros
    content: Optional one-line suite blurbs in suite block headers (capability, speed, tools, …)
    status: pending
  - id: docs-context
    content: Link plan from context.md benchmark section; note POLISH-004 in bug-hunt when shipped
    status: pending
isProject: false
---

# POLISH-004 — Benchmark per-test descriptions

**Tracking:** [bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) (POLISH-004)  
**Area:** `#/benchmark` — [`src/ui/benchmark-page.ts`](../../../src/ui/benchmark-page.ts), [`src/styles/benchmark-page.css`](../../../src/styles/benchmark-page.css)  
**Related polish:** POLISH-002 (live status animation), POLISH-003 (suite toggle selection), POLISH-005 (transcript on click)  
**Benchmark architecture:** [context.md](../../context.md) § Benchmark (`src/benchmark/`, runner, suites)

> **This document is plan-only.** No code changes are in scope for POLISH-004 until implementation is explicitly requested.

---

## Problem

Benchmark test cards today show:

| Element | Source | User value |
|---------|--------|------------|
| Title | `TestResult.label` | Short name only (e.g. “Streaming completion”) |
| Meta | UI-computed | Duration, Pass/Fail/Skip, optional “judged” |
| Details | `TestResult.details` | **Runtime** snippet (error, char count, tool message)—truncated to 120 chars |

Users cannot tell **what the probe does**, **how it runs** (streaming vs tool loop, skip rules), or **what “pass” means** without reading suite source under `src/benchmark/suites/`. That hurts discoverability when debugging open bugs (**BUG-002** streaming, **BUG-003** speed “0 chars”, **BUG-008** modes, **BUG-009** skills).

---

## Goals

1. **Per-test helper copy** — Plain-language description on every card: purpose, method, pass criteria.
2. **Visible across run lifecycle** — Copy available when viewing results after a run; ideally also on **pending** cards before/during a run (see Phase 2).
3. **Full suite coverage** — capability, speed, tools, skills, modes, coding (Quick + Full presets).
4. **Do not conflate with runtime `details`** — Keep `details` for outcomes; descriptions are static documentation.
5. **Maintainable catalog** — Adding a new `testId` in a suite should fail a coverage test if catalog entry is missing.

### Non-goals (POLISH-004)

- Click-to-open transcript (**POLISH-005**).
- Changing scoring, prompts, or suite logic (BUG fixes are separate).
- i18n / localization.
- Embedding descriptions in persisted `~/.minnow/benchmarks/*.json` (static lookup is enough).

---

## Current state (codebase)

### Types

[`TestResult`](../../../src/benchmark/types.ts) has `testId`, `label`, `passed`, `skipped`, `details`, timing fields—**no `description` field**.

`TestCase` in the same file is minimal (`id`, `suite`, `label`, `scoring`) and is **not** used uniformly across suites (many tests are built inline).

### UI

[`renderTestCard`](../../../src/ui/benchmark-page.ts) renders title + meta + optional `details` only. Live run clears `#benchmarkSuites` on start (`initLiveRunUI`) and adds cards as `test-done` events arrive—**no placeholder cards** with metadata today.

### Test inventory (approximate)

| Suite | Static IDs | Dynamic IDs | Notes |
|-------|------------|-------------|--------|
| **capability** | 7 | — | `cap-provider`, `cap-model`, `cap-stream`, `cap-usage`, `cap-tools-schema`, `cap-models-list`, `cap-multimodal` |
| **speed** | 4 | — | `speed-short-1..3`, `speed-long-1` |
| **tools** | 0 | ~55 | `tool-${tool.id}` from [`BUILT_IN_TOOLS`](../../../src/tools/definitions.ts) |
| **skills** | 0 | ~12 | `skill-${skill.id}` from [`builtin-manifest.json`](../../../src/skills/builtin-manifest.json) |
| **modes** | 0 | ≤10 | `mode-${modeId}-negative` / `-positive` per [`modes.ts`](../../../src/benchmark/suites/modes.ts) |
| **coding** | 10 | — | `code-fizzbuzz` … `code-judge-refactor` in [`coding.ts`](../../../src/benchmark/suites/coding.ts) |

**Total:** ~88+ distinct cards on a Full run (dominated by tools suite).

---

## Recommended design

### 1. Central catalog (preferred over scattering copy in suite files)

Add **`src/benchmark/test-catalog.ts`** exporting:

```ts
export interface BenchmarkTestDescription {
  /** Stable key: exact id or pattern documented below */
  testId: string;
  suite: SuiteId;
  /** Short title override optional; default = runtime label */
  label?: string;
  /** 1–2 sentences: what this probe checks */
  purpose: string;
  /** How the run works: prompt shape, streaming, tool loop, skip */
  method: string;
  /** Plain-language pass / skip rules */
  passCriteria: string;
}

export function resolveTestDescription(
  testId: string,
  suite: SuiteId,
  label: string,
): BenchmarkTestDescription | null;
```

**Why central:**

- UI can import descriptions **without** executing suites.
- Tools/skills/modes are **generated** at runtime; templates avoid duplicating 55+ tool paragraphs inside `tools.ts`.
- Single place for a **coverage test** to validate completeness.

**Alternative (rejected for v1):** `description` on each `TestResult` at runtime—bloats JSON history and duplicates static strings on every save.

### 2. Dynamic resolution rules

| Pattern | Resolver behavior |
|---------|-------------------|
| Exact match | `cap-stream`, `code-fizzbuzz`, etc. |
| `tool-${id}` | Lookup tool definition (`label`, `description` from definitions) + benchmark-specific sentence: “Model must call `id` with fixture args; server executes unless emit-only.” |
| `skill-${id}` | Merge skill manifest `description` + skills suite method (system skill body + regex on reply). |
| `mode-${id}-negative` | Map `MODE_NEGATIVE` forbidden tool + “must not call …” |
| `mode-${id}-positive` | Map `MODE_POSITIVE` expected tool + skip when `web_search` needs server |
| `speed-short-*` | Shared template: median TTFT sample, char count is informational only (**BUG-003** context) |

Document pattern precedence in catalog module header comment.

### 3. UI presentation

**Default (v1):** Always-visible secondary line under title:

```html
<p class="benchmark-test-card-desc">Purpose. Method. Pass: …</p>
```

Compose from `purpose` + condensed `passCriteria` (or single `summary` field if copy is edited for length).

**Optional (v1.1):** `<details class="benchmark-test-card-more">` for full `method` when text &gt; ~160 chars—keeps grid density on tools suite.

**Accessibility:**

- Card: `aria-labelledby` → title id; description id referenced by `aria-describedby`.
- Do not rely on `title` attribute alone for long copy.

**CSS:** New block in [`benchmark-page.css`](../../../src/styles/benchmark-page.css)—`font-size: 12px`, `color: var(--mn-fg-muted)`, `line-height: 1.45`, max 3 lines with optional clamp + expand.

**Runtime `details`:** Keep as third line (`.benchmark-test-card-details`) with distinct styling so users see “what we expected” vs “what happened”.

### 4. Suite-level blurbs (optional, same PR or follow-up)

Under each `benchmark-suite-block-header`, one sentence per suite, e.g.:

- **Capability** — Provider/model wiring, streaming, usage, tool schema, catalog APIs.
- **Speed** — Median TTFT and tok/s from fixed prompts (not answer correctness).
- **Tools** — One serial tool round-trip per built-in tool.
- etc.

Source: `SUITE_INTROS` adjacent to `SUITE_LABELS` in `benchmark-page.ts` or catalog.

### 5. Pre-run / in-run visibility (Phase 2)

Bug hunt asks for copy **before/during** run. Today live UI only mounts cards on `test-done`.

**Phase 1:** Descriptions on completed cards + history reload (minimal change).

**Phase 2:** When `initLiveRunUI` runs, pre-seed each suite section with **placeholder cards** from catalog filtered by `resolveBenchmarkSuites(preset, custom)`—pending state, no description swap on complete (only status/meta/details update).

Depends on knowing test list per preset without running—catalog must export `listTestsForSuites(suiteIds): { testId, suite, label }[]`.

---

## Content guidelines (for whoever authors copy)

Each description should answer:

1. **What** capability of Minnow or the model is under test?
2. **How** is the probe executed (one-shot stream, tool loop, judge, skip predicate)?
3. **Pass** what outcome counts as success? What skip reason is normal?

**Tone:** Short, non-jargon, English only. Avoid internal bug IDs in user-facing text.

**Examples (draft quality—not final copy):**

| testId | purpose (draft) |
|--------|-----------------|
| `cap-stream` | Verifies the provider returns streamed completion text for a minimal hello prompt. |
| `speed-short-1` | Samples time-to-first-token and throughput for a short fixed prompt; pass is completing the request, not char count. |
| `tool-read_file` | Checks the model issues a `read_file` tool call matching the fixture prompt; server runs the tool when required. |
| `mode-plan-negative` | Plan mode must refuse a destructive `delete_path` request (forbidden tool must not be called). |

Reuse existing tool/skill `description` fields where accurate; add benchmark-specific pass line.

---

## Implementation phases

### Phase 1 — Catalog + post-run UI (MVP)

1. Add `test-catalog.ts` + types.
2. Populate static entries (capability, speed, coding).
3. Implement resolvers for `tool-*`, `skill-*`, `mode-*`.
4. `resolveTestDescription(testId, suite, label)` used in `renderTestCard`.
5. Coverage test: walk catalog expectations + simulate suite id generators (tools list, skills manifest, modes list).
6. Extend `test/ui/benchmark-page-html.test.mjs` or add `test/benchmark/test-catalog.test.mts` for resolver edge cases.

### Phase 2 — Pre-run placeholders

1. Export `listExpectedTests(suiteIds)` from catalog.
2. `initLiveRunUI` seeds pending cards with descriptions (status icon = pending).
3. `upsertLiveTestCard` upgrades same `data-test-id` without losing description node.

### Phase 3 — Suite intros + polish

1. Suite header blurbs.
2. Optional `<details>` expand for long tool descriptions.
3. Cross-link from description to POLISH-005 transcript when that ships (“View run” affordance).

---

## Acceptance criteria

- [ ] Every `testId` produced by [`runCapabilitySuite`](../../../src/benchmark/suites/capability.ts), [`runSpeedSuite`](../../../src/benchmark/suites/speed.ts), [`runToolsSuite`](../../../src/benchmark/suites/tools.ts), [`runSkillsSuite`](../../../src/benchmark/suites/skills.ts), [`runModesSuite`](../../../src/benchmark/suites/modes.ts), and [`runCodingSuite`](../../../src/benchmark/suites/coding.ts) resolves to non-empty `purpose` + `passCriteria` via catalog.
- [ ] Benchmark cards in live run and history view show description distinct from runtime `details`.
- [ ] Skipped tests (e.g. `cap-usage`, `cap-multimodal`, tool `needs npm start`) explain skip semantics in `passCriteria` or method text.
- [ ] `npm run test:benchmark` passes including new catalog coverage test.
- [ ] No change to benchmark scores, persistence schema, or API routes.
- [ ] `documentation/context.md` benchmark bullet mentions per-test descriptions once shipped.

---

## Testing strategy

| Test | Intent |
|------|--------|
| `test/benchmark/catalog-coverage.test.mts` | Enumerate expected ids per suite; `resolveTestDescription` must not return null |
| `test/benchmark/test-catalog.test.mts` | Spot-check 3–5 static entries and one dynamic resolver (`tool-read_file`, `mode-build-positive`) |
| Manual QA | Open `#/benchmark`, run Quick, confirm capability/speed/modes cards show helper copy before judging pass/fail |

---

## Files to touch (implementation checklist)

| File | Change |
|------|--------|
| `src/benchmark/test-catalog.ts` | **New** — descriptions + resolvers + `listExpectedTests` |
| `src/benchmark/types.ts` | Optional: export `BenchmarkTestDescription` type only |
| `src/ui/benchmark-page.ts` | `renderTestCard`, optional `initLiveRunUI` seeding |
| `src/styles/benchmark-page.css` | `.benchmark-test-card-desc`, optional clamp/expand |
| `test/benchmark/catalog-coverage.test.mts` | **New** |
| `documentation/context.md` | One-line note when feature ships |

**Explicitly out of scope:** `src/benchmark/suites/*.ts` logic changes unless a test id rename forces catalog sync.

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Tools suite UI becomes very tall | Description clamp + `<details>`; suite collapsed by default (future) |
| Catalog drifts when new tool added | Coverage test imports `BUILT_IN_TOOLS` ids |
| Duplicate labels (speed “Sustained throughput”) | Catalog keyed by `testId`, not label |
| POLISH-003 changes suite selection UI | Catalog API keyed by `SuiteId[]` only—no coupling to control widget |

---

## Open questions (align before implementation)

1. **Single paragraph vs structured fields** — Is three-field (`purpose` / `method` / `passCriteria`) too much for cards, or should v1 ship one `summary` string?
2. **Pre-run placeholders** — Required for POLISH-004 acceptance, or acceptable as Phase 2?
3. **Tool copy source** — Reuse `ToolDefinition.description` verbatim or always append benchmark pass sentence?
4. **History runs** — Older runs without new UI still work; descriptions come from catalog at render time (confirm no regression for missing testIds in old JSON).

---

## Related bugs (context only)

Descriptions help interpret failures; they do not fix:

- **BUG-002** — `cap-stream` fails (streaming/parser).
- **BUG-003** — speed details `0 chars` while pass (copy should clarify timing-only).
- **BUG-004** — `cap-multimodal` skip behavior.
- **BUG-008** / **BUG-009** — modes/skills tool expectations.

---

## References

- Suite implementations: `src/benchmark/suites/`
- Scoring helpers: `src/benchmark/scoring.ts`
- Tool fixtures: `src/benchmark/suites/tools-fixtures.ts`
- Bug hunt polish spec: `documentation/bug-hunt-session-2026-05-24.md` § POLISH-004


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-94](https://linear.app/minnowai/issue/MIN-94/polish-004-benchmark-test-descriptions)
