# Minnow — project context

Authoritative technical reference for the codebase. For orientation, start with [`guides/architecture.md`](guides/architecture.md). For setup and commands, see [`getting-started.md`](getting-started.md). Product overview: [`README.md`](../README.md).

**Also useful:** [`guides/configuration.md`](guides/configuration.md) (storage layout), [`DESIGN.md`](../DESIGN.md) (visual tokens), [`AGENTS.md`](../AGENTS.md) (agent quick reference), [`documentation/plans/`](plans/) (feature plans and roadmaps).

---

## What it is

Minnow is a **local-first AI workspace**: a **Vite + TypeScript SPA**, a **Node tool server** (`server.js`), and an **Electron desktop shell** (MinnowOS). It targets **LM Studio** and other **OpenAI-compatible** providers.

| Layer | Role |
|-------|------|
| **Electron** (`electron/`) | Desktop window, frameless chrome, `WebContentsView` in-app browser (`browser_*`), packaged in-process server |
| **SPA** (`src/`, `index.html`) | MinnowOS shell, Code workspace, chat, modes, tools loop |
| **Tool server** (`server.js`, `server/`) | Vite dev host, `/api/*`, file/git/shell tools, generations SSE, persistence under `~/.minnow` |

- **`npm start`** — Vite + tool server (default port **9473**) + Electron.
- **`npm run dev`** — Vite only; most server features unavailable.
- **`npm run electron:dev`** — Vite + Electron with HMR.

### Operating modes

Six composer modes: **General**, **Build**, **Plan**, **Orchestrate**, **Reef**, **Debug**. **Super Plan** is a Plan sub-mode. **Desktop** and **Onboarding** are surface-bound (not in the Code composer strip). **Orchestrate** opens from the sidebar hub; chat agents are not prompted to suggest Reef.

Registry: [`src/chat/modes/registry.ts`](../src/chat/modes/registry.ts). Tool allowlists: [`src/chat/modes/tool-groups.ts`](../src/chat/modes/tool-groups.ts). Prompts: [`src/chat/prompts/modes/`](../src/chat/prompts/modes/).

**Plan mode** blocks mutating file/git writes except `save_file` / `make_directory` under `documentation/plans/` (client + server guards).

**Super Plan** (`super-plan` mode) runs a sequential pipeline (grill → spec → research → draft/review → present) via [`src/chat/super-plan/controller.ts`](../src/chat/super-plan/controller.ts). The controller owns chat turns for each stage; composer follow-up queue drains are deferred while the pipeline is active so a queued message cannot race the post-interview `spec_confirm` turn. If the loop backs off while a stage is still pending, it schedules a deferred `advanceSuperPlan` retry (stream-end recovery also retries when the hook fires during an in-flight loop). During the **research** stage, [`PlanProgressPanel`](../src/ui/plan-progress-screen.ts) embeds [`ResearchProgressPanel`](../src/research/progress-panel.ts) with `embedded: true` (compact “Deep research” chrome, no nested card, workspace styles in [`plan-progress.css`](../src/styles/plan-progress.css)).

### MinnowOS apps

Chat (desktop), **Code**, **Models**, **Compare**, **Bench**, **Research**, **Experts**, **Brain**, **Calendar**, **Email**, **Scheduler**, **Settings** — routes `#/desktop`, `#/app/{id}`, registry in [`src/os/app-registry.ts`](../src/os/app-registry.ts).

### Scale

- **~88 built-in tools** — [`src/tools/definitions.ts`](../src/tools/definitions.ts)
- **~33 built-in slash skills** — [`src/skills/`](../src/skills/), manifest via `npm run prebuild`
- **Six modes** + work agents, sub-agents, orchestrator boards, Brain wiki

---

## Repository layout

