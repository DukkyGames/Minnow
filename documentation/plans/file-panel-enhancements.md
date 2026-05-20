# File panel enhancements

Implementation plan for file tree auto-load, drag-to-chat references, syntax highlighting, editable save, and LSP completion.

## Phases

| Phase | Status |
|-------|--------|
| 1 Auto tree boot | Done |
| 2 Drag to chat | Done |
| 3 Syntax highlighting | Done |
| 4 Edit + save | Done |
| 5 LSP notify + completion | Done |
| 6 Tests + docs | Done |

## Todos

- [x] Auto-load file tree on init + server availability hook
- [x] CodeMirror HighlightStyle in file viewer
- [x] Workspace path chips + composer drop zone
- [x] Editable viewer, Save, Ctrl+S, large-file read-only
- [x] `/api/lsp/notify` + `/api/lsp/completion` + autocomplete
- [x] Tests and `documentation/context.md` update

Verification: [`verification/file-panel-enhancements.md`](verification/file-panel-enhancements.md)
