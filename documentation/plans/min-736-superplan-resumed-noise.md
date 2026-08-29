# MIN-736 — Super Plan Activity: spurious "resumed" rows

## Problem

When starting Super Plan (or advancing to a new stage), the Activity tab shows:

1. `Stage Interview · running`
2. `Stage Interview · resumed` ← confusing; nothing was paused

Same pattern appears when a new stage becomes active (`pending` / `running` followed by `resumed`).

## Root cause

[`PlanActivityCollector`](../../src/ui/plan-activity-collector.ts) compares `lastPaused` to `superPlan.paused` with strict inequality, then logs `paused` or `resumed` on any mismatch.

- On mount, `lastPaused` is seeded with `Boolean(state.paused)` → `false`.
- Live updates often leave `paused` as `undefined` (never set) or flip between `undefined` and `false` when `setSuperPlanPaused(chat, false)` runs.
- `false !== undefined` is true → a fake **resumed** row is appended after every stage status change.

## Fix

1. Normalize pause to a boolean for comparison and storage.
2. Only append `paused` / `resumed` when the normalized flag **actually changes** from a known prior value (never on first observation / seed).
3. Regression test: stage status notifications without a real pause must not emit `resumed`; real pause → resume still does.

## Todos

- [x] Locate emitter (`plan-activity-collector` controller subscription)
- [ ] Normalize pause comparison; skip first observation
- [ ] Add regression tests (MIN-736)
- [ ] Update `documentation/context.md`
- [ ] Run scoped tests; verify in browser if Super Plan UI reachable
- [ ] Commit, push, open PR
