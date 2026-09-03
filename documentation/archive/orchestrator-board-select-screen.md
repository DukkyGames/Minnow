# Restore Orchestrate board select (ask) pane on V2 Boards

**Status:** done · **Date:** 2026-09-01

## Agreed context

- **Goal:** When no V2 board is selected, the main pane is the V1 hub ask/start screen (plan picker, preview, Open board, Refresh, Make a plan), not the thin “No board open” blank.
- **Rail:** Keep the V2 left rail (board list + New board). New board focuses the ask pane rather than swapping in the optional-id create form.
- **Start:** `POST /api/boards` via `createBoardFromPlan` (parsePlan, no planner chat), then select that board. Show parse errors in the pane.
- **Make a plan:** Super Plan `preferNew` (same as the hub).
- **Non-goal:** Restoring V1 leftover board groups as the rail source of truth.

## Todos

- [x] Interview: hub ask pane; keep V2 rail
- [x] Mount hub ask UI in `paintBoard` when `selectedBoardId` is null
- [x] Wire Open board / Refresh / Make a plan / plan preview
- [x] Rail **New board** focuses the plan select
- [x] Avoid wiping an in-progress ask pane on list/notice repaints
- [x] CSS so the ask pane fills `.ov2__board` like `.ob-pane--ask`
- [x] Tests for the ask pane
- [x] Update `documentation/context.md`

## Success checks

- Opening Orchestrate with no board selected shows Boards & plans + plan dropdown + preview.
- Choosing a plan and Open board creates a V2 journal board and opens the kanban.
- Parse failures list line/column/message in the pane.
- Existing boards stay listed in the rail; picking one still opens the live board.
