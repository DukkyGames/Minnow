# Plan: Reuse the Orchestrator board header on V2 Boards

**Status:** done  
**Date:** 2026-08-29  
**Updated:** 2026-08-30  
**Register:** product (DESIGN.md / PRODUCT.md)

## Goal

Replace the boxed `.ov2-controls` bar on the V2 Boards live pane with the same tight `.board-header` instrument strip the V1 Orchestrator uses: title, status badge, inline telemetry, then model / concurrency / Start-Stop in one band.

The 132px control card (Running/Stopped segments, stepper, resource paragraph, model block) is the thing being removed. The header is one instrument, not a second chrome layer under the runhead.

## Why this shape

- **Earned familiarity:** Boards is the same job as Orchestrate. A second control vocabulary (segmented Running/Stopped + a wrapping hint card) is strangeness without purpose.
- **Flat Chrome Rule:** a bordered surface-0 card around run controls reads as a nested card. The V1 header is a hairline band.
- **Phase 4:** V2 still must not import `orchestrate-board.ts`. Markup reuses `.board-header*` class names; rules are restated under `.ov2` in `orchestrator-boards.css`.

## Mapped controls

| V1 header | V2 Boards |
|-----------|-----------|
| Title + status badge + `tasks · waves · run` + progress | Same, derived from `BoardState` |
| Model chip + reasoning | Same widgets as Orchestrate (`board` model chip + brain/effort strip). Persist via journaled `board.model.set` |
| `run` number input | Same input; `change` while running POSTs concurrency; Start still sends N |
| Start / Stop | Same commands as Running / Stopped; one button like V1 |
| Timeline | Existing journal toggle |
| Rename | Compact control; inline form when editing |

Out of scope (no V2 engine field): hands-off, isolation, skip-per-task-tests, bulk requeue, pending-AFK banner.

## Todos

- [x] Merge `renderBoardHeader` + `renderControls` into one `.board-header` strip
- [x] Restate header CSS under `.ov2`; delete boxed `.ov2-controls` chrome
- [x] DOM tests for header structure and Start/Stop
- [x] Replace the native model/reasoning `<select>`s with the Orchestrate chip + reasoning strip
- [x] Detach those widgets across live `replaceChildren` so the picker is not stuck on "Loading models…"
- [x] Journal `low` / `medium` / `high` on `board.model.set` (attempts still map to thinking on/off)
- [x] Update `documentation/context.md`
- [x] Run `test/ui/orchestrator-boards-*.mts` and `test/orchestrator/board-journal-reasoning.test.mts`
