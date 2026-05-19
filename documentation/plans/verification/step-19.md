# Step 19 verification — Self-healing

## Automated

```bash
npx tsx --test test/self-healing/**/*.test.mts
npm run build
```

Expected: **2/2** detector tests pass.

## Config

`~/.speedchat/config.json` → `selfHealing.enabled` (default **false**). Enable in Settings → Features for manual tier-1 restart tests.

## Manual (deferred)

Full orchestrator tier-1 restart during live sub-agent run with duplicate tool calls.
