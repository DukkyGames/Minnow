# Step 04 verification — programmatic prompts

## Automated

```bash
npm test
npm run build
```

Expected: all `test/prompts/*` tests pass (composer, loader, profiles, custom, prompt-configs API).

## Manual (npm start)

1. Start dev server: `npm start`.
2. Open app, send a chat message with tools enabled.
3. In DevTools → Network → `chat/completions` request body:
   - `messages[0].role` is `system`.
   - Content includes base + tool-usage sections (and info preset if `activeInfoPresetId` set).
4. Optional: `GET /api/prompt-configs` returns `{ configs: [] }` on fresh home.
5. `PUT /api/prompt-configs/my-debug-setup` with plan example JSON; set `activePromptProfile: custom` and `activePromptConfigId` in `config.json`; resend — overrides appear in system message.

## Checklist

- [ ] `src/chat/prompts/` tree with `_example/`, `base/`, `tool-usage/`, `info/` presets
- [ ] `composeSystemPrompt` used on tool send path (`loop.ts`)
- [ ] `sendMessagePlain` uses same compose path (`api/chat.ts`)
- [ ] Lite length ≤ 40% of Full (unit test)
- [ ] Custom `contentOverride` and `enabled: false` (unit tests)
- [ ] `_example/` excluded from loader
- [ ] `documentation/plans/references/prompt-sources.md` present
- [ ] `documentation/context.md` updated
