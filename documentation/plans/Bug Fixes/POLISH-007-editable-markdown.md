---
name: POLISH-007 — Editable markdown in file editor
overview: Make `.md` / `.markdown` open in the existing CodeMirror editor by default (editable, saveable) while keeping GFM preview as an optional toggle; align menus, chrome, tests, and docs with that priority.
source: documentation/bug-hunt-session-2026-05-24.md (POLISH-007)
related:
  - documentation/bug-hunt-session-2026-05-24.md
  - documentation/context.md (File panel / Viewer)
  - BUG-013 (syntax highlighting in file editor)
  - POLISH-006 (AI autocomplete in editor)
  - POLISH-008 (selection → Add to chat)
todos:
  - id: product-default
    content: Confirm default open mode — editable CodeMirror vs preview; whether preference should persist in filePanel config
    status: completed
  - id: flip-open-default
    content: Change markdown open default so tree click / Open uses CodeMirror unless explicitly preview (invert shouldUseMarkdownPreview or replace with asPreview flag)
    status: pending
  - id: menu-labels
    content: Rename file-tree and viewer context items — e.g. Open (editor), Open as preview; drop redundant Open as code when editor is default
    status: pending
  - id: viewer-chrome-toggle
    content: Optional toolbar control in file-viewer header — Preview / Source toggle for markdown (alongside Save)
    status: pending
  - id: verify-editor-affordances
    content: Verify typing, clipboard, undo/redo (CM history), Tab indent, Mod-s save, dirty marker, large-file read-only banner in markdown code path
    status: pending
  - id: optional-find
    content: Optional — add @codemirror/search panel + Mod-f keymap to file viewer (parity with IDE find; not blocking if deferred)
    status: pending
  - id: attachment-preview-unchanged
    content: Keep openAttachmentSnapshotInViewer markdown on read-only preview path (not project files)
    status: pending
  - id: unit-tests
    content: Update test/file/file-viewer-save.test.mjs expectations for new default; add tests for asPreview if API renamed
    status: pending
  - id: manual-qa
    content: Manual QA — open README.md from tree, edit, save, toggle preview, unsaved guard when switching modes/files
    status: pending
  - id: docs-context
    content: Update documentation/context.md Viewer row and bug-hunt POLISH-007 status when shipped
    status: pending
isProject: false
---

# POLISH-007 — Editable markdown in file editor

