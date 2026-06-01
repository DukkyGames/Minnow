# Workspace image preview (file panel + composer drag)

**Status:** Shipped (2026-05-31)

## Summary

Workspace image files were opened in the file viewer through `read_file` (UTF-8) and shown in CodeMirror as mojibake. Dragging images into the composer resolved to `kind: text` with the same garbage. This fix routes binary images through `GET /api/preview/file/*` (same as the preview browser panel).

## Changes

| Area | Module | Behavior |
|------|--------|----------|
| Path detection | `src/attachments/image-path.ts` | `isImageFilePath`, `mimeTypeForImagePath` |
| File panel | `src/ui/file-viewer.ts` | `mountImagePreviewInViewer`, `openWorkspaceImageInViewer`; `openFileInViewer` branches before `read_file` |
| Composer send | `src/attachments/workspace-ref.ts`, `workspace-image-read.ts` | Images → `kind: image` + `dataUrl`; text unchanged |

## Manual verification

1. `npm start` → click `*.png` in file tree → image preview (not CodeMirror).
2. Drag `*.png` from tree to composer → send → `[image: …]` in history; thumbnail chip when `dataUrl` present.
3. Drag `*.ts` → still text attachment; file-picker images unchanged.

## Out of scope

- Persisting chat image `dataUrl` after reload
- Pre-send thumbnail on pending `workspace` chips