```
Minnow/
├── index.html              # Vite shell; wiring via src/ui/shell-handlers.ts
├── server.js               # Dev: Vite + /api/*
├── server/                 # Config, tools, providers, generations, apps…
├── electron/               # Desktop main/preload → electron/dist/
├── src/
│   ├── main.ts             # Boot: theme, OS shell, initApp
│   ├── os/                 # MinnowOS shell, router, windows, dock
│   ├── chat/               # Modes, prompts, orchestrate, reef, titles
│   ├── tools/              # definitions, loop, client, permission gate
│   ├── agents/             # Sub-agents, work agents, UI Designer
│   ├── api/                # models, chat, generations, sse-parse
│   ├── providers/          # Multi-provider store and fetch
│   ├── state/              # Sessions, workspace, runs
│   ├── ui/                 # Views (settings, messages, file panel, apps)
│   ├── skills/             # SKILL.md packs
│   └── styles/             # CSS; tokens in tokens.css only
├── public/                 # sw.js, icons, benchmark-packs
├── test/                   # Auto-discovered via test/run-all.mjs
└── documentation/
```

---

## Persistence (`~/.minnow`)

**Override:** `MINNOW_HOME` for tests/CI.

| Platform | Path |
|----------|------|
| Linux / macOS | `$HOME/.minnow` |
| Windows | `%USERPROFILE%\.minnow` |

**Secrets:** AES-256-GCM at rest; key file `~/.minnow/.key` (`0o600`). Rotating or deleting `.key` makes encrypted secrets unrecoverable.

**Canonical session store:** `sessions/state.json` — single blob for all chats (not per-chat files).

Full directory map: [`guides/configuration.md`](guides/configuration.md). Notable paths:

| Path | Purpose |
|------|---------|
| `config.json` | Workspace, features, voice, synthesis, tool security, fallbacks |
| `tools.json` | Per-tool permissions (`full` / `ask` / `off`) |
| `providers/<id>/` | `profile.json`, encrypted `secrets.json`, `capabilities.json` |
| `prompts/`, `prompt-configs/`, `profiles/` | User prompt overrides and setup bundles |
| `work-agents.json`, `sub-agents.json` | Agent overrides and sub-agent types |
| `brain/` | Wiki pages, vectors, code index DBs, proposals |
| `skills/`, `skills.json` | User skills and enable flags |
| `scheduler.json`, `calendar/`, `email/` | Scheduler, calendar DB, email accounts + `mail-<accountId>.db` |
| `compare/`, `benchmarks/`, `evals/` | Compare history, bench runs, eval harness |
| `reef/widgets/`, `reef/modules/`, `reef/artifacts/` | Reef templates and user widgets |

**Vite-only (`npm run dev`):** falls back to `localStorage` for sessions (`minnow-sessions-v1`) and tools (`minnow.tools`); server features disabled.

---

## Tool server (`server.js`)

```
Browser / Electron (same origin, default :9473)
  ├─ GET  /api/config/ping, /api/tools/ping, /api/memory/ping, /api/brain/ping
  ├─ GET/PUT /api/config/*     → ~/.minnow JSON
  ├─ POST /api/tools             → { name, args, modeId? } → { result }
  ├─ POST /api/generations       → backend-owned SSE streams
  ├─ /api/providers/*, /api/terminal/*, /api/brain/*, /api/memory/*, …
  └─ Vite SPA
```

**Auth:** Per-boot session token in `~/.minnow/session-token`; injected as `window.__MINNOW_SESSION_TOKEN__` and sent as `X-Minnow-Token` ([`server/runtime/auth-middleware.js`](../server/runtime/auth-middleware.js)). No blanket CORS.

**Path policy:** Default workspace-only via `resolveSafePath()` ([`server/runtime/path-access.js`](../server/runtime/path-access.js)). Full disk when `toolSecurity.filesystemAccess` is `full` or `TOOLS_ALLOW_ALL_PATHS=1`.

**LAN:** Opt-in (`MINNOW_NETWORK=lan` or Settings → General → Network access); restart required.

