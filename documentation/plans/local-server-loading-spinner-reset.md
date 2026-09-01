# Local Server loading spinner resets

## Goal

The Models → Local Server loading wheel must rotate continuously while a model is loading, instead of restarting on every progress tick.

## Diagnosis

`render()` in `src/ui/models/server-panel.ts` rebuilds the whole panel with `replaceChildren` on every store emit. In-flight loads emit about every **250 ms** (`LOAD_TICK_MS`) plus on each log chunk. Destroying `.models-spinner` (0.7s rotation) and `.models-progress__fill.is-indeterminate` cancels their CSS animations, so the wheel visibly snaps back.

## Todos

- [x] Patch in-flight loading cards in place when the set of cards is unchanged
- [x] Keep the spinner node (update a label span, not `textContent` on the chip)
- [x] Full redraw still runs when a load starts, finishes, fails, or the card set changes
- [x] Test: two progress ticks keep the same spinner element
- [x] Note the in-place patch in `documentation/context.md`
- [x] Run the new server-panel suite

## Out of scope

- Discover download cards (same pattern, different page)
- Busy-slot spinners on an already-running model
