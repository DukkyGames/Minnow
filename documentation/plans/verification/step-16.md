# Step 16 verification — Memory system

## Automated

```bash
npm run test:memory
npm run build
```

Expected: **7/7** memory tests pass.

## Smoke (npm start)

```bash
npx tsx scripts/step16-memory-smoke.mjs http://localhost:5173
```

## Manual

1. Enable memory in Settings → Memory.
2. `POST /api/memory/entries` with a note; send chat — composed prompt includes `## Retrieved memory`.
3. Disable memory — block absent on send.
