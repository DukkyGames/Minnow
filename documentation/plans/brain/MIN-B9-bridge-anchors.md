# MIN-B9 — The Bridge: symbol anchors + `explain_symbol` + anchor drift

**Phase 5 of 7. The differentiator — makes the two layers one brain.**

## Goal

Connect the wiki and the code index with **symbol anchors**. A wiki page declares the stable
`symbol_id`s it explains; the index stores the reverse. Then:
- **code → meaning:** `explain_symbol(symbol)` returns the design pages anchored to it.
- **meaning → code:** a page's anchors resolve to the current implementation via `read_symbol`.
- **anchor drift:** when an anchored symbol's `content_hash` changes, every page anchored to it is
  flagged `status: stale`.

**Milestone:** edit a symbol → the right design note flags itself stale (visible in Lint).

## Why

Nothing off-the-shelf bridges a synthesized wiki and a deterministic code graph. Anchors are how the
interpretive layer stays honest about the code without mirroring it.

## Depends on

**MIN-B7** (the `anchors` table + `symbols.content_hash` exist) and **MIN-B5/MIN-B3** (wiki store,
frontmatter, Lint, Brain app Code section with the Explain placeholder).

## Scope / files

### Activate `anchors[]` in frontmatter — `server/brain/store.js`
- `anchors[]` holds stable `symbol_id`s (`<repo>:<qualified.name>`) a page explains.
- On page write, populate the `anchors` SQLite table (the reverse index) with one row per anchor:
  `(page_id, symbol_id, repo, symbol_hash_at_synth)`, where `symbol_hash_at_synth` = the symbol's
  current `content_hash` at write time.
- On page delete/move, keep `anchors` in sync (delete/update by `page_id` — `id` is stable across
  moves, so a move updates path metadata only).

### `explain_symbol` — tool + route
- `/api/brain/code/explain(symbol)` → look up `anchors` by `symbol_id`, return the anchoring wiki pages
  (path, title, summary).
- Register the `explain_symbol` tool per the MIN-B4 checklist (seed `'full'`, back-fill existing
  configs). Read-only.
- meaning → code direction: resolving a page's `anchors[]` calls `read_symbol` (MIN-B7) to fetch the
  current implementation span.

### Anchor drift — extend `server/brain/lint.js`
- For each `anchors` row, compare the symbol's current `content_hash` (from `symbols`) to
  `symbol_hash_at_synth`.
- On mismatch: set the page's frontmatter `status: stale` and queue it for re-synthesis (use the
  synthesis state/queue from MIN-B3).
- Include drifted pages in the Lint report.

### Cross-language anchors
A page may anchor symbols in two repos (e.g. a TS frontend symbol and a Python backend symbol). These
cross-language links live **only in the wiki/anchors**, never in the deterministic `edges` graph.

### Brain app — fill the Explain panel (MIN-B8 stub)
- In the Code section, wire the Explain panel to `explain_symbol`: given a selected symbol, show its
  anchored pages (clickable into the Wiki viewer).
- Surface `status: stale` pages prominently in the **Lint** section.

### Prompt routing line
Add to `full.md` / `lite.md` (the placeholder from MIN-B4/B7): *explain this code* → `explain_symbol`
then `read_symbol`.

## Tests

- `explain_symbol` reverse lookup returns the page that anchors a given symbol.
- **Anchor drift:** write a page anchoring symbol X (records X's hash) → change X's source so its
  `content_hash` changes → reindex → lint flags the page `stale`.
- Cross-repo anchor: a page anchoring symbols in two repos resolves both implementations via
  `read_symbol`.
- Move a page → its anchors stay attached (keyed by stable `page_id`/`id`).

## Acceptance criteria (milestone)

- [ ] Write a page with `anchors: [<repo>:telemetry.dispatchTelemetry]`; `explain_symbol(...)` returns
      it.
- [ ] Edit that symbol → cascade/lint flags the page `stale` (visible in Lint).
- [ ] Explain panel in the Code section shows a symbol's anchored pages.
- [ ] Tests green; typecheck + lint clean.

## Out of scope

- Automated Merkle hashing and incremental reindex triggers (MIN-B10) — drift here is detected on
  lint/reindex, not via a file watcher.
- Scheduled batch re-synthesis (MIN-B10).
