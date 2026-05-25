---
name: BUG-021 — Reef non-chart toExponential error
overview: Scope chart-only toExponential lint/runtime checks to Recharts widgets so non-chart fences (Calculator, scientific formatters) mount without misleading axis-tick errors.
source: documentation/bug-hunt-session-2026-05-24.md (BUG-021)
related:
  - documentation/bug-hunt-session-2026-05-24.md
  - documentation/context.md (Reef widget validation)
  - MIN-33 (Reef widget improvements — silent repair / validation)
  - POLISH-020 (Reef merged into General/Research)
todos:
  - id: confirm-repro
    content: Reproduce — non-chart fence with n.toExponential() fails prepareReefWidgetHtml with axis-tick message
    status: completed
  - id: scope-static-lint
    content: Move TO_EXPONENTIAL_RE check inside fenceUsesRecharts(body) branch in widget-fence-lint.ts
    status: pending
  - id: refine-error-copy
    content: If global check remains for charts, use chart-specific message only when Recharts detected; generic message for chart tickFormatter context
    status: pending
  - id: runtime-probe-audit
    content: Confirm probeChartLayout() already no-ops without .recharts-responsive-container; add test if missing
    status: pending
  - id: unit-tests-non-chart
    content: Add widget-fence-lint test — vanilla calculator HTML with toExponential passes; chart snippet with toExponential still errors
    status: pending
  - id: template-regression
    content: Assert all 21 built-in widget templates still pass prepareReefWidgetHtml after change
    status: pending
  - id: manual-verify
    content: Generate scientific calculator reef widget in Reef mode — mounts without chart-axis error
    status: pending
  - id: docs-context
    content: Update documentation/context.md Reef validation bullet; mark BUG-021 resolved in bug-hunt doc when shipped
    status: pending
isProject: false
---

# BUG-021 — Reef non-chart widgets fail with toExponential / axis-tick error

**Tracker:** [documentation/bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) — BUG-021  
**Severity:** Major  
**Area:** Reef — `reef-widget` mount / validation (`widget-fence-lint.ts`, `widget-prelude.ts`, `widget-error-ui.ts`)  
**Status:** Open (verified — plan only, no implementation in this document)

---

## Summary

Non-chart `reef-widget` fences (e.g. **Calculator**, scientific formatters) can fail validation with **Widget could not be displayed** and a **misleading chart-axis message** about `toExponential`, even when the widget has no Recharts chart. Shipped built-in templates (including `calculator.md`) pass today because they use `toFixed`; LLM-generated or user-authored widgets that legitimately call `Number.prototype.toExponential` for display are blocked.

---

## Verification (2026-05-24)

| Check | Result |
|-------|--------|
| All **21** built-in widget templates (`prepareReefWidgetHtml`) | **Pass** — 0 lint failures |
| `calculator.md` fence body | **Pass** — uses `toFixed(2)` only |
| Synthetic non-chart fence with `n.toExponential(4)` | **Fail** — exact user-reported message |
| `probeChartLayout()` in prelude | **Scoped** — returns early when no `.recharts-responsive-container` |

**Repro (confirmed):**

```js
// Non-chart HTML with scientific formatter
const fmt = (n) => n.toExponential(4);
// → lintReefWidgetFence / prepareReefWidgetHtml error:
// "Do not use toExponential on axis ticks (collapses Y-axis width); use toFixed instead."
```

**Root cause:** `widget-fence-lint.ts` runs `TO_EXPONENTIAL_RE` on **every** fence body (lines 46–50), not only when `fenceUsesRecharts(body)` is true. Chart-specific copy is shown for non-chart failures.

Runtime prelude `probeChartLayout()` is already chart-scoped (line 101: `if (!containers.length) return`).

---

## Problem statement

| | |
|---|---|
| **Expected** | Non-chart widgets render without chart-axis lint. `toExponential` allowed for general number formatting outside Recharts tick formatters. |
| **Actual** | Any `toExponential(` call in the fence body fails static lint with axis-tick wording; mount blocked before iframe probe. |
| **Impact** | Scientific calculators, engineering widgets, and repair-loop outputs that format large/small numbers fail with confusing errors. |

---

## User-reported error UI

- Title: **Widget could not be displayed**
- Message: **Do not use toExponential on axis ticks (collapses Y-axis width); use toFixed instead.**
- Hint: Ask the assistant to fix the reef-widget fence…

---

## Proposed fix (recommended)

### A. Scope static lint (required)

In `src/chat/reef/widget-fence-lint.ts`, move the `TO_EXPONENTIAL_RE` check inside the `if (usesRecharts)` block (or a helper `fenceDeclaresYAxis` / tickFormatter context):

```ts
if (usesRecharts && TO_EXPONENTIAL_RE.test(body)) {
  errors.push('Do not use toExponential on YAxis tickFormatter; use toFixed instead.');
}
```

Optional: also require `fenceDeclaresYAxis(body)` so Recharts pie-only widgets without cartesian axes are not flagged.

### B. Runtime (no change expected)

`probeChartLayout()` already limits scientific-notation tick scan to `.recharts-cartesian-axis-tick` nodes when containers exist. No change unless QA finds false positives on chart widgets with non-axis text matching `/e[+-]?\d+/i`.

### C. Tests

1. **Pass:** vanilla calculator fence with `toExponential` for output display.
2. **Fail:** Recharts snippet with `tickFormatter: (v) => v.toExponential(2)`.
3. **Regression:** lint all built-in templates (0 errors).

### D. Prompt / repair copy (optional)

`widget-repair.ts` and reef prompts already say “never toExponential” for **charts** — keep as-is; clarify “YAxis tickFormatter” in repair system prompt to reduce LLM echoing `toExponential(`产品` in comments.

---

## Acceptance criteria

- [ ] Non-chart fence with `toExponential()` for display formatting **passes** if no Recharts import.
- [ ] Recharts cartesian chart with `toExponential` in `tickFormatter` still **fails** lint.
- [ ] All 21 built-in widget templates still pass `prepareReefWidgetHtml`.
- [ ] Manual: scientific calculator reef widget mounts in chat without axis-tick error.
- [ ] `npm test` — `widget-fence-lint.test.mts` updated and green.
- [ ] `documentation/bug-hunt-session-2026-05-24.md` BUG-021 marked resolved when shipped.

---

## Files to touch

| File | Change |
|------|--------|
| `src/chat/reef/widget-fence-lint.ts` | Scope `toExponential` check to Recharts fences |
| `test/chat/reef/widget-fence-lint.test.mts` | Non-chart pass + chart fail cases |
| `documentation/bug-hunt-session-2026-05-24.md` | Status when fixed |
| `documentation/context.md` | Reef validation note if needed |

**Not required:** `widget-prelude.ts` (already chart-scoped), `widget-error-ui.ts`.

---

## References

- Bug report: [documentation/bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) — BUG-021
- Architecture: [documentation/context.md](../../context.md) — Reef widget validation
- Static lint: `src/chat/reef/widget-fence-lint.ts`
- Runtime prelude: `src/chat/reef/widget-prelude.ts` — `probeChartLayout()`
- Calculator template: `src/chat/reef/widgets/calculator.md`


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-83](https://linear.app/minnowai/issue/MIN-83/bug-021-reef-non-chart-toexponential)
