# Phase 1 — Editor fundamentals (CM6 baseline)

**Status:** Done

## Goal

Undo/redo, default keymap, auto-close, bracket match, folding, find/replace, multi-cursor, ~140 languages, Editor settings block.

## Todos

- [x] Create `src/ui/editor-core-extensions.ts`
- [x] Create `src/config/editor-settings.ts`
- [x] Rewrite `loadLanguageExtension` with `@codemirror/language-data`
- [x] Wire `editorCoreExtensions` in `mountEditor` (precedence vs AI/LSP keymaps)
- [x] Style search/fold/active-line in `src/styles/file-panel.css`
- [x] Editor section in `src/ui/settings-page.ts` (via `settings-editor.ts` / `editor-ai-settings.ts`)
- [x] Add npm deps (`@codemirror/search`, `language-data`, lang-* packages)
- [x] Unit test language resolver
- [x] Run `test/ui/file-editor-*`

## Key files

`src/ui/file-viewer.ts`, `src/ui/file-editor-keymap.ts`, `src/ui/editor-language.ts`, `src/ui/codemirror-theme.ts`, `package.json`

## Precedence

AI ghost + Minnow Tab/Escape must win over `defaultKeymap` (`Prec.highest` ghost, `Prec.high` file keymap, `Prec.low` core keymaps).
