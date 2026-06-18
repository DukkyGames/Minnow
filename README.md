# Minnow

**A local-first AI workspace for [LM Studio](https://lmstudio.ai/) and other OpenAI-compatible providers.**

Minnow started as a fast browser chat client and has grown into **MinnowOS** — a desktop, OS-style shell that wraps streaming chat, an agent layer with **~88 built-in tools**, sub-agents, and a suite of focused apps (Code, Models, Compare, Bench, Research, Experts, Brain, Calendar, Email, Scheduler) around your local models.

Built with **Vite + TypeScript** (single-page app), a **Node tool server** (`server.js`) for filesystem/git/provider/persistence APIs, and an **Electron desktop shell** (Chromium `WebContentsView`) for the in-app browser preview and native window. All state lives under `~/.minnow` on your machine — nothing is sent anywhere except the model providers you configure.

> **New here?** Jump to [Quick start](#quick-start). For a deeper tour of the apps see [`documentation/guides/apps.md`](documentation/guides/apps.md); for the full architecture reference see [`documentation/context.md`](documentation/context.md).

---

## Table of contents

- [What's in the box](#whats-in-the-box)
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

## What's in the box

### Chat & models

- **LM Studio (default)** plus **multi-provider routing** — any OpenAI-compatible endpoint (Ollama, llama.cpp `llama-server`, cloud APIs). Friendly model labels, load/unload, context-length-aware picker, **All / Local / Cloud** host filter.
- **Streaming chat** with markdown, syntax highlighting, reasoning/thought bubbles, and HTML sanitization.
- **Backend-owned generations** — attach, detach, cancel, and resume streams across reloads (`/api/generations`).
- **Inference metrics strip** — tok/s, TTFT, and per-turn stats as compact instrumentation.
- **Context usage ring** beside Send — live token fill with a per-section breakdown (system, rules, tools, history, composer, attachments).
- **Blind A/B compare** (Compare app) — run **2–6 models** on one prompt, parallel or sequential, vote blind, track win rates.

### Agent layer

- **~88 built-in tools** across web, utility, files, git, code, agents, browser (CDP preview), and LSP categories — OpenAI-style function calling.
- **Six operating modes** — **General**, **Build**, **Plan** (read-only/no-destructive guard), **Orchestrate** (board + plans), **Reef** (sandboxed inline widgets), **Debug** (bug tracker + `bug_*` tools).
- **Sub-agents** — `spawn_sub_agent` with concurrency limits, live cards, transcript drawer, per-type model/sampler bindings, and persisted runs.
- **Work agents** — composer-selectable agents with per-agent provider/model bindings.
- **Orchestrate board** — kanban tied to plans under `documentation/plans/`; `board_*` tools, sub-agent cards, and a drawer.
- **Skills** — `/` slash picker for built-in and user `SKILL.md` packs (includes **Impeccable** UI design and **Caveman** compression).
- **Tool permissions** — per-tool `full` / `ask` / `off`, path policy, and an in-chat approval modal.
- **Programmatic prompts** — full / lite / custom prompt profiles, prompt diffing vs. shipped defaults, and portable prompt bundles.

### Memory & knowledge

- **Memory** — `save_memory` tool plus a Settings panel; **semantic embeddings** (local `@xenova/transformers` or a provider `/v1/embeddings`) for hybrid keyword + vector recall.
- **Brain wiki** (CORTEX) — an on-disk markdown knowledge base at `~/.minnow/brain/` with `brain_*` tools, code-symbol indexing (`repo_map`, `find_symbol`, `who_calls`), and post-turn synthesis proposals.

### Workspace & IDE surfaces

- **Code app** — file tree, CodeMirror editor with AI completion, CRUD, search, drag-to-composer workspace references.
- **Integrated terminal** — xterm.js PTY tabs (requires the tool server).
- **LSP** — diagnostics + server tools (TypeScript, Python/Pyright, Bash, YAML, JSON, Docker, GraphQL, …).
- **MCP** — Context7 built-in; add custom MCP servers in Settings.
- **Built-in browser automation** — `browser_*` tools drive the same Electron preview panel you see in the UI (origin-allowlisted).

### Productivity apps (MinnowOS)

- **Models** — hardware-aware recommendations, Hugging Face downloads, local `llama-server` serving, provider/routing/sampler/usage settings.
- **Bench** — in-app benchmark battery + run history for the active model.
- **Research** — deep multi-step web research with progress steppers, a saved-report library, and a discuss panel.
- **Experts** — an "Experts' Lab" of specialist sandbox chats.
- **Calendar** — local SQLite store, month/week views, `.ics` import/export, RRULE recurrence, encrypted CalDAV + Google OAuth sync, `manage_calendar` tool.
- **Email** — agent-first IMAP/Gmail/Graph triage, AI summaries/tags, draft replies, and explicit-confirm SMTP send (`list_mail`, `draft_reply`, … tools).
- **Scheduler** — local recurring agent jobs (interval or cron) with run history and in-app reminders.

### Voice, attachments & extras

- **Voice I/O** — provider or local STT dictation (Whisper) and TTS read-aloud (Qwen3-TTS); managed under **Models → Voice**.
- **Attachments** — images (for VLM models), text/code, PDF, Word, Excel (optional parsers).
- **Notifications** — a session inbox in the menubar bell (chat/tool/sub-agent/scheduler/research events) with optional sounds.
- **Eval harness** — task packs, a suite-matrix runner, LLM rubric grading, and a leaderboard under Settings → Evals.
- **Outgoing webhooks** — HMAC-signed JSON deliveries for `chat.completed` / `session.created` with an SSRF guard.
- **Encrypted secrets** — provider keys and account credentials are AES-256-GCM encrypted at rest (`~/.minnow/.key`).

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Node.js 18+** | 20+ recommended (ES modules, Vite 6, native `node:test`). |
| **npm** | Ships with Node. |
| **LM Studio** (or any OpenAI-compatible provider) | Load a chat model and start the local server (default `http://localhost:1234`). Not strictly required to launch the UI, but needed to chat. |
| **Python 3** *(optional)* | Only for **local** voice STT/TTS — provisioned on demand. Provider-backed voice needs no Python. |
| **A C/C++ toolchain** *(optional)* | `better-sqlite3` and `@lydell/node-pty` ship prebuilt binaries for common platforms; a toolchain is only needed if a native rebuild is triggered. |

See [`documentation/guides/setup.md`](documentation/guides/setup.md) for a step-by-step setup walkthrough including providers, models, and voice.

---

## Quick start

### 1. Install dependencies

```bash
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

Typecheck only: `npx tsc --noEmit`. A full command reference (CLI flags, smoke scripts, env vars) lives in [`documentation/guides/commands.md`](documentation/guides/commands.md).

---

## Headless CLI

Drive one agent turn without the UI — useful for CI, scripts, and the Scheduler. Requires the tool server (`npm start`, or pass `--start-server`).

```bash
# with a server already running
minnow run --workspace . --agent builder --mode build \
  --prompt "Summarize README.md" --json-out run.json
```

Common flags (`minnow run --help` for the full list): `--prompt`, `--stdin`, `--workspace`, `--agent`, `--mode`, `--model`, `--provider`, `--profile`, `--base-url`, `--start-server`, `--json` / `--json-out`, `--max-tool-turns`, `--no-approval`, `--persist-chat` / `--chat-id` / `--chat-name`, `--minnow-home`, `--quiet`.

Tools that need the browser UI (e.g. `ask_question`) fail with a clear error unless you opt into unsafe automation. See [`documentation/context.md`](documentation/context.md) for machine-readable output and exit codes.

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

Plus `/api/memory/*`, `/api/brain/*`, `/api/models/*`, `/api/compare/*`, `/api/research/*`, `/api/calendar/*`, `/api/email/*`, `/api/scheduler/*`, `/api/webhooks/*`, `/api/oauth/*`, and more — see [`documentation/context.md`](documentation/context.md).

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

Useful environment variables (full list in [`commands.md`](documentation/guides/commands.md)): `PORT`, `MINNOW_HOME`, `MINNOW_BROWSER`, `MINNOW_HEADLESS`, `BROWSER=none`, `TOOLS_ALLOW_ALL_PATHS`, `MINNOW_OAUTH_REDIRECT_BASE`, `MINNOW_DEBUG`.

---

## Packaging a desktop build

```bash
npm run package        # installer (Windows NSIS → release/pkg)
npm run package:dir    # unpacked app directory
```

`package` runs `build` → `electron:build` → `electron-builder`. App id `org.grimmedia.minnow`; Windows target NSIS with `build/icon.ico`. `documentation/` is bundled as an extra resource and `@lydell/node-pty` is unpacked from the asar.

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
| OAuth `redirect_uri_mismatch` | Redirect URI in the Google/Microsoft console must exactly match Settings → OAuth (port included). See the [OAuth guides](documentation/guides/). |

Smoke test (server running):

```bash
npx tsx scripts/sa16-smoke.mjs http://localhost:5173
```

More fixes in [`documentation/guides/troubleshooting.md`](documentation/guides/troubleshooting.md).

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

- [`documentation/context.md`](documentation/context.md) — the **authoritative** architecture, tool catalog, API, and storage reference (dense, kept current).
- [`documentation/guides/`](documentation/guides/) — task-oriented guides:
  - [`setup.md`](documentation/guides/setup.md) — full install & setup walkthrough
  - [`commands.md`](documentation/guides/commands.md) — every command, script, flag, and env var
  - [`apps.md`](documentation/guides/apps.md) — tour of the MinnowOS apps
  - [`architecture.md`](documentation/guides/architecture.md) — high-level system map
  - [`configuration.md`](documentation/guides/configuration.md) — `~/.minnow`, `config.json`, providers, secrets
  - [`troubleshooting.md`](documentation/guides/troubleshooting.md) — common problems
  - [`oauth-google.md`](documentation/guides/oauth-google.md) / [`oauth-microsoft.md`](documentation/guides/oauth-microsoft.md) — Email/Calendar OAuth
- [`PRODUCT.md`](PRODUCT.md) — product goals and tone.
- [`DESIGN.md`](DESIGN.md) — visual design system and theme tokens.
- [`AGENTS.md`](AGENTS.md) — notes for AI coding agents working in this repo.

## License

Private project (`package.json` marks `"private": true`). Add a license file before distributing.
