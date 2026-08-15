# Capability matrix — cell click opens transcript panel

**Status:** Complete  
**Plan path:** `documentation/plans/capability-matrix-cell-panel.md`

## Goal

Clicking a capability-matrix cell opens the probe transcript side panel immediately. The bottom cell-editor strip is removed; its verdict / note / save controls live in that panel.

## Todos

- [x] Extra slot + `onClose` on the shared transcript drawer
- [x] Embed the cell editor in that slot (no duplicate transcript / close buttons)
- [x] Grid click (and Enter) opens the panel; drop the bottom editor host
- [x] Untested cells still open the panel with an empty transcript + editor
- [x] Selected-cell state on the open grid cell
- [x] Tests + `documentation/context.md`

## Locked decisions

- **One click, one panel.** Cell click and Enter open the side panel. Alt+Enter is the same action (no second path).
- **Always open.** Cells with no probe data still open the panel so manual verdicts stay reachable after the bottom strip is gone.
- **Editor is pinned under the transcript**, not inside the scroll, so Save stays in reach while reading.
- **Bench is unchanged.** The extra slot is optional; Bench test cards keep a read-only drawer.
- **No modal.** The existing right-edge drawer is the surface.

## Scene

A developer at a desk, Settings → Advanced → Capability matrix open beside a roster of local models, scanning glyphs and wanting the probe conversation for one cell without a detour through a strip under the grid.

## Color / motion

Restrained. Existing `--mn-*` tokens. No new palette. Drawer open/close stays instant (Escape / backdrop), matching the current Bench drawer.
