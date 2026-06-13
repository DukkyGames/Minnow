# Benchmark Charts Redesign

## Goal

Make the Benchmark Charts tab answer practical model-selection questions instead of presenting dense chart output. The page should help a developer quickly see the recommended model, the quality/speed tradeoff, weak tests, and whether recent runs are improving.

## Design Direction

- Keep the product register: restrained, instrument-like, compact, and token-driven.
- Avoid hero metrics, decorative gradients, glass effects, and nested card stacks.
- Lead with interpretation: best quality, fastest model, and balanced recommendation.
- Replace the per-test bar wall with ranked weak spots and model-by-model evidence.
- Make history useful by showing the latest delta per model before the trend SVG.

## Todos

- [x] Add chart data helpers for previous-run deltas and per-test insight ranking.
- [x] Replace the all-time leaderboard lead position with a run decision summary.
- [x] Redesign per-test scores into a ranked weak-spots section with compact evidence bars.
- [x] Add a latest movement strip to the run history section.
- [x] Update responsive CSS while preserving Minnow tokens and existing chart interactions.
- [x] Update `documentation/context.md` after implementation.
- [x] Run focused verification for the edited TypeScript and CSS.
- [x] Distill pass: flat sections, reduced redundancy, cleaner history axis.
