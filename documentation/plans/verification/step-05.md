# Step 05 verification — operating modes

## Fix note (2026-05-19)

Server `server/config/validators.js` `ensureChatShape` was missing `modeId`, `expertSelection`, and `lastResolvedExpertId`, so `PUT /api/config/sessions` stripped them. Aligned with client `src/state/sessions.ts`. Added `test/config/api-crud.test.js` case **PUT sessions round-trip preserves modeId**.

## Automated

```bash
npm test
npm run build
npx tsx test/modes/run-all.mts
npx tsx scripts/step-05-smoke.mjs http://127.0.0.1:<port>
```

Expected:

- All `test/modes/*.test.mts` pass (path resolution, loader bodies, tool policy, composer mode part, chat `modeId` shape).
- Typecheck + Vite build succeed.

## Manual (`npm start`)

1. Mode selector appears **above** the attachment row in the composer (not in the top bar).
2. New chat defaults to **Build**; switch to **Plan** → status pill “Mode: Plan”.
3. Second chat set to **Orchestrate**; switch back to first chat → mode restores.
4. Reload app → per-chat `modeId` persists in `~/.speedchat/sessions/state.json` (or `speedchat-sessions-v1` in Vite-only).
5. **Plan** send: DevTools → chat request `tools` array omits `execute_command` (and other denied ids).
6. **Research** send: read/web tools still present when enabled in Settings; `save_file` omitted.
7. While streaming, mode segments are disabled.
8. Optional: `npx tsx scripts/step-05-smoke.mjs http://localhost:5173` when server is up.

## Checklist

- [ ] Four modes in registry + `MODE_TEMPLATE` pack under `modes/_template/`
- [ ] Production prompts at `modes/*.full.md` / `*.lite.md`
- [ ] `composeSystemPrompt` includes mode fragment when `modeId` set
- [ ] `getEnabledToolDefinitionsForMode` wired in `loop.ts`
- [ ] `documentation/context.md` updated
- [ ] `documentation/plans/references/mode-sources.md` present
