# Right pane split viewer

Vertical two-slot split inside the Code workspace right column (`#rightPaneColumn`).

Each slot is an **independent editor group**: it owns a tab list and renders that list's
active tab into its own pane. The focused group is what global commands act on.

## UX

- **Split right** (`Ctrl+\` / `Cmd+\` inside either pane), toolbar split icon, unified tab
  **Open to the right** / **Move to other pane**, or dragging a tab onto the other strip
- **Close split** via the secondary pane close control — the second group's tabs merge back
  into the first (nothing is closed)
- **≤640px:** split disabled; existing mobile drawer rules apply
- **Focus ring:** `.right-pane-slot.is-focused` uses `--mn-accent` (no side stripes).
  Clicking or tabbing into a pane focuses that group.

## Ownership rules

These are the invariants the whole feature rests on:

1. **A path lives in exactly one group.** Two CodeMirror views over one `ViewerTabState`
   would fight over the dirty flag and cached buffer, so tabs are *moved*, never duplicated.
2. **Slot content is derived, never assigned.** `rightPaneSplit.primary` / `.secondary` are
   recomputed from `primaryTabs` / `secondaryTabs` on every mutation.
3. **A group never empties by giving up its last tab.** Splitting a lone tab opens the second
   group blank so the next file the user picks lands there.
4. **Each pane renders its own group's active tab.** The global active tab in the tab store
   follows the *focused* group — it is the command target (open / save / close), not a
   render pointer.
5. **Emptying a group collapses the split** (`collapseEmptySlots`), merging the survivor back.

## State (`filePanel.rightPaneSplit`)

Persisted: `enabled`, `ratio` (0.35–0.65), `focusedSlot`, `primaryTabs` / `secondaryTabs`
(viewer paths, preview ids, per-surface active id), and the derived `primary` / `secondary`
slot content. When `enabled`, `rightPaneMode` is `split`.

## Preview instances

| Slot | Electron `instanceId` |
|------|------------------------|
| Primary browser | `workspace-preview` |
| Secondary browser | `workspace-preview-secondary` |

Every `preview.tabs.*` call must pass the slot's instance id — the default instance is the
primary pane's, so an unqualified `tabs.activate` switches the *left* pane.

## Code map

- [`src/ui/right-pane-slot-tabs.ts`](../../src/ui/right-pane-slot-tabs.ts) — ownership model
  (register / move / unregister / merge / reconcile); the source of truth
- [`src/ui/right-pane-split.ts`](../../src/ui/right-pane-split.ts) — orchestration, focus,
  enable/close, DOM sync
- [`src/ui/right-pane-split-resize.ts`](../../src/ui/right-pane-split-resize.ts) — drag resizer
- [`src/ui/file-viewer.ts`](../../src/ui/file-viewer.ts) — primary group (full editor: AI,
  Intent, LSP, quick edit). `renderActiveViewerTab()` paints `primaryTabs.activeViewerPath`
- [`src/ui/file-viewer-secondary-slot.ts`](../../src/ui/file-viewer-secondary-slot.ts) —
  secondary group (plain CodeMirror + `Ctrl+S`, plus the read-only preview modes)
- [`src/ui/preview-secondary-slot.ts`](../../src/ui/preview-secondary-slot.ts) — secondary
  preview guest + `bindSecondaryPreviewControls()`
- [`src/ui/unified-right-tabs.ts`](../../src/ui/unified-right-tabs.ts) — per-group tab strips,
  cross-group drag and drop

Saving is path-addressed (`saveViewerTabByPath`): both editors snapshot their live buffer into
the shared tab state first, so the right pane's text can never be written to the left pane's file.

## Desktop workspace drawer

The desktop workspace rail reparents **only** `#fileViewerPane` and `#previewPane` (plus the
file tree) into drawer hosts — not the full `#rightPaneSplit` wrapper
([`src/os/desktop-workspace-mounts.ts`](../../src/os/desktop-workspace-mounts.ts)).

**v1 behavior**

- Right-pane split is **Code-only**. When hosting moves to the desktop drawer, any active
  split is closed via `closeRightPaneSplit()` (tabs merge into the primary group).
- `isRightPaneSplitActive()` is false on the desktop surface; split entry points no-op while
  desktop hosting is active.
- Restore after a desktop round-trip uses each pane's **actual** Code parent (e.g.
  `#rightPaneSlotPrimary`). `repairRightPaneDomStructure()` also moves stray primary panes back.

**Phase 2 (not implemented)**

- Reparent the entire `#rightPaneSplit` subtree into the drawer for true split-in-desktop.

## Manual test plan

1. File + file: split right, edit both sides, dirty close prompts, `Ctrl+S` in each pane
2. Open a file from the tree with the right pane focused — it appears **only** on the right
3. Click a left-pane tab while the right pane is focused — focus and render stay on the left
4. Drag a tab between strips (including onto an empty strip)
5. File + browser split, resize, live reload; two URLs in split preview slots (Electron)
6. Close the split — the right group's tabs are still open in the merged strip
7. Reload persistence of ratio, group membership, and active tab per group
8. `browser_navigate` with split focuses the correct instance
