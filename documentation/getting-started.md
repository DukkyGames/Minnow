# Getting started with Minnow

Developer setup, commands, configuration, and troubleshooting. For a product overview, see the [README](../README.md). For the full architecture reference, see [`context.md`](context.md).

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [npm scripts](#npm-scripts)
- [Headless CLI](#headless-cli)
- [The tool server](#the-tool-server)
- [Configuration & storage](#configuration--storage)
- [Packaging a desktop build](#packaging-a-desktop-build)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)
- [Documentation map](#documentation-map)

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Node.js 18+** | 20+ recommended (ES modules, Vite 6, native `node:test`). |
| **npm** | Ships with Node. |
| **LM Studio** (or any OpenAI-compatible provider) | Load a chat model and start the local server (default `http://localhost:1234`). Not strictly required to launch the UI, but needed to chat. |
| **Python 3** *(optional)* | Only for **local** voice STT/TTS — provisioned on demand. Provider-backed voice needs no Python. |
| **A C/C++ toolchain** *(optional)* | `better-sqlite3` and `@lydell/node-pty` ship prebuilt binaries for common platforms; a toolchain is only needed if a native rebuild is triggered. |

See [`guides/setup.md`](guides/setup.md) for a step-by-step setup walkthrough including providers, models, and voice.

---

## Quick start

### 1. Install dependencies

```bash
git clone https://github.com/DukkyGames/Minnow.git
cd Minnow
npm install
```

`postinstall` vendors the **Impeccable** UI-design skill into `src/skills/impeccable/` and ensures the **Electron** binary is present. Both steps are idempotent.

Optional document parsers (`optionalDependencies`) install best-effort; if PDF/Word/Excel attachments fail, install them explicitly:

```bash
npm install pdf-parse mammoth officeparser
```

### 2. Start a model provider

1. Open **LM Studio**, load a chat model.
2. Start its **local server** (Developer / Server tab → `http://localhost:1234`).
3. Confirm the model appears in LM Studio's server UI.

> Or point Minnow at Ollama, a `llama-server` instance, or a cloud API in **Settings → Models → Providers**. The **Models** app can also download and serve a model for you.

### 3. Run Minnow

```bash
npm start
```

This runs `node server.js`, which:

- starts **Vite** on port **5173** (or the next free port — watch the terminal),
- starts the **Node tool server** (files, git, config, generations, providers, skills, MCP, memory, brain, calendar, email, scheduler, …) on the same origin,
- prints **`Minnow data: <path>`** for your `~/.minnow` home (`%USERPROFILE%\.minnow` on Windows),
- launches the **Electron desktop shell** (Chromium) with the in-app browser preview.

> **Use `npm start`, not `npm run dev`,** whenever you want file/git tools, session persistence, the terminal, attachments, the browser preview, or any of the apps. `npm run dev` is **Vite-only** (UI/HMR) and most server features are unavailable.

**Open your system browser instead of Electron:** set `MINNOW_BROWSER=1`. **Suppress auto-open** (CI/headless): `BROWSER=none` or `MINNOW_HEADLESS=1`.

Custom port:

```bash
# bash
PORT=3000 npm start
# PowerShell
$env:PORT=3000; npm start
```

### 4. First run

1. Use the **Minnow desktop window** (or the printed URL if you set `MINNOW_BROWSER=1`).
2. The desktop **is** the chat surface — type in the concierge composer, or open an app from the **dock**.
3. Confirm your **provider** and server URL in **Settings → Models → Providers** (default LM Studio `http://localhost:1234`).
4. Pick a **model** from the menubar model chip (refresh if the list is empty).
5. Choose a **mode** in the composer (General / Build / Plan / Orchestrate / Reef / Debug).
6. Enable the capabilities you want under **Settings → Tools** (server tools need `npm start` and a healthy tools ping).

Verify the server is healthy:

```bash
curl http://localhost:5173/api/tools/ping   # {"ok":true}
```

---

## npm scripts

| Command | Description |
|---------|-------------|
| `npm start` | **Recommended** — Vite + tool server + `~/.minnow` APIs + Electron desktop shell. |
| `npm run desktop` / `npm run electron:dev` | Vite HMR + Electron window (no full tool server bootstrap of `server.js`). |
| `npm run dev` | Vite only (UI/HMR; most server features unavailable). |
| `npm run build` | Typecheck + production build → `dist/` (`prebuild` regenerates the skills manifest). |
| `npm run preview` | Preview the production `dist/` build (no tool API). |
| `npm run package` | Build + Electron build + **electron-builder** installer → `release/` (Windows NSIS by default). |
| `npm run package:dir` | Same, but an unpacked directory (no installer). |
| `npm run minnow:run -- --prompt "…"` | Headless CLI (see [below](#headless-cli)). |
| `npm test` | Full suite (`node --test` + `tsx`; ~hundreds of tests). |
| `npm run test:<area>` | Scoped suites — `memory`, `brain`, `engine`, `lsp`, `mcp`, `browser`, `skills`, `attachments`, `research`, `benchmark`, `evals`, `calendar`, `email`, `oauth`, `webhooks`, `notifications`, `voice`, `servers`, `plugins`, `terminal-pty`, `ui-designer`, `scheduler`. |
| `npm run impeccable:detect` | Anti-pattern scan of `src/` + `index.html` (exit code `2` = issues). |
| `npm run impeccable:sync` / `:update` | Re-vendor / update the Impeccable skill. |
| `npm run caveman:sync` | Refresh the upstream Caveman skill. |

Typecheck only: `npx tsc --noEmit`. A full command reference (CLI flags, smoke scripts, env vars) lives in [`guides/commands.md`](guides/commands.md).

---

## Headless CLI

Drive one agent turn without the UI — useful for CI, scripts, and the Scheduler. Requires the tool server (`npm start`, or pass `--start-server`).

```bash
# with a server already running
minnow run --workspace . --agent builder --mode build \
  --prompt "Summarize README.md" --json-out run.json
```

Common flags (`minnow run --help` for the full list): `--prompt`, `--stdin`, `--workspace`, `--agent`, `--mode`, `--model`, `--provider`, `--profile`, `--base-url`, `--start-server`, `--json` / `--json-out`, `--max-tool-turns`, `--no-approval`, `--persist-chat` / `--chat-id` / `--chat-name`, `--minnow-home`, `--quiet`.

Tools that need the browser UI (e.g. `ask_question`) fail with a clear error unless you opt into unsafe automation. See [`context.md`](context.md) for machine-readable output and exit codes.

---

## The tool server

When `npm start` is running, the UI and tools share one origin. Selected endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tools/ping` | GET | Health check (`{ "ok": true }`). |
| `/api/tools` | POST | Execute a tool — `{ name, args, modeId? }` → `{ result }` (Plan-mode write guard when `modeId` is `plan`). |
| `/api/config/ping` | GET | Config health + `~/.minnow` path. |
| `/api/generations` | POST | Start a buffered chat generation. |
| `/api/generations/:id/stream` | GET | SSE stream (replay + live). |
| `/api/generations/:id/cancel` | POST | Cancel a generation. |
| `/api/browser/screenshot/:id` | GET | PNG from `~/.minnow/screenshots/`. |

Plus `/api/memory/*`, `/api/brain/*`, `/api/models/*`, `/api/compare/*`, `/api/research/*`, `/api/calendar/*`, `/api/email/*`, `/api/scheduler/*`, `/api/webhooks/*`, `/api/oauth/*`, and more — see [`context.md`](context.md).

- **Path safety:** file/git tools resolve under the **workspace root** unless `TOOLS_ALLOW_ALL_PATHS=1`.
- **Browser-only tools** (`get_datetime`, `calculate`, `ask_question`, sub-agent/board tools, mode handoff, …) run in the page; calling them via `POST /api/tools` returns "Not implemented".
- **Built-in browser automation** (`browser_*`) needs the Electron shell; navigation is gated by `browser.allowedOriginPatterns`. In a plain browser tab these tools are hidden.
- **Web search:** choose **Brave**, **Tavily**, or **DuckDuckGo** in Settings → Tools (no silent fallback). Brave/Tavily need an API key.
- **Timeouts:** `execute_command`, `run_javascript`, and `run_python` time out after **30 seconds**.

---

## Configuration & storage

Everything persists under your Minnow home — `~/.minnow` (`%USERPROFILE%\.minnow` on Windows). Override for tests/isolation with `MINNOW_HOME=<dir>`.

| Path | Purpose |
|------|---------|
| `config.json` | Active provider, workspace, feature flags, voice/synthesis/oauth/webhooks settings. |
| `.key` | AES-256-GCM key for encrypted secrets (`0o600` on Unix). **Deleting it makes encrypted secrets unrecoverable.** |
| `sessions/state.json` | All chats and history (single blob). |
| `chats/` | Assistant/desktop chat workspaces. |
| `tools.json` | Tool permissions. |
| `providers/` | Provider profiles + encrypted secrets + capability probes. |
| `sub-agents.json` / `work-agents.json` | Agent types, concurrency, model + sampler bindings. |
| `skills/` + `skills.json` | User skills, enable flags, and synthesis proposals. |
| `rules.json` | Global user rules. |
| `profiles/` | Portable prompt/setup bundles. |
| `memory/` + `brain/` | Memory store, vectors, and the Brain wiki. |
| `models/` | Downloaded model artifacts + serve runtimes. |
| `evals/` | Eval task packs and results. |
| `calendar/`, `email/`, `scheduler*.json` | App data (calendar DB, mail cache + encrypted accounts, scheduler jobs/runs). |
| `webhooks*.json`, `oauth/`, `voice/` | Webhook subscriptions/secrets, OAuth tokens, voice runtime + installed models. |

In **Vite-only** mode (`npm run dev`), a few things fall back to browser `localStorage` (tool toggles under `minnow.tools`, a legacy session store, theme keys). Most features simply require the tool server.

Useful environment variables (full list in [`guides/commands.md`](guides/commands.md)): `PORT`, `MINNOW_HOME`, `MINNOW_BROWSER`, `MINNOW_HEADLESS`, `BROWSER=none`, `TOOLS_ALLOW_ALL_PATHS`, `MINNOW_OAUTH_REDIRECT_BASE`, `MINNOW_DEBUG`.

---

## Packaging a desktop build

```bash
npm run package        # installer (Windows NSIS → release/pkg)
npm run package:dir    # unpacked app directory
```

`package` runs `build` → `electron:build` → `electron-builder`. App id `org.grimmedia.minnow`; Windows target NSIS with `build/icon.ico`. `documentation/` is bundled as an extra resource and `@lydell/node-pty` is unpacked from the asar.

### Auto-update + releasing (MIN-384)

Packaged Windows installs auto-update from **GitHub Releases** (`DukkyGames/Minnow`) via `electron-updater`: the app checks on launch and every 4 hours, downloads in the background, and installs when the user clicks **Restart to update** (Settings → General → App updates, or the menubar pill). `npm run package` also emits `latest.yml` next to the installer — the updater feed metadata. Nothing is uploaded automatically (`--publish never`).

To ship a release:

1. Bump `version` in `package.json` (installs stay frozen on whatever version they see in the feed, so every release needs a bump).
2. `npm run package`.
3. Create a GitHub release tagged `v<version>` and attach **both** `Minnow-Setup-<version>.exe` and `latest.yml` (plus `.blockmap` if present). The release notes body is what users see under “What’s new”.
4. Mark the release as a **pre-release** to ship it to the **Beta** channel only; full releases go to everyone.

Known limitations: Windows builds are unsigned, so SmartScreen may warn on first install (auto-updates after that are silent). macOS auto-update requires code signing — the Settings section shows a disabled state with a signing note until certificates exist.

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| No models in the picker | LM Studio server running? Correct provider URL in Settings? Click refresh. |
| "Server tools need npm start" | Stop `npm run dev`; run `npm start`. |
| Tool can't read a file outside the repo | Expected unless `TOOLS_ALLOW_ALL_PATHS=1`. |
| PDF/Word/Excel attachment fails | Run `npm start`; install `pdf-parse` / `mammoth` / `officeparser`. |
| CORS / fetch errors on web tools | Run `npm start` so fetch is server-side; for login/SPA pages use `browser_navigate` + `browser_snapshot` in the desktop shell. |
| `browser_*` tools missing/failing | Use the Electron desktop app; enable them in Settings → Tools; check the allowlist patterns. |
| Context ring shows no limit | The loaded model may not report `context_length`. |
| Port already in use | Set `PORT` and open the printed URL. |
| `[providers] fetch failed` on startup | Normal without LM Studio running — provider discovery couldn't reach `localhost:1234`. |
| OAuth `redirect_uri_mismatch` | Redirect URI in the Google/Microsoft console must exactly match Settings → OAuth (port included). See the [OAuth guides](guides/). |

Smoke test (server running):

```bash
npx tsx scripts/sa16-smoke.mjs http://localhost:5173
```

More fixes in [`guides/troubleshooting.md`](guides/troubleshooting.md).

---

## Project layout

```
Minnow/
├── index.html              # App shell
├── server.js               # Dev/tool server: Vite + APIs + Electron launch
├── server/                 # Node APIs (config, tools, providers, generations,
│                           #   memory, brain, models, compare, research, calendar,
│                           #   email, scheduler, voice, mcp, lsp, webhooks, oauth, …)
├── electron/               # Electron main + preload + preview host
├── src/                    # TypeScript SPA
│   ├── os/                 # MinnowOS shell (desktop, dock, windows, apps)
│   ├── chat/               # Chat, modes, prompts, reef
│   ├── agents/             # Sub-agents, work agents, UI designer
│   ├── tools/              # Tool catalog + executors + permissions
│   ├── ui/ styles/ markdown/ theme.ts   # Views, CSS tokens, rendering
│   └── (models, compare, research, calendar, email, scheduler, voice, memory, …)
├── bin/minnow.mjs          # Headless CLI entry
├── public/                 # PWA manifest, service worker, icons, sounds
├── scripts/                # build, smoke, sync, and migration scripts
├── test/                   # node --test + tsx suites
├── dist/                   # Production build (after npm run build)
└── documentation/          # context.md, guides/, plans/, reference/
```

---

## Documentation map

- [`context.md`](context.md) — the **authoritative** architecture, tool catalog, API, and storage reference (dense, kept current).
- [`guides/`](guides/) — task-oriented guides:
  - [`setup.md`](guides/setup.md) — full install & setup walkthrough
  - [`commands.md`](guides/commands.md) — every command, script, flag, and env var
  - [`apps.md`](guides/apps.md) — tour of the MinnowOS apps
  - [`architecture.md`](guides/architecture.md) — high-level system map
  - [`configuration.md`](guides/configuration.md) — `~/.minnow`, `config.json`, providers, secrets
  - [`troubleshooting.md`](guides/troubleshooting.md) — common problems
  - [`oauth-google.md`](guides/oauth-google.md) / [`oauth-microsoft.md`](guides/oauth-microsoft.md) — Email/Calendar OAuth
- [`PRODUCT.md`](../PRODUCT.md) — product goals and tone.
- [`DESIGN.md`](../DESIGN.md) — visual design system and theme tokens.
- [`AGENTS.md`](../AGENTS.md) — notes for AI coding agents working in this repo.
