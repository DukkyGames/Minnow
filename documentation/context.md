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

Six composer modes: **General**, **Build**, **Plan**, **Orchestrate**, **Reef**, **Debug**. **Super Plan** is a Plan sub-mode. **Desktop**, **Email**, and **Onboarding** are surface-bound (not in the Code composer strip). **Orchestrate** opens from the sidebar hub; chat agents are not prompted to suggest Reef.

Registry: [`src/chat/modes/registry.ts`](../src/chat/modes/registry.ts). Tool allowlists: [`src/chat/modes/tool-groups.ts`](../src/chat/modes/tool-groups.ts). Prompts: [`src/chat/prompts/modes/`](../src/chat/prompts/modes/).

**Plan mode** blocks mutating file/git writes except `save_file` / `make_directory` under `documentation/plans/` (client + server guards).

**Super Plan** (`super-plan` mode) runs a sequential pipeline (grill → spec → research → draft/review → present) via [`src/chat/super-plan/controller.ts`](../src/chat/super-plan/controller.ts). The controller owns chat turns for each stage; composer follow-up queue drains are deferred while the pipeline is active so a queued message cannot race the post-interview `spec_confirm` turn. If the loop backs off while a stage is still pending, it schedules a deferred `advanceSuperPlan` retry (stream-end recovery also retries when the hook fires during an in-flight loop). During the **research** stage, [`PlanProgressPanel`](../src/ui/plan-progress-screen.ts) embeds [`ResearchProgressPanel`](../src/research/progress-panel.ts) with `embedded: true` (compact “Deep research” chrome, no nested card, workspace styles in [`plan-progress.css`](../src/styles/plan-progress.css)).

### MinnowOS apps

Chat (desktop), **Code**, **Models**, **Compare**, **Bench**, **Research**, **Experts**, **Brain**, **Calendar**, **Email**, **Scheduler**, **Settings** — routes `#/desktop`, `#/app/{id}`, registry in [`src/os/app-registry.ts`](../src/os/app-registry.ts).

**Availability:** each app is `core` (always on: Chat, Models, Brain, Settings) or `optional`, plus a developer `releaseState` (`released` | `hidden`). User preferences store disabled optional ids in `localStorage` key `minnow.os.disabledApps` ([`src/os/app-preferences.ts`](../src/os/app-preferences.ts)). Missing key = all released optional apps enabled. Dock, menubar shortcuts, hash routes, notifications, and `launch_minnow_app` all consult the same selectors. First-run **Choose your apps** (after Appearance) and **Settings → Apps** share [`src/os/app-picker-ui.ts`](../src/os/app-picker-ui.ts): core apps collapse to a read-only “Always included” line; optional apps use quiet toggle cards (dimmed when off, no accent wash when on) with Enable all / Disable all. Onboarding **Email** and **Calendar** setup steps are applicable only when the matching app is enabled (`isAppEnabled`) and the tool server is up — disabling those apps in Choose your apps (or Settings) skips their wizard steps.

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
│   ├── chat/               # Modes, prompts, orchestrate, reef, goal/loop, titles
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
| `rules.json` | Grouped user rules (v2: enable flags, groups, per-rule text); legacy v1 `text` migrates on read/write |
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

**Path policy:** Default workspace-only via `resolveSafePath()` ([`server/runtime/path-access.js`](../server/runtime/path-access.js)). Full disk when `toolSecurity.filesystemAccess` is `full` (Settings → General → Filesystem access) or `TOOLS_ALLOW_ALL_PATHS=1`.

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
- **Email assistant chats** reuse the chats workspace for normal file permissions but persist with `Chat.appScope === 'email'`, `modeId === 'email'`, and `lastActiveChatIdByApp.email`, so they stay out of Code, Desktop, and Chat app rails.

### Backend-owned generations

Main chat: `POST /api/generations` + `GET .../stream` with replay. Client stores `chat.currentGenerationId`; reload re-subscribes via [`src/chat/generation-resume.ts`](../src/chat/generation-resume.ts). Stop: [`src/chat/stop-generation.ts`](../src/chat/stop-generation.ts).

SSE parsing: [`src/api/sse-parse.ts`](../src/api/sse-parse.ts) — event boundaries and glued JSON chunks; do not `Response.json()` on the generations shim.

