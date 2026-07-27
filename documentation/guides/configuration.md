# Configuration & storage

Minnow is local-first: all durable state lives under your **Minnow home** directory. Nothing leaves your machine except requests to the model providers you configure.

For a complete list of every setting (UI sections, config keys, tools, and env vars), see **[settings-reference.md](../maintainer/settings-reference.md)**.

## Minnow home (`~/.minnow`)

Default: `~/.minnow` (`%USERPROFILE%\.minnow` on Windows). The path is printed at startup as `Minnow data: <path>`. Override with `MINNOW_HOME=<dir>` (handy for tests and isolated profiles).

| Path | Purpose |
|------|---------|
| `config.json` | Active provider, workspace, feature flags, and per-feature settings (voice, synthesis, oauth, webhooks). |
| `.key` | AES-256-GCM key for encrypted secrets (`0o600` on Unix). **Back this up.** |
| `sessions/sessions.db` | All chats and history (SQLite). Boot: summaries + lazy history; writes: PATCH dirty sets (full PUT fallback). Search: FTS5 `GET /api/config/sessions/search`. Legacy `state.json` imports once → `state.json.migrated`; rotating `state.json.backup` mirror. Rollback: `MINNOW_SESSIONS_STORE=json`. |
| `chats/` | Assistant/desktop chat workspaces + per-workspace active-chat memory. |
| `tools.json` | Per-tool permissions (`full` / `ask` / `off`) and path policy. |
| `providers/<id>/` | Provider profiles, encrypted `secrets.json`, and `capabilities.json` probes. |
| `sub-agents.json` | Sub-agent types, concurrency cap, model + sampler bindings. |
| `work-agents.json` | Work-agent provider/model bindings. |
| `skills/` + `skills.json` | User skills, enable flags, and synthesis proposals. |
| `rules.json` | Global user rules. |
| `profiles/` | Portable prompt/setup bundles (prompt meta + agent overrides + tool permissions). |
| `memory/` | Memory entries, vectors, and proposal queues. |
| `brain/` | The Brain wiki (markdown pages, `catalog.json` cache, `vectors.json`, `sources/`, `code/`). |
| `models/` | Downloaded artifacts, `downloads.json`, and serve runtimes. |
| `evals/` | Eval task packs and results. |
| `calendar/` | `calendar.db` (SQLite) + encrypted CalDAV secrets. |
| `email/` | `accounts.json`, encrypted `secrets/`, `cache/<accountId>/`, `automations.json`. |
| `scheduler.json` / `scheduler-runs/` / `scheduler-notifications.json` | Jobs, run history, reminders. |
| `webhooks.json` / `webhooks/secrets/` / `webhooks-deliveries.json` | Subscriptions, signing secrets, delivery log. |
| `oauth/` | Encrypted OAuth tokens (Google/Microsoft). |
| `voice/` | `installed.json` manifest + voice runtime state; models under `models/voice/`. |
| `screenshots/` | Browser-preview PNGs served by `/api/browser/screenshot/:id`. |
| `backups/` | Memory/brain backups. |

> **Encrypted secrets:** deleting or rotating `.key` makes all existing encrypted secrets (provider keys, email/CalDAV passwords, OAuth tokens, webhook secrets) **unrecoverable** — you'll have to re-enter them in Settings.

## `config.json` highlights

Managed through Settings; edit directly only if you know the shape ([`server/config/validators.js`](../../server/config/validators.js) normalizes it on load). Notable keys:

- **Provider / workspace** — active provider id and current workspace path.
- **`features.*`** — feature flags (e.g. `memoryInjection`).
- **`memory`** — `enabled`, inject char caps, and `embeddings` (`enabled`, `backend`, `modelId`, `providerId`, `blendWeight`, …).
- **`synthesis`** — post-turn memory/skill auto-learning (enabled, confidence threshold, utility model overrides). Default is suggest-and-confirm.
- **`toolCalls.useConstrainedDecoding`** — optional JSON-Schema-constrained tool turns.
- **`voice`** — `audio`, `stt`, and `tts` blocks (local vs provider vs browser).
- **`oauth.google` / `oauth.microsoft`** — BYO OAuth client id/secret (tokens stored separately under `oauth/`).
- **`webhooks.allowLocalHttp`** — dev-only, permits `http://127.0.0.1` webhook targets.
- **`desktopShell.closeToTray`** — when **true** (default), closing the Electron window hides Minnow to the system tray instead of quitting. Launch-at-startup is **not** stored here; Electron reads/writes the OS login item directly.

## Providers

Configured in **Settings → Models → Providers**. Each provider is an OpenAI-compatible base URL plus optional API key (encrypted). Minnow probes capabilities (tool calling, constrained decoding) per provider and caches them. Defaults assume LM Studio at `http://localhost:1234`.

The **Models** app can additionally download a model from Hugging Face and serve it locally with `llama-server`, auto-registering it as a provider.

## Vite-only fallbacks (`npm run dev`)

Without the tool server a few things use browser `localStorage`:

| Setting | Key |
|---------|-----|
| Tool toggles & web-search keys | `minnow.tools` |
| Legacy sessions (dev only) | `minnow-sessions-v1` |
| User-rules mirror | `minnow.userRules` |
| Theme | `minnow.theme`, `minnow.theme.followSystem`, `minnow.theme.family` |

Most features (files, git, persistence, terminal, apps) simply require `npm start`.

## Environment variables

See the [command reference](commands.md#environment-variables) for the full table — the most common are `PORT`, `MINNOW_HOME`, `MINNOW_BROWSER`, `BROWSER=none`, and `TOOLS_ALLOW_ALL_PATHS`.
