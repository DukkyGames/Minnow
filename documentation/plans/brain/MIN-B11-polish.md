# MIN-B11 — Polish (optional, post-MVP)

**Phase 7 of 7. Quality + scale. Ship items only when measurably better.**

## Goal

Optional improvements to retrieval quality and scale. Each item is independently gated by a benchmark —
do not merge a change that doesn't beat the current behavior on a held-out query set.

## Depends on

**MIN-B10** (a complete, cascading Brain). Everything here is additive.

## Scope (each item independently gated)

### 1. Optional code semantic search
Reuse the `server/engine/` embeddings to add semantic search over symbols/docs — **only if it beats
`grep` + the PageRank graph** on a held-out set of real navigation queries. If it doesn't win, drop it;
the deterministic graph + grep is the default and is usually enough.

### 2. Repo-map quality tuning
Tune PageRank weights, personalization, and signature-rendering within the token budget. Measure by
whether the map surfaces the symbols an agent actually needs for a task.

### 3. Multi-workspace index cache
Cache and warm per-workspace SQLite indexes so switching workspaces (and the LSP restart it implies)
doesn't pay full reindex cost each time.

### 4. tree-sitter accelerator (documented fallback)
**Only if** LSP bulk latency hurts on the largest repos (EdgeFlight, Grimm's Bluff). Add tree-sitter as
a bulk symbol-extraction accelerator alongside LSP (LSP stays the source of truth for call edges).
This was explicitly deferred to this phase in the original plan — do not pull it forward unless the
latency problem is real and measured.

## Acceptance criteria

- [ ] Any item merged ships with a **before/after benchmark** justifying it.
- [x] Repo-map rank-order rendering — benchmark in `test/brain/code/repo-map-benchmark.test.mjs`.
- [x] Multi-workspace SQLite handle cache + startup/MRU warm — `test/brain/code/workspace-cache.test.mjs`.
- [x] Code semantic search — **skipped** (no held-out win over grep + graph; toggle stays off).
- [x] tree-sitter accelerator — **skipped** (no measured LSP bulk latency regression on large repos).
- [x] No regression in existing `test/brain/**`, `test/memory/**`, or code-index tests.
- [x] Typecheck + lint clean.

## Non-goals (reminder — do not build these)

- External MCP surface (explicitly dropped — Brain is internal only).
- Chat UI, cloud sync, replacing git/editor.
- Fine-tuning facts into weights (train only on stable wiki prose, if ever).
