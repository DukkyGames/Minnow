# Feature 24 — User rules verification

## Automated

- [x] `npm run build` (TypeScript + Vite; pre-existing errors in unrelated files may block — run targeted tests below)
- [x] `node --test test/config/rules-crud.test.js`
- [x] `npx tsx --test test/tools/build-api-messages-rules.test.mts`
- [x] `node --test test/ui/settings-page-html.test.mjs` (rules section ids)

## Manual (R1–R5)

| ID | Step | Pass |
|----|------|------|
| R1 | Settings → Rules: enable, enter `RULES_MARKER_24`, Save | ☐ |
| R2 | Confirm `~/.minnow/rules.json` (or `MINNOW_HOME`) on disk | ☐ |
| R3 | Send chat; network/debug shows two `system` messages; second contains marker | ☐ |
| R4 | Disable rules toggle, Save, send — only one `system` message | ☐ |
| R5 | Stop server; textarea still readable from localStorage; restart + Save updates file | ☐ |

## Sign-off

- v1: global rules only; no `PART_ORDER` slot; no sub-agent injection
- Max rules text: 16 KiB UTF-8 (`413` on exceed)
