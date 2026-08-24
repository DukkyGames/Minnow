---
name: fix-file-tree-drag-drop-move
overview: Fix the file-tree drag-and-drop so that dropping a file or folder onto a folder moves it into that folder immediately (no confirmation dialog).
todos:
  - id: fix-drop-source
    status: pending
  - id: immediate-move
    status: pending
isProject: true
---

# Fix file-tree drag-and-drop move

## Context

**Bug:** Dragging a file (or folder) onto a folder in the file tree performs no action — no move, no dialog, no error.

**Diagnosis (confirmed with user):**
- While dragging a file over a folder, the folder row **does** highlight as a drop target.
- On drop, **nothing** happens — no "Move file?" dialog, no move, no error.
- Other file-tree operations (create / rename / delete via the row menu) work fine, so the local tool server is available and `getLocalServerAvailable()` is true.

**Root cause (hypothesis — confirm via the regression test in Task 1):**
The drop-target highlight is driven by the `dragover` handler in `bindHost` (`src/ui/file-tree-dnd.ts:147`), which resolves the drag source from the module-level `activeDragSourcePath` (set on `dragstart`, `src/ui/file-tree-dnd.ts:140-145`). That value is populated — which is why the highlight appears and `dragover` calls `preventDefault()` (so the browser does deliver the `drop` event).

However, the `drop` handler (`src/ui/file-tree-dnd.ts:200-221`) delegates to `handleTreeDrop` (`src/ui/file-tree-dnd.ts:67-103`), which resolves the source a *different* way: `pathFromDataTransfer(event.dataTransfer)` (`src/ui/file-tree-dnd.ts:36-42`), i.e. `getData(WORKSPACE_FILE_MIME)` / `getData('text/plain')`. When that read comes back empty at drop time, `handleTreeDrop` bails at its `if (!source || !destDir) return;` guard (`src/ui/file-tree-dnd.ts:76`) — before the confirm dialog and before `movePath`. Net effect: the highlight proves the drag is valid, but the drop is a silent no-op. Exactly the reported symptom.

The two handlers disagree about where the source comes from. The fix makes the drop path use the same proven-good source (`activeDragSourcePath`) the highlight already relies on, with the DataTransfer read as a fallback. (`activeDragSourcePath` is still set at drop time: `drop` fires before `dragend`, and only `dragend` clears it — `src/ui/file-tree-dnd.ts:223-226`.)

**Requested behavior (from user):**
- Move **immediately** on drop — remove the "Move file?" confirmation dialog from the DnD path.
- Support moving **both files and folders** (drag a folder onto another folder).

## Key Files

| File | Role |
|------|------|
| `src/ui/file-tree-dnd.ts` | DnD module. `bindHost` wires `dragstart`/`dragover`/`drop`/`dragend` on `#fileTreeHost`; `handleTreeDrop` performs the move; `activeDragSourcePath` is the dragstart-captured source; `pathFromDataTransfer` reads the DataTransfer; `sourceKindFromRow` feeds the confirm dialog. **Primary fix location.** |
| `src/ui/file-tree.ts` | `wireTreeRowDrag` (`src/ui/file-tree.ts:478-500`) sets `row.draggable` and `setData(WORKSPACE_FILE_MIME, …)` / `text/plain` on `dragstart`. Rows carry `data-path` / `data-entry-kind` (`src/ui/file-tree.ts:515-516`) and classes `file-tree-row--dir` / `--file` (`src/ui/file-tree.ts:585,644`). Expected: **no change**. |
| `src/ui/file-tree-path.ts` | `computeMoveDestination` (pure; already unit-tested). No change. |
| `src/ui/file-tree-ops.ts` | `movePath` (`src/ui/file-tree-ops.ts:233`) executes the `move_file` tool. No change. |
| `src/ui/file-tree-move-dialog.ts` | `showMoveConfirmDialog` (in-app confirm banner). Stopped from being called by the DnD path; module stays in the tree. |
| `test/file/file-tree-dnd.test.mjs` | Existing DnD test — only the `computeMoveDestination` matrix. Extend with a drop regression test. |

## Waves

- **Wave 1** — `fix-drop-source` (core bug fix).
- **Wave 2** — `immediate-move` (depends on `fix-drop-source`).

## Tasks

### Task 1 — `fix-drop-source`: make the drop resolve the source the same way the highlight does
**Depends on:** (none)

**Build**
- In `handleTreeDrop` (`src/ui/file-tree-dnd.ts:67`), change the source resolution from
  `const source = pathFromDataTransfer(dataTransfer);`
  to prefer the dragstart-captured value, with the DataTransfer read as fallback:
  `const source = activeDragSourcePath?.trim() || (dataTransfer ? pathFromDataTransfer(dataTransfer) : null) || '';`
- Keep the `if (!source || !destDir) return;` guard and the `computeMoveDestination` cycle guard (`src/ui/file-tree-dnd.ts:78-85`) intact.
- Do not touch `bindHost`'s `dragover`/`drop` wiring or `src/ui/file-tree.ts`.

**Test**
- Add a regression test (new `test/file/file-tree-dnd-drop.test.mts`, happy-dom harness + `--experimental-test-module-mocks` to stub `movePath` from `src/ui/file-tree-ops.ts`) that: builds a `#fileTreeHost` containing a file row and a folder row (with `data-path` / `data-entry-kind` / the `--dir` / `--file` classes), calls `initFileTreeDnD()`, dispatches `dragstart` on the file row, then dispatches `drop` on the folder row, and asserts `movePath` is called with the file path and the folder-joined destination.
- Command: `npm test` (auto-discovered via `test/run-all.mjs`); assertion: the new drop test passes and the existing `computeMoveDestination` matrix still passes.

**Accept:** Dropping a file on a folder triggers `movePath` — the drop is no longer a silent no-op.

### Task 2 — `immediate-move`: move immediately and cover folders
**Depends on:** `fix-drop-source`

**Build**
- In `handleTreeDrop` (`src/ui/file-tree-dnd.ts:87-92`), remove the `showMoveConfirmDialog(…)` call and its `if (!confirmed) return;` guard so the move runs immediately on drop.
- Remove the now-unused `sourceKindFromRow` helper (`src/ui/file-tree-dnd.ts:57-65`) and the `showMoveConfirmDialog` import (`src/ui/file-tree-dnd.ts:13`) from `file-tree-dnd.ts`. Keep `src/ui/file-tree-move-dialog.ts` in the tree; verify nothing else in `file-tree-dnd.ts` references the dialog.
- Confirm the drop path imposes no file/folder kind restriction, so a folder dropped on another folder also moves (verify `movePath(source, destination, 'move')` is reached for a `data-entry-kind="dir"` source).

**Test**
- Extend the drop regression test with: (a) an assertion that `movePath` is called directly with no confirm-dialog step in between, and (b) a folder-onto-folder case asserting `movePath` is called with the folder path and destination.
- Command: `npm test`; assertion: both new cases pass.

**Accept:** Dropping a file **or** a folder on a folder moves it immediately, with no confirmation prompt.

## Verification Checklist
- [ ] Dragging a file over a folder still shows the drop-target highlight.
- [ ] Dropping a file on a folder moves it into that folder immediately (no dialog).
- [ ] Dropping a folder on another folder moves it.
- [ ] Dropping a folder into itself / its own subfolder shows the "Cannot move a folder into itself or its subfolder." status (no crash, no move).
- [ ] Dropping on the host background (non-folder area) is a no-op.
- [ ] `test/file/file-tree-dnd*.test.*` pass under the test runner.
- [ ] `npx tsc --noEmit` passes (no unused-import / dead-code errors after removing the dialog call).
