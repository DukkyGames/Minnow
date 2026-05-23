# MIN-16 Phase 4 — Global bugs list

## Goal

Aggregate bug cards from every chat in `sessions/state.json` into one searchable list, with navigation back to the owning chat board.

## Scope

| Item | Decision |
| --- | --- |
| Data source | All chats in session (`chat.bugBoard.bugs`) |
| Workspace filter | **All** sessions vs **current workspace** (default: current) |
| Column filter | All columns or one workflow column |
| Hide complete | Toggle (default: on) |
| Entry point | Sidebar **All bugs** button + `#/bugs` route |
| Row action | Switch chat → **Bugs** mode → board view |

## Todos

- [x] `collectGlobalBugs` aggregator + unit tests
- [x] Full-page `global-bugs-page` UI (filters, table, open in chat)
- [x] Sidebar + hash routing; hide chat shell while open
- [x] Update `context.md` and MIN-16 plan status

## Out of scope

- Cross-device sync beyond existing session blob
- Linear export
