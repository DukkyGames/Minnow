# Board rail: delete icon + margin fix

## Problem
- Board list rows use `ob-row`, which pulls V1 padding from `ob-page.css` onto the `<li>`, nesting a padded button inside a padded row (extra chrome around the selected card).
- The delete control is a text label (`Delete`) absolutely positioned top-right, which reads as a gap / clutter on hover.

## Decisions (confirmed)
- Delete: trash **icon on hover/focus**, top-right of the row.
- Confirm: same icon, danger-styled; `aria-label` / `title` = “Delete the journal too?”
- Spacing: reset inherited `.ob-row` chrome under `.ov2__board-item` so the selected button fills the row.

## Todos
- [x] Align on delete affordance and confirm UX
- [ ] Reset `.ov2__board-item.ob-row` layout so V1 padding does not apply
- [ ] Build icon-only delete control with `createIcon('trash')`
- [ ] Style hover / focus / confirming states; `pointer-events` when hidden
- [ ] Update `documentation/context.md`
- [ ] Verify in the running desktop app
