# Feature 26 — Stats strip with file editor (E6)

| Field | Value |
|-------|-------|
| **ID** | `feature-26-stats-strip-with-editor` |
| **Epic** | E — File panel (E6) |
| **Build plan** | [`documentation/plans/Build out/feature-26-stats-strip-with-editor.md`](../Build%20out/feature-26-stats-strip-with-editor.md) |

## Automated

| Check | Command | Status |
|-------|---------|--------|
| Unit / DOM smoke | `npm test` (includes `test/ui/stats-split-layout.test.mjs`) | PASS |
| Production bundle | `npm run build` | PASS |

## Manual (AC1–AC6)

| # | Check | Result |
|---|-------|--------|
| M1 | Wide window, no viewer → full stats grid; no expand button (≥601px) | PASS |
| M2 | Open file → compact Metrics row; panel hidden until expand | PASS |
| M3 | Expand in split → panel fits chat column; chat scroll independent | PASS |
| M4 | CodeMirror vertical scrollbar fully usable | PASS |
| M5 | Resize split → stats stay in left column | PASS |
| M6 | Close viewer → full desktop stats grid returns | PASS |
| M7 | Send message → preview + strip values update | PASS |
| M8 | Terminal + viewer open → stack in main column only | PASS |
| M9 | Mobile ≤600px + open file → expand/collapse still works | PASS |
| M10 | Narrow split (~35% chat) → compact row readable | PASS |

## Sign-off

**PASS** — Stats strip stays in `#mainColumn` when `#workspaceSplit.viewer-open`; compact expand row on desktop split; no CodeMirror gutter overlap; tests green.

**Shipped:** 2026-05-20
