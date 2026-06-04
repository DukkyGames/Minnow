# File viewer tabs

## Status

Implemented (v1): multi-tab strip, per-tab in-memory state, persistence via `filePanel.openViewerTabs` / `activeViewerTab`, ephemeral attachment tabs, focus-existing on re-open.

## Checklist

- [x] Extend `FilePanelState` with `openViewerTabs` + `activeViewerTab`; normalize/save/load; sync `selectedPath`
- [x] `src/ui/file-viewer-tab-store.ts` — tab model + serialize/restore
- [x] Refactor `src/ui/file-viewer.ts` — single active editor mount, snapshot on switch
- [x] `src/ui/file-viewer-tabs.ts` + `index.html` tablist + `file-panel.css`
- [x] `init-file-panel.ts` boot restore; `file-tree-ops.ts` delete/rename/move; preview dismiss; workspace switch clear
- [x] Tests: `test/file/file-viewer-tab-store.test.mts`, extended `test/state/file-panel-preview.test.mts`
- [x] `documentation/context.md` File panel section

## Out of scope (follow-ups)

- Duplicate tab for same path
- Tab drag-reorder
- Close others / Close saved context menu
- Per-tab scroll/cursor restoration
- Split editor (two visible tabs)

## Manual test plan

1. Open 3 workspace files → 3 tabs; switch without losing edits; dirty dot on correct tab only.
2. Restart app (`npm start`) → same tabs restored; active tab focused.
3. Re-click same tree file → focuses tab, no duplicate.
4. Rename/delete open file → tab path updates or tab closes.
5. Open chat attachment → tab appears; not restored after reload.
6. Switch to preview pane with dirty tab → confirm; preview works.
7. Narrow/mobile width → tab strip scrolls; touch targets usable.
