# Phase 4 — AI: completion v2, Quick Edit, Add to Chat

**Status:** Shipped

## Goal

Multi-line ghost, partial accept, cache, Cmd-K quick edit, context menu Add to chat / Quick edit.

## Delivered

### 4a Inline completion v2

- [`src/ui/editor-ai-completion-prompt.ts`](../../../src/ui/editor-ai-completion-prompt.ts) — import/symbol context, optional LSP hover (`fetchLspHover` via [`src/lsp/hover-client.ts`](../../../src/lsp/hover-client.ts), try/catch), Qwen native FIM with chat fallback
- [`src/ui/file-editor-ai-extensions.ts`](../../../src/ui/file-editor-ai-extensions.ts) — multi-line ghost, partial accept `Mod-ArrowRight` at `Prec.highest`, abort-on-input preserved
- [`src/ui/editor-ai-completion-cache.ts`](../../../src/ui/editor-ai-completion-cache.ts) — cache key `hash(filePath, prefixTail, suffixHead)`
- [`src/ui/editor-ai-completion-client.ts`](../../../src/ui/editor-ai-completion-client.ts) — cache read/write, FIM `prompt` body for Qwen models
- [`src/config/editor-ai-completion.ts`](../../../src/config/editor-ai-completion.ts) — `maxTokens` default 256, toggles: `includeImportContext`, `includeLspHover`, `useNativeFim`, `enableCompletionCache`
- [`src/ui/editor-ai-settings.ts`](../../../src/ui/editor-ai-settings.ts) — settings UI for new toggles + max tokens

### 4b Quick Edit

- [`src/ui/editor-quick-edit/`](../../../src/ui/editor-quick-edit/) — Mod-K panel, stream via `/api/generations`, inline diff (`text-diff`, stats strip styling), Accept/Reject/Retry
- [`src/styles/editor-quick-edit.css`](../../../src/styles/editor-quick-edit.css)

### 4c Context menu

- [`src/ui/file-viewer.ts`](../../../src/ui/file-viewer.ts) — generalized `bindFileViewerContextMenu`: selection → **Add selection to chat** (fenced `` ```lang path:lines ``), **Quick edit**; markdown preview items when no selection

## Tests

- [`test/ui/file-editor-ai-keymap.test.mts`](../../../test/ui/file-editor-ai-keymap.test.mts) — FIM/fallback, cache key, partial accept, diff-apply range, context menu assembly
- [`test/ui/editor-ai-completion-prompt.test.mts`](../../../test/ui/editor-ai-completion-prompt.test.mts) — import context extraction

## Todos

- [x] Inline completion v2 (prompt, engine, config)
- [x] `src/ui/editor-quick-edit/*` + CSS
- [x] Generalize `bindFileViewerContextMenu`
- [x] Unit tests for prompt, cache, diff-apply, context menu

## Notes

- No `repetition_penalty` / `min_p` on editor AI requests.
- Graceful no-op when backend offline (`canRequest` / `getLocalServerAvailable`).
- LSP hover route is optional; client returns null on 404 until Phase 2 server adds `/api/lsp/hover`.
