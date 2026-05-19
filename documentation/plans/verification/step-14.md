# Step 14 verification — Impeccable built-in

## Automated

```bash
npm install
node --test test/skills-impeccable.test.mjs
npm run test:skills-impeccable
npm test
npm run build
npm run impeccable:sync
```

Optional (network / may report anti-patterns):

```bash
npm run impeccable:detect
```

With dev server running (`npm start` in another terminal):

```powershell
# Windows
curl -s http://localhost:5173/api/skills | findstr impeccable
```

```bash
# Unix
curl -s http://localhost:5173/api/skills | grep impeccable
```

Expected: JSON includes `"id":"impeccable"` (or `"id": "impeccable"`).

API smoke (temp home, free port):

```powershell
$env:SPEEDCHAT_HOME = "$env:TEMP\speedchat-step14-verify"
$env:PORT = "5197"
npm start
# then: Invoke-WebRequest http://localhost:5197/api/skills
```

## Manual

1. Open app → composer → type `/` → **Impeccable** listed with built-in badge.
2. Select `/impeccable` → send “list commands” → model acknowledges design commands / context files.
3. Confirm `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json` were **not** modified by `npm install` or sync.
4. `node src/skills/impeccable/scripts/speedchat-context.mjs` prints JSON with `designJson.schemaVersion === 2`.

## Result (verifier re-run 2026-05-19)

| Check | Status |
|-------|--------|
| `npm install` + postinstall sync | **PASS** |
| `test/skills-impeccable.test.mjs` | **PASS** (10/10) |
| `npm run test:skills-impeccable` | **PASS** (10/10) |
| `npm test` | **PASS** (node 43/43 + tsx 98/98 = **141/141**) |
| `npm run build` | **PASS** (`prebuild` manifest 10 skills incl. `impeccable`) |
| `npm run impeccable:sync` | **PASS** (idempotent) |
| `GET /api/skills` includes impeccable | **PASS** @ `http://localhost:5197` (`SPEEDCHAT_HOME` temp) |
| `npm run impeccable:detect` | (optional; not run in verifier pass) |
| Manual `/` picker | (deferred) |

**Overall: PASS**
