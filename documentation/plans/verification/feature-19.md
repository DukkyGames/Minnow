# Feature 19 — File tree name filter — verification

## Automated

```bash
npx tsx --test test/file/file-tree-filter.test.mjs test/file/file-tree-search.test.mjs test/file/file-tree-filter-render.test.mjs
npm test
```

Flat-list DOM integration is covered manually (M1–M3); unit tests cover matcher, index BFS, search input, and filter pipeline.

## Manual (`npm start`)

| # | Step | Expected |
|---|------|----------|
| M1 | Open Files sidebar, type partial basename | Flat list updates; files in collapsed folders appear |
| M2 | Clear filter | Lazy tree returns; prior expanded folders still expanded |
| M3 | Click result file | Viewer opens correct path |
| M4 | Query with no matches | “No matching files” |
| M5 | Refresh tree button | Index invalidated; re-filter rebuilds index |
| M6 | `npm run dev` only | Search disabled; offline tree message unchanged |
| M7 | Collapse file sidebar rail | Search input hidden with tree |
| M8 | Large repo (optional) | “Indexing project…” shown; UI stays responsive |

## Sign-off

- v1: **name filter only** (subsequence on basename); no content/ripgrep search
- Phase 2: content search documented in [`feature-19-file-search.md`](../Build%20out/feature-19-file-search.md) — not shipped
- Automated: **PASS** (2026-05-20) — filter/search/render tests + `npm test`; commit `42887a3`
