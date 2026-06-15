# MIN-B4 — Wiki tools + prompt/routing integration

**Phase 3b of 7. Makes the wiki usable by agents (chats + sub-agents) and wires it into prompts.**

## Goal

Register the wiki tools so they auto-propagate to chats and sub-agents, repoint the `{{memory}}`
plumbing at the Brain retrieve endpoint, and rewrite the memory prompt partials to describe the wiki
plus the routing schema.

## Why

The store and API exist (MIN-B2/B3) but agents can't call them yet, and the prompt still describes the
old flat memory. This issue closes the loop so a chat can search/write the wiki with no UI.

## Depends on

**MIN-B3** (brain routes + retrieve). Can run in parallel with MIN-B5.

## Tools to register

- `brain_search` — semantic/hybrid retrieve over the wiki (workspace-scoped).
- `brain_read_page` — read a page by relative path.
- `brain_list` — list/tree of pages.
- `brain_write_page` — create/update a page (frontmatter + body + wikilinks).
- `brain_append_log` — append to `log.md`.
- `brain_ingest_source` — ingest a non-code source into pages.
- `save_memory` — **alias** that writes to `pages/facts/` (keep the existing tool id working).

All are `category: 'utility'`, read-only where applicable; writes go through the sandbox.

## Registration checklist (do ALL of these per tool)

1. **`src/tools/definitions.ts`** — add the definition using `toolSchema` (see existing pattern at
   `src/tools/definitions.ts:51`), `category: 'utility'`.
2. **`server/config/tool-ids.js`** — add the tool id.
3. **`SERVER_TOOL_HANDLERS`** (`server/runtime/tools-middleware.js`, handler map ~line 849) — add the
   handler that calls the brain store/routes.
4. **`DEFAULT_ENABLED_TOOL_IDS`** (`server/config/home.js:295`) — add the id, **seeded `'full'`**.
   - The enum is `'full' | 'ask' | 'off'` (`src/ui/settings-plugins.ts:154`). `'full'` = no prompt.
     **Do not use `'allow'`** — it does not exist.
   - `defaultToolsJson()` (`server/config/home.js:310`) seeds enabled tools `'ask'` and **only runs at
     first-run seed**, so also…
5. **Back-fill** the new tool ids into existing configs on load (Correction 6). Add a migration in the
   config load path that inserts any missing brain tool ids at `'full'` for already-initialized users.
6. **Sub-agents** inherit automatically via `resolveSubAgentTools` (`src/agents/sub-agent-tools.ts`) —
   **verify** they appear for a sub-agent; do not re-wire.

## Prompt integration

- Repoint `src/memory/client.ts` `retrieveMemoryBlock` (`src/memory/client.ts:96`) to
  `/api/brain/retrieve`, passing `workspaceKey` (from `getWorkspacePath()`, `src/state/workspace.ts:12`).
  Keep `{{memory}}` as an alias token so existing prompt composition (`compose-context.ts`,
  `prompt-composer.ts`) keeps working.
- Mirror the same repoint in `src/agents/sub-agent-prompt.ts:94`.
- Rewrite `src/chat/prompts/memory/full.md` and `src/chat/prompts/memory/lite.md` to describe the Brain
  wiki **and the routing schema** (pulled from `schema.md`):
  - *why / decision / domain model / gotchas* → wiki tools.
  - fuzzy prose lookup → `brain_search`; exact strings → `grep`.
  - (Code-tool and `explain_symbol` routing lines are added later by MIN-B7 and MIN-B9 — leave clearly
    marked placeholders so those issues can slot in.)

## Step-by-step

1. Add definitions + tool ids + handlers for the six tools and the `save_memory` alias.
2. Seed `DEFAULT_ENABLED_TOOL_IDS` at `'full'`; add the back-fill migration.
3. Repoint `retrieveMemoryBlock` (main + sub-agent) to `/api/brain/retrieve` with `workspaceKey`.
4. Rewrite `full.md` / `lite.md` with the routing schema.

## Tests

- Tool-dispatch: `brain_write_page` lands a page with no permission prompt, scoped to the active
  workspace; `brain_search` returns it.
- Back-fill: load a config that predates these tool ids → after load they are present at `'full'`.
- Sub-agent inheritance: a sub-agent's resolved tool set includes the brain tools.

## Acceptance criteria

- [ ] All wiki tools are callable from a chat and from a sub-agent, no prompt (seeded `'full'`).
- [ ] New tool ids appear in pre-existing configs after upgrade (back-fill works).
- [ ] `{{memory}}` resolves via `/api/brain/retrieve` with workspace scoping, main + sub-agent.
- [ ] `full.md` / `lite.md` describe the wiki + routing schema.
- [ ] Typecheck + lint clean; tests green.

## Out of scope

- Code tools and Code routing lines (MIN-B7).
- `explain_symbol` (MIN-B9).
- Any UI (MIN-B5).
