# Issues list layout

Rebalance the Issues list so identity and labels are scannable. Titles no longer consume leftover width.

## Design direction

- **Register:** product. Restrained color. Existing `--mn-*` tokens.
- **Scene:** A developer scanning a long Issues list on a large monitor, triaging by priority then title.
- **Anchor:** Linear’s identity cluster (id + priority + type) on the left; metadata has room to breathe.

## Todos

- [x] Confirm current grid: title is `1fr`, labels capped at `12rem`, row height `28px`, priority after status
- [x] Move Priority between ID and Type in header and row DOM
- [x] Share leftover width between title and labels; widen metadata tracks slightly
- [x] Increase row height, cell padding, and column gap
- [x] Give list-row label chips more max-width and gap
- [x] Keep Priority visible in the ≤900px compact list (identity field)
- [x] Update `documentation/context.md` and CSS contract tests
- [x] Shrink-wrap the labels column so + hugs the last chip; caret for labels past three

## Anti-goals

- Do not redesign the board, peek, or capture chrome
- Do not invent a new density mode or column picker
- Do not use cards, side stripes, or metric colors on inactive rows
