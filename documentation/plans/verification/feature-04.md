# Feature 04 — Recent workspaces menu — verification

**Feature ID:** `feature-04-recent-workspaces-menu` (Epic B1)  
**Build plan:** [`documentation/plans/Build out/feature-04-recent-workspaces-menu.md`](../Build%20out/feature-04-recent-workspaces-menu.md)

## Plan conformance

| Backlog item | Status |
|--------------|--------|
| Popover on `#btnWorkspace` (not immediate picker) | Implemented |
| Up to 10 MRU paths in `config.json` | Implemented |
| Checkmark / `aria-current` on current workspace | Implemented |
| Switch via recent row without dialog | Implemented |
| **Open new workspace…** → native picker | Implemented |
| Missing paths disabled + Remove | Implemented |
| `GET /api/workspace` includes `recent[]` | Implemented |
| `DELETE /api/workspace/recent` | Implemented |

## Automated

```bash
npm run build
npm test
```

Included in `npm test`:

- `test/workspace/workspace-api.test.js` — MRU persist, dedupe, cap, GET shape, DELETE
- `test/ui/workspace-recent-menu.test.mjs` — checkmark, disabled row, Escape close

## Manual QA

- [ ] **U1** — `npm start`: first click opens menu (not OS dialog); current folder has checkmark
- [ ] **U2** — **Open new workspace…** picks folder A; menu shows A first on reopen
- [ ] **U3** — Pick folder B; menu shows B then A
- [ ] **U4** — Click A in menu (no dialog); file tree root updates
- [ ] **U5** — Delete folder A on disk; row grayed; **Remove** drops it from list
- [ ] **U6** — Open 12+ folders; menu never shows more than 10
- [ ] **U7** — `npm run dev`: workspace button shows server-required error (no menu)

## Sign-off

| Check | Result |
|-------|--------|
| Acceptance criteria 1–9 | Pass (automated + code review) |
| `npm test` workspace + UI cases | Pass |
| Manual U1–U7 | Pending operator |

**Implementation sign-off:** Automated tests pass; manual checklist left for local QA on Windows.
