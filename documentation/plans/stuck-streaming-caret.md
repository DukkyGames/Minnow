# Stuck streaming caret

## Problem

The live assistant reply can show an extra blinking caret (the streaming cursor) during a response, and the same caret can remain after the model finishes.

Reproduced from a live assistant row:

- `.msg.assistant` with `data-stream-phase="prose"` and `aria-busy="true"`
- Height ~49px when the row is revealed but the bubble still only holds the caret

## Why

The caret is a real DOM node (`.cursor.cursor--prose`), not a CSS `::after`. It leaks in three ways:

1. **Generic CSS.** `.cursor` is styled as the streaming caret. Markdown HTML that happens to use `class="cursor"` becomes a second blinking bar that survives the final render.
2. **Late paint.** Cancelling the streaming debounce clears timers but leaves `pendingCursor`. A flush after `cursor.remove()` re-appends the caret onto a finished bubble.
3. **Stale live rows.** `removeStaleLiveStreamingRows` only drops `.msg--awaiting-prose`. A revealed in-flight row (prose phase, caret still attached) stays when a remount or next tool-loop round inserts a new shell. `streamCompletionTurn` also captures `bubble`/`cursor` at turn start, so remounts keep painting the old node.

## Approach

- Style only `.cursor--prose`.
- Sweep leftover `.cursor--prose` nodes on incremental paints, final renders, debounce cancel, and stream end.
- Treat any assistant row that still holds a streaming caret as a stale live shell.
- Read live `bubble`/`cursor` during the turn and replay `livePartialText` onto a remounted row.
- Do not create a remount shell when no owner is registered (orphan caret).

## Todos

- [x] Diagnose caret ownership (DOM node vs CSS, remount, debounce)
- [x] Scope caret CSS to `.cursor--prose`
- [x] Renderer: sweep carets, clear pending cursor on cancel, finish helper
- [x] Drop stale live rows that still contain a streaming caret
- [x] Tool loop: live stream DOM + remount replay
- [x] Tests for sweep, stale-row cleanup, debounce cancel
- [x] Update `documentation/context.md`