**Live metrics (MIN-413):** [`src/chat/streaming-stats.ts`](../src/chat/streaming-stats.ts) updates `chat.lastStats` and the bottom metrics strip during SSE (throttled ~100ms). Provider `usage` from chunks is preferred when `completion_tokens` is present; otherwise completion tokens are estimated from partial assistant prose only (`chars ÷ 4`). Tool-loop rounds roll up via [`aggregateTurnUsageSegments`](../src/chat/orchestrate/stats-math.ts) — sum completions, keep the latest prompt (each API call reports full context, not a delta).

**Turn runs** (`chat.runs`): semantic branches for replay/fork ([`src/state/runs-store.ts`](../src/state/runs-store.ts)), separate from transport generations.

### Tool loop

[`sendMessageWithTools`](../src/tools/loop.ts) → `composeSystemPrompt()` → enabled tools for mode → stream → tool batch → repeat.

Tool approval: [`src/tools/permission-gate.ts`](../src/tools/permission-gate.ts) (`full` / `ask` / `off`). `ask_question` uses its own UI queue ([`src/tools/ask-question-queue.ts`](../src/tools/ask-question-queue.ts)).

### `/goal` and `/loop` (stateful slash commands)

Built-in non-skill slash commands live in [`src/chat/slash-commands/registry.ts`](../src/chat/slash-commands/registry.ts) (picker) and dispatch inside `sendMessageWithTools` **before** skill resolution.

| Command | Role | Persistence |
|---------|------|-------------|
| **`/goal`** | Work until a completion condition; post-turn evaluator continues the chat | `chat.activeGoal` ([`src/chat/goal/`](../src/chat/goal/)) |
| **`/loop`** | Re-run a prompt on a fixed interval or self-paced delay while the app is open and the chat is idle | `chat.activeLoops[]` ([`src/chat/loop/`](../src/chat/loop/)) |

**`/loop` modes:** `/loop 5m <prompt>` (interval; units `s`/`m`/`h`/`d`, sub-minute rounds up to 1m); `/loop <prompt>` (auto delay 1–60m from output change); bare `/loop` (maintenance: `<workspace>/.minnow/loop.md` or built-in checklist). Loops expire after 7 days. A global 15s ticker in [`src/chat/loop/ticker.ts`](../src/chat/loop/ticker.ts) (started from [`src/main.ts`](../src/main.ts)) scans persisted `dueAt` so reload/sleep survive. Fires go through [`sendProgrammaticChatText`](../src/tools/loop.ts) so looped text gets full slash/skill resolution. `/goal` and `/loop` are mutually exclusive on a chat. `/clear` clears both. `activeLoops` persist in session storage (client `ensureChatShape` + server `validateSessionState`). Chat panel: [`src/ui/loop-status.ts`](../src/ui/loop-status.ts) (countdown, interval edit, pause/resume, stop); re-synced after transcript paint and OS app foreground changes.

Naming: `src/tools/loop.ts` is the tool-call/send loop — unrelated to `/loop`. Do not rename it when touching session loops.

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

**Git commit messages (MIN-412):** The Code git panel and `/git-commit` skill share conventions — conventional commits with optional gitmoji (`config.json` → `gitCommitMessage.useGitmoji`, default on), imperative subject (≤72 chars), body explaining *why*, staged-vs-unstaged scope, and `BREAKING CHANGE:` footers. UI generation: [`src/ui/git-commit-message-client.ts`](../src/ui/git-commit-message-client.ts) (diff filtering, reasoning-chain extraction, prompt builder). During streaming, only high-confidence conventional commit lines are shown in the input; heuristic/plain-text extraction and reasoning-channel fallback run on completion. Markdown diff walkthroughs (numbered steps, `Removed/Updated` bullets, `**Identify Key Changes**` headers) from local/LM Studio models are rejected as non-commit output.

