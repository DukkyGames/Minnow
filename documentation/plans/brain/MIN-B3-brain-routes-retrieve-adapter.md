# MIN-B3 — Brain HTTP routes, workspace-scoped retrieve, memory back-compat adapter

**Phase 3a of 7. Puts the wiki store behind HTTP, moves synthesis in, keeps memory working.**

## Goal

Expose the wiki over `/api/brain/*`; add workspace-scoped retrieval that keeps the engine pure; move
synthesis/ingest/lint into `server/brain/`; and demote `server/memory/{routes,store,middleware}` to a
thin adapter over the brain store so `/api/memory/*`, `save_memory`, and server-side retrieval keep
working unchanged.

## Why

The store (MIN-B2) is usable in-process but nothing else can reach it. This issue makes the wiki the
single backing store for both the new Brain API and the legacy memory API, so the old surface never
breaks during the transition.

## Depends on

**MIN-B2** (store, paths, sandbox, catalog). Indirectly MIN-B1 (engine).

## Scope / files

### `server/brain/retrieve.js` — scoped wrapper
- Load pages from the store.
- `scopePagesToWorkspace(pages, workspaceKey)` → global pages (everything outside
  `pages/workspaces/`) **plus** `pages/workspaces/<workspaceKey>/**`.
- Then call the engine's `retrieveMemoryBlockHybrid` **unchanged**.
- **Scoping happens here / in the route, before the engine call** — mirror
  `server/memory/retrieve.js:83`. Keep `server/engine/retrieve.js` pure (no workspace knowledge).

### Move synthesis into `server/brain/` (5 files)
Move from `server/memory/`: `synthesis.js`, `synthesis-routes.js`, `synthesis-state.js`,
`skill-synthesis.js`, `synthesis-config.js`. Changes:
- Synthesis writes a **page** under `pages/facts/<slug>.md` (frontmatter `source: synthesis`) via the
  brain store instead of calling memory's `createEntry`.
- Default `requireConfirmation: false` (write-freely). The model is resolved via
  `resolveSynthesisModel` (`server/memory/synthesis-config.js:62` — moves with the file).

### `server/brain/ingest.js` — non-code source → pages
- Store the raw source under `sources/` (immutable).
- `llmCall` (`server/research/llm.js`; model via `resolveSynthesisModel`) to produce or patch pages +
  wikilinks from the raw source.
- `appendLog()`.
- Return the list of touched page paths.

### `server/brain/lint.js` — health report (no auto-edits)
- Report orphans, stale pages, and contradictions/missing links via an LLM pass.
- (Anchor-drift detection is added in MIN-B9 — leave a clear extension point.)

### `server/brain/routes.js` + `server/brain/middleware.js`
`/api/brain/*` endpoints:
```
GET    /status
GET    /tree
GET    /page            (read; path in query/body, validated via resolvePagePath)
PUT    /page            (create/update)
DELETE /page
POST   /retrieve        (body includes workspaceKey)
GET    /log
GET    /schema
PUT    /schema
POST   /ingest
POST   /lint
GET    /proposals       (+ accept/reject as the memory proposals API does)
GET    /embeddings/status
GET    /embeddings/config
POST   /embeddings/reindex
POST   /backup
POST   /clear
```
Register `createBrainMiddleware()` beside `createMemoryMiddleware()` in
`server/runtime/middlewares.js` (memory is registered there around line 58 — follow that pattern).
Every route that takes a page path must run it through `resolvePagePath` (MIN-B2) before touching disk.

### Memory back-compat adapter
Rewrite `server/memory/{routes,store,middleware}` as a **thin adapter** over the brain store:
- `/api/memory/*` continues to respond, delegating to the brain store/retrieve.
- `save_memory` continues to work (it writes to `pages/facts/` via the adapter).
- Server-side retrieval used elsewhere keeps its current call shape.
- Mark these files for removal (comment + tracking note) — they exist only for back-compat.

## Step-by-step

1. Write `retrieve.js` wrapper with workspace scoping; unit-test scoping in isolation.
2. Move the five synthesis files; repoint them at the brain store; switch the write path to a page.
3. Write `ingest.js` and `lint.js`.
4. Write `routes.js` + `middleware.js`; register beside memory middleware.
5. Convert `server/memory/{routes,store,middleware}` to adapters; run the memory test suite.

## Tests

- Workspace-scoped retrieve: global pages always returned; `workspaces/<A>/` pages returned for A and
  **excluded** for B.
- Synthesis writes a page (not a memory entry) with `source: synthesis`, no prompt by default.
- Ingest returns touched paths and stores raw under `sources/`.
- `lint` returns a structured report.
- **`test/memory/*` stays green** through the adapter (primary back-compat signal).

## Acceptance criteria

- [ ] All `/api/brain/*` endpoints respond; page routes enforce the sandbox.
- [ ] `/retrieve` respects `workspaceKey`; the engine remains pure.
- [ ] Synthesis files a page write-freely by default.
- [ ] `/api/memory/*` and `save_memory` still work via the adapter; memory tests green.
- [ ] Typecheck + lint clean.

## Out of scope

- Registering the wiki **tools** and prompt integration (MIN-B4).
- Any UI (MIN-B5).
- Anchor-drift in lint (MIN-B9).
