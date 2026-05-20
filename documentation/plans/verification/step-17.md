# Step 17 verification — LSP integration

## Automated

```bash
npm run test:lsp
npm run build
```

Expected: **4/4** LSP tests pass (includes fake-lsp integration).

## API (npm start)

```bash
curl http://localhost:5173/api/lsp/status
```

## Tool smoke

```bash
curl -X POST http://localhost:5173/api/tools -H "Content-Type: application/json" -d "{\"name\":\"get_lsp_diagnostics\",\"args\":{\"path\":\"test/fixtures/sample.fake\"}}"
```

Expected: formatted diagnostics containing `';' expected`.

## Settings UI

1. `npm start` → open `#/settings/lsp`.
2. Master toggle and per-server rows load from `GET /api/config/lsp` (not static placeholder).
3. Toggling a server persists via `PUT /api/config/lsp`.
