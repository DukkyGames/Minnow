# Historical migration artifacts

This folder holds **read-only snapshots** from the one-time Vite migration extractor (`scripts/migrate-extract.mjs`). They are **not** loaded by the app, tests, or build.

| File | Description |
| --- | --- |
| `_extracted-app.js` | Inline `<script>` body copied from legacy monolithic `index.html` before modularization under `src/`. |
| `_extracted-body.html` | `<body>` markup fragment from the same extraction (CDN tail stripped). |

**Current source of truth:** TypeScript modules under `src/` (especially `src/types.ts` for shared shapes). Re-running `node scripts/migrate-extract.mjs` overwrites these archive files only if you still have the old monolithic `index.html` layout; normal development does not need them.