**Browser-only tools** (`get_datetime`, `calculate`, `ask_question`, sub-agent/board tools, mode handoff, `browser_*`) run client-side; `POST /api/tools` returns `Not implemented` for those names.

Middleware registration: [`server/runtime/middlewares.js`](../server/runtime/middlewares.js). Bootstrap: [`server/runtime/bootstrap.js`](../server/runtime/bootstrap.js).

---

## Client bootstrap

[`src/main.ts`](../src/main.ts):

1. `detectConfigServer()` → `loadSessionsFromStorage()` (before OS router).
2. `detectLocalServer()` (before Code file panel init).
3. `initOsRouter()` when MinnowOS enabled.

`initApp()`: tool config → prompts → work agents → sessions → tool handlers → models → render chat.

Loader dismiss: [`src/boot/app-ready.ts`](../src/boot/app-ready.ts) on `DOMContentLoaded`, not `window.load`.

---

## Chat, sessions, and streaming

### Message types (`chat.history`)

| Role | Shape | Notes |
|------|--------|-------|
| `user` | `{ role, content: string }` | Attachments as `[image: …]` / `<file name="…">` in content |
| `assistant` | `{ role, content, thinking?, tool_calls?, stats? }` | Markdown UI; optional `thinking[]` |
| `tool` | `{ role, tool_call_id, content }` | Paired to `tool_calls` in UI |

Wire format may use multimodal `ContentPart[]` for VLMs; built in [`src/tools/loop.ts`](../src/tools/loop.ts) (`buildApiMessages`).

### Multi-chat

- Persisted in `sessions/state.json` (schema version in [`src/types.ts`](../src/types.ts)).
- Each chat has `workspacePath`; sidebar lists current workspace (+ Unassigned legacy).
- Max **50** chats; newest `lastMessageAt` first.
- **Desktop chat** uses `~/.minnow/workspace`; legacy Chat app uses `~/.minnow/chats`.

### Backend-owned generations

Main chat: `POST /api/generations` + `GET .../stream` with replay. Client stores `chat.currentGenerationId`; reload re-subscribes via [`src/chat/generation-resume.ts`](../src/chat/generation-resume.ts). Stop: [`src/chat/stop-generation.ts`](../src/chat/stop-generation.ts).

SSE parsing: [`src/api/sse-parse.ts`](../src/api/sse-parse.ts) — event boundaries and glued JSON chunks; do not `Response.json()` on the generations shim.

**Live metrics (MIN-413):** [`src/chat/streaming-stats.ts`](../src/chat/streaming-stats.ts) updates `chat.lastStats` and the bottom metrics strip during SSE (throttled ~100ms). Provider `usage` from chunks is preferred when `completion_tokens` is present; otherwise completion tokens are estimated from partial assistant prose only (`chars ÷ 4`). Tool-loop rounds roll up via [`aggregateTurnUsageSegments`](../src/chat/orchestrate/stats-math.ts) — sum completions, keep the latest prompt (each API call reports full context, not a delta).

**Turn runs** (`chat.runs`): semantic branches for replay/fork ([`src/state/runs-store.ts`](../src/state/runs-store.ts)), separate from transport generations.

### Tool loop

[`sendMessageWithTools`](../src/tools/loop.ts) → `composeSystemPrompt()` → enabled tools for mode → stream → tool batch → repeat.

Tool approval: [`src/tools/permission-gate.ts`](../src/tools/permission-gate.ts) (`full` / `ask` / `off`). `ask_question` uses its own UI queue ([`src/tools/ask-question-queue.ts`](../src/tools/ask-question-queue.ts)).

---

## Built-in tools

Catalog: [`BUILT_IN_TOOLS`](../src/tools/definitions.ts). Config UI: Settings → Tools; persistence `tools.json` / `minnow.tools`.

