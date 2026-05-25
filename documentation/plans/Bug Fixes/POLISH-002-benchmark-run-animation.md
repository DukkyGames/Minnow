# POLISH-002 — Benchmark run fading animation

| Field | Value |
|-------|-------|
| **ID** | POLISH-002 |
| **Type** | Polish / UX (not a correctness bug) |
| **Source** | [`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md) — Polish / UX table |
| **Route** | `#/benchmark` |
| **Status** | **APPROVED** (verified 2026-05-24; not implemented) |
| **Linear** | [MIN-88](https://linear.app/minnowai/issue/MIN-88/polish-002-benchmark-run-animation) — [POLISH-002] Benchmark run animation |
| **Related bugs** | BUG-002–BUG-004, BUG-005 (stop), BUG-007 (custom suites) — animation must not mask or fight these |
| **Related polish** | POLISH-003 (toggle selection), POLISH-004 (test descriptions), POLISH-005 (transcripts) |

---

## Summary

During an active benchmark run, replace the static progress label with a **readable, playful status strip**: copy that **fades out and in** as the active suite/test changes, showing **what is running now** and **which model** is under test. The existing progress bar and per-test cards stay; this enhancement layers on top without blocking pass/fail readability when the run ends.

---

## Current behavior (baseline)

| Layer | What exists today |
|-------|-------------------|
| **Progress UI** | `#benchmarkProgress` in `index.html`: label (`#benchmarkProgressLabel`), percent (`#benchmarkProgressPct`), fill bar (`#benchmarkProgressFill`). Shown via `setProgressVisible(true)` in `initLiveRunUI`. |
| **Label updates** | `updateProgressBar(pct, label)` in `src/ui/benchmark-page.ts` — plain `textContent` swap on suite start and each `test-done`. |
| **Bar motion** | Fill width animates via CSS `transition: width 0.45s` in `src/styles/benchmark-page.css`. |
| **Test cards** | `upsertLiveTestCard` + `.is-entering` enter animation when a test **completes**; spinning icon only on completed card markup during live grid build. |
| **Model context** | Binding resolved once in `runBenchmark` (`resolveBenchmarkBinding`); run record stores `provider` + `model.id`. **Not** shown in the live progress strip today. |
| **Global status** | `setStatus('ok', 'Benchmark Quick running…')` on start — separate from benchmark page body. |

### Progress event gap (important)

`BenchmarkProgressEvent` in `src/benchmark/types.ts` today:

- `suite-start` — emitted before a suite runs
- `test-done` — emitted **after the entire suite function returns**, in a loop over `suite.tests`
- `run-done` — final aggregate

Suite modules (`src/benchmark/suites/*.ts`) run all probes **sequentially inside one async function** and do not report per-test progress. During a long suite (e.g. capability streaming probe, tools fixtures), the UI label can sit on **“Capability suite”** for minutes while individual tests execute — **not** “Streaming completion” as requested in the bug-hunt notes.

**Implication:** POLISH-002 is not CSS-only; credible “current test” copy requires **`test-start` (or equivalent) events** from runner/suites unless we accept misleading labels until each suite batch completes.

---

## Desired behavior (acceptance criteria)

1. **While `benchmark-page.is-running` and live progress is visible**
   - A dedicated **status hero** (or augmented progress meta) shows two lines (or one line with clear hierarchy):
     - **Primary:** current activity — suite + human label (e.g. `Capability · Streaming completion`).
     - **Secondary:** model context — e.g. `LM Studio · qwen2.5-7b-instruct` (provider display name + `modelId`; optional truncated metadata if cheap to fetch).
   - On each meaningful progress change, **outgoing copy fades out** (~200–280ms), then **incoming copy fades in** (similar timing), without layout jump (min-height or stacked slots).
2. **Progress bar** remains functional: percent and `aria-valuenow` / `aria-valuetext` stay accurate; animation is additive, not a replacement for the bar.
3. **When the run finishes or is cancelled**
   - Hero hides or collapses with `finishLiveRunUI` / `setProgressVisible(false)`.
   - Final **summary metrics** and **test cards** are unchanged and fully readable (no permanent opacity on pass/fail).
4. **Accessibility**
   - `aria-live="polite"` on the live status region; respect `prefers-reduced-motion` (instant swap, no fade — mirror `thoughts.css` / existing `benchmark-page.css` reduced-motion block).
5. **Non-goals for this item**
   - No change to scoring, persistence, or suite definitions.
   - No transcript drawer (POLISH-005).
   - No toggle-based suite picker (POLISH-003).

---

## Proposed design

### UI structure

Add a **live status block** inside `.benchmark-progress` (above or below `.benchmark-progress-meta`):

```html
<div id="benchmarkLiveStatus" class="benchmark-live-status" aria-live="polite" hidden>
  <p class="benchmark-live-status-test" data-live-test>Starting…</p>
  <p class="benchmark-live-status-model" data-live-model></p>
</div>
```

- **Dual-slot crossfade (recommended):** two stacked elements (`benchmark-live-status__layer--a` / `--b`); toggle active layer and run fade on the inactive one — avoids blank frame between out/in (pattern aligned with `ThoughtBubbleController` gap/fade in `src/ui/thought-bubbles.ts` + `thoughtFadeOut` in `src/styles/thoughts.css`).
- **Single element + CSS class:** simpler but may flash empty between `textContent` updates; acceptable only if out/in are overlapped in one container with `position: absolute` + opacity transition.

Keep `#benchmarkProgressLabel` for **short bar caption** (percent companion) **or** demote it to duplicate of primary line — pick one source of truth in implementation to avoid drift.

### Copy rules

| Event | Primary line | Secondary line |
|-------|----------------|----------------|
| Run start (`initLiveRunUI`) | `Quick run starting` / `Full run starting` | `provider.label · modelId` from binding resolved at start |
| `suite-start` | `{label} suite` or `{SUITE_LABELS[suiteId]}` | unchanged until test-start |
| `test-start` (new) | `{SUITE_LABELS[suiteId]} · {testLabel}` | unchanged |
| `test-done` | same as last test-start until next test-start | optional: brief “Scoring…” only if needed |
| `run-done` | `Complete` | hide secondary or show final score one-shot |
| Cancel / error | clear animations; `finishLiveRunUI` | — |

Model line at run start: call `resolveBenchmarkBinding()` in `startRun` **before** `runBenchmark` (or pass binding into `initLiveRunUI`) so the hero shows model info immediately, not only after run JSON is saved.

### Visual tone

- Subtle motion: opacity + slight `translateY` (4px), ~220ms, `var(--ease-out)` if defined in theme.
- Muted secondary line (`--mn-fg-muted`, 12px); primary 14–15px semibold.
- Optional very soft pulse on progress fill during run (already tinted via `.benchmark-page.is-running`); do not add distracting loops on text.

---

## Implementation plan (phased)

### Phase A — Progress fidelity (runner)

**Goal:** UI can know the **active** test, not only completed ones.

| Task | Detail |
|------|--------|
| A.1 | Extend `BenchmarkProgressEvent` with `{ type: 'test-start'; suiteId; testId; label }`. |
| A.2 | Thread optional `onProgress` into suite runners **or** emit from `runner.ts` by refactoring suites to yield results one-by-one (preferred: **callback parameter** `onTestStart` / `onTestDone` on `BenchmarkRunContext` to avoid duplicating event wiring in six files). |
| A.3 | In each suite file, call `onTestStart` immediately before each probe (and keep `test-done` at runner loop or move to immediate emit after each probe for snappier cards). |
| A.4 | Document event contract in `src/benchmark/types.ts` JSDoc. |

**Files:** `src/benchmark/types.ts`, `src/benchmark/runner.ts`, `src/benchmark/suites/capability.ts`, `speed.ts`, `tools.ts`, `skills.ts`, `modes.ts`, `coding.ts`.

**Tests:** extend `npm run test:benchmark` or add a small unit test that a mock suite invokes start/done in order (deterministic ids).

### Phase B — Live status controller (UI)

| Task | Detail |
|------|--------|
| B.1 | Add DOM in `index.html` + ids to `test/ui/benchmark-page-html.test.mjs` `BENCHMARK_IDS`. |
| B.2 | New module or private helpers in `benchmark-page.ts`: `BenchmarkLiveStatusController` with `setPrimary`, `setModel`, `transitionTo(nextPrimary)`, `dispose` on finish/cancel. |
| B.3 | Wire `onBenchmarkProgress` + `initLiveRunUI` / `finishLiveRunUI`; bind model line once at run start. |
| B.4 | Sync `aria-valuetext` on progress bar with primary line for screen readers. |

**Files:** `index.html`, `src/ui/benchmark-page.ts`, `test/ui/benchmark-page-html.test.mjs`.

### Phase C — Styles and motion safety

| Task | Detail |
|------|--------|
| C.1 | `src/styles/benchmark-page.css`: `.benchmark-live-status`, keyframes `benchmarkStatusFadeIn` / `Out`, min-height. |
| C.2 | Extend existing `@media (prefers-reduced-motion: reduce)` block to disable status fades and crossfade. |
| C.3 | Verify contrast in light/dark tokens (`--mn-fg`, `--mn-fg-muted`). |

### Phase D — Verification and docs

| Task | Detail |
|------|--------|
| D.1 | Manual: Quick run — labels change per test, model line stable, bar moves, cards still enter on completion. |
| D.2 | Manual: Stop mid-run (BUG-005) — hero clears, no orphaned timers. |
| D.3 | Manual: reduced-motion OS setting — instant text swap. |
| D.4 | Update [`documentation/context.md`](../../context.md) Benchmark bullet to mention live fading status (post-implementation). |

---

## Open questions (resolve before coding)

1. **Label source of truth:** Keep `#benchmarkProgressLabel` in sync with hero primary, or remove duplicate and drive bar caption from hero only?
2. **Provider display name:** Use `provider.id`, configured label from `ProviderPublic`, or base URL host snippet?
3. **Suite-level-only fallback:** If Phase A is deferred, is suite-level fade (without per-test labels) acceptable as MVP? Bug-hunt text expects per-test names — **default answer: no**, ship Phase A with animation.
4. **Headless benchmark:** `scripts/benchmark-headless.mjs` — no UI; no changes unless it asserts DOM ids.

---

## Risk and compatibility notes

| Risk | Mitigation |
|------|------------|
| Rapid `test-start` on fast tests causes animation pile-up | Serialize transitions (queue or ignore interrupt until fade-out completes), same as `ThoughtBubbleController.tailWork`. |
| Timer leak on Stop | `dispose()` in `finishLiveRunUI` and catch paths in `startRun`. |
| Misleading “current test” if Phase A skipped | Do not ship Phase C without Phase A. |
| Layout shift when labels wrap | `min-height: 2.6em` on primary line; ellipsis with `title` tooltip for long `modelId`. |
| BUG-005 stop not aborting runner | Fading UI must listen to same abort path; fixing stop is separate but cancel must call `finishLiveRunUI`. |

---

## File checklist

| File | Action |
|------|--------|
| `documentation/plans/Bug Fixes/POLISH-002-benchmark-run-animation.md` | This plan |
| `src/benchmark/types.ts` | Add `test-start` event |
| `src/benchmark/runner.ts` | Wire context callbacks |
| `src/benchmark/suites/*.ts` | Emit per-test start |
| `src/ui/benchmark-page.ts` | Controller + handlers |
| `index.html` | Live status markup |
| `src/styles/benchmark-page.css` | Animation + reduced motion |
| `test/ui/benchmark-page-html.test.mjs` | New element ids |
| `documentation/context.md` | After implementation |

---

## Todos

- [ ] **A** — Add `test-start` to `BenchmarkProgressEvent` and emit from all suites (via `BenchmarkRunContext` callback).
- [ ] **A** — Optionally emit `test-done` immediately after each probe (instead of batch post-suite) for aligned card + hero updates.
- [ ] **B** — Add `#benchmarkLiveStatus` markup and HTML regression ids.
- [ ] **B** — Implement `BenchmarkLiveStatusController` (dual-layer crossfade, serialized transitions).
- [ ] **B** — Resolve binding at run start; populate model secondary line.
- [ ] **B** — Wire `onBenchmarkProgress` for `suite-start`, `test-start`, `test-done`, `run-done`, cancel.
- [ ] **C** — CSS for live status + `prefers-reduced-motion` overrides.
- [ ] **D** — Manual QA matrix (Quick/Full, stop, reduced motion).
- [ ] **D** — Update `documentation/context.md` Benchmark section.

---

## Verification (APPROVED)

**Date:** 2026-05-24  
**Verifier:** Agent (POLISH-002 plan review)  
**Plan poll:** Plan file present at session start (no 25min Full-run soak required for approval; Phase D manual QA remains post-implementation).

### Code path verification

| Claim | Result |
|-------|--------|
| `BenchmarkProgressEvent` has `suite-start`, `test-done`, `run-done` only (no `test-start`) | **Confirmed** — `src/benchmark/types.ts` L104–107 |
| Runner emits `test-done` in batch after each suite function returns | **Confirmed** — `src/benchmark/runner.ts` L87–114 loop |
| Suites run probes sequentially inside one async function (e.g. capability) | **Confirmed** — `src/benchmark/suites/capability.ts` |
| Progress UI: `#benchmarkProgress` + label/pct/fill; `updateProgressBar` uses `textContent` | **Confirmed** — `index.html` L686–692, `src/ui/benchmark-page.ts` L142–157 |
| No `#benchmarkLiveStatus` / crossfade controller | **Confirmed** — absent from `index.html`, `benchmark-page.ts` |
| Model binding resolved in runner only; not shown in live progress strip at run start | **Confirmed** — `resolveBenchmarkBinding` in `runner.ts` L56; `initLiveRunUI` L215–235 has no model line |
| `onBenchmarkProgress` updates label on `suite-start` and `test-done` only | **Confirmed** — `benchmark-page.ts` L259–297 |
| Fade precedent exists (`ThoughtBubbleController`, `thoughtFadeOut`) | **Confirmed** — `src/ui/thought-bubbles.ts`, `src/styles/thoughts.css` |
| `prefers-reduced-motion` block exists on benchmark page (progress fill, cards) | **Confirmed** — `src/styles/benchmark-page.css` L409+ |
| Fix not yet implemented | **Confirmed** — no `test-start`, no live status markup/CSS |

### Bug-hunt alignment

[documentation/bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) § POLISH-002 (fading status copy, suite + test label, model context) matches baseline gaps above. Status remains **Requested** until Phases A–C ship.

### Plan quality

- Progress event gap analysis is accurate; Phase A required before credible per-test labels (not CSS-only).
- Phased plan (runner → UI controller → CSS → QA) is actionable; BUG-005 stop / reduced-motion called out.
- `test/ui/benchmark-page-html.test.mjs` passes (15/15). `npm run test:benchmark`: scoring 5/5 pass; 1 unrelated fail in `modes-suite-probes.test.mts` (BUG-008).

### Outcome

**APPROVED** — Plan is ready for implementation. Linear issue **[MIN-88](https://linear.app/minnowai/issue/MIN-88/polish-002-benchmark-run-animation)** created for tracking.

---

## References

- Bug-hunt spec: [`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md) — § POLISH-002
- Architecture: [`documentation/context.md`](../../context.md) — Benchmark (Bench)
- Fade precedent: `src/ui/thought-bubbles.ts`, `src/styles/thoughts.css`
- Progress UI: `src/ui/benchmark-page.ts` (`updateProgressBar`, `onBenchmarkProgress`), `src/styles/benchmark-page.css`
- Runner: `src/benchmark/runner.ts`, `src/benchmark/resolve-binding.ts`
