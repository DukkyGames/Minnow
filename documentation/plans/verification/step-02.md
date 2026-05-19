# Step 02 verification — `~/.speedchat` data layer

## Automated

```powershell
cd c:\Users\dukky\Documents\Development\SpeedChat
npm test
npm run build
```

**Config tests** use a temp `SPEEDCHAT_HOME` (see `test/config/test-helpers.js`). No writes to the real user profile.

| Suite | File |
|-------|------|
| Path guard | `test/config/resolve-config-path.test.js` |
| CRUD | `test/config/api-crud.test.js` |
| Migration | `test/config/migration.test.js` |

Fixtures: `test/fixtures/migration/*` (static expected JSON).

## Manual — file-backed mode (`npm start`)

1. Set a fresh home (optional):

   ```powershell
   $env:SPEEDCHAT_HOME = "$env:TEMP\speedchat-verify-step02"
   Remove-Item -Recurse -Force $env:SPEEDCHAT_HOME -ErrorAction SilentlyContinue
   ```

2. `npm start` — console should log `SpeedChat data: ...` and `Config API: .../api/config/ping`.

3. Open the app → Settings: **`#configStorageBanner` hidden**.

4. Create/rename a chat, toggle a tool, edit system prompt → restart `npm start` → state persists from disk (not `localStorage`).

5. DevTools → Application → confirm legacy keys cleared after migration (if you had data before).

6. Path traversal:

   ```powershell
   curl "http://localhost:5173/api/config/file?key=..%2F..%2Fetc%2Fpasswd"
   ```

   Expect **400** and `{ "error": "Invalid config path" }`.

## Manual — Vite-only (`npm run dev`)

1. `npm run dev` (no `SPEEDCHAT_HOME` override needed).

2. App boots; sessions/tools/prompt work via `localStorage`.

3. Settings shows **`#configStorageBanner`** (file-backed config requires `npm start`).

## PASS criteria

- [ ] `npm test` — 14 config tests + UI tests pass
- [ ] `npm run build` passes
- [ ] Empty home + `npm start` creates layout + default JSON files
- [ ] Migration from seeded `localStorage` writes fixture-equivalent files once
- [ ] `documentation/context.md` persistence section updated
