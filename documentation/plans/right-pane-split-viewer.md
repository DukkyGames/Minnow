# Right pane split viewer

Vertical two-slot split inside the Code workspace right column (`#rightPaneColumn`).

## UX

- **Split right** (`Ctrl+\` / `Cmd+\` with viewer focused), toolbar split icon, unified tab **Open to the right**
- **Close split** via secondary pane close control (merges layout back to single slot)
- **≤640px:** split disabled; existing mobile drawer rules apply
- **Focus ring:** `.right-pane-slot.is-focused` uses `--mn-accent` border (no side stripes)

## State (`filePanel.rightPaneSplit`)

Persisted fields: `enabled`, `ratio` (0.35–0.65), `focusedSlot`, `primary` / `secondary` slot content (`none` | `viewer` + path | `preview` + tab id). When `enabled`, `rightPaneMode` is `split`.

## Preview instances

| Slot | Electron `instanceId` |
|------|------------------------|
| Primary browser | `workspace-preview` |
| Secondary browser | `workspace-preview-secondary` |

## Code map

- [`src/ui/right-pane-split.ts`](../../src/ui/right-pane-split.ts) — orchestration
- [`src/ui/right-pane-split-resize.ts`](../../src/ui/right-pane-split-resize.ts) — drag resizer
- [`src/ui/file-viewer-secondary-slot.ts`](../../src/ui/file-viewer-secondary-slot.ts) — secondary CodeMirror
- [`src/ui/preview-secondary-slot.ts`](../../src/ui/preview-secondary-slot.ts) — secondary preview guest + `bindSecondaryPreviewControls()` (header back/forward/reload/Go; Electron uses `workspace-preview-secondary` + tab id; iframe uses secondary frame history/src)

## Desktop workspace drawer

The desktop workspace rail reparents **only** `#fileViewerPane` and `#previewPane` (plus the file tree) into drawer hosts — not the full `#rightPaneSplit` wrapper ([`src/os/desktop-workspace-mounts.ts`](../../src/os/desktop-workspace-mounts.ts)).

**v1 behavior**

- Right-pane split is **Code-only**. When hosting moves to the desktop drawer, any active split is closed via `closeRightPaneSplit()` (primary slot content is kept; secondary is merged away in state).
- `isRightPaneSplitActive()` is false on the desktop surface; split entry points (`enableRightPaneSplit`, **Open to the right**) no-op while desktop hosting is active.
- Restore after desktop round-trip uses each pane’s **actual** Code parent (e.g. `#rightPaneSlotPrimary`) so split DOM is not flattened onto `#rightPaneColumn`. `repairRightPaneDomStructure()` also moves stray primary panes back into `#rightPaneSlotPrimary`.

**Phase 2 (not implemented)**

- Reparent the entire `#rightPaneSplit` subtree into the drawer for true split-in-desktop, or a dedicated single-pane policy with persisted secondary slot.

## Manual test plan

1. File + file: split right, edit both sides, dirty close prompts
2. File + browser: viewer + preview in split, resize, live reload
3. Two URLs in split preview slots (Electron)
4. Reload persistence of ratio and slot content
5. `browser_navigate` with split focuses correct instance
