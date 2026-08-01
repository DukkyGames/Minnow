# Troubleshooting

Common problems and fixes. If a fix mentions a setting, it's under the in-app **Settings** unless noted.

## Startup & server

| Problem | Fix |
|---------|-----|
| `[providers] fetch failed` on startup | Normal without LM Studio running — provider discovery couldn't reach `localhost:1234`. Start a provider or ignore. |
| Port already in use | Set `PORT` and open the printed URL: `PORT=3000 npm start` (PowerShell: `$env:PORT=3000; npm start`). |
| Nothing opens on `npm start` | You may have `BROWSER=none` / `MINNOW_HEADLESS=1` set. Open the URL from the terminal, or set `MINNOW_BROWSER=1` for a system browser tab. |
| Desktop shell slow on first launch | After `npm install`, Vite may log **Re-optimizing dependencies** (can take 1–2 minutes on a cold start). Electron compile is pre-run in `postinstall`; if you skipped it (`MINNOW_SKIP_ELECTRON=1`), run `npm run electron:build`. Terminal should show `[electron:dev] Waiting…` and periodic still-waiting lines until the server is ready. |
| `[server] The file does not exist at …/node_modules/.vite/deps/dist-*.js` | Stale Vite dep-optimizer cache or a client requesting an old hashed chunk (common with CodeMirror language modes). **Fix:** stop the dev server, delete `node_modules/.vite`, restart with `npm start`. If it persists after a dependency change, hard-refresh the Electron window (**View → Reload**) or clear site data for `localhost`. Minnow pre-warms editor deps on boot to reduce this race. |
| "Local tools need Minnow running" | You're in preview-only mode. Close other dev sessions and open the full Minnow app. |
| Health check | `curl http://localhost:9473/api/config/ping` requires the session token (`X-Minnow-Token` header). Read it from `~/.minnow/session-token` after the server starts, or use the in-app UI. Also `/api/tools/ping`, `/api/memory/ping`, `/api/brain/ping`, `/api/diagnostics/ping`. |
| `npm install` rebuild errors (native modules) | `better-sqlite3` / `@lydell/node-pty` need a toolchain only if prebuilt binaries are unavailable. Ensure Node 18+/20+ and try again, or install platform build tools. |

## Local diagnostics (no telemetry)

Minnow captures errors **locally only** — nothing is sent off-device.

| What | Where |
|------|--------|
| In-app viewer | **Settings → Advanced → Health & diagnostics** — health strip, grouped recent errors, log tail, **Copy report** (redacted markdown) |
| Log files | `~/.minnow/logs/diagnostics.jsonl` (server/child-process), `~/.minnow/logs/crash.jsonl` (Electron/renderer) |
| Health API | `GET /api/diagnostics/health`, `GET /api/diagnostics/errors`, `GET /api/diagnostics/report` |
| Debug agent tool | `read_diagnostics` (permission `ask` by default; available in **Debug** mode) |

**Copy report** redacts home paths, API keys, tokens, and URLs. Use it when filing bugs or asking for help.

| Problem | Fix |
|---------|-----|
| Errors not showing in Health & diagnostics | Run `npm start` so the tool server can read `~/.minnow/logs/`. Renderer errors in Electron also land in `crash.jsonl` via the desktop shell. |
| Empty health strip | Server offline — start with `npm start` and open **Settings → Advanced → Health & diagnostics** again. |
| Agent cannot read diagnostics | Enable **read_diagnostics** under Settings → Tools; switch chat to **Debug** mode; approve the tool when prompted (`ask` permission). |

## Models & chat

| Problem | Fix |
|---------|-----|
| No models in the picker | Is the provider server running? Is the base URL correct in Settings → Models → Providers? Click refresh. |
| Empty assistant replies / garbled stream | Verify the provider's `chatCompletionsPath` is OpenAI-compatible (`/v1/chat/completions`). Some non-OpenAI SSE formats (e.g. `llmster`) can yield empty text. |
| Context ring shows no limit | The loaded model doesn't report `context_length`. |
| Tools never get called | Use a tool-calling-capable model; enable the tools in Settings → Tools; check per-tool permission isn't `off`. |
| Images ignored | Use a vision (VLM) model for image attachments. |

## Tools & files

| Problem | Fix |
|---------|-----|
| Tool can't read a file outside the repo | Expected — file/git tools are sandboxed to the workspace root. Set `TOOLS_ALLOW_ALL_PATHS=1` only if you understand the risk. |
| `get_datetime` / `calculate` return "Not implemented" via `/api/tools` | These are browser-only tools; they run in the page, not the server. |
| PDF / Word / Excel attachment fails | Run `npm start`; install parsers: `npm install pdf-parse mammoth officeparser`. |
| CORS / fetch errors on web tools | Run `npm start` so fetch is server-side. For login/SPA pages use `browser_navigate` + `browser_snapshot` in the desktop shell. |
| Web search does nothing | Pick a provider in Settings → Tools (Brave / Tavily / DuckDuckGo) and add the API key for Brave/Tavily. There is no silent fallback. |

## Browser automation

| Problem | Fix |
|---------|-----|
| `browser_*` tools missing | They require the **Electron** desktop shell — use `npm start` or `npm run electron:dev`, not a plain browser tab. |
| `browser_navigate` blocked | The target origin isn't in `browser.allowedOriginPatterns`. Add it under Settings → Tools → Built-in browser automation, or approve when prompted. |

## Apps

| Problem | Fix |
|---------|-----|
| OAuth `redirect_uri_mismatch` | The redirect URI in the Google/Microsoft console must exactly match Settings → OAuth, port included. Only relevant to the release-gated Email/Calendar apps. |
| OAuth `access_denied` (Google) | Add your account as a **test user** on the consent screen while the app is in Testing mode. |
| Email / Calendar / Compare / Bench / Experts app missing | Expected — these are release-gated off (`releaseState: 'hidden'`). They have no dock tile, route, or tools. See [apps.md](apps.md#behind-the-release-gate). |
| Email won't send | *(hidden app)* By design — send always requires explicit confirmation. Also: Outlook tenants often block IMAP/SMTP basic auth; prefer Graph/OAuth. |
| Scheduler job didn't run | Jobs only run while Minnow is open (`npm start` / desktop shell). Check the run history and the job's workspace/model. |
| Local voice fails to start | Local STT/TTS provisions a Python worker — ensure Python 3 is available, or switch to a provider-backed voice in Models → Voice. |

## Secrets & data

| Problem | Fix |
|---------|-----|
| All credentials disappeared | `~/.minnow/.key` was deleted/rotated — encrypted secrets are unrecoverable. Re-enter them in Settings. |
| Want a clean profile | Run with `MINNOW_HOME=<temp-dir> npm start` to use a fresh data directory. |

## Smoke tests

With the server running (substitute your port):

```bash
npx tsx scripts/sa16-smoke.mjs http://localhost:9473
node test/terminal-stream.test.mjs http://localhost:9473
npx tsx scripts/step16-memory-smoke.mjs http://localhost:9473
```

Still stuck? The exhaustive reference is [`../context.md`](../context.md), and active issues/fixes are tracked under [`../plans/`](../plans/).
