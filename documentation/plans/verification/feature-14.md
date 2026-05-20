# Feature 14 — Stop generation (verification)

| Field | Value |
|-------|-------|
| **Feature** | `feature-14-stop-generation` (Epic C1) |
| **Status** | Shipped |

## Automated

```bash
npm run build
npx tsx --test test/chat/stop-generation.test.mts test/chat/finalize-stopped-turn.test.mts test/ui/composer-send.test.mjs
```

- `stopGeneration()` aborts active `chatFetchAbort`
- Stopped checkpoint uses `buildPendingSnapshot` + `markMessageStopped`
- Composer `setComposerStreamingMode` toggles send/stop affordance

## Manual (M1–M8)

1. **Basic stream** — Send; click Stop mid-token → partial text, stopped chip, status **Stopped**, send mode returns.
2. **Thinking** — Reasoning model; stop during **Thinking…** → no error bubble.
3. **Tool turn** — Stop during **Running tools…** → no hang; sub-agents cancelled when spawned.
4. **Multi-round** — Stop during second assistant stream after tools → prior tool rows remain.
5. **Reload** — After stop, refresh → **Continue / Discard** banner (pending turn), stopped styling on checkpoint row.
6. **Tool approval** — Approval strip hides composer; after close, Stop works on next stream.
7. **Double stop** — Two Stop clicks → clean idle state.
8. **Plain send** — If using `sendMessagePlain`, same stop/finalize behavior.

## Sign-off

| Check | Result |
|-------|--------|
| AC1–AC8 (code + unit tests) | **PASS** (2026-05-20: `stop-generation`, `finalize-stopped-turn`, `composer-send` via tsx+test-loader) |
| `npm run build` | **PASS** |
| Manual M1–M8 | Pending operator run |

## Verification commands (2026-05-20)

```bash
node --import ./test/test-loader.mjs ./node_modules/tsx/dist/cli.mjs --test test/chat/stop-generation.test.mts test/chat/finalize-stopped-turn.test.mts test/ui/composer-send.test.mjs
npm run build
```