| Category | Examples | Runs on |
|----------|----------|---------|
| **Utility** | `get_datetime`, `calculate`, clipboard | Browser |
| **Web** | `web_search`, `fetch_web_content`, `wikipedia_search` | Browser + server fetch |
| **Files** | `read_file`, `save_file`, `grep`, `find_files` | Server (`npm start`) |
| **Git** | `git_status`, `git_commit`, `git_diff`, … | Server |
| **Code** | `execute_command`, `run_javascript`, `run_python` | Server (+ terminal SSE) |
| **Code intel** | `repo_map`, `find_symbol`, `who_calls`, `brain_*` | Server |
| **LSP** | `get_lsp_diagnostics`, `list_lsp_servers` | Server |
| **Memory** | `save_memory` | Server (Brain adapter) |
| **Agents** | `spawn_sub_agent`, `board_*`, mode handoff | Browser executors |
| **Browser preview** | `browser_navigate`, `browser_snapshot`, … | Electron + server allowlist |
| **Chat UI** | `ask_question`, `propose_mode_switch` | Browser |
| **Appearance** | `get_appearance`, `update_appearance` | Browser (desktop only) |

`mcp__*` and `plugin__*` tools bypass mode matrix; gated by Settings permissions only.

---

## Prompts and skills

### Prompt system

Shipped under [`src/chat/prompts/`](../src/chat/prompts/): `base/`, `modes/`, `tool-usage/`, `work-agents/`, `experts/`, `titles/`. User overrides: `~/.minnow/prompts/`.

Composer: [`src/chat/prompts/prompt-composer.ts`](../src/chat/prompts/prompt-composer.ts). Custom profiles: `~/.minnow/prompt-configs/`, portable bundles `~/.minnow/profiles/`.

API: `GET/PUT /api/prompts/...` when server running.

### Skills

Cursor-style **SKILL.md** (YAML front matter + body). Built-in: `src/skills/<id>/`; user: `~/.minnow/skills/<id>/` (user wins on name clash).

Invoke via **`/`** slash picker ([`src/ui/skill-picker.ts`](../src/ui/skill-picker.ts)). Built-ins include `git-commit`, `code-review`, `impeccable`, `ui-designer`, `caveman`, `partymode`, and **19 Matt Pocock skills** (sync: `npm run matt-pocock-skills:sync`).

API: `GET /api/skills`, `GET/PUT /api/skills/:id`, `GET/PUT /api/config/skills`.

**Git commit messages (MIN-412):** The Code git panel and `/git-commit` skill share conventions — conventional commits with optional gitmoji (`config.json` → `gitCommitMessage.useGitmoji`, default on), imperative subject (≤72 chars), body explaining *why*, staged-vs-unstaged scope, and `BREAKING CHANGE:` footers. UI generation: [`src/ui/git-commit-message-client.ts`](../src/ui/git-commit-message-client.ts) (diff filtering, reasoning-chain extraction, prompt builder).

---

## Memory and Brain

**Memory** is a thin adapter over the **Brain wiki** ([`server/memory/store.js`](../server/memory/store.js) → `pages/facts/`). Retrieval injects into composer `memory` part; untrusted fencing via [`src/lib/untrusted.mjs`](../src/lib/untrusted.mjs).

**Brain** (`~/.minnow/brain/`): nested markdown pages, `catalog.json` cache, hybrid keyword + vector retrieve, code index per workspace (`code/<workspace-key>.db`), synthesis proposals.

| API prefix | Purpose |
|------------|---------|
| `/api/memory/*` | Legacy CRUD + retrieve (delegates to brain) |
| `/api/brain/*` | Wiki pages, tree, ingest, retrieve, code index, proposals |

UI: **Brain** app `#/app/brain/<section>`. Settings for embeddings/synthesis live in Brain → Settings.

Tools: `brain_search`, `brain_read_page`, `brain_write_page`, `save_memory`, `repo_map`, `find_symbol`, …

---

## Agents

### Work agents