**Merge to main (MIN-465):** When the Source Control panel is on a feature branch (main or secondary worktree), a **Merge to main** toolbar button appears beside Pull/Push. It checks out `main`/`master` on the main workspace (with dirty-tree confirmation when needed), merges the current branch, switches the panel back to the workspace worktree, and surfaces merge failures via toast + optional **Send to chat**. Trunk resolution prefers local `main`/`master`, then `origin/main`/`origin/master` (needed when trunk is checked out in another worktree and omitted from the local branch list). Logic: [`src/lib/git-trunk-branch.ts`](../src/lib/git-trunk-branch.ts), [`src/ui/git-merge-to-main.ts`](../src/ui/git-merge-to-main.ts).

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

[`src/agents/work-agent-registry.ts`](../src/agents/work-agent-registry.ts), overrides `~/.minnow/work-agents.json`. API: `/api/work-agents`, `/api/agent-packs` (list/toggle + `GET /api/agent-packs/template` zip + `GET /api/agent-packs/builtin` default pack export + `POST /api/agent-packs/upload` zip install). Settings → **Agent packs**: authoring steps, template/default downloads, zip upload, installed pack list.

### Sub-agents

[`src/agents/sub-agent-runner.ts`](../src/agents/sub-agent-runner.ts) — nested loops, concurrency cap in `sub-agents.json`. Tools: `spawn_sub_agent`, `get_sub_agent_status`, `cancel_sub_agent`. Background completion pushes a hidden user resume row to the parent (`sub-agent-completion-push.ts` + [`hidden-transcript-user-messages.ts`](../src/chat/hidden-transcript-user-messages.ts)) — the model sees it; the transcript does not.

**Generation timeouts:** Settings → **Watchdog** (`config.json` → `chat.generationIdleTimeoutMs`, `chat.generationMaxDurationMs`) — upstream idle and max-duration limits while streaming from the model.

### Orchestrate boards

Kanban delivery from plans under `documentation/plans/`. Tools: `board_init`, `board_update_task`, `board_get_state`, `board_report`, `delegate_tasks`. Board member chats get role-scoped tool filters ([`src/chat/modes/orchestrate-tool-filter.ts`](../src/chat/modes/orchestrate-tool-filter.ts)).

State: `Chat.orchestratePlanPath`, `ChatGroup.orchestrateBoard`, [`src/ui/orchestrate-board.ts`](../src/ui/orchestrate-board.ts). Global defaults (`autopilot` block in `config.json`): Settings → **Autopilot** ([`src/ui/settings-autopilot.ts`](../src/ui/settings-autopilot.ts)) — emphasis-panel layout matching Agents/Rules (board execution, retries, heartbeat, planner fallback, self-heal). Per-board overrides on the board header.

**Board metrics strip (MIN-414):** When the main column is in board view, the bottom inference metrics panel rolls up **all planner + member chat** token totals (ledger-first per chat) and averages per-chat tok/s (completion-weighted via [`averageStatsSegments`](../src/chat/orchestrate/stats-math.ts)). Implementation: [`src/chat/orchestrate/board-stats-aggregate.ts`](../src/chat/orchestrate/board-stats-aggregate.ts); refreshed on board live updates and chat switches so focusing a member chat does not reset totals.

**Board view browse root (MIN-464):** When board view is active and worktree isolation is on, the file explorer, terminal, and Source Control browse cwd follow the board **integration worktree** (not per-task chat worktrees). Chat view continues to sync browse cwd from the active chat's composer run-target. Helpers: [`resolveBoardIntegrationWorktreePath`](../src/state/worktree-isolation.ts), [`syncPanelFromActiveChat`](../src/ui/git-panel.ts).

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

**Desktop chat** is the primary chat surface (`#desktopChatCol`); legacy `#chatView` retained for deep links. **Code** reparents `#appBody` into `#osAppsLayer`. Chat transcript mount + inset overlay routing (sub-agent drawer, goal eval) live in [`src/ui/chat-mount.ts`](../src/ui/chat-mount.ts): Code → `#mainColumn`, desktop → `.mn-os-desktop-chat`, Chat app → `.chat-app-main`.

The Code chat sidebar header keeps its navigation controls ordered as **collapse sidebar**, **search chats**, then **Code overview**.

Router: [`src/os/router.ts`](../src/os/router.ts). Boot: `initOsPageBridge()` → `initOsShell()` → `initOsRouter()`.

