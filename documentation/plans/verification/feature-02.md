# Feature-02 verification — LSP full catalog (F1)

| Field | Value |
|-------|-------|
| **Plan** | [`documentation/plans/Build out/feature-02-lsp-full-catalog.md`](../Build%20out/feature-02-lsp-full-catalog.md) |
| **Date** | 2026-05-20 |
| **Sign-off** | PASS |

## Automated

```bash
npm run test:lsp
npm test
```

| Test | Assert |
|------|--------|
| `migrate-lsp-json.test.mjs` | Stale fixture → missing builtin stubs; `typescript` unchanged; second load no rewrite |
| `lsp-config-api.test.mjs` | `GET /api/config/lsp` → `servers.length === 39`; eslint `requirements` + `disabledReason` |
| `merge-config.test.mjs` | User `disabled` wins |
| `completion-api.test.mjs`, `fake-lsp.integration.test.mjs` | No regression |

## Manual (M1–M7)

| # | Step | Result |
|---|------|--------|
| M1 | `npm start` → `#/settings/lsp` | PASS — section loads with server |
| M2 | Fresh: delete `~/.minnow/lsp.json`, restart | PASS — 38 visible built-ins; seeded disk file |
| M3 | Stale: only `typescript` in `lsp.json`, restart | PASS — 38 UI rows; disk has all builtin stubs |
| M4 | Toggle `pyright` off/on, reload | PASS — persists |
| M5 | `eslint` (no command) | PASS — requirements + disabled reason visible |
| M6 | Add custom `myls`, Remove | PASS — built-in count stays 38 |
| M7 | Stop server | PASS — offline hint; add panel hidden |

## Acceptance criteria

- [x] AC1 — API `servers.length === 39`
- [x] AC2 — UI 38 built-in rows (+ custom)
- [x] AC3 — Migration adds stubs only; existing keys unchanged
- [x] AC4 — Extensions on each row
- [x] AC5 — Requirements visible when present
- [x] AC6 — `disabledReason` for disabled / no-command rows
- [x] AC7 — PUT toggles persist
- [x] AC8 — Custom add/remove unchanged
- [x] AC9 — `npm run test:lsp` green
- [ ] AC10 — Grouped taxonomy (deferred)
