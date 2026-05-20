# Feature 20 — Drag-and-drop move with confirmation

## Automated

```bash
npx tsx --test test/file/path-utils.test.mjs test/file/file-tree-move-dialog.test.mjs test/file/file-tree-dnd.test.mjs
```

## Manual (`npm start`)

| # | Step | Expected |
|---|------|----------|
| M1 | Enable `move_file` **Ask** | DnD confirm dialog, then tool approval strip, then move |
| M2 | Drag `a.ts` onto `src/` folder | Dialog shows move into `src/`; file appears under `src/` |
| M3 | Drag folder into its child | Error status; no dialog |
| M4 | Drag file onto current parent | No-op; no dialog |
| M5 | Drag file to composer | Reference chip only; no move dialog |
| M6 | `move_file` **off** | After confirm, error status points to Settings |
| M7 | Move open file in viewer | Viewer path updates |
| M8 | Short click file row | Opens viewer; no accidental drag |

## Sign-off

- Automated: **PASS** (2026-05-20) — path-utils, move-dialog, dnd tests + `npm test`; commit `2d21408`
- Manual M1–M8: pending