**Notifications:** menubar bell inbox ([`src/os/notifications-menu.ts`](../src/os/notifications-menu.ts), [`src/notifications/`](../src/notifications/)). Sounds use **packs** under `public/sounds/packs/<packId>/` ([`src/notifications/sound-packs.ts`](../src/notifications/sound-packs.ts)): each pack maps three cues — `turn_complete`, `question`, `tool_turn` — to audio files; notification kinds resolve to a cue at playback time. Default pack **Minnow** ships `turn-complete.wav`, `question.wav`, `tool-turn.mp3`. Prefs: `minnow.notifications.soundPackId` (`default` | `none`), `minnow.notifications.soundOnActiveChat` (play cues while watching the active chat in Code without bell rows). Settings → General → Notifications.

**Desktop prefs** (`minnow.os.*`): wallpaper / layout via [`src/os/desktop-prefs.ts`](../src/os/desktop-prefs.ts); **disabled apps** via `minnow.os.disabledApps` ([`src/os/app-preferences.ts`](../src/os/app-preferences.ts)).

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
| **Evals** | Headless API / `~/.minnow/evals/` (no Settings page; Bench covers in-app runs) | `server/evals/`, `~/.minnow/evals/` |
| **Research** | Desktop / `#/research` | `server/research/`, `~/.minnow/research/` |
| **Scheduler** | `#/app/scheduler` | `server/scheduler/`, `scheduler.json` (jobs only run while app open) |
| **Calendar** | `#/app/calendar` | `server/calendar/`, SQLite `calendar.db`, CalDAV |
| **Email** | `#/app/email` | `server/email/`, IMAP/SMTP, encrypted accounts, SQLite `mail-<accountId>.db` |
| **Voice** | Models → Voice | `server/voice/`, local Whisper + Qwen TTS option |
| **Settings** | `#/app/settings` | Full config via `/api/config/*`; General category includes General, Notifications, Audio, About; Appearance, Models (Providers, **Routing**, Usage & cost, Sampler, Thinking) use the emphasis-panel layout; Integrations hubs **Search**, **Servers**, **Tools** (collapsible category groups in the tool catalog), **Skills**, **Browser**, **MCP servers**, **Language servers**, and **Editor** match the General emphasis-panel pattern (`settings-general` shell, offline banner, emphasis groups, related links); other Integrations hubs (**Deep Research**, External); Advanced is Health & diagnostics only (Orchestration and Evals Settings pages removed — supervisor tuning lives under Autopilot / `config.supervisor`). In-page cross-links (`linkToSettingsSection`) call `openSettings` / `openModels` directly — hash-only `#/settings/…` redirects are not enough once the Settings window is already open ([`src/ui/settings-layout.ts`](../src/ui/settings-layout.ts), [`src/os/app-host.ts`](../src/os/app-host.ts)). |

**Deep Research** is a dedicated panel (not a composer mode). **Compare** runs 2–6 blind model slots. **Bench** runs integration + academic packs; distinct from eval harness task packs.

### Email sync engine