**Tracker:** [documentation/bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) — POLISH-007  
**Type:** Feature / polish (not a defect)  
**Area:** File panel — viewer (`src/ui/file-viewer.ts`, `src/ui/file-markdown-path.ts`, `src/ui/file-tree-context-menu.ts`)  
**Status:** Approved → Linear [MIN-68](https://linear.app/minnowai/issue/MIN-68/polish-007-editable-markdown) (verified 2026-05-24 — not implemented in codebase)

**Verification (2026-05-24):** Plan matches code. Preview remains default (`shouldUseMarkdownPreview` → true for `.md`); tree **Open as code**; tests assert preview-first. Editor/save/preview-toggle infrastructure present. Attachment snapshots correctly preview-only.

---

## Summary

Users expect **`.md` files to open editable** in the file panel with normal text-editor behavior (type, undo, save). Today Minnow opens markdown as a **read-only GFM preview** by default; editing requires an extra step (**Open as code** in the tree or **Open as code** in the viewer context menu). The CodeMirror path, `save_file`, dirty state, and preview toggle **already exist** — POLISH-007 is primarily a **product-default and discoverability** change, plus small UX and test alignment.

---

## Problem statement

| | |
|---|---|
| **Expected** | Clicking a `.md` file opens an **editable** buffer; Save (button + Ctrl/Cmd+S) persists to disk; preview is optional. |
| **Actual** | Default path is `mountMarkdownPreview()` — rendered HTML via `setAssistantBubbleContent`, no `editorView`, Save disabled. |
| **Impact** | Documentation and plans feel “view only”; extra clicks to reach the editor; POLISH-008 (Add to chat from selection) only applies meaningfully in code mode. |

---

## Current state (codebase)

### Dual paths in `src/ui/file-viewer.ts`

| Mode | Trigger | UI | Save |
|------|---------|-----|------|
| **Preview** | `shouldUseMarkdownPreview(path)` → true (default for `.md`) | `.file-viewer-markdown-preview` + GFM renderer | No (`editorView` null) |
| **Editor** | `openFileInViewer(path, { asCode: true })` or `switchMarkdownViewerToCode()` | CodeMirror 6 + `@codemirror/lang-markdown` | Yes via `save_file` when dirty |

Helper:

```ts
// shouldUseMarkdownPreview: true when markdown AND NOT asCode
export function shouldUseMarkdownPreview(path: string, asCode?: boolean): boolean {
  return isMarkdownFilePath(path) && !asCode;
}
```

### Entry points

| Action | Behavior today |
|--------|----------------|
| File tree **click** | `openFileInViewer(fullPath)` — **preview** for markdown |
| Tree context **Open** | Same (preview) |
| Tree context **Open as code** | `openFileInViewer(path, { asCode: true })` — editor |
| Viewer **context menu** | **Open as code** / **Open as preview** toggle |
| `switchMarkdownViewerToPreview()` | Confirms if dirty; discards unsaved preview switch risk |

### Editor affordances (already on code path)

- **Typing / selection / clipboard:** CodeMirror defaults.
- **Undo / redo:** CodeMirror `history` (standard keybindings unless overridden).
- **Indent:** `fileEditorKeymapExtensions()` — Tab / Shift+Tab, 2-space `indentUnit`.
- **Save:** `saveCurrentFile()` → `executeTool('save_file', { path, content })`; dirty ● in path label.
- **LSP:** Optional completions when LSP enabled (`file-editor-extensions.ts`).
- **Large files (>512 KB):** `read_file_range` excerpt + read-only banner in **both** preview and editor.

### Styles

- `src/styles/file-panel.css` — full-width markdown preview; overrides chat bubble max-width for viewer pane.
- `src/styles/global.css` — shared preview class hooks.

### Tests

- `test/file/file-viewer-save.test.mjs` asserts `shouldUseMarkdownPreview('README.md') === true` (documents preview-default).

### Intentionally different: attachment snapshots

- `openAttachmentSnapshotInViewer` opens markdown attachments as **read-only preview** with a banner — should **stay** preview-only (not project paths).

---

## Desired behavior (from bug hunt)

1. **Open `.md` in an editable buffer** (not preview-only by default).
2. **Basic editing:** typing, select/copy/paste, undo/redo, save to disk.
3. **Find:** optional (nice-to-have; not in file viewer today).
4. **Preview:** optional toggle or split; **editing is priority** for this item.

---

## Proposed solution

### Phase 1 — Default to editable (required)

**Goal:** One click from the file tree opens CodeMirror for `.md` / `.markdown`.

1. **Invert open default**
   - Option A (minimal): Change `shouldUseMarkdownPreview` so it returns `false` unless `options?.asPreview === true` (rename `asCode` → `asPreview` for clarity).
   - Option B: Remove preview from default `openFileInViewer` branch; only call `mountMarkdownPreview` when `asPreview` is set.

2. **Update callers**
   - `src/ui/file-tree.ts` — click / open unchanged (gets editor by default).
   - `src/ui/file-tree-context-menu.ts` — swap menu items:
     - **Open** → editor (default).
     - **Open as preview** → `openFileInViewer(path, { asPreview: true })` (replaces **Open as code**).
   - `orchestrate-board.ts`, `bug-board.ts`, `init-file-panel.ts` — no change unless they relied on preview-first for plans (confirm product intent for `*.md` plan files).

3. **Viewer context menu** (`bindFileViewerContextMenu`)
   - When in editor: **Open as preview**.
   - When in preview: **Open as editor** (rename from **Open as code**).

4. **Tests**
   - Flip `shouldUseMarkdownPreview` / rename tests in `file-viewer-save.test.mjs`.

### Phase 2 — Discoverability (recommended)

**Goal:** Users can switch modes without hunting the context menu.

1. **Header toggle** (`index.html` `#fileViewerPane` toolbar)
   - Segmented control or icon button: **Source** | **Preview**, visible only when `isMarkdownFilePath(currentPath)`.
   - Wire to `switchMarkdownViewerToCode` / `switchMarkdownViewerToPreview` (reuse unsaved confirm on preview switch).

2. **Optional persisted preference** (`src/state/file-panel.ts` + `config.json` `filePanel`)
   - e.g. `markdownOpenMode: 'editor' | 'preview'` — only if product wants preview-first for some users; default **`editor`**.

### Phase 3 — Optional enhancements (out of core POLISH-007 unless scoped)

| Item | Notes |
|------|--------|
| **Find in file** | Add `@codemirror/search` (`search`, `searchKeymap`, `highlightSelectionMatches`) to `mountEditor` extensions — not present repo-wide today. |
| **Side-by-side split** | Source + live preview pane — larger layout work (`file-layout.ts`, CSS). Defer unless explicitly requested. |
| **WYSIWYG markdown** | Out of scope — stay on CodeMirror source editing. |
| **BUG-013 highlighting** | Separate; markdown mode may still look “plain” until highlighting fix lands. |
| **POLISH-006 autocomplete** | Separate feature. |

---

## Acceptance criteria

- [ ] **File tree:** Single click on `*.md` / `*.markdown` opens **CodeMirror** with file content loaded from `read_file`.
- [ ] **Edit:** User can type, undo/redo, cut/copy/paste; dirty ● appears when content differs from last saved/loaded baseline.
- [ ] **Save:** Save button enables when dirty; Ctrl/Cmd+S persists via `save_file`; tree refresh after save (existing bridge).
- [ ] **Preview:** User can switch to GFM preview (context menu and/or toolbar); switching back to editor preserves content; unsaved guard when leaving editor for preview without saving.
- [ ] **Menus:** Tree and viewer labels reflect new defaults (**Open as preview**, not **Open as code** as the primary alternate).
- [ ] **Attachments:** Chat attachment markdown snapshots remain read-only preview with banner (no regression).
- [ ] **Large markdown files:** Still read-only excerpt with banner in editor (unchanged policy).
- [ ] **Tests:** Unit tests reflect new default; `npm test` / `npx tsc --noEmit` clean for touched files.
- [ ] **Docs:** `documentation/context.md` Viewer bullet updated; bug-hunt POLISH-007 marked resolved when shipped.

---

## Implementation checklist (files)

| File | Change |
|------|--------|
| `src/ui/file-viewer.ts` | Default branch → `mountEditor` for markdown; rename option flag; export helpers if needed |
| `src/ui/file-markdown-path.ts` | Comments only unless logic moves here |
| `src/ui/file-tree-context-menu.ts` | Menu labels and `asPreview` / default open |
| `index.html` | Optional preview/source toggle in viewer chrome |
| `src/ui/init-file-panel.ts` | Bind toggle if added |
| `src/styles/file-panel.css` | Toolbar toggle styles if added |
| `test/file/file-viewer-save.test.mjs` | Default expectation + optional `asPreview` tests |
| `documentation/context.md` | Viewer behavior description |
| `documentation/bug-hunt-session-2026-05-24.md` | POLISH-007 status when done |

**Not required for minimal POLISH-007:** `src/markdown/renderer.ts`, tool server, `save_file` implementation.

---

## Testing strategy

| Layer | Action |
|-------|--------|
| **Unit** | Update `shouldUseMarkdownPreview` (or successor) tests; static helpers unchanged |
| **Manual** | `npm start` → open `documentation/context.md` or any `.md` → edit line → Save → reload file → toggle preview |
| **Manual edge** | Dirty file → switch to preview (confirm dialog) → open another file (unsaved guard) → large `.md` >512 KB (read-only banner, save disabled) |
| **Regression** | Open chat attachment `.md` snapshot — still read-only preview |
| **Related** | After BUG-013 fix, re-check markdown syntax colors in editor mode |

---

## Risks and open questions

1. **Plan / README preview-first?** Some users may have preferred rendered README on open. Mitigation: **Open as preview** in tree + optional `filePanel.markdownOpenMode` preference.
2. **Orchestrate plan boards** open `.md` via `openFileInViewer(planPath)` — flipping default means plan files open in source view (likely **desired** for editing plans). Confirm with product.
3. **Find (optional)** — Without `@codemirror/search`, “basic text editor” is still satisfied by CodeMirror defaults; document deferral if not in Phase 1.
4. **POLISH-008 dependency** — Selection → Add to chat needs `editorView`; default editor mode unblocks that feature’s file-editor path.
5. **BUG-013** — Editing works even if highlighting is broken; do not block POLISH-007 on BUG-013.

### Questions for alignment before implementation

- Should **preview ever** remain the default for a subset of paths (e.g. only `README.md` at repo root)?
- Persist **markdown open mode** in `filePanel` config, or always default to editor?
- Is a **toolbar toggle** required for Phase 1, or are context menu + tree items enough?
- Include **Mod-f find** in the same PR or follow-up?

---

## Out of scope

- WYSIWYG or inline rendered editing inside preview HTML.
- Side-by-side edit + preview split (unless explicitly added as Phase 3).
- POLISH-006 AI autocomplete, POLISH-008/009 Add to chat (separate items; benefit from editor default).
- BUG-013 syntax highlighting fix (coordinate but separate PR).
- Phase 2 file-tree **content search** (F19 note in context.md).
- Changing `save_file` / `read_file` tool contracts.

---

## References

- Feature request: [documentation/bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) — POLISH-007
- Architecture: [documentation/context.md](../../context.md) — File panel, Viewer row
- Implementation: `src/ui/file-viewer.ts`, `src/ui/file-markdown-path.ts`, `src/ui/file-tree-context-menu.ts`
- Tests: `test/file/file-viewer-save.test.mjs`


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-68](https://linear.app/minnowai/issue/MIN-68/polish-007-editable-markdown)
