# Feature 25 — Prompt token estimate verification

**Plan:** [`documentation/plans/Build out/feature-25-prompt-token-estimate.md`](../Build%20out/feature-25-prompt-token-estimate.md)

## Automated

```bash
npm run build
npm test
```

Includes:

- `test/chat/token-estimate.test.mjs`
- `test/chat/outbound-prompt-estimate.test.mts`
- `test/ui/settings-page-html.test.mjs` (estimate element ids)

## Manual QA

1. `npm start`, open Settings — header shows `~N tokens (estimate)`.
2. **Prompting** → switch Full → Lite → total drops.
3. Long active chat history → estimate higher than empty chat.
4. **Tools** → disable tools → tools portion in breakdown drops.
5. Send a message; devtools `[Minnow] composed system prompt` composed tokens ≤ settings **System** line (settings total includes history + tools).
6. Memory enabled with entries → system bucket grows after fetch.

## Sign-off

PASS when acceptance criteria 1–9 in the feature plan hold.
