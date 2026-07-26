# Plan: File viewer recent-files empty state

## Goal

When the file viewer has no open tabs (especially the desktop workspace **Viewer** tab), show a calm recent-files panel in `#fileViewerHost` instead of a blank pane.

## Decisions

- [x] Track workspace files opened via the viewer (not chat attachment virtual paths)
- [x] Persist MRU per workspace root in `filePanel.recentViewerFilesByWorkspace` (max 12)
- [x] Click a row to reopen; per-row remove + Clear recent
- [x] Empty of empties: nudge to open from the Files tab
- [x] Respect `prefers-reduced-motion` for list reveal

## Todos

- [x] Extend `FilePanelState` + normalize/persist helpers
- [x] MRU helpers in `src/state/recent-viewer-files.ts`
- [x] Empty-state UI in `src/ui/file-viewer-recent.ts` + CSS
- [x] Wire record/render into `file-viewer`, desktop Viewer tab, file-tree ops, init
- [x] Unit tests for MRU + normalize
- [x] Update `documentation/context.md`

## Out of scope (follow-ups)

- Keep Code right-split open after closing the last tab solely to show recents
- File-type colored glyphs beyond the shared `fileText` icon
