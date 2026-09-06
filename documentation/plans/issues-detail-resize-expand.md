# Issues peek: resize and expand sheet

Shipped interaction for `#issuesDetailHost`: drag the left edge to widen the docked peek (persisted per workspace), and open a centered sheet over the Issues body.

## Todos

- [x] Persist peek width per workspace (`minnow.issues.peekWidth`)
- [x] Left-edge drag handle (Code sidebar family), clamp 380px–70% of body / 900px
- [x] Header control: expand to ~80% sheet with dim scrim; Restore / first Escape returns to peek
- [x] Hide resizer + expand on compact Issues (`@container` ≤900px)
- [x] Tests, `documentation/context.md`, Issues manual, DESIGN.md
