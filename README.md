# Minnow

A fast, lightweight browser client for **[LM Studio](https://lmstudio.ai/)** and other OpenAI-compatible local providers — streaming chat, multi-session history, inference metrics, programmatic system prompts, and **55 built-in agent tools** (files, git, shell, browser CDP, sub-agents, orchestration board, memory, LSP, and more).

Built with **Vite + TypeScript**. The UI is a single-page app; a **Node dev server** (`server.js`) runs alongside Vite during development for filesystem tools, config persistence under `~/.minnow`, and provider proxying.

## Features

### Chat and models

- **LM Studio (default)** and **multi-provider** routing — `v0` models API, load/unload, friendly model labels, context-length-aware picker
- **Streaming chat** — live assistant replies with markdown, syntax highlighting, reasoning/thought bubbles, and sanitization
- **Backend-owned generations** — attach, detach, cancel, and resume streams across reloads (`/api/generations`)
- **Multi-session sidebar** — workspace-scoped chats; history in `~/.minnow/sessions/state.json` when `npm start` is running (browser `localStorage` fallback in Vite-only mode)
- **Inference metrics strip** — tok/s, TTFT, and related stats per turn
- **Context usage ring (MIN-13)** — fill indicator beside Send with per-section breakdown (system, rules, tools, history, composer, attachments)

### Agent capabilities

- **55 built-in tools** — OpenAI-style function calling; **20** routed in the browser (web, utilities, mode handoff, sub-agent/board orchestration UI), **35** on the Node tool server (files, git, code, CDP browser, memory, LSP, Impeccable)
- **Operating modes** — **Build**, **Plan**, **Orchestrate**, **Research**, **Reef** (sandboxed inline widgets via `reef-widget` fences)
- **Orchestrate board** — kanban view tied to plans under `documentation/plans/`; `board_*` tools + sub-agent cards and drawer
- **Sub-agents** — `spawn_sub_agent`, concurrency limits, live cards, transcript drawer, persisted runs on the chat
- **Work agents** — composer-selectable agents with per-agent provider/model bindings
- **Skills** — `/` slash picker for built-in and user `SKILL.md` packs (includes **Impeccable** and **UI Designer**)
- **Tool permissions** — per-tool `full` / `ask` / `off`, path policy, and approval modal
- **Ask-user cards** — structured `ask_question` UI in chat (Feature 31)

### Workspace and IDE-like surfaces

- **File panel** — tree, viewer (CodeMirror), CRUD, search, drag-to-composer workspace references
- **Integrated terminal** — xterm.js PTY tabs (requires `npm start`)
- **LSP** — diagnostics and server listing tools + settings
- **MCP** — Context7 built-in; add custom MCP servers in Settings
- **Memory** — `save_memory` tool and memory settings section

### Attachments and PWA

- **File attachments** — images (VLM models), text/code, and PDF (tool server + optional `pdf-parse`)
- **PWA** — installable via `manifest.json` and service worker (`public/`)

For architecture, APIs, and file layout, see [`documentation/context.md`](documentation/context.md). For product tone and visual principles, see [`PRODUCT.md`](PRODUCT.md) and [`DESIGN.md`](DESIGN.md).

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js** | 18+ recommended (ES modules, Vite 5) |
| **npm** | Comes with Node |
| **LM Studio** | Running locally with at least one model loaded; enable the local server (default port **1234**) |

---

## Quick start

### 1. Install dependencies

Clone or download this repo, then from the project root:

```bash
npm install
```

**Impeccable (UI design skill):** `postinstall` vendors the [Impeccable](https://impeccable.style) skill into `src/skills/impeccable/`. With `npm start`, use **`/impeccable`** in the composer for design critique, polish, and related commands — context comes from [`PRODUCT.md`](PRODUCT.md), [`DESIGN.md`](DESIGN.md), and [`.impeccable/design.json`](.impeccable/design.json). Docs: https://impeccable.style/docs. Before UI-heavy PRs: `npm run impeccable:detect` (exit code `2` = issues found). Re-sync: `npm run impeccable:sync`; update upstream: `npm run impeccable:update`.

**UI Designer:** Use **`/ui-designer plan`** or **`/ui-designer implement`** (or select the **UI Designer** work agent) for an Impeccable-guided audit → screenshot → shape → plan or UI edits. For screenshots, run Chrome with remote debugging (`--remote-debugging-port=9222`) and prefer a **vision-capable** model; optional binding in `~/.minnow/config.json` under `uiDesigner`.

Optional: PDF text extraction uses `pdf-parse` (`optionalDependencies`). If PDF attachments fail:

```bash
npm install pdf-parse
```

### 2. Start LM Studio

1. Open **LM Studio** and load a chat model.
2. Start the **local server** (Developer / Server tab — typically `http://localhost:1234`).
3. Confirm models appear in LM Studio’s server UI.

### 3. Run the dev server (recommended)

For the **full** experience (tools, `~/.minnow` persistence, PDF attachments, terminal, providers API):

```bash
npm start
```

This runs `node server.js`, which:

- Starts **Vite** on port **5173** (or the next free port — check the terminal)
- Serves the Minnow UI
- Exposes **`GET /api/tools/ping`**, **`POST /api/tools`**, **`/api/config/*`**, **`/api/generations`**, providers, skills, MCP, memory, and related APIs
- Logs **`Minnow data: <path>`** for your `~/.minnow` (or `%USERPROFILE%\.minnow` on Windows)
- Opens your default browser to the app URL

> **Important:** Use `npm start`, not `npm run dev`, when you want file/git tools, session persistence, PDFs, terminal PTY, or server-side tool execution. `npm run dev` is Vite-only.

Custom port:

```bash
PORT=3000 npm start
```

On Windows (PowerShell):

```powershell
$env:PORT=3000; npm start
```

### 4. Use the app

1. Open the URL printed in the terminal (usually **http://localhost:5173**).
2. Open **Settings** (gear icon) — full-page sections at `#/settings/<section>` (providers, modes, tools, skills, memory, MCP, LSP, sub-agents, work agents, rules, …).
3. Verify the active **provider** and **LM Studio server URL** (default `http://localhost:1234`).
4. Pick a **model** from the top bar; use refresh if the list is empty.
5. Choose a **mode** in the composer (Build / Plan / Orchestrate / Research / Reef).
6. Type a message and press **Send** (or Enter). Use the **context ring** beside Send to inspect token fill before sending.

**Tools:** Enable capabilities under Settings → **Tools**. Server tools need `npm start` and a successful tools ping (status banner clears when healthy).

**Attachments:** Paperclip above the composer. Images work best with a **vision (VLM)** model. PDFs require `npm start`.

**Orchestrate:** Select **Orchestrate**, pick a plan under `documentation/plans/`, use **Board** view for the kanban, or stay in **Chat** view for the parent orchestrator thread.

**Chats:** Sidebar for create/switch/rename. With `npm start`, sessions persist under `~/.minnow/sessions/state.json`.

### Headless CLI (CI / scripts)

With the dev server running (`BROWSER=none npm start` in CI):

```bash
minnow run --workspace . --agent builder --mode build \
  --prompt "Summarize README.md" --json-out run.json
```

Machine-readable output and exit codes are documented in [`documentation/context.md`](documentation/context.md#headless-cli-feature-18). Tools that need the browser UI (for example `ask_question`) fail with a clear error unless you use unsafe automation flags documented in `minnow run --help`.

---

## npm scripts

| Command | Description |
|---------|-------------|
| `npm start` | **Recommended** — Vite + tool server + `~/.minnow` APIs |
| `npm run minnow:run` | Headless CLI (`minnow run …`) — requires `npm start` (or `--start-server`) |
| `minnow run --help` | Full flags for CI / scripts (see [Headless CLI](documentation/context.md#headless-cli-feature-18)) |
| `npm run dev` | Vite only (UI/HMR; most server features unavailable) |
| `npm run build` | Typecheck + production build → `dist/` (`prebuild` refreshes skills manifest) |
| `npm run preview` | Preview production build (no tool API) |
| `npm test` | Full test suite (`node --test` + `tsx`; see `package.json` for scope) |
| `npm run test:memory` | Memory API tests |
| `npm run test:lsp` | LSP tests |
| `npm run test:mcp` | MCP tests |
| `npm run test:browser` | CDP / browser tool tests |
| `npm run test:skills` | Skills loader tests |
| `npm run test:attachments` | Workspace reference tests |
| `npm run test:ui-designer` | UI Designer agent smoke |
| `npm run impeccable:sync` | Re-vendor Impeccable into `src/skills/impeccable/` |
| `npm run caveman:sync` | Refresh upstream caveman `SKILL.md` into `src/skills/caveman/` |
| `npm run impeccable:update` | Update upstream Impeccable + re-sync |
| `npm run impeccable:detect` | Anti-pattern scan on `src/` and `index.html` |
| `npm run test:skills-impeccable` | `/impeccable` built-in tests |

Typecheck only: `npx tsc --noEmit`.

Production output in `dist/` is a **static** SPA. Host it on any static file server. Tool and config APIs are **not** in `dist/` unless you deploy `server.js` separately or run `npm start` against a built app.

---

## Tool server details

When you run `npm start`, the browser uses the same origin for tools and config:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tools/ping` | GET | Health check (`{ "ok": true }`) |
| `/api/tools` | POST | Execute a tool — `{ "name", "args", "modeId"? }` → `{ "result" }` (optional `attachments`; Plan mode write guard when `modeId` is `plan`) |
| `/api/config/ping` | GET | Config server health + `~/.minnow` path |
| `/api/generations` | POST | Start buffered chat generation |
| `/api/generations/:id/stream` | GET | SSE stream (replay + live) |
| `/api/generations/:id/cancel` | POST | Cancel generation |
| `/api/browser/screenshot/:id` | GET | PNG from `~/.minnow/screenshots/` |

- **Path safety:** File/git tools resolve under the **workspace root** unless `TOOLS_ALLOW_ALL_PATHS=1`.
- **Brave Search:** Optional API key in Settings → Tools for `web_search`; without it, DuckDuckGo fallback when the server is up.
- **Timeouts:** `execute_command`, `run_javascript`, and `run_python` time out after **30 seconds**.

Browser-routed tools (`get_datetime`, `calculate`, `ask_question`, sub-agent spawn/status, board tools, mode handoff, etc.) run in the page. Calling pure browser tools via `POST /api/tools` returns "Not implemented".

### Browser automation (CDP, optional)

Enable **Browser (CDP)** tools in Settings. Start Chrome with remote debugging:

```bash
# Windows (typical)
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222

# macOS / Linux
google-chrome --remote-debugging-port=9222
```

Optional: `MINNOW_BROWSER_URL=http://127.0.0.1:9222` or `browser.defaultUrl` in `~/.minnow/config.json`.

Navigation is restricted by `browser.allowedOriginPatterns` (localhost dev hosts by default). Edit patterns in **Settings → Tools → Browser navigation allowlist**, or approve when the agent is blocked in chat. `browser_eval` runs full page JavaScript — use only on trusted pages.

---

## Configuration

### Browser (`localStorage` when Vite-only)

| Setting | Storage key / notes |
|---------|---------------------|
| Tool toggles & Brave key | `minnow.tools` |
| Legacy sessions (dev-only) | `minnow-sessions-v1` |
| User rules mirror | `minnow.userRules` |

### `~/.minnow` (when `npm start` is running)

| Path | Purpose |
|------|---------|
| `config.json` | Active provider, workspace, feature flags |
| `sessions/state.json` | All chats and history |
| `tools.json` | Tool permissions |
| `providers/` | Provider profiles and secrets |
| `sub-agents.json` | Sub-agent types, concurrency, models |
| `work-agents.json` | Work agent bindings |
| `skills/` + `skills.json` | User skills and enable flags |
| `rules.json` | Global user rules |
| `memory/`, `mcp/`, `lsp/`, `reef/` | Feature scaffolds |

Override home for tests: `MINNOW_HOME=<temp-dir>`.

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| No models in dropdown | LM Studio server running? Correct provider URL in Settings? Click refresh. |
| “Server tools need npm start” | Stop `npm run dev`; run `npm start` instead. |
| Tool can’t read a file outside the repo | Expected unless `TOOLS_ALLOW_ALL_PATHS=1`. |
| PDF attachment fails | Run `npm start`; install `pdf-parse` if prompted. |
| CORS / fetch errors on web tools | Run `npm start` so **Fetch page** uses server-side HTTP; for login/SPA pages use CDP `browser_navigate` + `browser_snapshot`. |
| CDP browser tools fail | Chrome with `--remote-debugging-port=9222`? `npm start`? Tools enabled? |
| Context ring shows no limit | Model may not report `context_length`; check loaded model in LM Studio. |
| Port already in use | Set `PORT` and open the printed URL. |
| `[providers] fetch failed` on startup | Normal without LM Studio; add a provider when the server is up. |

Smoke test (with `npm start` running):

```bash
npx tsx scripts/sa16-smoke.mjs http://localhost:5173
```

Use the port shown in your terminal if it is not 5173.

Terminal stream API:

```bash
node test/terminal-stream.test.mjs http://localhost:5173
```

**Known:** The `llmster` headless daemon can have SSE streaming incompatibilities with the browser parser; the server-side generations proxy works (see [`AGENTS.md`](AGENTS.md)).

---

## Project layout (short)

```
Minnow/
├── index.html              # App shell
├── server.js               # Dev server: Vite + APIs
├── server/                 # Config, tools, providers, generations, MCP, …
├── src/                    # TypeScript SPA (chat, agents, tools, ui, …)
├── public/                 # PWA manifest, service worker, icons
├── test/                   # node --test + tsx suites
├── scripts/                # smoke and maintenance scripts
├── dist/                   # Production build (after npm run build)
└── documentation/        # context.md, plans, verification checklists
```

---

## Related docs

- [`documentation/context.md`](documentation/context.md) — architecture, tools catalog, APIs, storage
- [`documentation/plans/feature-audit-roadmap.md`](documentation/plans/feature-audit-roadmap.md) — shipped vs gap audit (22 wishlist items)
- [`documentation/plans/to-fix.md`](documentation/plans/to-fix.md) — active fix backlog
- [`PRODUCT.md`](PRODUCT.md) — product goals and tone
- [`DESIGN.md`](DESIGN.md) — visual design notes
- [`AGENTS.md`](AGENTS.md) — agent/CI notes for Cursor Cloud

## License

Private project (`package.json` marks `"private": true`). Add a license file if you intend to distribute this repo.
