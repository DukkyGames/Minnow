# Plan: V2 Boards task detail as centered overlay

**Status:** done  
**Date:** 2026-08-30  
**Register:** product (DESIGN.md / PRODUCT.md)

## Goal

Replace the inline `.ov2-detail` section at the bottom of the V2 board pane with a **centered, near-full-board dialog overlay** that opens when a task card is clicked. Keep the board readable underneath; put Build / Test / Accept content first.

## Confirmed shape (user)

| Decision | Choice |
|----------|--------|
| Placement | Centered overlay over the board |
| Size | Nearly full board height and width |
| Content order | Build / plan specs first; meta as a compact header strip |
| Dismiss | Close button, click outside (scrim), Escape, open another task (replaces) |
| Same-card click | Does **not** toggle closed |
| Board scroll | Locked while open |
| Focus on close | Return to the task card that opened it |

## Why this shape

- The bottom panel steals vertical space and pushes Finish / ledger / merge queue off-screen while reading a long spec.
- A centered near-full overlay matches “read the task, then dismiss” without inventing a second navigation surface.
- Restrained product chrome: `--mn-overlay` scrim, surface panel, hairline border, existing `.ov2-btn` / field / pill vocabulary. No glass, gradient text, or side-stripe accents.

## Structure

```
.ov2-detail-overlay          (scrim; click closes)
  section.ov2-detail         (role=dialog, aria-modal=true)
    .ov2-detail__head        title + phase + Close
    .ov2-detail__meta        compact Column / Wave / Touches / Depends / Merged
    .ov2-detail__body        scroll: specs → notes → attempts → transcript
```

## Todos

- [x] Refactor `renderTaskDetail` to wrap dialog + scrim; reorder body; wire backdrop / Escape
- [x] Stop same-card toggle; focus Close on open; focus task card on close
- [x] Add `.ov2__board.is-detail-open { overflow: hidden }` + overlay CSS
- [x] Tests for dialog semantics, content order, Close dismiss
- [x] Update `documentation/context.md`
- [x] Verify with scoped UI tests and agent-browser on localhost:9473

## Out of scope

- Changing attempt / transcript loading behavior
- V1 Orchestrate board task inspector
- Anchored-to-card popovers or side drawers