Per-role prompts and optional provider/model binding. Shipped: `default`, `builder`, `planner`, `reviewer`, `researcher`, `ui-designer`, …

[`src/agents/work-agent-registry.ts`](../src/agents/work-agent-registry.ts), overrides `~/.minnow/work-agents.json`. API: `/api/work-agents`, `/api/agent-packs`.

### Sub-agents

[`src/agents/sub-agent-runner.ts`](../src/agents/sub-agent-runner.ts) — nested loops, concurrency cap in `sub-agents.json`. Tools: `spawn_sub_agent`, `get_sub_agent_status`, `cancel_sub_agent`.

### Orchestrate boards

Kanban delivery from plans under `documentation/plans/`. Tools: `board_init`, `board_update_task`, `board_get_state`, `board_report`, `delegate_tasks`. Board member chats get role-scoped tool filters ([`src/chat/modes/orchestrate-tool-filter.ts`](../src/chat/modes/orchestrate-tool-filter.ts)).

State: `Chat.orchestratePlanPath`, `ChatGroup.orchestrateBoard`, [`src/ui/orchestrate-board.ts`](../src/ui/orchestrate-board.ts).

**Board metrics strip (MIN-414):** When the main column is in board view, the bottom inference metrics panel rolls up **all planner + member chat** token totals (ledger-first per chat) and averages per-chat tok/s (completion-weighted via [`averageStatsSegments`](../src/chat/orchestrate/stats-math.ts)). Implementation: [`src/chat/orchestrate/board-stats-aggregate.ts`](../src/chat/orchestrate/board-stats-aggregate.ts); refreshed on board live updates and chat switches so focusing a member chat does not reset totals.

### Experts

Personas under `src/chat/prompts/experts/<id>/`. Chats: `Chat.kind === 'expert'`, memory under `pages/experts/<id>/facts/`. UI: Experts' Lab on desktop + `#/experts`.

### Reef widgets

` ```reef-widget ` fences → sandboxed iframes ([`src/chat/reef/`](../src/chat/reef/)). Bridge: `window.minnow` (`sendPrompt`, `callLLM`, `editArtifact`). Templates: `src/chat/reef/widgets/`; user modules: `~/.minnow/reef/modules/`.

---

## MinnowOS shell

Stage layers in `#osStage` ([`src/os/shell.ts`](../src/os/shell.ts)):

| Layer | Contents |
|-------|----------|
| Desktop | Wallpaper, concierge composer, chat rail, research/experts overlays |
| Windows | Floating apps (Settings, Models, Brain, Bench, Compare, Calendar, …) |
| Side panels | Scheduler list rail |
| Fullscreen apps | Code, Email, Settings-from-Code |

Presentation modes: `fullscreen` | `window` | `desktop` | `sidePanel` ([`src/os/presentation-mode.ts`](../src/os/presentation-mode.ts)).

**Desktop chat** is the primary chat surface (`#desktopChatCol`); legacy `#chatView` retained for deep links. **Code** reparents `#appBody` into `#osAppsLayer`.

Router: [`src/os/router.ts`](../src/os/router.ts). Boot: `initOsPageBridge()` → `initOsShell()` → `initOsRouter()`.

---

## Theme and appearance

16 themes: `<html data-theme="{family}-{mode}">` (8 families × dark/light). **All hex/rgba only in** [`src/styles/tokens.css`](../src/styles/tokens.css); app code uses `--mn-*`.

Runtime: [`src/theme.ts`](../src/theme.ts), Settings → Appearance, desktop wallpaper ([`src/os/wallpaper.ts`](../src/os/wallpaper.ts)). Reef iframes receive forwarded tokens ([`src/chat/reef/theme-forward.ts`](../src/chat/reef/theme-forward.ts)).

Design reference: [`DESIGN.md`](../DESIGN.md), [`documentation/design-system/`](design-system/README.md).

---

## Major apps (server + UI)

