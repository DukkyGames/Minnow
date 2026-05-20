# Feature 01 — Top bar grouped actions — verification

**Feature ID:** `feature-01-topbar-grouped-actions`  
**Build plan:** [`documentation/plans/Build out/feature-01-topbar-grouped-actions.md`](../Build%20out/feature-01-topbar-grouped-actions.md)

## Automated

```bash
npm run build
npm test
```

Optional (with `npm start` running):

```bash
node scripts/feature01-topbar-smoke.mjs http://localhost:5173
```

## Manual QA

| ID | Steps | Pass |
|----|-------|------|
| U1 | Desktop ≥900px: six action icons read as one strip (small gaps); model + status on far right | ☑ |
| U2 | No vertical rule between workspace icon and model control | ☑ |
| U3 | Mobile ≤640px: title hidden; hamburger visible; icons tappable | ☑ |
| U4 | Width 375px: refresh hidden; files, terminal, settings reachable | ☑ |
| U5 | `#btnSettings` → full settings page; topbar hidden; back restores layout | ☑ |
| U6 | Exercise workspace, files, terminal, refresh, model change — same as pre-refactor | ☑ |

**Verified:** 2026-05-20 — implementer session (layout + `npm test`).
