# MIN-592 — File tree folder drag-and-drop

## Problem

The Code file tree already accepts OS file drops (`import_workspace_file`) and highlights folder rows while dragging. Dropping a **folder** from Explorer / Finder is rejected with “folders are not supported yet.” `dataTransfer.files` only exposes the folder as a zero-byte `File`, so nested contents never reach the importer.

## Approach

1. On `drop`, synchronously call `DataTransferItem.webkitGetAsEntry()` (must happen before any `await` or Chromium returns `null`).
2. Recursively walk `FileSystemDirectoryEntry` (`readEntries` until an empty batch).
3. Import files with nested workspace-relative paths through existing `import_workspace_file` (server already `mkdir -p` parents).
4. Import empty directories with `import_workspace_file` `{ kind: 'dir' }` so empty folders are preserved without going through the LLM `make_directory` permission/plan-mode path.
5. Fallback: if the entries API is missing, import flat files; if the drop is only unreadable folders, show an actionable error (not “not supported yet”).

## Todos

- [x] Plan this change
- [x] `src/attachments/directory-drop.ts` — capture roots, expand tree, sanitize paths, cap size
- [x] `src/ui/import-external-files.ts` — nested relative paths + empty dirs
- [x] `server/runtime/tools-middleware.js` — `kind: 'dir'` on `import_workspace_file`
- [x] `src/ui/file-tree-dnd.ts` — use the collector; drop the folder rejection
- [x] Tests: directory walk, path sanitization, import dest paths, server dir import
- [x] Docs: `documentation/context.md`, `documentation/manual/apps/code.md`, wiki catalog

## Out of scope

- Composer attachments of folders (chat chips, not the file tree)
- Bulk/multipart import API (N files still mean N `import_workspace_file` calls)
- Native Electron `webUtils.getPathForFile` copy (faster for huge trees; follow-up)

## Verification

- Unit tests for `webkitGetAsEntry` walk, batched `readEntries`, `..` rejection, file-list fallback
- Server test: nested file write + empty directory via `import_workspace_file`
- Dropping a folder onto a tree folder copies the folder (name + contents) into that destination
