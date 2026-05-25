---
name: POLISH-008 — Right-click selection Add to chat
overview: In the file viewer CodeMirror editor, let users right-click a non-empty text selection and choose Add to chat to queue a snippet attachment in the composer with workspace path and 1-based line range metadata.
source: documentation/bug-hunt-session-2026-05-24.md (POLISH-008)
status: verified
linear: MIN-87
verifiedAt: 2026-05-24
related:
  - POLISH-009 (file tree → Add to chat; separate plan)
  - POLISH-007 (editable markdown in viewer)
  - POLISH-013 (Report bug from selection; parallel context-menu pattern)
todos:
  - id: selection-api
    content: Export getEditorSelectionRange() from file-viewer.ts (path, text, startLine, endLine, empty guard)
    status: pending
  - id: snippet-attachment
    content: Add addEditorSnippetToComposer() in src/attachments/ — text chip with path#line label, size limits, dedupe policy
    status: pending
  - id: context-menu
    content: Extend bindFileViewerContextMenu() — selection menu with Add to chat; merge with markdown preview/code items
    status: pending
  - id: markdown-preview
    content: Define behavior when markdown preview is active (DOM selection vs disabled with hint)
    status: pending
  - id: composer-ux
    content: Focus msgInput, setStatus feedback, scheduleContextUsageRefresh after push
    status: pending
  - id: tests
    content: test/file/file-viewer-selection-chat.test.mjs (selection helper + menu wiring); optional attachment unit test
    status: pending
  - id: context-doc
    content: Update documentation/context.md file panel + attachments bullets after implementation
    status: pending
  - id: verification
    content: Manual QA checklist in plan Verification section (code + md + large file excerpt + read-only snapshot)
    status: pending
isProject: false
---

# POLISH-008 — Right-click selection → Add to chat

