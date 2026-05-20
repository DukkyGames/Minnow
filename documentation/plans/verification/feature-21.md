# Feature 21 — File tree row padding (E4)

**Feature ID:** `feature-21-file-tree-padding`  
**Status:** Implemented

## Automated

```bash
npm test
```

Includes:

- `test/file/file-tree-layout.test.mjs` — constants + rendered `paddingLeft` at depth 2
- `test/file/file-tree-boot.test.mjs` — regression

## Manual QA (M1–M5)

| ID | Check | Result |
|----|-------|--------|
| M1 | Desktop: more rows visible in `#fileTreeHost`; click/hover/selection OK | |
| M2 | Touch emulation / phone: tap files/folders; rows easy to hit | |
| M3 | Drag file to composer; click without 5px move opens viewer | |
| M4 | Collapse/expand file sidebar rail — no rail regression | |
| M5 | Coarse pointer: row box ≥ 44px (`--touch-min`) | |

**Prerequisites:** `npm start`, workspace with nested tree (≥ 3 levels).

## Acceptance

1. Fine pointer: row height &lt; 40px (excluding margin) vs pre-change.
2. Coarse pointer: `min-height` 44px or padding yields ≥ 44px row box.
3. Click, expand, keyboard, drag-to-composer unchanged.
4. Selection/hover styling unchanged in character.
5. Long names ellipsis; chevron aligned at depth 3+.

## Sign-off

| Role | PASS/FAIL | Date | Notes |
|------|-----------|------|-------|
| Implementer | | | |
| Verifier | | | |
