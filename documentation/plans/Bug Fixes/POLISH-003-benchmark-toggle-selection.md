# POLISH-003 — Benchmark suite selection as toggle button group

| Field | Value |
| --- | --- |
| **ID** | POLISH-003 |
| **Type** | UX polish (not a correctness bug) |
| **Route** | `#/benchmark` |
| **Status** | Verified baseline 2026-05-24 — not implemented; Linear [MIN-64](https://linear.app/minnowai/issue/MIN-64/polish-003-benchmark-toggle-selection) |
| **Source** | `documentation/bug-hunt-session-2026-05-24.md` |
| **Related** | BUG-007 (Custom suites control), POLISH-002 (live status), POLISH-004 (test descriptions), POLISH-005 (transcripts) |

## Goal

Replace the benchmark run bar’s **hidden checkbox panel** and **“Custom suites” reveal button** with an **always-visible, segmented toggle button group** so users can see and change which suites run **before** pressing Quick or Full, with clear selected vs unselected styling and accessible toggle semantics.

## Problem statement

Today, suite selection is easy to miss and awkward to use:

1. **Custom suites** (`#btnBenchmarkCustom`) only toggles visibility of `#benchmarkCustomSuites` (checkboxes). It does not start a run and does not read as “pick suites.”
2. **Overrides apply only when the panel is visible**: `getSelectedSuites()` in `src/ui/benchmark-page.ts` returns `undefined` when `benchmarkCustomSuites.hidden` is true, so Quick/Full ignore checkbox state unless the user opened Custom first — surprising and reported as **BUG-007**.
3. **Checkboxes** sit on a second row after reveal; they do not match Minnow’s established **segmented toggle** patterns (composer mode control, settings theme pills).

Users want a **group of toggle buttons** (one per suite) with obvious on/off state, grouped visually, usable without an extra “open custom” step.

## Current behavior (baseline)

### Run bar markup (`index.html`)

- **Quick** / **Full** — primary actions; call `startRun('quick' | 'full')` immediately.
- **Custom suites** — toggles `hidden` on `#benchmarkCustomSuites`.
- **Stop** — aborts in-flight run.
- **Custom panel** — six `<input type="checkbox">` labels (Capability, Speed, Tools, Skills, Modes, Coding); default checked: capability, speed, modes; tools/skills/coding unchecked.

### Selection logic (`src/ui/benchmark-page.ts`)

```358:364:src/ui/benchmark-page.ts
function getSelectedSuites(): SuiteId[] | undefined {
  const custom = document.getElementById('benchmarkCustomSuites');
  if (!(custom instanceof HTMLElement) || custom.hidden) return undefined;
  const boxes = custom.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked');
  const ids = [...boxes].map((b) => b.value as SuiteId);
  return ids.length ? ids : undefined;
}
```

- When `undefined`, `resolveBenchmarkSuites(preset, override)` falls back to preset lists in `src/benchmark/runner.ts`:
  - **Quick:** `capability`, `speed`, `modes`
  - **Full:** all six suites

### Styling (`src/styles/benchmark-page.css`)

- `.benchmark-suite-checkboxes` — flex wrap of checkbox labels; full-width row under run bar when revealed.

### Backend contract (unchanged for v1)

- `RunBenchmarkOptions.suites?: SuiteId[]` — non-empty override replaces preset list.
- No `'custom'` preset in `BenchmarkPreset` (`'quick' | 'full'` only); “custom” is purely UI-driven override.

## Desired behavior

| Requirement | Detail |
| --- | --- |
| **Visible by default** | Suite toggles always shown in the run bar (or directly under it), not behind a reveal button. |
| **Toggle semantics** | Each suite is a `button` with `aria-pressed="true|false"` (or `role="checkbox"` + `aria-checked` if using a toolbar pattern). |
| **Visual group** | Segmented control: shared border/background, adjacent pills (reuse patterns from `.mode-segmented` / `.mode-segment` in `src/styles/mode-selector.css`). |
| **Active state** | Selected: accent fill (align with `.mode-segment[aria-checked='true']` or settings `is-active` + `aria-pressed`). Unselected: muted text, transparent/neutral background. |
| **Pre-run editing** | User toggles suites on/off, then clicks **Quick** or **Full**; selection is read on every run start. |
| **Preset interaction** | Documented behavior (see **Design decision** below): Quick/Full buttons **apply preset templates** to toggles and/or **run using current toggle state**. |
| **Validation** | At least one suite must be selected before run; otherwise disable Quick/Full and show short status message. |
| **Running state** | While `is-running`, disable suite toggles (match run bar buttons except Stop). |
| **Remove or repurpose Custom** | **Recommended:** remove `#btnBenchmarkCustom` and `#benchmarkCustomSuites`; selection lives only in the toggle group. Resolves overlap with **BUG-007**. |

### Out of scope for POLISH-003 (defer)

- **Per-test toggles** inside a suite (e.g. individual coding probes). High cardinality and runner changes; track as POLISH-003b or pair with POLISH-004 layout on result cards.
- **New “Run custom” button** that only runs override without Quick/Full labels (optional later; not required if toggles + Quick/Full suffice).
- **Persisting selection** across sessions (`localStorage` / `~/.minnow`) — nice-to-have, not required for acceptance.
- **Headless/API suite picker** — `scripts/benchmark-headless.mjs` only pings APIs today.

## Design decision: Quick / Full vs toggle state

Choose **one** primary model and implement consistently (recommend **Option B**).

### Option A — Presets overwrite toggles, then run

- Click **Quick** → set toggles to Quick set → start run with that set.
- Click **Full** → set toggles to Full set → start run.
- Manual toggles apply only if user changes them **after** preset click but **before** a hypothetical separate “Run” — awkward with immediate-run buttons.

### Option B — Toggles are source of truth; Quick/Full are shortcuts (recommended)

- **Quick** / **Full** update the toggle group to the preset’s suite list **and** start the run using **current toggle state** (after applying template).
- If user had customized toggles, clicking Quick resets to Quick suites then runs — predictable “shortcut” semantics.
- No hidden panel; `getSelectedSuites()` always reads toggles (no `hidden` guard).

### Option C — Decouple preset from run

- Add explicit **Run** button; Quick/Full only set toggles. Larger UX change; not recommended unless product asks for three-step flow.

**Recommendation:** **Option B** — matches “preset buttons set toggles” language in the bug hunt and fixes BUG-007’s “panel must be open” issue.

## Proposed UI structure

```html
<!-- Conceptual; implement in index.html -->
<div class="benchmark-run-bar">
  <div class="benchmark-run-actions">
    <button type="button" class="is-primary" id="btnBenchmarkQuick">Quick</button>
    <button type="button" id="btnBenchmarkFull">Full</button>
    <button type="button" id="btnBenchmarkStop" disabled>Stop</button>
  </div>
  <div
    id="benchmarkSuiteToggles"
    class="benchmark-suite-toggles"
    role="group"
    aria-label="Benchmark suites to run"
  >
    <!-- One button per SuiteId; aria-pressed reflects selection -->
  </div>
</div>
```

- **Remove:** `#btnBenchmarkCustom`, `#benchmarkCustomSuites`.
- **Labels:** use `SUITE_LABELS` map in `benchmark-page.ts` (single source for display names).
- **Defaults on open:** match current Quick preset (capability, speed, modes on; tools, skills, coding off) OR all six on — product choice; document in acceptance criteria (recommend **Quick defaults** so first-time users see a fast path).

## Implementation plan (phased)

### Phase 1 — Suite-level toggle group (POLISH-003 scope)

| Step | Task |
| --- | --- |
| 1 | Update `index.html` run bar: add `#benchmarkSuiteToggles` segmented group; remove custom button + checkbox panel. |
| 2 | Add CSS in `benchmark-page.css`: `.benchmark-suite-toggles`, `.benchmark-suite-toggle` (mirror `.mode-segmented` / `.mode-segment` tokens). |
| 3 | Refactor `benchmark-page.ts`: `getSelectedSuites()` reads toggle buttons; `applyPresetToToggles('quick' \| 'full')`; Quick/Full handlers call apply then `startRun`. |
| 4 | Validation: if zero suites selected, block run + `setStatus('err', …)`. |
| 5 | `setRunning(true)`: disable toggles and Quick/Full; re-enable on finish. |
| 6 | Update `test/ui/benchmark-page-html.test.mjs`: drop custom IDs if removed; assert `#benchmarkSuiteToggles` and per-suite controls. |
| 7 | Add focused UI test (tsx/mjs): preset clicks set `aria-pressed`; run passes `suites` override matching toggles. |
| 8 | Manual QA on `#/benchmark`: toggle mix, Quick, Full, Stop, compare/history unchanged. |
| 9 | Update `documentation/context.md` benchmark bullet after implementation. |
| 10 | Close or note **BUG-007** in bug-hunt doc when verified. |

### Phase 2 — Per-test toggles (optional follow-up)

- Export static test manifests from `src/benchmark/suites/*.ts` (ids + labels).
- Nested toggle rows under each suite in results area or expandable run bar section.
- Runner: `RunBenchmarkOptions.tests?: string[]` filter — **not** in Phase 1.

## Files to touch (implementation)

| File | Change |
| --- | --- |
| `index.html` | Run bar markup: toggle group; remove custom control |
| `src/ui/benchmark-page.ts` | Selection API, preset apply, init listeners, running disable |
| `src/styles/benchmark-page.css` | Toggle group styles; remove `.benchmark-suite-checkboxes` or repurpose |
| `test/ui/benchmark-page-html.test.mjs` | ID list / structure assertions |
| New: `test/ui/benchmark-suite-toggles.test.mjs` (or `.mts`) | Toggle + preset behavior |
| `documentation/context.md` | Benchmark run bar description (post-impl) |
| `documentation/bug-hunt-session-2026-05-24.md` | POLISH-003 / BUG-007 status when done |

**No runner changes required** for Phase 1 if override continues to pass `SuiteId[]` via existing `options.suites`.

## Accessibility

- Container: `role="group"` + `aria-label="Benchmark suites to run"`.
- Each control: `type="button"`, `aria-pressed="true|false"`.
- Keyboard: buttons in tab order; Space/Enter toggles selection (do not submit form).
- Focus: `:focus-visible` outline consistent with `.mode-segment`.
- Screen reader: announce suite name + pressed state; optional `aria-describedby` when **POLISH-004** adds descriptions.

## Acceptance criteria

- [ ] All six suites appear as toggle buttons in a single visual group on `#/benchmark` without clicking “Custom suites.”
- [ ] Selected suites use clear active styling; unselected suites are visibly off.
- [ ] Clicking **Quick** selects Quick suite set and starts a run using exactly those suites (unless user changed toggles after click — per Option B, run uses state **after** Quick applies template).
- [ ] Clicking **Full** selects all six suites and starts a full run.
- [ ] With zero suites selected, Quick/Full do not start a run and user sees an error/status hint.
- [ ] During a run, suite toggles are disabled; Stop still works.
- [ ] Compare toggle and history row behave as before.
- [ ] `npm test` includes updated/added benchmark HTML and toggle tests; no regressions in benchmark runner tests.

## Test plan

1. **Automated:** extend `benchmark-page-html.test.mjs`; add unit test for `getSelectedSuites` / preset application (extract pure helpers if needed for testability).
2. **Manual:** open `#/benchmark` → turn off Modes → Quick → confirm only capability + speed run; turn on Tools only + custom mix → Full → confirm six suites when Full clicked.
3. **Regression:** existing `test/benchmark/*.test.mts` unchanged; `resolveBenchmarkSuites` contract unchanged.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Users expect Custom button to “run custom only” | Remove button; toggles + Quick/Full shortcuts; empty-state copy in summary (“Select suites above, then Quick or Full”). |
| Run bar wraps badly on narrow viewports | `flex-wrap` on run bar; toggle group `flex-wrap` like mode selector; test &lt; 600px width. |
| POLISH-004 descriptions need anchor | Add `data-suite-id` on toggles for future `aria-describedby` hooks. |

## Todos

- [ ] Confirm product choice: **Option B** (Quick/Full apply preset to toggles then run) vs Option A/C.
- [ ] Confirm default toggle state on first open (Quick preset vs all on).
- [ ] Implement Phase 1 markup + CSS + `benchmark-page.ts` wiring.
- [ ] Remove `#btnBenchmarkCustom` / `#benchmarkCustomSuites` and update HTML tests.
- [ ] Add toggle interaction tests.
- [ ] Manual QA + update `context.md` and bug-hunt statuses.
- [ ] (Optional Phase 2) Per-test toggle design doc / separate ticket.

## References

- Bug hunt: `documentation/bug-hunt-session-2026-05-24.md` — POLISH-003, BUG-007
- Runner presets: `QUICK_SUITES` / `FULL_SUITES` in `src/benchmark/runner.ts`
- Segmented control precedent: `src/styles/mode-selector.css`, `src/ui/settings-theme.ts` (`aria-pressed`)
- Suite labels: `SUITE_LABELS` in `src/ui/benchmark-page.ts`


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-64](https://linear.app/minnowai/issue/MIN-64/polish-003-benchmark-toggle-selection)
