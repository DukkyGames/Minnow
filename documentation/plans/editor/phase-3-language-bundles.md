# Phase 3 — Language packs + bundle install UI

**Status:** Shipped (2026-06-03)

## Goal

Pre-bundle lightweight npm LSPs; download-on-demand for binaries; Language bundles UI.

## Todos

- [x] Pre-bundle pyright, vscode-langservers-extracted, yaml, bash, dockerfile, graphql in package.json + `$minnow:` resolver
- [x] `server/lsp/bundle-installer.js` + `src/lsp/bundles.json`
- [x] Resolver search order: workspace → app bundle → `~/.minnow/lsp-servers` → PATH
- [x] HTTP routes for bundles install/progress
- [x] Language bundles section in `src/ui/lsp-settings.ts`
- [x] Tests (`test/lsp/resolve-command.test.mjs`, `test/lsp/bundle-installer.test.mjs`)

## Implementation notes

| Area | Location |
|------|----------|
| Catalog | `src/lsp/bundles.json` (Web, Python, Systems, JVM, Scripting, Other) |
| Installer | `server/lsp/bundle-installer.js` — npm `--prefix ~/.minnow/lsp-servers`, GitHub binaries → `bin/` |
| PATH / resolve | `server/lsp/paths.js`, `server/lsp/resolve-command.js`, `server/lsp/manager.js` (`buildLspProcessEnv`) |
| API | `GET /api/lsp/bundles`, `POST /api/lsp/bundles/install`, `POST /api/lsp/bundles/uninstall`, `GET /api/lsp/bundles/progress` |
| UI | Settings → Language servers → **Language bundles** cards |
| Defaults | `src/lsp/defaults.json` — `$minnow:` tokens for pyright, html, css, yaml, bash, dockerfile, graphql |

## Verify

1. `npm start` (requires app `node_modules` with LSP deps installed).
2. Settings → Language servers → **Language bundles** — install YAML or rust-analyzer; watch progress bar.
3. `npm run test:lsp`
