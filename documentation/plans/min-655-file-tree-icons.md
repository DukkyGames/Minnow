# MIN-655 — Improve File Tree icons

## Problem

Switching the left pane to Source Control changes the header chrome (refresh drops out of the action cluster; the Files control becomes a collapse chevron). Users lose their place: it feels like the chrome changed instead of the pane. The Files control also reuses a document glyph (`fi-rr-document`) rather than a file-tree icon.

## Goal

Keep the **same pane buttons** (Files, Browser, Source Control) in one cluster. Highlight which left pane is active. Use a dedicated **file-tree** icon for Files.

## Todos

- [x] Add `fileTree` → `fi-rr-folder-tree` to the icon registry; point `ICON_FILE_TREE` at it
- [x] Reorder header: refresh outside the pane cluster; cluster = Files | Browser | Source Control
- [x] Always render the file-tree glyph on the Files button (no chevron swap)
- [x] Highlight Files when the files view is showing; Browser and Source Control keep existing active styles
- [x] Files click while Source Control is open switches back to the file tree (does not collapse)
- [x] Tests for icon, stable cluster, and Files↔Source Control switching
- [x] Update `documentation/context.md`
- [x] Browser verify in the running app

## Non-goals

- Full VS Code-style activity bar redesign beyond this chrome fix
- Changing Source Control Center (“Open full view”) behavior
