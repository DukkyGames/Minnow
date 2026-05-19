# Step 06 verification — Expert system

## Prerequisites

- Node.js 20+
- Repo root: `c:\Users\dukky\Documents\Development\SpeedChat`

## Automated tests

```bash
npm test
```

Expert-only:

```bash
npx tsx --test test/experts/**/*.test.mjs
```

**Expected:** all tests pass (17 expert tests + existing suites).

## Build

```bash
npm run build
```

**Expected:** `tsc` and `vite build` exit 0.

## Manual checks (`npm start`)

1. Open the app; above the message input, confirm **mode segments** and **Expert** dropdown (`#expertSelect`).
2. Set Expert to **Auto**, send: `fix this TypeScript bug` — after send, `#expertAutoHint` shows `→ Software engineer` (or similar).
3. Set Expert to **Security reviewer**, send any message — composed system prompt includes security persona (Settings drawer legacy textarea is fallback only when compose is empty).
4. Settings → **Experts** → uncheck **Enable experts** — composer strip hides; sends omit expert part.
5. Re-enable experts; confirm six built-in experts appear in the dropdown (plus Auto).

## Config (`~/.speedchat/config.json`)

```json
{
  "experts": {
    "enabled": true,
    "classifier": "rules",
    "llmFallbackBelow": 0.55,
    "rulesMinScore": 3,
    "autoOmitWhenNoMatch": false
  }
}
```

**Note:** Send path uses **rules only** synchronously (LLM classifier module exists for `classifier: "llm"` / `"rules+llm"` but is not awaited on send to avoid blocking).

## Files touched (implementer checklist)

- `src/chat/experts/*` — registry, rules router, resolve, optional LLM classifier
- `src/chat/prompts/experts/` — six built-ins + `_template`
- `src/ui/expert-select.ts` — composer dropdown
- `src/config/experts-config.ts` — config load/save
- `test/experts/*.test.mjs` — unit tests
