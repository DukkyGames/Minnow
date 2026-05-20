# Feature 23 — Manual memory add — verification

| Field | Value |
|-------|-------|
| **Feature** | `feature-23-manual-memory-add` (Epic F2) |
| **Status** | Implemented |

## Automated

- [x] `npm run build`
- [x] `npm test` (includes `test/ui/settings-page-html.test.mjs` add-form ids, `test/ui/memory-tags-parse.test.mjs`, `test/memory/memory-api.test.mjs` regression)

## Manual (U1–U7)

| # | Step | Result |
|---|------|--------|
| U1 | `npm start`, open `#/settings/memory` | |
| U2 | **Add memory** panel visible; offline banner hidden when server up | |
| U3 | Submit empty form → inline validation, no API call | |
| U4 | Add entry: title `Manual note`, body `Created from settings`, tags `manual, test` → success toast, form cleared, list shows **user** badge | |
| U5 | Stop server → add panel hidden / offline copy; list shows npm start message | |
| U6 | Optional: body > 32 KB → error | |
| U7 | `npx tsx scripts/step16-memory-smoke.mjs http://localhost:5173` passes | |

## Sign-off

**PASS** when automated checks pass and U1–U7 are verified in browser with `npm start`.
