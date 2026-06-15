# MIN-B8 — Brain app: Code section UI

**Phase 4c of 7. The Code section in the Brain app.**

## Goal

Add the **Code** section to the Brain app: a repo-map viewer, a `find_symbol` search box, and index
status + a **Reindex** button. The Explain panel (anchored pages) is stubbed here and filled in by
MIN-B9.

## Why

MIN-B7 makes the code index usable by agents and over HTTP; this gives a human a way to browse the map,
search symbols, and trigger a reindex.

## Depends on

**MIN-B5** (Brain app shell + section routing) and **MIN-B7** (`/api/brain/code/*` routes + tools).

## Scope / files

- New module under `src/ui/brain/` for the Code section, registered in `src/ui/brain-page.ts`'s lazy
  `renderBrainSection` and section routing (`#/app/brain/code`).
- Extend `src/brain/client.ts` + `src/brain/types.ts` with the `/api/brain/code/*` calls
  (`repo_map`, `find_symbol`, `who_calls`, `read_symbol`, `status`, `reindex`).
- UI elements:
  - **Repo-map viewer** — render the signature-only, token-budgeted map; show the active repo and the
    token budget; allow setting a `focus`.
  - **`find_symbol` search box** — type a query, list matches; clicking a result shows its def
    (`read_symbol`) and its `who_calls` / `calls_of` edges.
  - **Index status + Reindex button** — show last-indexed state from `status`; Reindex triggers
    `reindex` and reflects progress/completion.
  - **Explain panel** — a placeholder/disabled panel here; MIN-B9 wires it to `explain_symbol`.
- Code-index settings (`config.brain.code.*` from MIN-B7) — surface the editable fields in the Brain
  **Settings** section (include/exclude globs, repo-map token budget, reindex cadence, code-embeddings
  toggle).

## Verification (preview workflow — required)

1. `npm run dev`; point the workspace at Minnow itself.
2. Open Brain → **Code** → **Reindex**.
3. Search a known symbol (e.g. `retrieveMemoryBlock`); confirm the def + call sites render.
4. Confirm the repo map renders within budget and `status` shows the index is current.
5. Screenshot the Code section as proof. Check `preview_console_logs` for errors.

## Acceptance criteria

- [ ] Code section renders the repo map, supports symbol search with def + call-site drill-down, shows
      index status, and triggers Reindex.
- [ ] Code-index settings are editable in the Settings section.
- [ ] No FOUC; no console errors.
- [ ] Typecheck + lint clean.

## Out of scope

- The Explain panel's real behavior and anchors (MIN-B9) — stub only.
