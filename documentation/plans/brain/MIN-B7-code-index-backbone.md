# MIN-B7 — Code index backbone: SQLite schema, indexer, rank, query + tools

**Phase 4b of 7. The deterministic, always-fresh code backbone. The core of Layer 3.**

## Goal

Build the deterministic code index: LSP-derived symbols and edges stored in SQLite, ranked by
personalized PageRank, rendered as a token-budgeted repo map, and exposed through read-only code tools
(`repo_map`, `find_symbol`, `who_calls`, `read_symbol`).

**Milestone:** an agent navigates Minnow's codebase with zero preloading — `find_symbol` returns the
def, `who_calls` returns exact call sites, `repo_map` fits a token budget.

## Why

Dropping an agent into a 300k-LOC repo fails: dumping the repo blows the window, hand-written maps rot.
A deterministic graph answers "what calls `dispatchTelemetry`" with the *actual* call sites (edges),
not 50 string hits — the difference between finishing and burning the window.

## Depends on

**MIN-B6** (LSP functions) and **MIN-B4** (tool-registration pattern + back-fill). MIN-B2 for
`getBrainCodeDir()`.

## Scope / files

### `server/brain/code/schema.js` — SQLite (model on `server/calendar/store.js`)
Reuse the `better-sqlite3` WAL + singleton-handle pattern from `server/calendar/store.js`. One DB per
workspace at `~/.minnow/brain/code/<workspace-key>.db` (`workspace-key` = slug of `getWorkspacePath()`,
`src/state/workspace.ts:12`).
```sql
symbols(
  id PK,            -- "<repo>:<qualified.name>" — stable across file moves; NEVER line numbers
  repo, kind, name, file, line_start, line_end,
  signature,        -- elided signature for map rendering
  doc, content_hash,-- sha256 of the source span (drives cascade staleness, MIN-B10)
  pagerank
)
edges(src_symbol, dst_symbol, kind)        -- calls | imports | extends | uses
file_hashes(repo, file, sha256, mtime)
anchors(page_id, symbol_id, repo, symbol_hash_at_synth)   -- table created now; POPULATED in MIN-B9
-- FTS5 virtual table over symbols(name, doc) for lexical search
```
`id` format is load-bearing: anchor on `<repo>:<qualified.name>`, resolve through the graph, never on
line numbers — so refactors that move code don't break ids or anchors.

### `server/brain/code/indexer.js` — pipeline (per repo / per changed file)
1. Walk workspace files via `server/tools/grep.js` / `find_files` (respects `.gitignore`).
2. For each file: LSP `getLspDocumentSymbols` (MIN-B6) → symbol defs.
3. Compute `signature` (elided) and `content_hash` (sha256 of the source span).
4. LSP references / `getLspCallHierarchy` → build `edges` (calls/imports/extends/uses).
5. Upsert `symbols`, `edges`, `file_hashes` into SQLite.
6. Augment ranking inputs with ripgrep usage counts.
Support both full-repo and single-file (incremental) modes — single-file mode re-parses only that file
and updates its symbols/edges (full Merkle incrementality is MIN-B10, but the indexer must accept a
changed-file list now).

### `server/brain/code/rank.js` — personalized PageRank
- ~30 lines (or a tiny dependency) over the `edges` graph.
- Personalization vector biased toward the agent's currently-open/active files.
- Render the top-ranked symbols as **signature-only** views into a token budget (Aider-style, default
  ~1–2k tokens, configurable via `config.brain.code.repoMapTokenBudget`).

### `server/brain/code/query.js` + routes `/api/brain/code/*`
- `repo_map(repo, focus?)` — token-budgeted signature map, optionally focused.
- `find_symbol(query)` — FTS5 + workspace-symbol fallback.
- `who_calls(symbol)` / `calls_of(symbol)` — incoming/outgoing edges.
- `read_symbol(symbol)` — return the **current** source span via `read_file_range` (read fresh from
  disk, not from the cached span — fresh beats clever).
- `status` / `reindex`.
Register the routes beside the brain middleware.

### Code tools (register per the MIN-B4 checklist — seed `'full'`, back-fill existing configs)
`repo_map`, `find_symbol`, `who_calls`, `read_symbol`. All read-only. `grep` (via
`server/tools/grep.js`) remains the always-fresh fallback when the index is cold/stale.
Touch: `src/tools/definitions.ts`, `server/config/tool-ids.js`, `SERVER_TOOL_HANDLERS`
(`server/runtime/tools-middleware.js`), `DEFAULT_ENABLED_TOOL_IDS` (`server/config/home.js:295`) +
back-fill.

### Settings — `config.brain.code.*`
include/exclude globs, repo-map token budget, reindex cadence (on-demand / on-switch / git-hook),
optional code-embeddings toggle. Surface in the Settings section (UI lands in MIN-B8; schema/defaults
here).

### Prompt routing lines
Add to `src/chat/prompts/memory/full.md` + `lite.md` (slot into the placeholders left by MIN-B4):
*where / what-calls / signature* → code tools; **start code tasks with `repo_map` low-res, then zoom**;
exact strings → `grep`.

## Tests (`test/brain/code/`)

- `documentSymbol` extraction → SQLite rows with correct ids/signatures.
- Deterministic PageRank: same graph → same ranking (no randomness).
- Incremental reindex on a changed file updates only that file's symbols/edges.
- `repo_map` output respects the token budget.
- `find_symbol` / `who_calls` exactness against known Minnow symbols.

## Acceptance criteria (milestone)

- [ ] Point a workspace at Minnow → **Reindex** → `find_symbol("retrieveMemoryBlock")` returns the def.
- [ ] `who_calls` returns exact call sites (graph edges, not string hits).
- [ ] `repo_map` fits the configured token budget.
- [ ] Code tools callable from chat + sub-agents (seeded `'full'`, back-filled).
- [ ] Tests green; typecheck + lint clean.

## Out of scope

- Code-section UI (MIN-B8).
- Anchors / `explain_symbol` / drift (MIN-B9) — the `anchors` table is created but not populated.
- Merkle hashing + automated incremental triggers (MIN-B10).
- Code semantic search / tree-sitter (MIN-B11).
