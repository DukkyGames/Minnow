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

## Verifier report (2026-05-19)

| Check | Result |
|-------|--------|
| `npx tsx --test test/self-healing/**/*.test.mts` | **PASS** — 2/2 detector tests |
| `npm run build` | **PASS** |
| `npm test` | **PASS** — 176/176 (includes self-healing suite) |
| `selfHealing.enabled` default | **false** (`server/config/home.js`, `defaults.ts`) |
| Settings → Features toggle | **PASS** — reads/writes `config.json` → `selfHealing.enabled` via `/api/config/file` |
| Tier 2 (explorer, skills, guardrails) | **Deferred** — tier-1 restart + R1 detector only; controller logs tier-2 deferred message on repeat signature |

**Overall: PASS** (tier-1 scope; tier-2 documented deferral).