| App | Route | Server / storage |
|-----|-------|------------------|
| **Models** | `#/app/models` | `/api/models/*`, `/api/system/hardware`, downloads, serve |
| **Compare** | `#/app/compare` | `server/compare/`, `~/.minnow/compare/` |
| **Bench** | `#/app/bench` | `src/benchmark/`, `~/.minnow/benchmarks/` |
| **Evals** | Settings → Evals | `server/evals/`, `~/.minnow/evals/` |
| **Research** | Desktop / `#/research` | `server/research/`, `~/.minnow/research/` |
| **Scheduler** | `#/app/scheduler` | `server/scheduler/`, `scheduler.json` (jobs only run while app open) |
| **Calendar** | `#/app/calendar` | `server/calendar/`, SQLite `calendar.db`, CalDAV |
| **Email** | `#/app/email` | `server/email/`, IMAP/SMTP, encrypted accounts, SQLite `mail-<accountId>.db` |
| **Voice** | Models → Voice | `server/voice/`, local Whisper + Qwen TTS option |
| **Settings** | `#/app/settings` | Full config via `/api/config/*` |

**Deep Research** is a dedicated panel (not a composer mode). **Compare** runs 2–6 blind model slots. **Bench** runs integration + academic packs; distinct from eval harness task packs.

### Email sync engine

- **Store:** one SQLite DB per account (`~/.minnow/email/mail-<accountId>.db`, WAL) — `server/email/store.js` owns the schema, `cache.js` the async API. `message_row_id` is the stable PK, so a move rewrites `folder`/`uid` while triage, reply variants, and bodies survive. `messages_fts` (FTS5) backs search over subject/sender/body. Legacy `cache/<id>/messages.json` is imported once on first sync and renamed `.migrated`.
- **Connections:** `imap-session.js` holds one long-lived ImapFlow client per account. All reads and mutations borrow it via `withMailbox(accountId, folder, fn)`, which serializes per account and closes after 5 minutes idle. The folder list is cached in `meta`, so archive/move no longer pay a `LIST` each.
- **Sync:** incremental — `UID lastSeen+1:*` for new mail (headers + first text part only), then a FLAGS-only reconcile over the newest 200 UIDs that applies external reads/stars and drops messages deleted or moved elsewhere. `UIDVALIDITY` changes clear the folder and refill it. Full bodies, HTML, and attachment metadata load lazily on first open (`ensureMessageBody`).
- **Push:** an IMAP IDLE watcher per polling-enabled account (own connection — IDLE parks the socket) triggers a debounced sync; the interval poller stays as the fallback for servers with broken IDLE.
- **Routes:** `GET /accounts/:id/threads` (conversation rollups), `GET /search?q=` (FTS, all accounts when `accountId` is omitted), `GET /messages/:id/body` (lazy body fetch).

---

## LSP, MCP, plugins

**LSP:** Bundled TS/JS + on-demand language bundles; config `~/.minnow/lsp.json`, defaults `src/lsp/defaults.json`. APIs: `/api/lsp/*`.

**MCP:** Config under `~/.minnow/mcp/`; Context7 built-in for library docs. Tools surface as `mcp__<server>__<tool>`.

**Native tool plugins:** `plugin__*` tools from user plugins ([`documentation/plugins/tool-authoring.md`](plugins/tool-authoring.md)).

---

## Providers and models

Multi-provider registry: `~/.minnow/providers/`. UI: Models app → Providers. Chat uses composite model keys (`providerId` + model id) in [`src/lib/model-select-key.ts`](../src/lib/model-select-key.ts).

**One-click presets:** shared catalog in [`src/providers/presets.ts`](../src/providers/presets.ts) — OpenCode Go/Zen, Anthropic, DeepSeek, GitHub Copilot, plus OpenRouter/OpenAI/Groq/Mistral. Used by onboarding cloud setup (chips) and **Settings → Providers → Add provider** (preset grid first, then form; **Add custom provider** opens the full field set for local or arbitrary endpoints).

