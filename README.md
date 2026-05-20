# Minnow

A fast, lightweight browser client for **[LM Studio](https://lmstudio.ai/)** — local OpenAI-compatible chat with streaming replies, multi-session history, inference metrics, and built-in **agent tools** (file ops, git, web search, code execution, and more).

Built with **Vite + TypeScript**. The UI is a single-page app; a small **Node tool server** (`server.js`) runs alongside Vite during development so the model can call tools that need the filesystem or shell.

## Features

- **LM Studio integration** — `v0` models and chat completions API (default server: `http://localhost:1234`)
- **Streaming chat** — live assistant replies with markdown, syntax highlighting, and sanitization
- **Multi-session sidebar** — multiple chats persisted in `localStorage`
- **32 built-in tools** — OpenAI-style function calling; **9** run in the browser, **23** on the Node tool server
- **File attachments** — images (VLM models), text/code, and PDF (with tool server + optional `pdf-parse`)
- **Settings drawer** — server URL, temperature, max tokens, system prompt presets, per-tool toggles
- **PWA** — installable via `manifest.json` and service worker (static assets in `public/`)

For architecture and file layout, see [`documentation/context.md`](documentation/context.md).

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

**Impeccable (UI design skill):** `postinstall` vendors the [Impeccable](https://impeccable.style) skill into `src/skills/impeccable/` (reference docs + scripts). With `npm start`, use **`/impeccable`** in the composer for design critique, polish, and related commands — context comes from [`PRODUCT.md`](PRODUCT.md), [`DESIGN.md`](DESIGN.md), and [`.impeccable/design.json`](.impeccable/design.json). Docs: https://impeccable.style/docs — optional Chrome extension for Live Mode. Before UI-heavy PRs: `npm run impeccable:detect` (exit code `2` = issues found). Re-sync: `npm run impeccable:sync`; update upstream: `npm run impeccable:update`.

**UI Designer:** Use **`/ui-designer plan`** or **`/ui-designer implement`** (or select the **UI Designer** Work Agent) for an Impeccable-guided audit → screenshot → shape → plan or UI edits. For screenshots, run Chrome with remote debugging (`--remote-debugging-port=9222`) and prefer a **vision-capable** model; optional dedicated binding in `~/.minnow/config.json` under `uiDesigner`.

Optional: PDF text extraction uses `pdf-parse` (listed under `optionalDependencies`). A normal `npm install` should pull it in; if PDF attachments fail, run:

```bash
npm install pdf-parse
```

### 2. Start LM Studio

1. Open **LM Studio** and load a chat model.
2. Start the **local server** (Developer / Server tab — typically `http://localhost:1234`).
3. Confirm models appear in LM Studio’s server UI.

### 3. Run the tool server (recommended)

For the **full** experience (file/git tools, PDF attachments, server-side search fallbacks), use:

```bash
npm start
```

This runs `node server.js`, which:

- Starts **Vite** on port **5173** (or the next free port — check the terminal)
- Serves the Minnow UI
- Exposes **`GET /api/tools/ping`** and **`POST /api/tools`** for server-side tool execution
- Opens your default browser to the app URL

> **Important:** Use `npm start`, not `npm run dev`, when you want tools that touch the project directory, git, or PDFs. `npm run dev` is Vite-only and does **not** include the tools API.

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
2. Open **Settings** (gear icon) and verify **LM Studio server URL** (default `http://localhost:1234`).
3. Pick a **model** from the top bar dropdown; use the refresh button if the list is empty.
4. Type a message and press **Send** (or Enter).

**Tools:** In Settings → **Tools**, enable the capabilities you want. Defaults include `get_datetime`, `calculate`, `web_search`, and `wikipedia_search`. Server tools (files, git, `execute_command`, etc.) only work when `npm start` is running and the app has detected the server (status banner clears when ping succeeds).

**Attachments:** Use the **paperclip** above the composer. Images work best with a **vision (VLM)** model selected. PDFs require `npm start`.

**Chats:** Use the sidebar to create, switch, and rename sessions. History is stored in the browser (`localStorage`).

---

## npm scripts

| Command | Description |
|---------|-------------|
| `npm start` | **Recommended dev mode** — Vite + `/api/tools` tool server |
| `npm run dev` | Vite only (UI/HMR; no server tools) |
| `npm run build` | Typecheck + production build → `dist/` |
| `npm run preview` | Preview the production build (no tool API) |
| `npm run impeccable:sync` | Re-vendor Impeccable `reference/` + `scripts/` into `src/skills/impeccable/` |
| `npm run impeccable:update` | Update upstream Impeccable skill + re-sync |
| `npm run impeccable:detect` | Anti-pattern scan on `src/` and `index.html` |
| `npm run test:skills-impeccable` | Step 14 tests for `/impeccable` built-in |

Production output in `dist/` is a **static** SPA. Host it on any static file server. The tool API is **not** included in `dist/` unless you deploy `server.js` separately or run `npm start` against a built app.

---

## Tool server details

When you run `npm start`, the browser talks to the same origin for tools:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tools/ping` | GET | Health check (`{ "ok": true }`) |
| `/api/tools` | POST | Execute a tool — body: `{ "name": "...", "args": { ... } }` → `{ "result": "..." }` (optional `attachments` for screenshots) |
| `/api/browser/screenshot/:id` | GET | PNG from `~/.minnow/screenshots/` (Step 12) |

- **Path safety:** File/git tools resolve paths under the **project root** unless you set `TOOLS_ALLOW_ALL_PATHS=1`.
- **Brave Search:** Optional API key in Settings → Tools for `web_search`; without it, the client may use a DuckDuckGo fallback when the server is up.
- **Timeouts:** `execute_command`, `run_javascript`, and `run_python` time out after **30 seconds**.

Browser-only tools (`get_datetime`, `calculate`, clipboard, etc.) run in the page and do not need the Node server.

### Browser automation (CDP, optional)

Enable **Browser (CDP)** tools in Settings. Start Chrome with remote debugging:

```bash
# Windows (typical)
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222

# macOS / Linux
google-chrome --remote-debugging-port=9222
```

Optional: `MINNOW_BROWSER_URL=http://127.0.0.1:9222` or `browser.defaultUrl` in `~/.minnow/config.json`.

Navigation is restricted by `browser.allowedOriginPatterns` (localhost dev hosts by default). `browser_eval` runs full page JavaScript — use only on trusted pages.

---

## Configuration (browser)

| Setting | Where | Notes |
|---------|--------|--------|
| LM Studio URL | Settings | Default `http://localhost:1234` |
| Temperature / max tokens | Settings | Per-session behavior via active chat |
| System prompt | Settings | Presets + custom text (`localStorage`) |
| Tool toggles & Brave key | Settings → Tools | Stored as `minnow.tools` |
| Chat sessions | Sidebar | Stored as `minnow-sessions-v1` |

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| No models in dropdown | LM Studio server running? URL correct in Settings? Click refresh. |
| “Server tools need npm start” | Stop `npm run dev`; run `npm start` instead. |
| Tool can’t read a file outside the repo | Expected unless `TOOLS_ALLOW_ALL_PATHS=1`. |
| PDF attachment fails | Run `npm start`; install `pdf-parse` if prompted. |
| CORS / fetch errors on web tools | Some sites block browser `fetch`; use CDP `browser_navigate` + `browser_snapshot`, or server file tools. |
| CDP browser tools fail | Chrome running with `--remote-debugging-port=9222`? `npm start`? Tools enabled in Settings? |
| Port already in use | Set `PORT` to another value and open the printed URL. |

Smoke test (with `npm start` running):

```bash
npx tsx scripts/sa16-smoke.mjs http://localhost:5173
```

Use the port shown in your terminal if it is not 5173.

Terminal stream API (with `npm start` running):

```bash
node test/terminal-stream.test.mjs http://localhost:5173
```

---

Read lints on edited ts files


ReadLints

## Project layout (short)

```
Minnow/
├── index.html          # App shell
├── server.js           # Dev server: Vite + /api/tools
├── src/                # TypeScript app (chat, tools, UI, attachments)
├── public/             # PWA manifest, service worker, icons
├── dist/               # Production build output (after npm run build)
└── documentation/      # context.md, plans, verification checklists
```

---

## Related docs

- [`documentation/context.md`](documentation/context.md) — detailed architecture, tools catalog, storage keys
- [`PRODUCT.md`](PRODUCT.md) — product goals and tone
- [`DESIGN.md`](DESIGN.md) — visual design notes

## License

Private project (`package.json` marks `"private": true`). Add a license file if you intend to distribute this repo.
