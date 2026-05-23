# MIN-16 — Bug tracker and list

## Status

MVP shipped on branch `cursor/bug-tracker-min-16-e60d`.

## Scope delivered

- **Mode:** `debug` (UI label **Bugs**)
- **Board:** `Chat.bugBoard` with five columns
- **Tools:** `bug_add`, `bug_update`, `bug_get_state`
- **Agents:** `debugger`, `bug-planner` sub-agent types
- **Pipeline:** Investigate → Plan fix → Start fix (Orchestrate handoff)

## Phase 4 — Global bugs (shipped)

- Sidebar **All bugs** + `#/bugs` full-page list
- Filters: workspace scope, column, hide complete
- Row opens owning chat in Bugs board view
- See [`min-16-global-bugs.md`](min-16-global-bugs.md)

## Out of scope (v2)

- Linear integration
- Auto-complete when orchestrator finishes (manual column / future sync)

## Todos

- [x] Mode + persistence schema
- [x] Kanban UI + Add bug form
- [x] Debugger + planner pipeline
- [x] Start fix → Orchestrate
- [x] Unit tests for store + tools
