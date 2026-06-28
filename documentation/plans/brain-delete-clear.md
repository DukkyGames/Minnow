# Brain delete and clear

**Status:** Implemented (worktree `brain-delete-clear-2eadb370`).

Expose Brain data deletion end-to-end: `manage_brain` LLM tool (permission `ask`, `confirmed: true` gate) plus Brain UI controls for wiki pages, archives, proposals, code index, and ingest sources.

## Shipped

### Server

- `clearMemoryProposals(scope)` in `server/engine/proposals.js` → `POST /api/brain/proposals/clear` + `POST /api/memory/proposals/clear`
- `clearCodeIndex()` in `server/brain/code/schema.js` → `POST /api/brain/code/clear`
- `clearIngestSources()` in `server/brain/ingest.js` → `POST /api/brain/sources/clear`
- `deleteChatArchive` / `reconcileOrphanArchives` call `rebuildCatalog()` after folder removal

### LLM tool

- `manage_brain` in `src/tools/definitions.ts`, `server/tools/brain-tools.js`, `tools-middleware.js`
- `BRAIN_DESTRUCTIVE_TOOL_IDS` → default permission `ask`; back-filled on config load
- Denied in Plan mode (`PLAN_DENIED_TOOLS`)

### Client + UI

- Destructive helpers in `src/brain/client.ts`
- Inspector: delete page + delete chat archive
- Edit: delete loaded page
- Settings danger zone
- Proposals: clear pending
- Code: reset index

### Tests

- `test/brain/brain-tools.test.mjs` — `manage_brain` gate + `clear_wiki`
- `test/brain/routes-api.test.mjs` — clear routes + `confirmed`
- `test/brain/archive-routes.test.mjs` — catalog rebuild after archive delete
- `test/brain/tool-config-backfill.test.mjs` — `manage_brain` at `ask`

See [`documentation/context.md`](../context.md) for API tables and tool catalog.
