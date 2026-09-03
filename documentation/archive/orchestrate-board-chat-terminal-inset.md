# Orchestrate board-chat terminal sits behind the chats rail

## Problem

Opening a board task chat pins `.ob-rail` to `#mainColumn` (`position: absolute; bottom: 0`) so the chats list can sit beside the composer. The composer is measured and inset (`--ob-chat-composer-left` / `--ob-chat-composer-width`). `#terminalPanel` is a `#mainColumn` sibling below the composer and was never inset, so the rail paints over the left side of the dock.

Kanban / hub board views are fine: the rail stays in-flow inside `#chatArea`, so the terminal is a full-width row *below* the shell rather than layered under it.

## Decision

Keep the rail spanning the full column (existing board-chat design). Inset the terminal to `.ob-main` so it aligns with the chat pane, not the padded transcript. Skip the inset while the terminal is maximized (`main-column--terminal-maximized` hides the viewport, so the rail is gone).

## Todos

- [x] Measure `.ob-main` against `#mainColumn` and publish `--ob-chat-terminal-left` / `--ob-chat-terminal-width`
- [x] Apply those vars to `.terminal-panel` while `main-column--board-chat` is set (not maximized)
- [x] Clear the vars on embed close / maximize
- [x] Observe `.ob-main` so rail collapse / column resize re-syncs
- [x] Test: mocked rects set and clear the CSS vars
- [x] Update `documentation/context.md`
