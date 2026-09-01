# Workspace switch hangs after “still running” confirm (macOS)

**Status:** implemented  
**Date:** 2026-09-01  
**Register:** product

## Goal

Opening or switching a workspace must complete after the user confirms the
running-board dialog. A hung V2 board stop (end-of-run LLM report) must not
leave the picker frozen.

## Todos

- [x] Time out V2 `stopBoard` in the workspace switch guard; proceed with PUT
      even if stop is still in flight
- [x] Do not dim / `pointer-events: none` the workspace gate until the switch
      is actually proceeding (after confirm)
- [x] Time out the end-of-run report `complete()` so `stopBoard` falls back to
      the mechanical report instead of waiting forever
- [x] Mark the in-app confirm overlay `-webkit-app-region: no-drag` so Electron
      macOS frameless chrome cannot swallow the confirm click
- [x] Persist leftover V1 board `stopped` after confirm
- [x] Tests + `documentation/context.md`

## Why

Workspace switch (cold pick and in-session) calls
`confirmAndStopBoardsForWorkspaceSwitch`. After confirm it `await`s
`POST /api/boards/:id/stop`. That path journals `board.stopped`, ticks, then
`await maybeWriteEndOfRunReport()` which calls the live model with no timeout.

If LM Studio / the bound model never finishes the stream, the switch never
reaches `PUT /api/workspace`. The welcome gate is already
`workspace-gate--opening` (`pointer-events: none`), so the picker also cannot
be used again.

Leftover V1 folders with `status: 'running'` trigger the same copy even though
the V1 engine is gone (MIN-714). Confirm still has to finish the PUT.

## Locked decisions

- Prompt copy stays the same. Users with a live V2 board still confirm stop.
- Stop is best-effort: journal/stop in the background after a short timeout;
  the workspace PUT must not wait on the report writer.
- Mechanical report fallback when `complete()` times out (existing fallback
  path when `complete()` throws).
