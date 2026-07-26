# MIN-500 — Dev Server Code screen

## Goal

Promote workspace Dev Server from a Hub strip cell + terminal virtual tab into a first-class Code screen: multi-server registry, listening-port monitor, and log console with backfill.

## Shape brief (from Linear; confirmed decisions)

- **Register:** product (Code workspace instrument)
- **Color strategy:** Restrained (`--mn-*` tokens; status dots use semantic success/warning/danger)
- **Scene:** Solo builder at a desk mid-session, glancing at which local servers are up and what owns which port — calm bench chrome like Code Overview, not a marketing surface
- **Layout contract:** server list → log tabs → ports table (ASCII in Linear MIN-500)
- **Hub:** shrink to status + open screen; settings/console move to the screen
- **Route:** `#/app/code/dev-server` + sidebar footer rail button

## Todos

- [x] Worktree + Impeccable context
- [x] Part 1: registry, manager nest, ports, API routes, validators
- [x] Part 2: screen UI, API client, view models, route/rail
- [x] Part 3: remove terminal Dev Server tab
- [x] Part 4: shrink Hub cell
- [x] Tests, tsc, context.md
- [x] Browser verify + PR

## Visual-direction note

Image probes skipped: surface matches existing Code Overview / Brain Map chrome per confirmed ticket; mock exploration would not change the contract.
