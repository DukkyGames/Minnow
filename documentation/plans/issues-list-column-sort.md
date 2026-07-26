# Issues list column sort

## Goal

Let users click Issues list column headers (ID, Type, Title, Status, Priority, Labels, Updated) to sort the visible list by that field.

## Todos

- [x] Add pure sort helpers (`src/ui/issues-list-sort.ts`) with smart first-click direction
- [x] Convert list head labels to sortable buttons in `index.html`
- [x] Wire session sort state into `issues-page.ts` (list only; board unchanged)
- [x] Style active column + ▲/▼ indicator in `issues.css`
- [x] Unit tests for compare / toggle / defaults
- [x] Update `documentation/context.md`

## Behavior

| Column | First click | Second click |
|--------|-------------|--------------|
| ID, Type, Title, Status, Labels | Ascending | Descending |
| Priority, Updated | Descending (urgent / newest first) | Ascending |

- Single active column (no Shift multi-sort).
- Sort is session-only (not persisted).
- Ties break on numeric `ISS-n` id ascending.
- Select-all / Shift-range selection follow the sorted visible order.

## Files

- `src/ui/issues-list-sort.ts`
- `src/ui/issues-page.ts`
- `src/styles/issues.css`
- `index.html`
- `test/ui/issues-list-sort.test.mts`
