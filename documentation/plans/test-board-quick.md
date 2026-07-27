# Test Board (Quick)

Minimal orchestrate board for local dev — three parallel W1 tasks, no dependencies.
Use with `npm run seed:test-board` and the fake-model server.

## Goal

Exercise build → test → merge for three trivial tasks under `sandbox/test-board-quick/`.

## Wave Breakdown

### Wave W1

#### W1-A — Greet util
- **category:** build
- **wave:** W1
- **build:** Create `sandbox/test-board-quick/greet.ts` exporting `greet(name: string)` returning `` `Hello, ${name}!` ``.
- **test:** Read the file; confirm `greet('World')` would return `Hello, World!`.

#### W1-B — Add util
- **category:** build
- **wave:** W1
- **build:** Create `sandbox/test-board-quick/add.ts` exporting `add(a, b)` returning `a + b`.
- **test:** Read the file; confirm `add(2, 3)` is `5`.

#### W1-C — Index barrel
- **category:** build
- **wave:** W1
- **build:** Create `sandbox/test-board-quick/index.ts` re-exporting `greet` and `add`.
- **test:** Read the file; confirm both exports are present.
