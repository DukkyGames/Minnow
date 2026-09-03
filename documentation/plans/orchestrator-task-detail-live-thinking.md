# Board task detail during live thinking

**Status:** implemented  
**Date:** 2026-09-03

## Goal

Task detail must open while an agent is thinking, and an already-open overlay must not flicker chats or restart animations when thoughts stream (including when Thoughts is collapsed).

## Cause

Every coalesced `{ type: 'thinking' }` SSE frame called `emit()` → `paintBoard()` → `replaceChildren` on the kanban and a full remount of `.ov2-detail-overlay`. Card `click` never fired (mousedown/mouseup hit different nodes). Remounting the thread restarted `.tool-call-msg` `fadeUp`, tool spinners, and `.thoughts-caret--pulse`.

## Approach

- Journal/snapshot/error still `subscribe()` → `paintBoard()`.
- Thinking/tool frames `subscribeLive()` → rAF `patchLiveUi()` (in-place card activity + live tail).
- Overlay with the same `data-task-id` is reused on journal paints.
- Transcript poll skips a full paint when only thinking text grew (`transcriptStructureKey`).

## Todos

- [x] Split board client `subscribe` vs `subscribeLive` so thinking/tool SSE does not notify `paintBoard`
- [x] Add in-place card activity sync and wire boards-view live subscriber via rAF
- [x] Reuse overlay + mutate transcript live tail; skip full paint on thinking-only transcript polls
- [x] Cover live-bus isolation, stable card node/click, and stable collapsed Thoughts toggle
- [x] Update `documentation/context.md`
