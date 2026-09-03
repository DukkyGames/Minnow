# V2 board report screen and rerun

Restore a dedicated end-of-run report pane on the V2 Boards page, plus a
user-initiated **Retry** that reopens a finished-badly run.

## Todos

- [x] Fold: `board.reopened`, `task.added`; `Attempt.retired`; `TaskState.reopened`; `BoardState.rerun`
- [x] Engine: `reopen()`; `journalHasReport` only counts reports after the last `board.reopened`; snapshot v3
- [x] API: `POST /api/boards/:id/rerun`; `POST /start` 409 when finished
- [x] UI: report replaces kanban when finished or user-stopped; header Board / Report toggle (session-local)
- [x] Actions: back, follow-up chat, commit/push/PR/clear worktrees, Retry (failed tasks or synthetic fix task)
- [x] Tests: fold, plan, policy, seeds golden, engine, API, report pane, kanban Failed/Retry
- [x] Docs: `documentation/context.md`, boards manual finishing section

## Shape (confirmed)

- Replace the kanban in `.ob-main` when the run is finished or user-stopped. Header stays.
- Board / Report toggle is session-local (the V2 view does not write the journal).
- No second hero: status lives in the existing header badge. A failed ladder is **Failed**, not Complete.
- Rendered markdown (chat renderer), not a `<pre>` dump. Journal ledger under the report, including failing-rung output.
- Stats: journal counts (merged / abandoned / skipped / attempts) plus git files/lines. No invented elapsed clock.
- Merge queue and timeline stay on the Board view only.

## Engine (confirmed)

Append-only. Retry is a completed side effect, same family as
`task.abandoned { reason: 'user' }`. Merged stays merged.

| Event | Fold |
|-------|------|
| `board.reopened { taskIds, reason }` | Capture `previousFinalTest`; clear `finished` / `finalTest` / `runSummary`; reopen abandoned/skipped ids (never `mergedSha`); retire ended attempts |
| `task.added { task, wave? }` | Append a task (and optional new wave); additive and idempotent |

`POST /rerun` (`engine.reopen`): reopen abandoned + skipped (plus skipped dependents), then `board.reopened` + `board.started`. If nothing is abandoned but the final test failed, append a synthetic `FIX-n` task in a new wave first.

A second end-of-run report is allowed after `board.reopened`: `journalHasReport` ignores writes from the previous run. `report.md` is overwritten; the new report folds the whole journal.

`POST /start` on a finished board is 409 (`the run has finished; rerun it instead`) so it cannot wedge the board as running with an empty `plan()`.
