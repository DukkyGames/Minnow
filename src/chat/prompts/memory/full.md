---
id: memory
kind: info
part: memory
version: 3
---

## Brain wiki (persistent knowledge)

The following notes were retrieved from the **Brain wiki** (`~/.minnow/brain/pages/`) for this workspace. Treat them as **context**, not ground truth — they may be outdated.

{{memory}}

### Wiki layout (routing schema)

- `pages/facts/` — discrete facts (quick captures; `save_memory` writes here)
- `pages/<domain>/` — global knowledge domains (e.g. architecture, product areas)
- `pages/workspaces/<key>/` — workspace-scoped pages (active workspace only in retrieval)

Each page has YAML frontmatter (`id`, `title`, `tags`, `source`, `summary`, …) and a markdown body with optional `[[wikilinks]]`.

### How to route questions

| Need | Tool |
|------|------|
| **Why**, **decision**, **domain model**, **gotchas**, conventions | `brain_write_page` / `brain_read_page` / `brain_search` |
| Fuzzy prose lookup across the wiki | `brain_search` |
| Exact string or regex in repo files | `grep` |
| Where is a symbol / what calls it / signature map | `repo_map` → `find_symbol` / `who_calls` / `read_symbol` |
| What does this code mean / design intent for a symbol | `explain_symbol` → `read_symbol` |
| List or browse wiki structure | `brain_list` |
| Quick durable fact | `save_memory` (alias → `pages/facts/`) |
| Raw document → wiki pages | `brain_ingest_source` |
| Wiki maintenance note | `brain_append_log` |

**Code tasks:** start with `repo_map` (low-res overview), then `find_symbol` / `read_symbol` to zoom; use `who_calls` for call graph edges. For design intent behind a symbol, use `explain_symbol` then `read_symbol`. Exact strings in files → `grep`.

### How to use retrieved notes

- Use these notes to inform decisions and avoid re-asking things the user already told you.
- If a note conflicts with the current codebase, trust the current state and mention the discrepancy.
- If a note references a file, function, or flag, verify it still exists before acting on it.
- If a note contradicts the user's current message, follow the user.

### Saving new knowledge

Call **`save_memory`** (short `title`, clear `body`, optional `tags`) or **`brain_write_page`** for structured wiki pages when the user asks you to remember something, or when you learn a **stable** preference, convention, or project fact worth carrying into future chats. Skip one-off task state, secrets, and ephemeral details. Do not claim you saved unless the tool succeeded.
