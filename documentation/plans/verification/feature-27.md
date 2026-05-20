# Feature 27 — Editor Tab key verification

| Field | Value |
| --- | --- |
| **Feature** | `feature-27-editor-tab-key` |
| **Epic** | E5 — File panel |
| **Plan** | [`documentation/plans/Build out/feature-27-editor-tab-key.md`](../Build%20out/feature-27-editor-tab-key.md) |

## Plan review

- [x] E5 goal: Tab indents in CodeMirror; Escape exits editor focus
- [x] Key files: `file-editor-extensions.ts`, `file-viewer.ts`, `@codemirror/commands`
- [x] Wave 1; depends on Step 11 file viewer only

## Automated

```bash
npm install
npm run build
npm test
npm test -- test/file/file-editor-keymap.test.mjs test/file/file-viewer-save.test.mjs
```

| Check | Command | Result |
| --- | --- | --- |
| Build | `npm run build` | PASS |
| Full test suite | `npm test` | PASS |
| Keymap tests | `test/file/file-editor-keymap.test.mjs` | PASS — Tab indent + Escape blur |
| Save regression | `test/file/file-viewer-save.test.mjs` | PASS |

## Manual QA (§8.2)

1. `npm start` — set workspace, open Files, open editable source (e.g. `src/main.ts`).
2. Focus editor, Tab mid-line → indent; Shift+Tab → outdent.
3. Multi-line selection → Tab indents all lines.
4. Tab repeatedly → focus stays in editor until Escape.
5. Escape → Tab moves focus to viewer chrome or next control.
6. Mod-s saves when dirty.
7. LSP on: completion popup → Tab accepts; no popup → Tab indents.
8. Large read-only excerpt (>512 KB) → no doc corruption on Tab.

## Sign-off

| Phase | Status | Notes |
| --- | --- | --- |
| Implementation | **PASS** | `indentWithTab`, `indentUnit` 2 spaces, Escape blur in `fileEditorKeymapExtensions()` |
| Automated | **PASS** | `npm test` + focused file tests |
| Manual QA | Pending | Run M1–M8 with `npm start` before release |
