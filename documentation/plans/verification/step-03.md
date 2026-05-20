# Step 03 verification — Multiple providers + API auth

## Automated

From repo root with **no** real `~/.minnow` touched (`MINNOW_HOME` set by tests):

```bash
npm test
npm run build
```

Provider-specific tests:

```bash
node --test test/providers/auth-headers.test.js test/providers/proxy-mock.test.js
```

## Environment

| Variable | Purpose |
|----------|---------|
| `MINNOW_HOME` | Temp directory for provider CRUD/proxy tests (set automatically in tests) |
| `MINNOW_DEBUG=1` | Optional: config ping includes `homePath` |

## Manual (`npm start`)

1. Start: `npm start` (note port, default **5173**).
2. Open Settings → **Provider** select lists `lm-studio-local` (and any others under `%USERPROFILE%\.minnow\providers\`).
3. Switch provider → model dropdown refreshes; status pill updates.
4. **Provider base URL** is read-only when file-backed providers API is up.
5. Secrets (curl example — replace port):

```bash
curl -s -X PUT http://localhost:5173/api/providers/lm-studio-local/secrets \
  -H "Content-Type: application/json" \
  -d "{\"apiKey\":\"your-key-here\"}"
```

Response must **not** echo the key: `{"ok":true,"hasApiKey":true,...}`.

6. Create a second provider (proxy recommended for non-localhost):

```bash
curl -s -X POST http://localhost:5173/api/providers \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"openrouter-fixed\",\"label\":\"OpenRouter\",\"baseUrl\":\"https://openrouter.ai/api\",\"apiKind\":\"openai-v1\",\"connectionMode\":\"proxy\"}"
```

7. `GET http://localhost:5173/api/providers` — JSON must not contain raw secrets.

## Pass criteria

- [ ] `npm test` and `npm run build` pass
- [ ] Two+ providers on disk; switching active changes models/chat target
- [ ] Secrets only under `~/.minnow/providers/*/secrets.json`
- [ ] Proxy routes attach auth headers (covered by `proxy-mock.test.js`)
- [ ] `documentation/context.md` documents provider layout and routes
