# MIN-B6 — LSP extensions: documentSymbol / workspace-symbol / callHierarchy

**Phase 4a of 7. Backend LSP capability for the code index — no SQLite, no tools yet.**

## Goal

Extend the existing LSP manager to expose symbol and call-graph queries over the already-running
language servers, and surface them at `/api/lsp/*`. This is the deterministic data source the code
index (MIN-B7) consumes.

## Why

The code index must be derived **mechanically** from real language-server data, never hallucinated.
The transport, document-sync, and multi-server pool already exist in `server/lsp/manager.js`; we only
need to add three request types and advertise their capabilities.

## Depends on

Nothing in the Brain chain. Sequence it before MIN-B7 (the indexer consumes these functions). Can be
built in parallel with the entire wiki track (B2–B5).

## Current state (verified)

`server/lsp/` contains: `bundle-installer.js`, `config-loader.js`, `manager.js`, `middleware.js`,
`paths.js`, `resolve-command.js`. The manager already handles JSON-RPC transport, `textDocument`
open/sync, and a pool of language servers.

## Scope / files

### `server/lsp/manager.js` — add three functions
- `getLspDocumentSymbols(path)` → `textDocument/documentSymbol`. Returns the symbol tree for a file
  (kind, name, range, selectionRange, children).
- `getLspWorkspaceSymbols(query)` → `workspace/symbol`. Returns matching symbols across the workspace.
- `getLspCallHierarchy(path, line, char)` → `prepareCallHierarchy` then `callHierarchy/incomingCalls`
  and `callHierarchy/outgoingCalls`. Returns both directions for the symbol at the position.

Each function must:
- Route to the correct language server in the pool for the file's language.
- Ensure the document is opened/synced before querying (reuse existing doc-sync).
- Normalize the LSP response into a plain JSON shape the indexer can store (don't leak raw protocol
  objects).

### `initialize` request — advertise capabilities
Add the matching client capabilities so servers enable these features:
`textDocument.documentSymbol`, `workspace.symbol`, `textDocument.callHierarchy`.

### `server/lsp/middleware.js` — surface `/api/lsp/*`
- `GET/POST /api/lsp/document-symbols` (path)
- `GET/POST /api/lsp/workspace-symbols` (query)
- `POST /api/lsp/call-hierarchy` (path, line, char)

## Step-by-step

1. Add the three capability flags to the `initialize` params.
2. Implement the three manager functions with doc-sync + response normalization.
3. Add the three middleware routes.
4. Test against Minnow's own TypeScript sources with a live server.

## Tests

- `documentSymbol`: for a known TS file, the returned tree contains known exported symbols with
  correct kinds.
- `workspace/symbol`: a query for a known export returns it with the right file/location.
- `callHierarchy`: for a function with known callers, `incomingCalls` returns those call sites; for a
  function that calls known callees, `outgoingCalls` returns them.

## Acceptance criteria

- [x] The three functions return normalized, well-formed results against a live language server.
- [x] Capabilities are advertised in `initialize`.
- [x] `/api/lsp/*` endpoints respond.
- [x] Typecheck + lint clean; tests green.

## Out of scope

- SQLite schema, indexer, ranking, code tools, UI (MIN-B7 / MIN-B8).
- tree-sitter (explicitly a later optional accelerator, MIN-B11).
