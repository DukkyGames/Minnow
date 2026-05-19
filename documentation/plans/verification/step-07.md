# Step 07 verification — programmatic chat titles

## Automated

```bash
cd c:\Users\dukky\Documents\Development\SpeedChat
npm test
npm run build
```

Expected:

- `test/titles/sanitize.test.mjs` — normalize quotes, length, fences
- `test/titles/generate.test.mjs` — mocked port, `max_tokens`, no `tools`
- `test/titles/schedule.test.mjs` — apply, rename race, duplicate guard, `titles.enabled: false`
- No `maybeAutoTitleFromFirstUserMessage` under `src/` (`rg maybeAutoTitle` → no matches)
- `tsc` + Vite build succeed

## Manual (`npm start`)

1. `npm start` → new chat shows **New chat** in sidebar.
2. Send first message → sidebar may stay **New chat** briefly, then a short model title (within a few seconds).
3. New chat → send first message → **rename** to `My thread` before title returns → generated title must **not** overwrite.
4. Second message in same chat → title unchanged.
5. Stop LM Studio / break provider → send still works; title stays **New chat** (fail silent).

## Checklist

- [ ] `src/chat/prompts/titles/` + README (override path)
- [ ] `src/chat/titles/` (`prompt`, `generate`, `schedule`, `sanitize`)
- [ ] Async, non-blocking, non-streaming title job
- [ ] Session save on success (`scheduleSaveSessions`)
- [ ] `documentation/context.md` updated
- [ ] Verifier: PASS / FAIL
