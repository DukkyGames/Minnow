# Orchestrator Board Smoke Test

A self-contained plan whose only purpose is to **exercise every orchestrator board
function**: multi-wave gating, parallel concurrency, intra- and cross-wave
`depends on`, all four task categories (`build` / `fix` / `test` / `research`),
worktree isolation + merge, and the board-level final test.

All work is trivial, deterministic, and sandboxed under `sandbox/board-smoke/` so it
runs fast, can't break the app, and is easy to delete afterward (`git clean -fd sandbox/`).

## Goal

Stand up a tiny TypeScript utility module (`greet`, `add`) plus a wiring module and a
test, built across three waves so the board's ordering, dependencies, isolation, and
final test all get hit.

## How to run (exercises each feature)

1. Open an Orchestrate chat, point it at this plan (`documentation/plans/orchestrator-board-smoke.md`), let it `board_init`.
2. **Manual mode** — start/stop individual cards by hand; confirm later waves stay locked.
3. **Sequential mode** — press Start; confirm tasks run one at a time in plan order, deps respected.
4. **Auto mode** — press Start; confirm W1 tasks run in parallel (concurrency), per-task worktrees appear (`git worktree list`), branches merge into the integration branch, and the final test runs at the end.
5. Mid-run press **Stop**; confirm timer freezes + Stopped badge. Reload; confirm it stays stopped.

---

## Wave Breakdown

### Wave W1 — Independent leaf tasks (parallel / concurrency + per-task isolation)

Three tasks with **no dependencies** so Auto mode runs them concurrently and each gets
its own worktree.

#### W1-A — Create greet util
- **category:** build
- **wave:** W1
- **build:** Create `sandbox/board-smoke/greet.ts` exporting `export function greet(name: string): string` that returns `` `Hello, ${name}!` ``. No other files. Keep it under 10 lines.
- **test:** Confirm the file exists and `greet('World')` would return `Hello, World!` (read the source; no runner needed).

#### W1-B — Create add util
- **category:** build
- **wave:** W1
- **build:** Create `sandbox/board-smoke/add.ts` exporting `export function add(a: number, b: number): number` returning `a + b`. No other files.
- **test:** Confirm the file exists and `add(2, 3)` returns `5` by reading the source.

#### W1-C — Survey existing sandbox
- **category:** research
- **wave:** W1
- **build:** Read-only. List what already exists under `sandbox/board-smoke/` and report whether `greet.ts` / `add.ts` are present. Do **not** write any files (verifies the research category does no mutation).

### Wave W2 — Wiring (cross-wave depends on + wave gating)

Stays locked until **all** of W1 is `complete`.

#### W2-A — Wire utils into an index
- **category:** build
- **wave:** W2
- **depends on:** W1-A, W1-B
- **build:** Create `sandbox/board-smoke/index.ts` that imports `greet` and `add` from the sibling files and exports `export function describe(name: string, x: number, y: number): string` returning `` `${greet(name)} ${x}+${y}=${add(x, y)}` ``.
- **test:** Read the source and confirm both imports resolve to the files from W1 and `describe('World', 2, 3)` would produce `Hello, World! 2+3=5`.

#### W2-B — Unit test for the module
- **category:** test
- **wave:** W2
- **depends on:** W2-A
- **build:** Create `sandbox/board-smoke/smoke.test.mts` using `node:test` + `node:assert` that imports `describe` from `./index.ts` and asserts it equals `Hello, World! 2+3=5`. (Verifies the `test` category and an intra-wave dependency.)
- **test:** Confirm the test file imports from `./index.ts` and asserts the expected string.

### Wave W3 — Cleanup pass (fix category)

Stays locked until all of W2 is `complete`.

#### W3-A — Add a module barrel header
- **category:** fix
- **wave:** W3
- **depends on:** W2-A
- **build:** Prepend a one-line `// sandbox/board-smoke — orchestrator board smoke test` comment to `sandbox/board-smoke/index.ts`. Change nothing else.
- **test:** Confirm the header comment is the first line of `index.ts` and the exports are unchanged.

---

## Board final test (runs after every task completes)

Verify the assembled module is coherent:
- `sandbox/board-smoke/greet.ts`, `add.ts`, `index.ts`, and `smoke.test.mts` all exist.
- `index.ts` starts with the W3-A header comment and re-exports `describe`.
- The smoke test asserts `Hello, World! 2+3=5`.

## Expected board behavior checklist

- [ ] `board_init` reports **6 tasks across 3 waves**.
- [ ] W1-A / W1-B / W1-C run **in parallel** under Auto (up to the concurrency cap).
- [ ] W2 stays gated until W1 is fully complete; W2-B waits on W2-A (`depends on`).
- [ ] W3 stays gated until W2 is complete.
- [ ] Under Auto: per-task worktrees + branches `minnow/board/<id>/task/<taskId>` appear and merge into `minnow/board/<id>/integration`.
- [ ] Stop freezes the timer + shows Stopped; reload keeps it stopped.
- [ ] Final test passes once all 6 tasks are complete.

## Cleanup

```bash
git worktree prune
git branch --list 'minnow/board/*' | xargs -r git branch -D
git clean -fd sandbox/board-smoke
```
