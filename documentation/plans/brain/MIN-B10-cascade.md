# MIN-B10 — The Cascade: unified staleness, incremental reindex, git hook

**Phase 6 of 7. One staleness engine, three customers (code index, raw sources, wiki).**

## Goal

Generalize staleness into a single cascade engine that Merkle-hashes inputs, propagates dirtiness,
reindexes incrementally, and offers the trigger paths Minnow needs (it has **no file watcher**).

## Why

Without this, the index and wiki only refresh on a full manual Reindex. The cascade makes refresh
targeted (re-hash only changed branches), keeps anchored pages honest automatically, and never blocks
on LLM regeneration.

## Depends on

**MIN-B7** (code index + `file_hashes` + indexer single-file mode) and **MIN-B9** (anchors + drift →
stale).

## Scope / files

### `server/brain/code/cascade.js`
**Watched inputs (three kinds):**
- Code files → a Merkle tree of `sha256` per repo; walk only changed branches to find changed files.
- Raw/source files → content hash on ingest.
- Wiki pages → `input_hash` (hash of sources + anchored symbol signatures).

**Propagation graph:**
- Code file change → re-parse that file (indexer single-file mode) → dirty symbols → (a) re-rank the
  affected map slice and (b) mark anchored pages `stale` (via the MIN-B9 path).
- Raw source change → dirty the synthesized pages derived from it.
- Wiki lint failure → orphan/contradiction flags.

**Two regeneration modes:**
- *Deterministic* (the code index): instant; lazy on next query or on trigger.
- *LLM* (the wiki): costs tokens; batched/scheduled; **never blocks** a request.

**Triggers (no file watcher available):**
- Manual **Reindex** in the Brain app (already exists from MIN-B7/B8 — route it through the cascade).
- On **workspace switch** (LSP restarts anyway — good moment to hash-check).
- Optional **git `post-commit` hook** the user installs: reuse the `git_*` tools / `git status` to get
  the changed-file set and feed it to the incremental indexer. Provide the hook script + an installer
  action; do not auto-install.
- **Lazy hash-check on query**: before answering a code query, cheaply verify the DB is current; if
  not, reindex the stale slice first.

### Settings
Wire `config.brain.code.*` reindex cadence (on-demand / on-switch / git-hook) to actually select which
triggers are active. Add the git-hook install action to the Brain Code/Settings UI.

## Step-by-step

1. Implement per-repo Merkle hashing over `file_hashes`; expose "what changed since hash X".
2. Implement the propagation graph (file → symbols → ranking + anchored-page staleness; raw → pages).
3. Route manual Reindex, workspace-switch, and lazy-on-query through the cascade.
4. Add the git `post-commit` hook script + installer; feed changed files to the incremental indexer.
5. Add a scheduled/batched wiki re-synthesis + lint pass for LLM-mode regen.

## Tests

- Incremental reindex on a single changed file re-hashes only that branch and updates only that file's
  symbols/edges (not a full rebuild).
- Lazy hash-check detects a stale DB on query and refreshes the affected slice before answering.
- Git-hook path: given a changed-file set, the indexer updates exactly those files.
- A code change propagates a `stale` flag to the correct anchored page (end-to-end with MIN-B9).

## Acceptance criteria

- [ ] Editing one file triggers a **targeted** reindex (not a full rebuild) and propagates stale flags
      to anchored pages.
- [ ] All four trigger paths work (manual, workspace-switch, git-hook, lazy-on-query).
- [ ] LLM-mode wiki regen is batched/scheduled and never blocks a request.
- [ ] Tests green; typecheck + lint clean.

## Out of scope

- Code semantic search and tree-sitter accelerator (MIN-B11).