**Tracking:** [bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) · **Architecture:** [context.md](../../context.md) · **Scope:** Plan only (no implementation in this document)  
**Linear:** [MIN-87](https://linear.app/minnowai/issue/MIN-87/polish-008-selection-add-to-chat) — priority Low (4), labels `polish`, `editor`

---

## Verification (2026-05-24)

**Result: CONFIRMED (not implemented)** — static code review; plan matches codebase; ready for implementation.

| Check | Result |
|-------|--------|
| `getEditorSelectionContext` / `editor-snippet.ts` | **Missing** — not in repo |
| `bindFileViewerContextMenu` | **Markdown-only** — `if (!path \|\| !isMarkdownFilePath(path)) return` blocks menu on `.ts` etc.; must restructure for selection + md toggles |
| `editorView` | Module-private; selection helper can stay in `file-viewer.ts` |
| `getOpenViewerPath()` | Exported — OK |
| `pushAttachment` → `renderAttachPreview` → `scheduleContextUsageRefresh` | OK (`store.ts`) |
| `MAX_ATTACHMENT_BYTES` / `LARGE_TEXT_WARN_BYTES` | 10 MB / 32 KB — OK (`reader.ts`) |
| `addWorkspaceReference` (full file) | Separate pipeline — OK |
| `showFilePanelContextMenu` | Reusable — OK (`file-tree-context-menu.ts`) |
| `isMarkdownPreviewActive()` | Exists — v1 Option B (no Add to chat in preview) viable |
| Automated tests | **None** — `file-viewer-selection-chat.test.mjs` absent |
| Live manual QA (~25 min, `npm start`) | **Deferred** — post-implementation |

**Implementation note:** Replacing the markdown-only early return is required so **Add to chat** appears for code files with a non-empty CodeMirror selection, while markdown preview/code items remain when path is `.md`.

---

## Problem

Users working in the file viewer cannot send a **highlighted excerpt** to the composer without copy-paste. IDE-style products (Cursor, VS Code) expose **Add to Chat** on editor selections. Minnow already wires workspace files into the composer via drag-drop and `kind: workspace` chips, but there is no path from **in-editor selection** → pending attachment.

---

## Desired behavior (from bug hunt)

| Requirement | Detail |
|-------------|--------|
| Trigger | User selects text in the **open file editor**, right-clicks, chooses **Add to chat** |
| Payload | Snippet text plus **workspace-relative path** and **1-based line range** when available |
| File types | Code and plain/markdown text in CodeMirror; behavior for markdown **preview** mode called out below |
| Outcome | Composer shows a preview chip; send path inlines content like other text attachments (`<file name="…">…</file>` via `buildHistoryUserContent`) |

**Out of scope for POLISH-008:** Right-click on **file tree rows** → full-file attach (**POLISH-009**). Right-click **Report bug** (**POLISH-013**).

---

## Current state

| Area | Today |
|------|--------|
| File viewer editor | CodeMirror 6 in [`src/ui/file-viewer.ts`](../../../src/ui/file-viewer.ts); `editorView`, `getOpenViewerPath()`, line numbers enabled |
| Viewer context menu | [`bindFileViewerContextMenu()`](../../../src/ui/file-viewer.ts) — **only** markdown toggle: “Open as code” / “Open as preview”; early-returns when path is not `.md` |
| Composer attachments | [`src/attachments/store.ts`](../../../src/attachments/store.ts) `pushAttachment`, [`src/attachments/types.ts`](../../../src/attachments/types.ts) kinds: `image`, `text`, `pdf`, `error`, `workspace` |
| Full-file workspace ref | [`src/attachments/workspace-ref.ts`](../../../src/attachments/workspace-ref.ts) `addWorkspaceReference` — dedupes by path; body loaded on send via `read_file` |
| Send / history shape | [`buildHistoryUserContent`](../../../src/tools/loop.ts) wraps text/PDF as `<file name="…">body</file>` |
| Size policy | [`MAX_ATTACHMENT_BYTES`](../../../src/attachments/reader.ts) 10 MB hard; [`LARGE_TEXT_WARN_BYTES`](../../../src/attachments/reader.ts) 32 KB soft warning on chips |
| Large file viewer | Loads lines 1–2000 read-only excerpt; footer documents truncated range — selection still valid **within loaded doc** |
| Markdown preview | Read-only GFM DOM (no `editorView`); separate from CodeMirror selection API |

---

## Recommended design

### 1. Selection helper (file-viewer)

Add a small exported API (names illustrative):

```ts
export interface EditorSelectionContext {
  path: string;
  text: string;
  startLine: number; // 1-based inclusive
  endLine: number;   // 1-based inclusive
}

export function getEditorSelectionContext(): EditorSelectionContext | null
```

**Rules:**

- Return `null` if `editorView` is missing, `getOpenViewerPath()` is null, or selection is empty (cursor only).
- Use `EditorState.selection.main` `from`/`to`; map to lines with `doc.lineAt` (CodeMirror 1-based: `line.number`).
- `text` = `doc.sliceString(from, to)` (trim optional — prefer **no trim** so whitespace-only selections still work for tests).
- Do **not** read unsaved buffer for POLISH-009-style full-file attach; snippet uses **editor document as shown** (includes unsaved edits — desirable for “ask about my change”).

### 2. Snippet → composer (new attachment helper)

New module e.g. [`src/attachments/editor-snippet.ts`](../../../src/attachments/editor-snippet.ts):

```ts
export function addEditorSnippetToComposer(ctx: EditorSelectionContext): void
```

**Chip shape:** `kind: 'text'` (reuse existing send/history pipeline — no new `AttachmentKind` in v1).

| Field | Value |
|-------|--------|
| `id` | `snippet-${Date.now()}-…` or `crypto.randomUUID()` |
| `name` | `` `${basename(path)}:${startLine}-${endLine}` `` or `` `path#L${startLine}-L${endLine}` `` (pick one convention; display in chip + `<file name>`) |
| `mimeType` | `text/plain` |
| `size` | `text.length` (UTF-16 code units OK for UI) |
| `text` | selection body |
| `largeTextWarning` | `text.length > LARGE_TEXT_WARN_BYTES` |

**Limits:**

- If `text.length > MAX_ATTACHMENT_BYTES` (or byte estimate): push `kind: 'error'` chip with clear message (“Selection too large…”) — mirror `processFile` oversize behavior.
- Do **not** call `read_file` / `read_file_range` on send for snippets (content already inline).

**Dedupe (v1):** Allow multiple snippet chips (different ranges). Optional later: dedupe by `(path, startLine, endLine, text hash)`.

### 3. Context menu wiring

Extend [`bindFileViewerContextMenu()`](../../../src/ui/file-viewer.ts):

```
contextmenu on #fileViewerHost
  preventDefault when we show a custom menu
  if getEditorSelectionContext() != null
    items += { label: 'Add to chat', action: () => { addEditorSnippet…; focusComposer(); setStatus(...) } }
  if isMarkdownFilePath(path)
    items += existing Open as code / preview toggle
  if items.length > 0 → showFilePanelContextMenu(items, x, y)
```

**Menu ordering:** **Add to chat** first when selection exists; markdown toggles below (or only when no selection — product choice: show both when applicable).

Reuse [`showFilePanelContextMenu`](../../../src/ui/file-tree-context-menu.ts) / `.file-tree-context-menu` styling (already used for viewer).

### 4. Markdown preview mode

| Option | Recommendation |
|--------|----------------|
| A | Use `window.getSelection()` on `.file-viewer-markdown-preview` when preview active; map lines approximately or omit line range |
| B | Disable **Add to chat** in preview; menu item disabled + title “Switch to code view to add a selection” |
| **v1** | **Option B** — simpler, matches today’s viewer context menu only targeting markdown paths; users toggle **Open as code** (POLISH-007 alignment) then select + Add to chat |

Document in verification: preview → code → select → add.

### 5. Edge cases

| Case | Behavior |
|------|----------|
| No file open / loading / error pane | No custom menu (browser default or no-op) |
| Read-only excerpt (large file) | Allow add; line range relative to **loaded** excerpt; name still uses real `currentPath` |
| Chat attachment snapshot (`.minnow/attachments/…`) | Allow add; path is virtual — agent sees snapshot label; acceptable v1 |
| Image viewer | No text selection menu |
| `main-column--tool-approval-pending` / question modal | Add to chat still queues chip; composer hidden until dismissed (existing pattern) |
| Orchestrate plan drop on composer | Unrelated; snippet uses `pushAttachment` not `addWorkspaceReference` |

### 6. Composer UX

After successful `pushAttachment`:

1. `renderAttachPreview()` (already inside `pushAttachment`)
2. `scheduleContextUsageRefresh()` (attachments with `text` count in [`estimateAttachmentTokens`](../../../src/chat/context-usage.ts))
3. Focus `#msgInput` ([`initComposerInput`](../../../src/ui/composer-input.ts) if needed)
4. `setStatus('ok', 'Added selection to chat')` or similar (match file-tree CRUD feedback convention)

**Keyboard (non-goal v1):** No default keybinding; optional follow-up `Mod-Shift-L` style.

---

## Files to touch (implementation checklist)

| File | Change |
|------|--------|
| [`src/ui/file-viewer.ts`](../../../src/ui/file-viewer.ts) | `getEditorSelectionContext`; extend `bindFileViewerContextMenu` |
| [`src/attachments/editor-snippet.ts`](../../../src/attachments/editor-snippet.ts) | **New** — `addEditorSnippetToComposer` |
| [`src/attachments/store.ts`](../../../src/attachments/store.ts) | No change if using `pushAttachment` only |
| [`src/main.ts`](../../../src/main.ts) / [`src/ui/init-file-panel.ts`](../../../src/ui/init-file-panel.ts) | Ensure menu bound after viewer mount (already `bindFileViewerContextMenu()` in init-file-panel) |
| [`test/file/file-viewer-selection-chat.test.mjs`](../../../test/file/file-viewer-selection-chat.test.mjs) | **New** — selection helper + menu item fires push |
| [`documentation/context.md`](../../context.md) | File panel + attachments bullets after ship |

**Avoid in v1:** Changing `Attachment` schema, `resolveWorkspaceReferences`, or tool definitions.

---

## Acceptance criteria

- [ ] With a workspace file open in CodeMirror, non-empty selection → right-click → **Add to chat** visible and works.
- [ ] Composer chip appears; removing chip works; send includes `<file name="…">` with **selected text only** (not whole file).
- [ ] Chip / file name encodes **path** and **line range** (e.g. `src/foo.ts:12-18`).
- [ ] Empty selection / click without drag-select → no **Add to chat** item (or disabled).
- [ ] Selection &gt; 10 MB equivalent → error chip, no silent truncate.
- [ ] Selection &gt; 32 KB → chip shows large-file warning (existing styling).
- [ ] Markdown **preview** mode: documented behavior (disabled or code-switch path).
- [ ] Unsaved edits in buffer are what get attached.
- [ ] `npm test` — new test passes; no regressions in `file-viewer-save.test.mjs`.

---

## Verification (manual QA)

1. Open `src/main.ts` (or any TS file) → select 3 lines → Add to chat → chip label shows path + range → send message → inspect history bubble / network payload for `<file>` block with excerpt only.
2. Open `.md` as preview → confirm Add to chat not offered (or disabled) → **Open as code** → select → Add to chat works.
3. Open file &gt; 512 KB → select lines in excerpt → add → range matches visible lines.
4. Dirty file: edit line, select, add — attached text matches edit, not disk.
5. Two different selections from same file → two chips.
6. Context usage ring updates after attach.

---

## Test plan (automated)

| Test | Approach |
|------|----------|
| `getEditorSelectionContext` | happy-dom + tsx: mount editor with known doc, set selection via `EditorView.dispatch`, assert lines + text |
| Context menu | Spy/mock `pushAttachment` or `addEditorSnippetToComposer`; dispatch `contextmenu` with selection; click menu item |
| Oversize selection | Unit test `addEditorSnippetToComposer` with string length &gt; `MAX_ATTACHMENT_BYTES` → `kind: 'error'` |

Use [`test/test-loader.mjs`](../../../test/test-loader.mjs) pattern from other file-viewer tests.

---

## Relationship to other work

| Item | Relationship |
|------|----------------|
| **POLISH-009** | Full file from tree; may share “Add to chat” label and `pushAttachment` / `addWorkspaceReference` — keep implementations separate; optional shared submenu builder later |
| **POLISH-007** | Editable markdown makes selection path more common |
| **POLISH-013** | Same context-menu host; avoid duplicate `contextmenu` listeners — extend single binder |
| **MIN-31** | User message chips open viewer snapshots — snippet chips are composer-only until send |

---

## Open questions (resolve before or during implementation)

1. **Chip label format:** `path#L10-L20` vs `filename.ts:10-20` — prefer includes full workspace-relative path for agent clarity.
2. **Trim selection:** Leading/trailing newline trim? Default **no** trim in v1.
3. **Markdown preview v2:** Worth `getSelection()` line mapping if users expect preview-first workflow?

---

## Implementation order

1. `getEditorSelectionContext` + unit tests  
2. `addEditorSnippetToComposer` + size limits  
3. Context menu integration + composer focus/status  
4. Markdown preview policy (disabled + title)  
5. Manual QA → update `context.md`

---

## Post-ship documentation

Update [context.md](../../context.md) **File panel** / **Attachments** sections:

- Note viewer context menu **Add to chat** on selection (CodeMirror only).
- Snippet attachments use `kind: text` with line range in display name; distinct from workspace reference chips.

---

*Plan authored from codebase review 2026-05-24. Implementation not started.*


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-87](https://linear.app/minnowai/issue/MIN-87/polish-008-selection-add-to-chat)
