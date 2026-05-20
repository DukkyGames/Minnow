# Feature 28 — Composer tools button — verification

| Field | Value |
|-------|-------|
| **Feature** | `feature-28-composer-tools-button` (Epic F5) |
| **Plan** | [`documentation/plans/Build out/feature-28-composer-tools-button.md`](../Build%20out/feature-28-composer-tools-button.md) |

## Automated

- [x] `npm run build`
- [x] `npm test` (includes `test/tools/tools-list-sync.test.mjs`, `test/ui/settings-page-html.test.mjs` composer ids)

## Manual (§9.2)

| # | Step | Result |
|---|------|--------|
| M1 | Tools button beside paperclip in composer | |
| M2 | Popover lists tools; descriptions hidden in composer variant | |
| M3 | `read_file` → Full → no approval in workspace | |
| M4 | Requires permission → approval strip | |
| M5 | Disabled → tool absent from request | |
| M6 | Server down → server tools disabled + banner | |
| M7 | Popover change syncs drawer `#toolsList` | |
| M8 | Settings page change syncs popover | |
| M9 | Reload preserves permissions | |
| M10 | Mobile: popover scrolls, send reachable | |
| M11 | Tool approval hides composer (tools button not interactable) | |

## Sign-off

**PASS** when automated checks pass and M1–M11 verified with `npm start`.