- **Store:** one SQLite DB per account (`~/.minnow/email/mail-<accountId>.db`, WAL) — `server/email/store.js` owns the schema, `cache.js` the async API. `message_row_id` is the stable PK, so a move rewrites `folder`/`uid` while triage, reply variants, and bodies survive. `messages_fts` (FTS5) backs search over subject/sender/body. Legacy `cache/<id>/messages.json` is imported once on first sync and renamed `.migrated`.
- **Connections:** `imap-session.js` holds one long-lived ImapFlow client per account. All reads and mutations borrow it via `withMailbox(accountId, folder, fn)`, which serializes per account and closes after 5 minutes idle. The folder list is cached in `meta`, so archive/move no longer pay a `LIST` each.
- **Sync:** incremental — `UID lastSeen+1:*` for new mail (headers + first text part only), then paginated backfill of older UIDs until the folder is fully cached (`lowest_uid` / `backfill_complete` in `sync_state`). Manual sync (`POST /accounts/:id/sync`, default `untilComplete: true`) runs batches until backfill finishes and emits `sync_progress` SSE events (`cached`, `folderTotal`, `backfillComplete`). Background poll/IDLE sync advances one batch per tick when backfill is incomplete. Then a FLAGS-only reconcile over the newest 200 UIDs applies external reads/stars and drops messages deleted or moved elsewhere. `UIDVALIDITY` changes clear the folder and refill it. Preview parts are decoded from their Content-Transfer-Encoding (base64 / quoted-printable) in `parse-body.js` before storage — quoted-printable UTF-8 is reassembled as bytes, not Latin-1 code units. List snippets pass through `sanitizePreviewText()` to strip invisible marketing characters (zero-width spaces/joiners, soft hyphens) and repair mojibake already stored in the cache. Full bodies, HTML, and attachment metadata load lazily on first open (`ensureMessageBody` via `GET /messages/:id/body`); the reader calls `hydrateThreadBodies()` so opened threads always fetch complete MIME before rendering.
- **Push:** an IMAP IDLE watcher per polling-enabled account (own connection — IDLE parks the socket) triggers a debounced sync; the interval poller stays as the fallback for servers with broken IDLE.
- **Routes:** `GET /accounts/:id/threads` (conversation rollups), `GET /search?q=` (FTS, all accounts when `accountId` is omitted), `GET /messages/:id/body` (lazy body fetch). Thread payloads include `bodyComplete` so the client knows when to lazy-load.
- **Reader:** HTML bodies render in a sandboxed iframe ([`src/ui/email/email-body.ts`](../src/ui/email/email-body.ts)) so sender CSS cannot leak into the app. When the app theme is dark, bodies are smart-inverted to match; a per-message **Match theme** toggle (dark mode only) restores the sender's original light canvas. Remote images stay blocked until the reader loads them, trusts the sender, or **Email → Settings → Privacy → Always load remote images** is enabled (`~/.minnow/email/preferences.json`, `GET/PATCH /api/email/preferences`). Settings uses **Privacy** and **Account** tabs in the workspace.
- **Needs attention:** triaged inbox highlights render in the unified stream head (`renderHighlightRow` in [`src/ui/email/email-dashboard.ts`](../src/ui/email/email-dashboard.ts)). Each card has a top-right dismiss control; `POST /accounts/:id/highlights/:messageId/dismiss` persists the clear in `attention_dismissals` and rebuilds the summary (`server/email/attention.js`). The **Everything else** list below the highlights is unread-only (same server filter as the Unread view).
- **Layout:** the spine rail (`.email-rail`) and reader dock (`.email-reader-dock`) are drag-resizable via edge handles ([`src/ui/email/email-panel-resize.ts`](../src/ui/email/email-panel-resize.ts)); widths persist in `localStorage` key `minnow.email.panelWidths`. The rail exposes a **Sync mail** control above Automations/Settings (`.email-rail-sync`) with a status line and progress bar driven by `sync_progress` SSE while backfill runs; the triage readout’s freshness row also includes a sync icon that POSTs `/accounts/:id/sync` for the active scope folder and reloads the stream ([`src/ui/email/email-inbox.ts`](../src/ui/email/email-inbox.ts)).
- **Inbox productivity:** the stream marker hosts a list toolbar (master tri-state checkbox, selection actions, Unread-scope **Read all**, search, keyboard help). When the page is fully selected and more conversations exist in the folder/view, a banner offers **Select all N in …** (Gmail-style) or **Clear selection** after folder-wide select. Rows use listbox/option semantics with persistent checkboxes, quick star (filled warning color when starred), context menu (`email-context-menu.ts`), and private drag payloads (`application/x-minnow-email-threads`) onto rail folders. Selection helpers live in [`src/ui/email/email-selection.ts`](../src/ui/email/email-selection.ts). Thread summaries include folder-scoped `messageIds` for bulk ops. Keyboard shortcuts and compose recipient autocomplete use opaque `--mn-surface-1` panels with a scrim on the shortcut sheet. `POST /api/email/messages/bulk` accepts `spam` (junk-folder role resolution). `POST /api/email/accounts/:id/messages/mark-all-read` marks every unseen message in a folder (optional FTS `query`) in chunks and returns `{ attempted, updated, failed }`.
- **Inbox stream paging:** the conversation list in [`src/ui/email/email-inbox.ts`](../src/ui/email/email-inbox.ts) loads 40 threads per page with a Prev/Next pager; page/search/account/scope changes clear checkbox selection.
- **Inbox brief:** the triage stream head (`.email-stream-brief`) prefers the LLM narrative digest from `GET /accounts/:id/summary` (`digest.narrative`, generated by [`server/email/digest.js`](../server/email/digest.js)); until that lands, it shows the heuristic count template from `summary.text`. Background regeneration and `digest_updated` SSE swap in the narrative without a manual refresh ([`src/ui/email/email-panel.ts`](../src/ui/email/email-panel.ts) re-renders the triage stream on that event).
- **Actionable digest + assistant:** validated digest groups render as counted review rows below the narrative; selecting one queues the existing pending action and **Ready for review** exposes Apply, Always allow (except delete), and Dismiss. Queueing consumes that group from the cached digest (and identical open pending rows are deduped) so the Review chip cannot reappear and stack duplicates; Apply/Dismiss remove the review row immediately and scrub overlapping digest chips. The General-icon toggle mounts on the far right of the triage readout (or the stream marker when the head is hidden) and opens a persisted, resizable assistant dock ([`src/ui/email/email-assistant-panel.ts`](../src/ui/email/email-assistant-panel.ts)) that reuses shared message rendering, attachments, streaming, auto-scroll, tool approval, and question hosts. Its dedicated `email` mode allows mail, calendar, web, file/document, Brain, utility, and question tools while denying shell, git, boards, settings mutation, browser automation, and unrelated app controls. Closing the dock parks question UI and leaves any generation running as a background stream; notifications route back to Email. Active account/view/thread identifiers are sanitized and injected ephemerally; message bodies remain behind fenced `search_mail` / `get_thread` tools.

