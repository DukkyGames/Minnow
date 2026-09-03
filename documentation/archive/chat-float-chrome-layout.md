# Chat float chrome: jump chip + code-change strip

## Problem

When **Jump to latest** and the **Code changes** strip are both visible, they occupy the same bottom-center slot of `.chat-viewport`. The jump chip is lifted with a hardcoded `+ 38px` offset that does not track the strip’s real height. In a narrow chat column (split editor), the strip button shrinks (`flex-shrink: 1`) and **Code changes** / **1 file** wrap onto two lines, making the strip taller and overlapping the chip.

## Todos

- [x] Stack jump + strip in one `.chat-viewport-dock` (flex column, 8px gap)
- [x] Keep strip copy on one line (`nowrap`, no shrink)
- [x] Unify strip + Commit + Create PR into one instrument (not three competing pills)
- [x] Hide the “Code changes” label when the dock is narrow (container query)
- [x] Collapse the jump chip with `display: none` inside the dock so it does not reserve space
- [x] Tests + `documentation/context.md`

## Layout

```
.chat-viewport-dock          /* absolute, bottom-center, column, 8px gap */
  #chatJumpLatest            /* in-flow; display:none when .hidden */
  .code-change-strip-wrap    /* in-flow; [hidden] when idle */
    .code-change-panel       /* absolute, opens upward over the dock */
    .code-change-strip-row   /* one surface: stats | Commit | Create PR | undo */
```

Chat-app jump (`#chatAppJumpLatest`) stays absolutely positioned; it has no code-change strip.
