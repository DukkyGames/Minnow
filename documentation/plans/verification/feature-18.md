# Feature 18 — File tree CRUD (E1) — verification

**Feature ID:** `feature-18-file-tree-crud`  
**Epic:** E — File panel

## Automated

```bash
npm run build
npm test
node --import tsx --import ./test/test-loader.mjs --test test/file/file-tree-ops.test.mts
node --import tsx --import ./test/test-loader.mjs --test test/file/file-tree-boot.test.mjs
```

| # | Check | Pass |
|---|-------|------|
| A1 | `npm run build` exits 0 | ✓ |
| A2 | `npm test` full suite green | ✓ |
| A3 | `file-tree-ops.test.mts` — parseToolResult, path helpers, clipboard | ✓ |
| A4 | `file-tree-boot.test.mjs` — offline/loading strings regression | ✓ |

## Manual (`npm start`)

| # | Step | Expected |
|---|------|----------|
| M1 | Right-click file → Open, Cut, Copy, Paste, Rename, Delete | Menu items; actions via tools |
| M2 | Right-click folder → New File/Folder, Cut, Paste, Rename, Delete | Folder menu; copy disabled for dirs v1 |
| M3 | Delete open file | Row gone; viewer closes |
| M4 | Rename open file | Viewer follows new path |
| M5 | Cut + Paste to folder | `move_file`; tree refresh |
| M6 | Copy + Paste file | `copy_file` duplicate |
| M7 | Path outside workspace | Status error |
| M8 | Tool `off` / `ask` | Blocked or approval modal |
| M9 | `npm run dev` only | CRUD disabled; boot empty state unchanged |

## Acceptance (AC1–AC10)

Automated: **AC9–AC10** via tests above. Manual: **AC1–AC8** (not run in this pass).

## Sign-off

| Gate | Result | Date |
|------|--------|------|
| Automated | **PASS** | 2026-05-20 |
| Manual UAT | Pending | — |
| **Overall (automated)** | **PASS** | 2026-05-20 |