`fetchModels()` loads all enabled providers. Main chat streams via generations API; `postChatCompletions` shim for headless/sub-agents.

**Fallback chains:** `config.json` → `fallbackChains` — sequential retry before first upstream byte ([`server/generations/fallback.js`](../server/generations/fallback.js)).

**Constrained decoding:** optional `response_format` JSON Schema on tool turns when provider supports it.

---

## Security

| Concern | Location |
|---------|----------|
| Encrypted secrets | [`server/security/secret-box.js`](../server/security/secret-box.js) |
| Untrusted content fencing | [`src/lib/untrusted.mjs`](../src/lib/untrusted.mjs), [`server/security/untrusted.js`](../server/security/untrusted.js) |
| Webhook/CalDAV SSRF | [`server/webhooks/ssrf.js`](../server/webhooks/ssrf.js), calendar CalDAV guards |
| Browser origin allowlist | `config.json` → `browser.allowedOriginPatterns`, `/api/browser/allowlist/*` |
| Host kill / port bind guards | Agent shell commands cannot kill Minnow or bind its port |

---

## File attachments

[`src/attachments/`](../src/attachments/) — composer chips, max **10 MB**. Images → VLM `image_url` parts when model supports vision. PDF/office → server `read_document` when `npm start`.

---

## Electron and packaging

- **Dev:** `npm start` spawns Electron after Vite is up.
- **Package:** `npm run package` → `release/` (NSIS on Windows).
- **Preview browser:** requires Electron (`window.minnow.preview`); hidden in plain browser tabs.
- **Auto-update:** GitHub Releases via `electron-updater` (packaged installs); Settings → General → App updates.

---

## Testing and CI

- **`npm test`** — discovers `test/**/*.test.{js,mjs,mts,ts}` via [`test/run-all.mjs`](../test/run-all.mjs).
- **`npx tsc --noEmit`** — typecheck (no ESLint config).
- **CI:** [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — Windows + Ubuntu.

Scoped suites: see `package.json` (`test:memory`, `test:brain`, `test:engine`, …).

---

## Key files

| File | Role |
|------|------|
| [`server.js`](../server.js) | Vite + API middleware |
| [`src/main.ts`](../src/main.ts) | Client bootstrap |
| [`src/tools/definitions.ts`](../src/tools/definitions.ts) | Tool catalog |
| [`src/tools/loop.ts`](../src/tools/loop.ts) | Tool loop, `buildApiMessages` |
| [`src/tools/client.ts`](../src/tools/client.ts) | Tool router + approval |
| [`src/chat/prompts/prompt-composer.ts`](../src/chat/prompts/prompt-composer.ts) | System prompt composition |
| [`src/chat/modes/registry.ts`](../src/chat/modes/registry.ts) | Mode definitions |
| [`src/state/sessions.ts`](../src/state/sessions.ts) | Session persistence |
| [`src/api/generations.ts`](../src/api/generations.ts) | Generations client |
| [`src/api/sse-parse.ts`](../src/api/sse-parse.ts) | SSE framing |
| [`src/os/shell.ts`](../src/os/shell.ts) | MinnowOS shell |
| [`server/runtime/tools-middleware.js`](../server/runtime/tools-middleware.js) | Server tool dispatch |
| [`server/generations/`](../server/generations/) | Buffered upstream streams |
| [`server/config/validators.js`](../server/config/validators.js) | Config + session schema |

---

## Conventions for contributors

- Match surrounding code style; CSS uses `--mn-*` tokens only ([`tokens.css`](../src/styles/tokens.css)).
- Update **this file** when architecture, APIs, or storage change.
- Feature plans and historical notes live in [`documentation/plans/`](plans/) — not here.
- Path safety: file/git tools resolve under workspace root unless `TOOLS_ALLOW_ALL_PATHS=1`.
