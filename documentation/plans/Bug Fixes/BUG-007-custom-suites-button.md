---
name: BUG-007 — Custom suites button broken
overview: Fix benchmark Custom suites toggle so the checkbox panel actually hides/shows; align getSelectedSuites behavior with visible state.
source: documentation/bug-hunt-session-2026-05-24.md (BUG-007)
related:
  - documentation/bug-hunt-session-2026-05-24.md
  - documentation/plans/Bug Fixes/POLISH-003-benchmark-toggle-selection.md
  - documentation/context.md (Benchmark section)
todos:
  - id: css-hidden-override
    content: Add `.benchmark-suite-checkboxes[hidden] { display: none !important; }` in benchmark-page.css (class display:flex overrides UA [hidden])
    status: pending
  - id: manual-verify-toggle
    content: On #/benchmark — panel hidden on load; Custom suites click shows/hides checkboxes; repeat click hides again
    status: pending
  - id: verify-getSelectedSuites
    content: With panel hidden, Quick uses preset; after opening panel and unchecking suites, Quick respects checked boxes
    status: pending
  - id: html-test-ids
    content: Extend test/ui/benchmark-page-html.test.mjs to assert btnBenchmarkCustom and benchmarkCustomSuites exist
    status: pending
  - id: optional-aria
    content: Set aria-expanded on btnBenchmarkCustom when panel toggles (accessibility)
    status: pending
  - id: docs-bug-hunt
    content: Mark BUG-007 verified/fixed in bug-hunt-session doc after implementation
    status: pending
  - id: coordinate-polish-003
    content: If POLISH-003 ships first, close BUG-007 as superseded by toggle group removal
    status: pending
isProject: false
---

# BUG-007 — Custom suites button does not work

**Tracker:** [documentation/bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) — BUG-007  
**Severity:** Major  
**Area:** Benchmark — **Custom suites** (`#btnBenchmarkCustom`, `#benchmarkCustomSuites`)  
**Status:** Open — **verified 2026-05-24** (root cause confirmed; fix not yet applied)

---

## Summary

The **Custom suites** button toggles the `hidden` property on `#benchmarkCustomSuites`, but the checkbox panel **never visually hides** because `.benchmark-suite-checkboxes { display: flex }` overrides the user-agent `[hidden]` rule. Users perceive the button as broken (no show/hide). Suite overrides via `getSelectedSuites()` only apply when `hidden === false`, which adds a second surprise: checkboxes may appear always-on-screen while Quick/Full still ignore them until the user clicks Custom suites once.

---

## Verification (2026-05-24)

**Status: CONFIRMED** — live app on `http://localhost:5173/#/benchmark` + `Runtime.evaluate` computed styles.

| Check | Result |
|-------|--------|
| `initBenchmarkPage()` wires click listener | Yes — `src/ui/benchmark-page.ts` lines 521–527 |
| `btn.click()` toggles `panel.hidden` | Yes — `before: true` → `after: false` |
| `getComputedStyle(panel).display` when `hidden=true` | **`flex`** (should be `none`) |
| `getComputedStyle(panel).display` when `hidden=false` | **`flex`** |
| Visual toggle on user click | **No visible change** — panel always displayed as flex row |

**Root cause:** `src/styles/benchmark-page.css` — `.benchmark-suite-checkboxes { display: flex; }` wins over the HTML `hidden` attribute default in this build (same pattern as other Minnow panels that use explicit `[hidden]` or `.hidden` rules — see `input.css` `.hidden`, `view-mode-toggle.css` `#btnViewModeToggleBoard[hidden]`).

---

## Problem statement

| | |
|---|---|
| **Expected** | Custom suites button reveals/toggles the suite checkbox picker; hidden by default; Quick/Full can use checked suites when panel is open. |
| **Actual** | Button toggles `hidden` IDL property but panel stays `display: flex`; no visible toggle. Checkbox overrides gated on `custom.hidden` in `getSelectedSuites()`. |
| **Impact** | Users cannot discover or control per-suite selection; undermines custom benchmark workflows. |

---

## Reproduction

1. Open Benchmark (`#/benchmark`).
2. Note suite checkboxes (Capability, Speed, …) are **always visible** in the run bar area.
3. Click **Custom suites** repeatedly — **no show/hide change**.
4. (Optional) DevTools: `document.getElementById('benchmarkCustomSuites').hidden` toggles; `getComputedStyle(...).display` stays `flex`.

---

## Proposed fix (minimal)

### CSS (`src/styles/benchmark-page.css`)

After `.benchmark-suite-checkboxes { display: flex; ... }`, add:

```css
.benchmark-suite-checkboxes[hidden] {
  display: none !important;
}
```

Alternative: toggle class `.hidden` from `input.css` instead of `hidden` attribute (matches settings/terminal patterns).

### Optional UX

- `aria-expanded` on `#btnBenchmarkCustom` when panel open.
- Consider **POLISH-003** (always-visible segmented toggles) as the long-term replacement; this CSS fix unblocks BUG-007 until then.

---

## Files

| File | Role |
|------|------|
| `index.html` | `#btnBenchmarkCustom`, `#benchmarkCustomSuites` markup |
| `src/ui/benchmark-page.ts` | Toggle listener, `getSelectedSuites()` |
| `src/styles/benchmark-page.css` | **Fix location** — `[hidden]` override |
| `src/benchmark/runner.ts` | `resolveBenchmarkSuites(preset, override)` |
| `test/ui/benchmark-page-html.test.mjs` | Add IDs to static HTML tests |

---

## Acceptance criteria

- [ ] On load, custom suite checkboxes are **not** visible (panel hidden).
- [ ] Click **Custom suites** → checkboxes appear.
- [ ] Click again → checkboxes hide.
- [ ] With panel open, changing checkboxes affects the next Quick/Full run (`getSelectedSuites()` non-empty).
- [ ] With panel closed, Quick/Full use preset defaults (capability + speed + modes for Quick).

---

## Linear

- **Title:** `[BUG-007] Custom suites button broken`
- **Priority:** 2 (High)
- **Labels:** `bug`, `benchmark` (workspace may use `Bug` capitalization — match existing issues)


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-90](https://linear.app/minnowai/issue/MIN-90/bug-007-custom-suites-button-broken)
