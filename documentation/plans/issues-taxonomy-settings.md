# Issues taxonomy settings

## Goal

Users manage issue types, statuses, and priorities in **Settings → Apps → Issues**. The catalog drives the Issues UI (filters, board columns, detail selects), agent tools, and workflow pipelines via semantic status **roles**.

## Agreed context

- **Built-ins:** Fully removable (including defaults).
- **Removal:** Block if any issue still uses the value (show count; no silent migrate).
- **Scope:** Custom statuses are full board columns and workflow targets.
- **Non-goals:** Custom label taxonomy, per-workspace taxonomies, color pickers beyond a small default palette, in-app Issues settings duplicate.

## Data model

- Module: [`src/issues/taxonomy.ts`](../src/issues/taxonomy.ts)
- Store: [`src/state/issues-taxonomy-store.ts`](../src/state/issues-taxonomy-store.ts)
- Server: `~/.minnow/issues/taxonomy.json` via config resource `issues-taxonomy`
- Vite-only: `localStorage` key `minnow-issues-taxonomy-v1`

Statuses carry optional `role` (`triage`, `in_progress`, `review`, `done`, …), `isClosed`, and `boardVisible`. Workflows call `statusIdForRole()` / `requireStatusIdForRole()` instead of hardcoded status strings.

## Implementation slices

1. Taxonomy model + defaults + client/server persistence + validators
2. Issues store / tools / types wired to catalog; unknown card values preserved on load
3. Workflow + board role/visibility integration
4. Settings → Issues UI + catalog/search registration
5. Tests + `documentation/context.md`

## Tests

- [`test/issues/issues-taxonomy.test.mts`](../test/issues/issues-taxonomy.test.mts) — validate/seed, role uniqueness, in-use delete block, role helpers
