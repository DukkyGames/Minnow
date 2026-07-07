# Settings agent tools

**Status:** Implemented (2026-07-03)

## Goal

Let the **desktop agent** (and General mode) read and change Minnow Settings via natural language, with **user approval on every write** and safe handling of secrets.

## Shipped

- [x] Field registry (`src/settings/field-registry.ts`, `storage-overlay.ts`, `types.ts`)
- [x] Generated server manifest (`scripts/generate-settings-registry.mjs` → `server/settings/registry-manifest.json`)
- [x] HTTP API: `GET /api/settings/catalog`, `POST /api/settings/read`, `POST /api/settings/update`
- [x] Tools: `search_settings`, `get_settings`, `update_settings`
- [x] Permissions: read tools `full`, write `ask`; `settings` group in desktop + general
- [x] Plan mode denies `update_settings`
- [x] Approval diff in `describe-invocation.ts`; `confirmed` gate in `destructive-tool-confirm.ts`
- [x] Client sync (`src/settings/client-sync.ts`) for browser patches + section refresh
- [x] Prompt: `src/chat/prompts/tool-usage/manage-settings.md`
- [x] Tests: `npm run test:settings`

## Follow-ups (out of scope)

- Provider/MCP/LSP/webhook/prompt per-entity dynamic keys beyond tool permissions
- Per-chat session settings (model/mode)
- OAuth connect flows
- Headless CLI approval bypass wiring

See [`documentation/guides/settings-reference.md`](../guides/settings-reference.md) § Agent settings tools.