---

## LSP, MCP, plugins

**LSP:** Bundled TS/JS + on-demand language bundles; config `~/.minnow/lsp.json`, defaults `src/lsp/defaults.json`. APIs: `/api/lsp/*`.

**MCP:** Config under `~/.minnow/mcp/`; Context7 built-in for library docs. Tools surface as `mcp__<server>__<tool>`.

**Native tool plugins:** `plugin__*` tools from user plugins ([`documentation/plugins/tool-authoring.md`](plugins/tool-authoring.md)).

---

## Providers and models

Multi-provider registry: `~/.minnow/providers/`. UI: Models app → Providers. Chat uses composite model keys (`providerId` + model id) in [`src/lib/model-select-key.ts`](../src/lib/model-select-key.ts).

**One-click presets:** shared catalog in [`src/providers/presets.ts`](../src/providers/presets.ts) — OpenCode Go/Zen, Anthropic, DeepSeek, GitHub Copilot, plus OpenRouter/OpenAI/Groq/Mistral. **Settings → Providers** uses the `settings-general` emphasis-panel layout (like Routing and Usage): grouped picker (local servers, featured APIs, more cloud APIs, then custom), flat provider rows inside the configured panel, and related links to Routing and Usage. Styles: [`src/styles/settings-providers.css`](../src/styles/settings-providers.css).

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

**Document creation (agents):** `create_pdf`, `create_spreadsheet` (.xlsx), and `create_word_document` (.docx) write binary files via the tool server (`pdf-lib`, `xlsx`, `docx` optional deps). **File viewer preview:** PDFs embed via `/api/preview/file/*`; spreadsheets and Word docs render HTML via `/api/preview/document-html/*` (uses `xlsx` / `mammoth` / `officeparser` when installed).

---

## Electron and packaging

- **Dev:** `npm start` spawns Electron after Vite is up.
- **Package:** `npm run package` → `release/` (NSIS on Windows).
- **Preview browser:** requires Electron (`window.minnow.preview`); hidden in plain browser tabs.
- **Auto-update:** GitHub Releases via `electron-updater` (packaged installs); Settings → General → App updates.
- **In-app dialogs:** [`src/ui/app-dialog.ts`](../src/ui/app-dialog.ts) replaces blocking native `alert` / `confirm` / `prompt` in the Electron shell with Minnow-styled modals (`installAppDialogs()` at boot; call sites use `await appConfirm()` / `appAlert()` / `appPrompt()`). Overlay z-index `100030` keeps dialogs above shell chrome. Do not use synchronous `window.confirm()` in Electron — it cannot block on custom UI without freezing the renderer.

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
