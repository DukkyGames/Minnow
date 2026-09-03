# MIN-606 — Models runtime log cutoff at bottom

## Problem

On **Models → Local Server**, the runtime log’s last lines are clipped at the bottom of the window. Follow-output is already at the end of the log, so scrolling further does nothing.

## Root cause

1. **Page is taller than the OS stage.** `.models-page` used `height: 100vh`. Under MinnowOS the app layer is the stage *below* the menubar (`#osAppsLayer`, `inset: 0` on `.mn-os-stage`). `100vh` + `overflow: hidden` on the shell clips the bottom of the page — exactly the log. Brain already fills `height: 100%` and is listed in the `#osAppsLayer … is-open` rule; Models was not.
2. **Log pane cannot shrink below its content.** `.models-logs` is `flex: 1` with `min-height: 14rem` and no `overflow: hidden`. Flex items default to `min-height: auto` (content size) unless overridden to `0`. The `<pre>` then grows with every line instead of becoming the scrollport, so the last lines paint past the visible stage.

## Plan

- [x] Fill the OS stage: `.models-page` `height: 100%` / `min-height: 0` / `overflow: hidden`; `100vh` only when `html:not(.minnow-os-enabled)` (same contract as Brain).
- [x] Include `.models-page.is-open` in the `#osAppsLayer` height override in `minnowos-shell.css`.
- [x] Make `.models-logs` a nested flex pane (`min-height: 0`, `overflow: hidden`) so `.models-logs__body` is the only scrollport.
- [x] Contract tests in `test/os/models-app.test.mts`; note the layout in `documentation/context.md`.

## Verification

- Contract tests: Models CSS uses `height: 100%`, OS fallback, shell selector, log pane `min-height: 0`.
- Manual: Local Server with a long log — last line fully visible when scrolled to bottom; inner log scrollbar moves.
