---
name: p2g-widget
overview: Three-task fixture for Orchestrator V2 Phase 2 gate. Agents write into a sandbox workspace, never Minnow product source.
todos:
  - id: W1-A
    content: "Wave 1: Add greet"
    status: pending
  - id: W1-B
    content: "Wave 1: Add add"
    status: pending
  - id: W2-A
    content: "Wave 2: Wire the barrel"
    status: pending
isProject: true
---

# P2-G Widget

**Date:** 2026-08-29
**Goal:** A real 3-task board the server can drive at concurrency 1 against a sandbox.

## Context
Phase 2 gate fixture. Builders write files under the attempt cwd (the test sandbox). Do not touch Minnow's own `src/` or `server/`.

## Architecture / Key Files
| File | Role | Action |
|------|------|--------|
| `src/greet.js` | greet helper | CREATE |
| `src/add.js` | add helper | CREATE |
| `src/index.js` | barrel | CREATE |

## Wave Breakdown

### Wave 1 — Helpers

#### Task W1-A: Add greet
- **Build:** Create `src/greet.js` exporting `greet(name)` that returns `hello <name>`.
- **Test:** The module exports `greet` and returns a greeting string.
- **Accept:** `greet('world')` is `hello world`.
- **Touches:** src/greet.js

#### Task W1-B: Add add
- **Build:** Create `src/add.js` exporting `add(a, b)` that returns the sum.
- **Test:** The module exports `add` and returns a number.
- **Accept:** `add(2, 3)` is `5`.
- **Touches:** src/add.js
- **Depends on:**

### Wave 2 — Barrel

#### Task W2-A: Wire the barrel
- **Build:** Create `src/index.js` that re-exports `greet` from `./greet.js` and `add` from `./add.js`.
- **Test:** The barrel exports both names.
- **Accept:** Importing `src/index.js` yields both `greet` and `add`.
- **Touches:** src/index.js
- **Depends on:** W1-A, W1-B

## Verification Checklist
- [ ] The three sandbox files exist after the run
