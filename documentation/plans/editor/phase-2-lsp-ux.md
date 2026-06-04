# Phase 2 — Full in-editor LSP UX

**Status:** Shipped

## Goal

Diagnostics squiggles, hover, signature help, go-to-definition, rich completion with resolve/auto-import.

## Todos

- [x] Fix `bindLspProcessLifecycle` `child` → `state.child` bug
- [x] Server helpers + routes (hover, definition, signature, structured diagnostics, resolve)
- [x] Extend `src/lsp/completion-client.ts`
- [x] Create `src/ui/lsp-editor/{diagnostics,hover,signature,definition}.ts`
- [x] Upgrade completion in `file-editor-extensions.ts`
- [x] Wire + chrome diagnostics count; theme in `codemirror-theme.ts`
- [x] Tests: fake-lsp + integration (`test/lsp/lsp-ux-api.test.mjs`)

## API routes

| Route | Purpose |
| --- | --- |
| `POST /api/lsp/hover` | Hover at line/character |
| `POST /api/lsp/definition` | Go-to-definition targets |
| `POST /api/lsp/signature` | Signature help |
| `POST /api/lsp/diagnostics-structured` | Raw diagnostics for CM6 lint |
| `POST /api/lsp/resolve` | `completionItem/resolve` |

## Deps

`@codemirror/lint` (lint gutter + squiggles)

## Graceful degrade

All browser fetches use `detectLocalServer()` and empty catch — editor works without `npm start`.
