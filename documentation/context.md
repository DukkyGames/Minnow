# Minnow â€” project context

User-facing setup and quick start: [`README.md`](../README.md).

**Feature gap audit (2026):** [`documentation/plans/feature-audit-roadmap.md`](plans/feature-audit-roadmap.md) — shipped vs partial vs missing across agents, Reef, trace/replay, and settings. **Sub-agent orchestration** is documented below under **Sub-agent orchestration (Step 09)**; verification: [`documentation/plans/verification/step-09.md`](plans/verification/step-09.md).

**To-fix roadmap:** Backlog in [`documentation/plans/to-fix.md`](plans/to-fix.md). **Implementation build plans** (with tests and todos): [`documentation/plans/Build out/`](plans/Build%20out/) â€” `switch-chats-while-waiting`, `reef-files-minnow-home`, `reef-optional-save-prompt`, `no-auto-open-terminal`, `no-restart-finished-chat`, `llm-mode-switch-suggestions`, `fix-chat-titles-thinking-leak`, `files-sidebar-close-arrow` (line numbers in each plan link to `to-fix.md`). Product backlog plans remain `feature-01` â€¦ `feature-30` in the same folder. **Persistence contract (Step 02+):** `~/.minnow/sessions/state.json` â€” single session blob, not per-chat files. **Tests (Step 02+):** `npm test` â†’ `node --test` (JS suites), then `tsx --import ./test/test-loader.mjs --test` (TS/UI; loader stubs `.css` / xterm).

## Product backlog (features 01â€“29)

Assignable pack: [`documentation/plans/product_backlog_agents_48a41af9.plan.md`](plans/product_backlog_agents_48a41af9.plan.md). Build plans: [`documentation/plans/Build out/`](plans/Build%20out/) (`feature-01` â€¦ `feature-30`). Verification: [`documentation/plans/verification/`](plans/verification/).

| ID | Slug | Status | Primary commit (`Large-Feature-Add`) |
| --- | --- | --- | --- |
| 01 | topbar-grouped-actions | Shipped | `5f3adb9` |
| 02 | lsp-full-catalog | Shipped | settings wave + `8ad1447` (fixture) |
| 03 | workspace-scoped-chats | Shipped | `5bc076a` |
| 04 | recent-workspaces-menu | Shipped | workspace API + UI tests |
| 05 | thinking-duration | Shipped | `ade9c45` |
| 06â€“09 | terminal-pty | Shipped | `15cc1dc` |
| 10 | model-display-names | Shipped | `bf63994` |
| 11â€“12 | load-unload-model | Shipped | `2d49c52` |
| 12â€“13 | model-picker-right-dots | Shipped | `b4735b6` |
| 14 | stop-generation | Shipped | `9df9f12` |
| 15â€“17 | message-actions | Shipped | `618f7c3` |
| 17 | chat-scroll-during-stream | Shipped | `4ade7a3` |
| 18 | file-tree-crud | Shipped | `1c9293b` |
| 19 | file-search | Shipped | `42887a3` |
| 20 | drag-drop-move-confirm | Shipped | `2d21408` |
| 21 | file-tree-padding | Shipped | `17eb130` |
| 22 | stream-persistence-reload | Shipped | `9860d41` |
| 23 | manual-memory-add | Shipped | `e3f209c` |
| 24 | user-rules-settings | Shipped | `c118962` |
| 25 | prompt-token-estimate | Shipped | `38fe81a` |
| 26 | stats-strip-with-editor | Shipped | `b1ca5c6` |
| 27 | editor-tab-key | Shipped | `8ad1447` |
| 28 | composer-tools-button | Shipped | `b2e6f7b` |
| 29 | all-full-permissions | Shipped | `1cf8c45` |
| 31 | ask-question-cards | Shipped | [`documentation/plans/feature-31-ask-question-cards.md`](plans/feature-31-ask-question-cards.md) |

**Integration QA (2026-05-21):** Reef widget chart templates/snippets use theme tokens only (`var(--accent)`, `color-mix(in oklch, var(--accent) …)` for multi-series/heatmap levels — no hex). `node --test test/chat/reef/*.test.mjs` convention suites pass (24 tests). Full `npm test` may still report unrelated failures (e.g. `messages-stream-row` session init).

## What it is

Minnow is a **Vite + TypeScript** single-page web client for **LM Studio** and other **OpenAI-compatible local providers** (multi-provider routing via `~/.minnow/providers/`). UI markup lives in [`index.html`](../index.html); styles and logic are modular under [`src/`](../src/). Production output is emitted to [`dist/`](../dist/) via `npm run build`.

**LM Studio tools + attachments:** The default send path runs an OpenAI-style **tool loop** (`sendMessageWithTools` in [`src/tools/loop.ts`](../src/tools/loop.ts)). **55** built-in tools are defined in [`src/tools/definitions.ts`](../src/tools/definitions.ts) (Orchestrate `board_*` trio, sub-agent spawn/status, mode handoff, memory, LSP, Impeccable, etc.); **35** are `serverRequired` and execute on the Node side via **`npm start`** (`server.js` â†’ `POST /api/tools`, including **7** CDP `browser_*` tools). **20** are browser-routed (`serverRequired: false`), including web/utility tools, `ask_question`, mode handoff, and sub-agent/board orchestration tools (spawn/status via [`src/tools/sub-agent-executor.ts`](../src/tools/sub-agent-executor.ts) / [`src/tools/board-tools.ts`](../src/tools/board-tools.ts), not raw `POST /api/tools`). File **attachments** (images, text/code, PDF) use the composer paperclip and multimodal API payloads when a **VLM** model is selected. **`browser_screenshot`** returns inline PNG bubbles via `ToolResultMessage.attachments` and `GET /api/browser/screenshot/:id`.

## Repository layout (Vite)

```
Minnow/
â”œâ”€â”€ index.html              # Vite shell: inline `#app-loader` until `html.app-ready` (set when `main.ts` module runs)
â”œâ”€â”€ server.js               # Dev server: Vite + /api/* (npm start)
â”œâ”€â”€ server/                 # Config, tools, providers, generations, MCP, memory, …
â”œâ”€â”€ package.json
â”œâ”€â”€ tsconfig.json
â”œâ”€â”€ vite.config.ts          # base: './', outDir: dist
â”œâ”€â”€ public/                 # Copied verbatim to dist/ (not bundled)
â”‚   â”œâ”€â”€ manifest.json       # PWA manifest (start_url: ./)
â”‚   â”œâ”€â”€ sw.js               # Service worker (cache: minnow-v5)
â”‚   â””â”€â”€ icons/              # icon-192.png, icon-512.png
â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ main.ts             # Entry: CSS imports, initTheme(), window handlers, initApp()
â”‚   â”œâ”€â”€ types.ts            # Messages, ApiMessage, ToolCall, ContentPart
â”‚   â”œâ”€â”€ constants.ts        # STORAGE_KEY, PRESET_STORAGE_KEY, THEME_STORAGE_KEY
â”‚   â”œâ”€â”€ app-state.ts        # streaming flags, modelCache, abort controllers
â”‚   â”œâ”€â”€ chat/streaming-state.ts # per-chat streaming helpers (active vs background)
â”‚   â”œâ”€â”€ chat/context-usage.ts # MIN-13 context budget + breakdown sections
â”‚   â”œâ”€â”€ agents/             # Sub-agent orchestrator, runner, work agents, UI Designer
â”‚   â”œâ”€â”€ providers/          # Multi-provider store, fetch-models, resolve
â”‚   â”œâ”€â”€ state/sessions.ts   # Sessions API + ~/.minnow mirror
â”‚   â”œâ”€â”€ api/models.ts       # fetchModels, modelCache, resolveModelInfo; friendly #modelSelect labels
â”‚   â”œâ”€â”€ api/reasoning.ts    # extractReasoningDelta, splitThinkingSegments (LM Studio)
â”‚   â”œâ”€â”€ api/chat.ts         # SSE/stream helpers, mergeToolCallDelta, sendMessagePlain
â”‚   â”œâ”€â”€ api/generations.ts  # Backend-owned generations client (POST/subscribe/cancel)
â”‚   â”œâ”€â”€ chat/
â”‚   â”‚   â”œâ”€â”€ messaging.ts    # sendMessage â†’ sendMessageWithTools
â”‚   â”‚   â”œâ”€â”€ generation-resume.ts # boot re-subscribe via currentGenerationId
â”‚   â”‚   â”œâ”€â”€ modes/          # Step 05: registry, tool-policy
â”‚   â”‚   â”œâ”€â”€ orchestrate/    # Orchestrate: plan paths, list plans (find_files), send gate
â”‚   â”‚   â”œâ”€â”€ reef/           # Reef mode: widget iframes + bridge (Phase 2)
â”‚   â”‚   â”œâ”€â”€ prompts/        # Step 04 composer; `prompts/titles/` for title templates (Step 07)
â”‚   â”‚   â””â”€â”€ titles/         # Step 07: schedule, generate, sanitize
â”‚   â”œâ”€â”€ ui/                 # sidebar, theme.ts (Appearance), settings, stats, messages, tool-approval-modal, question-cards-modal, â€¦
â”‚   â”œâ”€â”€ state/file-panel.ts # file sidebar + viewer prefs
â”‚   â”œâ”€â”€ lib/
â”‚   â”‚   â”œâ”€â”€ format-model-label.ts  # Epic A2: humanize model ids for top-bar picker
â”‚   â”‚   â”œâ”€â”€ context-length.ts      # loaded vs max context from model rows
â”‚   â”‚   â””â”€â”€ list-directory-parse.ts
â”‚   â”œâ”€â”€ skills/               # Step 13: SKILL.md pack, client, builtin-manifest.json
â”‚   â”œâ”€â”€ tools/
â”‚   â”‚   â”œâ”€â”€ definitions.ts      # 55-tool catalog (OpenAI function schemas)
â”‚   â”‚   â”œâ”€â”€ config.ts           # tools.json sync, permissions, enabled defs
â”‚   â”‚   â”œâ”€â”€ browser-executor.ts # Web/utility browser handlers (ask_question via client + UI; sub-agent/board via dedicated executors)
â”‚   â”‚   â”œâ”€â”€ client.ts           # ping, executeTool router, approval gate, ask_question â†’ UI queue
â”‚   â”‚   â”œâ”€â”€ permission-gate.ts  # modal + path policy before tool runs
â”‚   â”‚   â”œâ”€â”€ approval-queue.ts   # serialized approval requests
â”‚   â”‚   â”œâ”€â”€ ask-question-queue.ts
â”‚   â”‚   â”œâ”€â”€ ask-question-types.ts
â”‚   â”‚   â”œâ”€â”€ tool-approval-types.ts
â”‚   â”‚   â”œâ”€â”€ describe-invocation.ts
â”‚   â”‚   â”œâ”€â”€ path-args.ts
â”‚   â”‚   â”œâ”€â”€ workspace-path-guard.ts
â”‚   â”‚   â””â”€â”€ loop.ts             # buildApiMessages, sendMessageWithTools
â”‚   â”œâ”€â”€ attachments/
â”‚   â”‚   â”œâ”€â”€ types.ts
â”‚   â”‚   â”œâ”€â”€ store.ts        # pending list, preview chips, initAttachments()
â”‚   â”‚   â””â”€â”€ reader.ts       # processFile â€” image, text, PDF
â”‚   â”œâ”€â”€ markdown/renderer.ts
â”‚   â””â”€â”€ styles/
â”‚       â”œâ”€â”€ fonts.css tokens.css global.css topbar.css sidebar.css
â”‚       â”œâ”€â”€ messages.css input.css settings.css stats.css file-panel.css tool-approval.css question-cards.css responsive.css
â”‚       â””â”€â”€ thoughts.css    # live thought bubbles + Thoughts panel
â”œâ”€â”€ dist/                   # Production build (gitignored)
â””â”€â”€ documentation/
```

## Persistence (`~/.minnow`)

When **`npm start`** is running, the Node dev server is the **source of truth** for durable config. Data lives under:

| Platform | Path |
|----------|------|
| Linux / macOS | `$HOME/.minnow` |
| Windows | `%USERPROFILE%\.minnow` (via `os.homedir()`) |

**Override for tests/CI:** set `MINNOW_HOME` to a temp directory (never run destructive tests against the real profile).

On first `npm start`, the server logs `Minnow data: <path>` and creates the layout if missing.

### Layout (Step 02)

```text
~/.minnow/
  config.json              # schemaVersion, activeProviderId, toolSecurity.filesystemAccess, â€¦
  sessions/state.json      # full SessionState blob (all chats â€” canonical)
  tools.json               # ToolConfig (permissions, mirrored enabled, braveApiKey)
  system-prompt.json       # { presetId, text }
  rules.json               # global user rules { version, enabled, text } (Feature 24)
  memory/                  # scaffold (Step 16)
  providers/               # one dir per provider (Step 03)
    lm-studio-local/
      profile.json         # label, baseUrl, apiKind, paths
      secrets.json         # apiKey, bearerToken (0o600 on Unix; never in git)
  mcp/                     # scaffold (Step 18)
  lsp/                     # scaffold (Step 17)
  prompt-configs/          # scaffold (Step 04)
  prompts/                 # user prompt overrides (Step 04; work-agents/ subdir Step 08)
  work-agents.json         # per-agent provider/model/disabled overrides (Step 08)
  sub-agents.json          # sub-agent types, concurrency, tool allow/deny (Step 09)
  logs/sub-agents/         # optional per-run debug transcripts (Step 09)
  logs/terminal/           # full stdout/stderr per runId (Step 10)
  screenshots/             # browser_screenshot PNGs (Step 12)
  skills/                  # user skills (Step 13)
  skills.json              # per-skill enabled flags (Step 20 settings)
  reef/
    widgets/               # synced built-in templates (read)
    modules/               # user-saved custom widgets (read/write after ask_question)
  backups/                 # scaffold
```

**Built-in prompts** ship under `src/chat/prompts/` (Step 04). **Built-in skills** under `src/skills/` (Step 13). User overrides use `~/.minnow/prompts/` and `~/.minnow/skills/`.

### Skills framework (Step 13)

Cursor-compatible **SKILL.md** skills: YAML front matter + markdown body. Invoked from the composer with **`/`** (slash picker) or by typing `/<skill-id>`.

| Root | Path | Override |
|------|------|----------|
| Built-in | `src/skills/<id>/SKILL.md` | Shipped in repo |
| User | `~/.minnow/skills/<id>/SKILL.md` | Same `name` replaces built-in |

**Merge:** user wins on duplicate `name`; dirs starting with `_` are excluded from the picker (`_example` is author docs only). **Send path:** `parseSlashCommand()` â†’ `resolveActiveSkill()` â†’ `skillBody` in `composeSystemPrompt()` (`skill` part). History stores user text without the raw slash line; footer `[skill: <id>]` when a skill was used.

| Concern | Location |
|---------|----------|
| Types, merge, slash parse | `src/skills/` (`loader.ts`, `parse-slash.ts`, `parse-frontmatter.ts`) |
| Catalog client + offline manifest | `src/skills/client.ts`, `src/skills/builtin-manifest.json` (from `npm run prebuild`) |
| Enable/disable + persistence | `src/skills/config.ts`, `~/.minnow/skills.json`, `GET/PUT /api/config/skills` |
| Settings UI (toggles, editor, add custom) | `src/ui/settings-skills.ts`, `src/skills/skill-settings-api.ts` |
| Custom skill template | `src/skills/_template/SKILL.md` (copied on `POST /api/skills`) |
| Slash picker UI | `src/ui/skill-picker.ts`, `src/styles/skill-picker.css` — row hover/`--active` set nested label, id, desc, and badge to `--elevated-fg` on `--surface-elevated` (same pattern as chat sidebar / file tree; MIN-12) |
| Server scan + API | `server/skills/scan.js`, `server/skills/middleware.js`, `server/skills/user-skills.js` |

**API** (same CORS as `/api/tools`; requires `npm start` for user skills):

| Route | Response |
|-------|----------|
| `GET /api/skills/ping` | `{ ok: true }` |
| `GET /api/skills` | `{ skills: SkillListItem[] }` (no body) |
| `GET /api/skills/:id` | `{ skill: SkillDetail }` or 404 (`raw` = full SKILL.md) |
| `POST /api/skills` | Create user skill from `_template/SKILL.md` (`{ id, label? }`) |
| `PUT /api/skills/:id` | Save SKILL.md (`{ content }`; user override path) |
| `GET/PUT /api/config/skills` | `{ enabled: Record<string, boolean> }` |

**Built-in ids (v1):** `git-commit`, `code-review`, `write-tests`, `explain-code`, `debug-error`, `docs-update`, `refactor-safe`, `security-review`, `browser-automation`, `ask-user` (Feature 31), `impeccable` (Step 14), `ui-designer` (Step 15).

### Skills â†’ Impeccable built-in (Step 14)

| Concern | Location |
|---------|----------|
| Built-in skill | `src/skills/impeccable/SKILL.md` (`name: impeccable` â†’ `/impeccable`) |
| Upstream snapshot | `src/skills/impeccable/SKILL.upstream.md` (auto-synced; do not edit) |
| Command references | `src/skills/impeccable/reference/*.md` |
| Scripts | `src/skills/impeccable/scripts/` (`load-context.mjs`, `minnow-context.mjs`, â€¦) |
| Postinstall / sync | `scripts/sync-impeccable-skill.mjs` (vendors from `.agents/skills/impeccable` after `npx impeccable skills install -y`) |
| npm scripts | `impeccable:sync`, `impeccable:update`, `impeccable:detect` |
| Design context (read-only for skill) | `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json` |

`npm install` runs `postinstall` sync (non-strict by default; set `IMPECCABLE_SYNC_STRICT=1` in CI). Override built-in: `~/.minnow/skills/impeccable/SKILL.md` (user wins on duplicate `name`).

**Tests:** `npm run test:skills-impeccable`. Verification: [`documentation/plans/verification/step-14.md`](plans/verification/step-14.md).

### UI Designer (Step 15)

Dual entry: **`/ui-designer`** slash skill or **UI Designer** Work Agent (`ui-designer`). Single runner in `src/agents/ui-designer/` with Impeccable preflight, plan/implement modes, restricted tools, and optional CDP screenshots.

| Concern | Location |
|---------|----------|
| Slash skill | `src/skills/ui-designer/SKILL.md` |
| Work Agent prompts | `src/chat/prompts/work-agents/ui-designer/agent.{full,lite}.md` |
| Model binding | `config.json` â†’ `uiDesigner.providerId`, `uiDesigner.modelId`, `fallbackToChatModel` (default true) |
| Config API | `GET/PUT /api/config/meta` merges `uiDesigner` |
| Runner / preflight | `src/agents/ui-designer/runner.ts`, `preflight.ts` |
| Tool allowlist | `src/agents/ui-designer/tools.ts` â€” plan mode blocks writes |
| Send wiring | `src/tools/loop.ts` â€” binding, tool filter, one-turn `workAgentId` pin |
| Impeccable context tool | `load_impeccable_context` â†’ `server/impeccable/load-impeccable-context.js` (script from app root, reads `PRODUCT.md` / `DESIGN.md` / `.impeccable/design.json` from workspace) |
| Impeccable CLI tool | `run_impeccable` â†’ `server/impeccable/run-impeccable.js` |

**Modes:** `plan` (default, no file mutations) or `implement` (UI paths only). Composer hint after picking `/ui-designer`.

**Tests:** `npm run test:ui-designer`; `node scripts/step15-smoke.mjs`. Verification: [`documentation/plans/verification/step-15.md`](plans/verification/step-15.md).

### Memory system (Step 16)

Persistent notes under `~/.minnow/memory/` (`index.json` + `entries/<uuid>.md`). Injected via composer `memory` part and `{{memory}}` when enabled.

| API | Purpose |
|-----|---------|
| `GET /api/memory/ping` | Health |
| `GET /api/memory/status` | `enabled`, `entryCount`, `home` |
| `GET/POST/PUT/DELETE /api/memory/entries` | CRUD |
| `POST /api/memory/retrieve` | Keyword-ranked block for injection |
| `POST /api/memory/clear` | Clear (optional archive) |
| `POST /api/memory/backup` / `restore` | Folder backup under `backups/` |

| Tool | Purpose |
|------|---------|
| `save_memory` | Agent persists `title` + `body` (+ optional `tags`) as `source: agent` via `server/tools/memory-tools.js` |

**Config:** `config.json` â†’ `memory.enabled`, `maxInjectCharsFull` / `maxInjectCharsLite`; `features.memoryInjection` gates retrieval on send (default on). **Client:** `src/memory/client.ts` (`fetchMemoryStatus`, `fetchMemoryEntries`, `retrieveMemoryBlock`, `createMemoryEntry`, â€¦); `src/memory/config.ts` (`shouldInjectMemory`). **Settings UI:** `#/settings/memory` â€” toggle store, live entry count via `GET /api/memory/status`, scrollable list of entries (title, tags, body) via `GET /api/memory/entries?includeBody=1`, per-entry delete, backup/clear actions. **`save_memory`** is enabled by default (permission **ask**). **Tests:** `npm run test:memory`; smoke: `npx tsx scripts/step16-memory-smoke.mjs http://localhost:5173`.

### LSP integration (Step 17)

Language servers run in Node on `npm start`. Defaults in `src/lsp/defaults.json`; user overrides `~/.minnow/lsp.json`.

| Tool | Description |
|------|-------------|
| `get_lsp_diagnostics` | Formatted diagnostics for a relative path |
| `list_lsp_servers` | Configured servers + running state |

**API:** `/api/lsp/status`, `/api/lsp/diagnostics`, `POST /api/lsp/notify` (`{ path, event: open|change|close, text? }` â†’ didOpen/didChange/didClose), `POST /api/lsp/completion` (`{ path, line, character }` â†’ `{ items: [{ label, insertText, kind?, detail? }] }`), `GET/PUT /api/config/lsp` (PUT supports `removeLspIds` for custom server removal). **File viewer:** When LSP is enabled and `npm start` is up, CodeMirror autocomplete calls `src/lsp/completion-client.ts` via `src/ui/file-editor-extensions.ts`; open/edit/save debounce document sync (`src/ui/file-viewer.ts`). **Catalog:** `src/lsp/defaults.json` ships OpenCode-aligned built-ins (typescript, pyright, rust, â€¦); user overrides in `~/.minnow/lsp.json`. **Settings:** `#/settings/lsp` lists all built-in servers (toggle `disabled`), running/idle badges, and an **Add custom language server** form (`src/ui/lsp-settings.ts`, `src/lsp/config-client.ts`). Test-only `fake` server is hidden in UI. **Tests:** `npm run test:lsp` (fake stdio server for `.fake` files + completion API).

### MCP + Context7 (Step 18)

MCP tools are namespaced `mcp__<serverId>__<toolName>` and merged into `getEnabledToolDefinitions()` when the local server is up. **Context7** seeded enabled under `~/.minnow/mcp/`.

| API | Purpose |
|-----|---------|
| `GET /api/mcp/tools` | OpenAI-style defs for enabled servers |
| `POST /api/mcp/tools/call` | Execute namespaced tool |
| `GET /api/mcp/servers` | Server list (label, description, enabled, connected) |
| `POST /api/mcp/servers` | Add custom stdio server (writes `mcp/servers/<id>.json` + `mcp.json` index) |
| `DELETE /api/mcp/servers/:id` | Remove user-added server (built-ins cannot be deleted) |
| `PUT /api/mcp/servers/:id/enabled` | Toggle server in `mcp.json` |

**Settings UI:** `#/settings/mcp` loads servers from `GET /api/mcp/servers` (requires `npm start`). Each server row (`createMcpSettingsRow` in `src/ui/settings-sections.ts`, styles in `src/styles/settings-page.css`) uses a title line (checkbox + name, built-in badge or remove), then a stacked block: muted description, mono status line with a small dot (green when connected), and optional Context7 API key hint. **Add MCP server** form (stdio: id, label, command, args, env). Custom servers can be removed; Context7 is built-in with enable toggle; test `fixture` server is hidden in UI.

**Tests:** `npm run test:mcp` (in-process `fixture` server returns `pong`).

### Self-healing (Step 19)

Off by default (`config.json` â†’ `selfHealing.enabled`). Toggle in **Settings â†’ Features** (persists via `/api/config/file`). When enabled, duplicate sub-agent tool calls trigger tier-1 **restart** via `restartSubAgent()`. Tier 2 (explorer + skill authoring) is deferred.

| Module | Role |
|--------|------|
| `src/agents/self-healing/detector.ts` | Pure repetition heuristics |
| `src/agents/self-healing/controller.ts` | Observe tool log â†’ restart |

**Tests:** `npx tsx --test test/self-healing/**/*.test.mts`.

### Settings page (Step 20)

Full-page settings at `#/settings/<section>` (`src/ui/settings-page.ts`, `src/ui/settings-sections.ts`, `src/styles/settings-page.css`). The sidebar `.settings-nav` stacks section buttons in a column with a small vertical `gap` between them. Topbar gear opens settings; each section loads live data from Step 02â€“18 APIs (providers, prompt-configs, **rules**, modes, experts, work/sub-agents, tools, MCP, LSP, skills, memory). **Rules** (`#/settings/rules`): enable toggle + textarea for global instructions; explicit **Save rules** persists to `rules.json` when `npm start` is up (offline hint + localStorage mirror otherwise). **Plan granularity** (`large` / `medium` / `small`) lives under **Modes â†’ Plan** (expand the Plan row); persisted in `config.json` via `prompt-meta` (`planGranularity`). Nav clicks update the hash after `setActiveSection`; `openSettings()` skips re-entry when the page is already open on that section so `hashchange` does not race async section renders (duplicate entity lists on work/sub-agents). Async sections (providers, work agents, sub-agents) use a render-generation guard like the Tools panel. **Skills** panel (`#settingsSection-skills` / `#settingsSkillsBody`): each skill shows full description, **Built-In** or **Custom** badge, enable toggle (persisted in `skills.json`), and expandable **Edit SKILL.md**; **Add custom skill** copies `src/skills/_template/SKILL.md` to `~/.minnow/skills/<id>/` via `POST /api/skills` (requires `npm start`). Disabled skills are hidden from the slash picker. Custom prompt configs use `GET/PUT/DELETE /api/prompt-configs` with toolbar New/Save/Duplicate/Delete.

**Prompt token estimate (Feature 25 / F4):** While settings is open, `#settingsPromptTokenEstimate` in `.settings-page-header` shows **~N tokens (estimate)** for the next main-chat send (active session). **Prompting** adds `#settingsPromptTokenBreakdown` (System Â· History Â· Tools Â· Rules). Heuristic: `chars Ã· 4` (`estimateTokensFromText` in `src/chat/prompts/token-estimate-core.ts`). `resolveOutboundPromptEstimate()` in `src/chat/prompts/token-estimate.ts` mirrors send via `resolveOutboundSystemMessages()`, full `chat.history`, and mode-filtered tool JSON (work-agent allowlist + UI Designer filter). UI: `src/ui/settings-prompt-estimate.ts`. Refreshes on settings open, section change, and profile/part toggles (300 ms debounce). Not provider `usage.prompt_tokens`. Verification: [`documentation/plans/verification/feature-25.md`](plans/verification/feature-25.md).

**Context window usage (MIN-13):** In-chat **context fill** indicator distinct from the bottom metrics strip (tok/s, TTFT). `#contextUsageRing` in `.input-bar-send-stack` (left of Send): compact 24px SVG ring (no button chrome); light grey track, ink `--accent` stroke fill for used share; warning fill at ≥85% (`--warning`). Hover tooltip: model name, limit, used/remaining (approx.). Click opens `#contextUsageBreakdown` popover with per-section token rows and bars (System, Rules, Tools, History, optional Composer/Attachments). Data: `getContextBudget()` / `assembleContextBudget()` in [`src/chat/context-usage.ts`](../src/chat/context-usage.ts) merges `resolveOutboundPromptEstimate()` + pending `#msgInput` + `getPendingAttachments()`. **Context limit** uses the effective window, not catalog max: `resolveContextLimit()` prefers `chat.modelInfo.context_length` from the last LM Studio completion, then `loaded_context_length` on a loaded row from `GET /api/v0/models`, then `max_context_length` (same precedence as `contextLengthFromModelRow()` in [`src/lib/context-length.ts`](../src/lib/context-length.ts)). Shows **last turn API** `prompt_tokens` when `chat.lastStats` has them; section sizes stay heuristic. UI: [`src/ui/context-usage-ring.ts`](../src/ui/context-usage-ring.ts), [`src/ui/context-usage-breakdown.ts`](../src/ui/context-usage-breakdown.ts), [`src/styles/context-usage.css`](../src/styles/context-usage.css). Refreshes on history paint, stats update, model change, composer input, attachments, tool permission changes. Tests: [`test/chat/context-usage.test.mts`](../test/chat/context-usage.test.mts).

**Editable agents (modes, experts, work agents, sub-agents):** Expand each row in `#/settings/modes`, `#/settings/experts`, `#/settings/work-agents`, or `#/settings/sub-agents` to edit **Full/Lite** prompt bodies and **provider + model** bindings. UI: `src/ui/settings-entity-editor.ts`. APIs: `GET/PUT/DELETE /api/prompts/{modes|experts|sub-agents}/:id/prompt?profile=full|lite` (overrides under `~/.minnow/prompts/`); work agents also use `GET/PUT/DELETE /api/work-agents/:id/prompt` and `PUT /api/work-agents/:id` for `providerId` / `modelId` / `disabled` in `work-agents.json`. **Sub-agents** (`#/settings/sub-agents`): top **settings-kv** row uses inline controls â€” **Enabled** (checkbox), **Max concurrent** (1â€“16), **Default timeout** (ms, min 1000) â€” each saves on change via `PUT /api/config/sub-agents`; per-type rows still expand for prompt + model overrides.

**Tests:** `npm test`, `npm run build`, `test/ui/settings-sections.test.mjs`, `test/ui/settings-page-html.test.mjs`. Verification: [`documentation/plans/verification/step-20.md`](plans/verification/step-20.md).

**Tests:** `npm run test:skills`; `node scripts/s13-skills-smoke.mjs` (set `MINNOW_HOME` for override fixture). Verification: [`documentation/plans/verification/step-13.md`](plans/verification/step-13.md).

**Vite-only (`npm run dev`):** picker uses `builtin-manifest.json` + lazy `import.meta.glob` in `client.ts` for built-in bodies (glob is no-op under Node/tsx tests); user skills need `npm start`.

### Programmatic prompts (Step 04)

Composable system prompt at send time via `composeSystemPrompt()` ([`src/chat/prompts/prompt-composer.ts`](../src/chat/prompts/prompt-composer.ts)).

| Profile | `config.json` | Behavior |
|---------|---------------|----------|
| **full** | `activePromptProfile: "full"` | All applicable parts, full templates |
| **lite** | `activePromptProfile: "lite"` | Short/lite bodies, `info`/`memory` off by default |
| **custom** | `"custom"` + `activePromptConfigId` | Per-part enable + `contentOverride` from `prompt-configs/<id>.json` |

**Composition order** (single `system` message, `\n\n---\n\n` separators):

`base â†’ mode â†’ expert â†’ work-agent â†’ tool-usage â†’ info â†’ skill â†’ memory`

**Shipped tree:** `src/chat/prompts/` (`base/`, `tool-usage/`, `info/` presets from `SYSTEM_PROMPT_PRESETS`, `modes/` full+lite pairs, `experts/`, â€¦). Reference-only: `_example/`, `modes/_template/MODE_TEMPLATE.md`.

### Operating modes (Step 05)

Five primary modes per chat: **Build**, **Plan**, **Orchestrate**, **Research**, **Reef** (inline chat widgets via `reef-widget` fences; prompts in `modes/reef.*.md`, copy-paste templates in `src/chat/reef/widgets/*.md` â€” **15 full templates:** calculator, calculator-with-chart, slider-graph, tabs, form, data-table, comparison, checklist, stats-dashboard, pie-chart, heatmap, quiz, qa-callllm, timeline, unit-converter; **6 composable snippets** (`snippet-*.md`): chart-line, chart-bar, table, stat-card, input-row, sparkline).

| Concern | Location |
|---------|----------|
| Registry + tool policy | `src/chat/modes/registry.ts`, `tool-policy.ts` â€” Plan allows **`save_file`** / **`make_directory`** only under `documentation/plans/` (`plan-write-guard.ts` + prompts in `modes/plan.*.md`; `save_file` creates parent dirs on the server) |
| Prompt bodies | `src/chat/prompts/modes/{id}.full.md`, `{id}.lite.md` |
| Template pack | `src/chat/prompts/modes/_template/` |
| UI mode selector | `src/ui/mode-selector.ts` (in `#composerControls` in `index.html`) |
| Orchestrate plan control | `#orchestratePlanStrip.orchestrate-plan-control` inline in `#composerControls` after mode segments â€” `src/ui/orchestrate-plan-selector.ts`, shared population in `src/ui/orchestrate-plan-picker.ts`, `src/styles/orchestrate-plan-selector.css`; strip stays **hidden** while Orchestrate + no `orchestrateBoard` + `viewMode === board` (board onboarding panel owns plan pick); refresh on mode/chat/workspace change and when server tools become available (`init-file-panel.ts`); missing `documentation/plans/` maps to `no_plans_dir` in `list-plans.ts` |
| Orchestrate view toggle (Phase 4) | Split toggles: `#btnViewModeToggleBoard` (composer column above `#sendBtn`) and `#btnViewModeToggleChat` (board `board-header__controls`, after Stop) â€” `src/ui/view-mode-toggle.ts`, `src/styles/view-mode-toggle.css`; sets `Chat.viewMode` (`chat` \| `board`); enabled in Orchestrate mode anytime (including mid-stream; plan optional); hidden/disabled outside Orchestrate or when the target view is already active (`[hidden]` + `.hidden` + `display:none !important` so `.icon-btn` flex does not override); sync on mode/chat/plan change (`loop.ts`, sidebar, plan selector, board header wire) |
| Plan listing | `src/chat/orchestrate/list-plans.ts` (`find_files`); path rules `src/chat/orchestrate/plan-path.ts` |
| Send gate (Orchestrate) | `src/chat/orchestrate/send-gate.ts` + `sendMessageWithTools` in `src/tools/loop.ts` (requires `Chat.orchestratePlanPath`; empty composer uses default line) |
| Stall watchdog (MIN-9) | `src/chat/orchestrate/watchdog.ts` — after a sub-agent terminal event, if the board has incomplete tasks, no active subs for the chat, and the parent is idle for `ORCHESTRATE_WATCHDOG_STALL_MS` (30s), auto-injects `ORCHESTRATE_RESUME_MESSAGE` from `resume-message.ts` (max `ORCHESTRATE_WATCHDOG_MAX_RETRIES_PER_TASK` per task via `BoardTask.retryCount`); retries exhausted → header badge **Stalled — Resume** (`deriveBoardHeaderStatus` + `isOrchestrateWatchdogStalled`). Started from `initApp()` after `initSubAgentUi()`. Tests: `test/orchestrate/watchdog.test.mts` |
| Persistence | `Chat.modeId` and optional `Chat.orchestratePlanPath` in `sessions/state.json` (default mode `build`; plan path normalized in `ensureChatShape`); server: `server/config/validators.js` + `orchestrate-plan-path.js` |
| Board View | `Chat.orchestrateBoard?: OrchestrateBoardState`, `Chat.viewMode?: 'chat' \| 'board'`. **MIN-5:** With no board store yet, Board view shows `.board-onboarding` (`mountBoardOnboardingPanel` in `orchestrate-board.ts`, shared options in `orchestrate-plan-picker.ts`): plan `<select>` with single-plan auto-select, Refresh, **Start** (sends `BOARD_ONBOARDING_KICKOFF_MESSAGE`), Open plan, Chat view; `#orchestratePlanStrip` is hidden (`shouldHideComposerPlanStripForOrchestrateBoardOnboarding`); entering Orchestrate without a board sets `viewMode: board` (`mode-selector.ts`). Store: `src/state/orchestrate-board-store.ts`, `src/state/orchestrate-board-events.ts` (`emitBoardChange` â†’ live kanban refresh). Tools: `board_init`, `board_update_task`, `board_get_state` (`src/tools/board-tools.ts`) â€” **`board_init`** uses `tasks[].id` + non-empty `waves`; **`board_update_task`** uses **`task_id`** (not `id`); **`spawn_sub_agent`** uses **`board_task_id`**. Schemas: `src/tools/definitions.ts`; copy-paste JSON examples in `orchestrate.*.md` Â§ Board tool API. UI: `src/ui/orchestrate-board.ts` (header **status badge** via `deriveBoardHeaderStatus` (semantic chips: warning/success/danger) plus **activity chip** (`deriveOrchestratorLastActivity` in `chat/orchestrate/last-activity.ts` â€” last tool label or message preview up to 240 chars; width fits label with `max-width` ellipsis cap; click opens Chat view via `setOrchestrateViewMode('chat')`); toolbar layout with **Start**/**Stop**/`Open plan` plus **Chat view** icon toggle on the right (`board-header__controls`); board view toggle in composer above send; `.board-btn` hover fills match top-bar outlined controls (`orchestrate-board.css`, fine-pointer only); subscribes on empty board; in-place `refreshBoardDom` + 1s live tick; kanban task cards show agent badge and open `openSubAgentDrawer` on click), `src/styles/orchestrate-board.css` (board view: `.board-root` flex-fills `#chatArea` inside existing `.chat-area` padding; kanban columns scroll per-column); dispatch in `renderChatFromHistory` (`messages.ts`); board-only streaming guards (`appendBubble`, `appendStreamingAssistantRow`, `sub-agent-cards.ts`, tool-call DOM in `loop.ts`). Board mode: `#mainColumn.main-column--board-view` hides `.input-bar` and `#chatJumpLatest` (no in-board composer); toggle in top bar `#btnViewModeToggle`. Controls: stop orchestrator, **Open plan** (opens `orchestratePlanPath` in split file viewer as rendered markdown), **Resume** (fixed resume line). New user messages: switch to Chat view or use header controls. No inline plan sidebar â€” plans use `openFileInViewer` + markdown preview for `.md`. `activeParentTurnId` on board in `loop.ts`. Prompts: `orchestrate.*.md` (no `documentation/progress/`). Tests: `test/state/orchestrate-board-shape.test.mts`, `test/orchestrate/board-store.test.mts`, `test/tools/board-tools.test.mts`, `test/orchestrate/orchestrator-board-link.test.mts`, `test/ui/view-mode-toggle.test.mjs`, `test/ui/orchestrate-board-streaming.test.mjs`, `test/ui/orchestrate-board-live-update.test.mjs`, `test/prompts/orchestrate-board-prompt.test.mjs`; `test/orchestrate/**` in `npm test`. Verification: [`documentation/plans/verification/feature-orchestrate-board.md`](plans/verification/feature-orchestrate-board.md). Plan: [`documentation/plans/shiny-minsky-board-view.md`](plans/shiny-minsky-board-view.md) |

### Reef mode widgets (inline iframes)

When `Chat.modeId === 'reef'`, closed ` ```reef-widget ` fences in assistant bubbles mount as sandboxed iframes; other modes leave them as syntax-highlighted code. While that bubble is still streaming (`setAssistantBubbleContent` with `streaming: true`), each fence shows a **pending** row (phase label + dot pulse) instead of raw highlighted code; the final non-streaming render mounts the iframe. Mounting does **not** use the global `app-state.streaming` flag (it can stay true until after the final render).

| Concern | Location |
|---------|----------|
| Mount pipeline | `src/chat/reef/` (`widget-block-detector.ts`, `widget-pending-ui.ts`, `widget-iframe.ts`, `theme-forward.ts`, `widget-prelude.ts`, `widget-bridge.ts`, `run-widget-completion.ts`) |
| Renderer hook | `mountReefWidgets(bubble, { bubbleStreaming, modeId })` at end of `setAssistantBubbleContent` in `src/markdown/renderer.ts`; history render passes `chat.modeId` via `appendBubble` meta |
| Bridge init | `initReefBridge()` in `src/main.ts` |
| Styles | `src/styles/reef-widgets.css` |
| Widget LLM overrides | `Chat.reefWidgetProviderId`, `Chat.reefWidgetModelId`; Settings â†’ Modes â†’ Reef (`src/ui/reef-widget-settings.ts`) |
| Widget library | **15 templates** + **6 snippets** under `src/chat/reef/widgets/`; catalog in `modes/reef.full.md` (Templates table + Snippets subsection); lite prompt notes `snippet-*.md`. Tools: `@minnow/reef/widgets/<name>.md` (read-only; synced to `~/.minnow/reef/widgets/` on `npm start`). **User modules:** `@minnow/reef/modules/<slug>.md` (read/write under `~/.minnow/reef/modules/`, scaffolded on `npm start`; `server/reef/widget-paths.js` + `resolveSafePath` in `server.js`) |
| User modules | Custom widgets saved only after **`ask_question`** confirmation â†’ `@minnow/reef/modules/<slug>.md` under `~/.minnow/reef/modules/` (scaffold on `npm start`; path resolution in `server/reef/widget-paths.js`). Prompt rules: `modes/reef.full.md` Â§ User module library; `/ask-user` skill preset. Plan: [`documentation/plans/Build out/reef-optional-save-prompt.md`](plans/Build%20out/reef-optional-save-prompt.md) |

**Sandbox:** `iframe sandbox="allow-scripts"` only (no `allow-same-origin`). CSP + esm.sh importmap inside srcdoc (`react@19` / `react-dom@19/client` without `?dev` so widget code and Recharts share one React instance). Theme tokens forwarded from host `html[data-theme]`.

**Bridge (`window.minnow` in iframe):** `sendPrompt(text)` â†’ fills `#msgInput` (user sends); `callLLM({ messages })` â†’ host streams via `postChatCompletions`; `openLink(url)` â†’ confirm + new tab; `requestResize()` â†’ re-measure iframe document height so the host matches widget content (charts should call this from `useLayoutEffect` after layout).

**Charts (Recharts):** Host srcdoc injects baseline CSS (`.rw-chart` / `.mw-chart` â†’ 220px tall) and the prelude sizes chart wrappers plus parents of `.recharts-responsive-container` when height collapses to ~0 (including after async ESM load via `MutationObserver`). Widgets should use `className="rw-chart"` (or explicit pixel height) and `requestResize()` after layout. **`reef-widget` fences are not passed to highlight.js** â€” mount runs before hljs so the unknown `reef-widget` language warnings do not spam the console during stream or after mount.

**JSX guard:** Before Babel, the iframe runner auto-quotes `color: var(--text)` â†’ `color: 'var(--text)'` in widget scripts (`widget-jsx-guard.ts`); prompts tell models to quote tokens in `style={{ }}` (bare `var()` is valid only in `<style>` CSS).

**Iframe height:** Prelude posts resize on load plus delayed passes (0 / 100 / 400 ms) so dynamic vanilla DOM and async React/Recharts still expand the host iframe; widgets should still call `requestResize()` after tab/layout changes.

**Tests:** `test/chat/reef/*.test.mts`, `test/chat/reef/*.test.mjs` (template/snippet conventions, `reef-prompts-catalog.test.mjs`, `reef-save-prompt.test.mjs`). Plan: [`documentation/plans/feature-reef-mode-widgets.md`](plans/feature-reef-mode-widgets.md), expansion: [`documentation/plans/reef-widget-library-expansion.md`](plans/reef-widget-library-expansion.md). Verification: [`documentation/plans/verification/feature-reef.md`](plans/verification/feature-reef.md).

**Send path:** `buildComposeContext()` sets `modeId` (and `orchestratePlanPath` when mode is Orchestrate) from active chat â†’ `composeSystemPrompt()` loads `kind: mode` fragment with `{{orchestrate_plan}}` where applicable â†’ `getEnabledToolDefinitionsForMode(modeId)` filters tools in `loop.ts`.

**Plan / Research** deny destructive tools at the API (shell, file writes, git mutations per `registry.ts`).

**Mode handoff (LLM suggestions):** Shared rules in `src/chat/prompts/tool-usage/mode-handoff.md` â€” appended by `composeSystemPrompt()` for Build, Plan, Orchestrate, Research, and Reef. Host tools (browser, default on): **`propose_mode_switch`** (standard `ask_question` presets), **`set_chat_mode`** (`setChatMode` in `mode-selector.ts`), **`create_chat_with_mode`** (`createChatWithMode` in `sidebar.ts` â€” optional `orchestratePlanPath`, seed user message). Reef visualization from other modes: **`spawn_sub_agent`** `type: reef-widget` (`sub-agents.json` + `agents/prompts/sub-agents/reef-widget.*.md`, read-only template tools) then **`set_chat_mode`** `reef` so fences mount. Tests: `test/prompts/mode-handoff-prompt.test.mjs`, `test/tools/mode-handoff-tools.test.mjs`. Plan: [`documentation/plans/Build out/llm-mode-switch-suggestions.md`](plans/Build%20out/llm-mode-switch-suggestions.md).

**Tests:** `test/modes/*.test.mts`, `test/orchestrate/*.test.mts`. Verification: [`documentation/plans/verification/step-05.md`](plans/verification/step-05.md). OpenCode mapping: [`documentation/plans/references/mode-sources.md`](plans/references/mode-sources.md).

### Reef widgets (Phase 2)

When `Chat.modeId === 'reef'`, assistant markdown with complete ` ```reef-widget ` fences mounts as sandboxed iframes after the bubbleâ€™s final non-streaming render; while streaming, pending labels replace visible fence code.

| Concern | Location |
|---------|----------|
| Public API | `src/chat/reef/index.ts` â€” `mountReefWidgets`, `unmountReefWidgetsInChat`, `initReefBridge` |
| Fence scan + host | `widget-block-detector.ts` (pending UI while bubble streams; iframe when `bubbleStreaming` is false; marks `data-reef-mounted`) |
| iframe srcdoc | `widget-iframe.ts` (CSP, esm.sh import map, prelude, theme CSS) |
| Theme tokens | `theme-forward.ts` (`html[data-theme]` observer) |
| Bridge API | `widget-prelude.ts` (`window.minnow`), `widget-bridge.ts` (postMessage host) |
| Widget LLM | `run-widget-completion.ts` (SSE, no tools); overrides `Chat.reefWidgetProviderId` / `reefWidgetModelId` |
| Settings UI | Settings â†’ Modes â†’ Reef (`src/ui/reef-widget-settings.ts`) |
| Styles | `src/styles/reef-widgets.css` |
| Integration | `markdown/renderer.ts` (post-render mount), `main.ts` (`initReefBridge`), `mode-selector.ts` (unmount + re-render on mode change) |

**Tests:** `test/chat/reef/*.test.mts` (21 tests, happy-dom).

**Widget library (snippets):** Six composable `snippet-*.md` files â€” `snippet-chart-line`, `snippet-chart-bar` (Recharts), `snippet-table`, `snippet-stat-card`, `snippet-input-row`, `snippet-sparkline` (SVG, embed in stat card `.rw-spark`). Full templates (15) cover end-to-end UIs including `qa-callllm` (`callLLM` + `onChunk` streaming). Conventions: description + bullets above one ` ```reef-widget ` fence; **no hex colors** (use `var(--*)` and `color-mix` with forwarded tokens for charts/heatmaps); snippets omit title chrome.

### Expert system (Step 06)

Domain personas under `src/chat/prompts/experts/<id>/` (`expert.full.md`, `expert.lite.md`). User overrides: `~/.minnow/prompts/experts/<id>/`.

| Concern | Location |
|---------|----------|
| Registry + routing | `src/chat/experts/registry.ts`, `rules-router.ts`, `resolve.ts` |
| Optional LLM classify | `src/chat/experts/llm-classifier.ts` (not awaited on send â€” latency) |
| Config | `config.json` â†’ `experts` block; loader `src/config/experts-config.ts` |
| UI | `#expertSelect` in composer strip (`src/ui/expert-select.ts`) |
| Persistence | `Chat.expertSelection`, `Chat.lastResolvedExpertId` in session blob |

**Behavior:** **Auto** re-runs rules router each send; **Manual** pins `expertId` until user selects Auto. `resolveExpertForTurn()` â†’ `resolveComposedSystemPrompt()` sets `expertId` / `expertLabel` for `{{expert}}` interpolation.

**Built-in ids:** `general` (default), `software-engineer`, `technical-writer`, `data-analyst`, `creative-writer`, `security-reviewer`. Template: `src/chat/prompts/experts/_template/`.

**Config keys (`experts`):** `enabled`, `classifier` (`rules` \| `llm` \| `rules+llm`), `llmFallbackBelow`, `rulesMinScore`, `autoOmitWhenNoMatch`, `classifierModel`.

**Tests:** `test/experts/**/*.test.mjs`. Verification: [`documentation/plans/verification/step-06.md`](plans/verification/step-06.md).

### Work Agents (Step 08)

Task-specific agents with per-agent prompts, optional provider/model binding, and composer `work-agent` part.

| Concern | Location |
|---------|----------|
| Types + registry | `src/agents/work-agent-types.ts`, `work-agent-registry.ts` |
| Binding resolver | `src/agents/resolve-work-agent-binding.ts` |
| Turn resolution | `src/agents/resolve-work-agent.ts`, `set-work-agent.ts` (S09 hook) |
| Shipped prompts | `src/chat/prompts/work-agents/<id>/agent.{full,lite}.md`, `registry.json` |
| Prompt API client | `src/agents/work-agent-prompt-api.ts` |
| Dev UI | `src/ui/work-agent-dev.ts` (`?dev=1` shows `#workAgentSelect`) |
| Persistence | `Chat.workAgentId`, `Chat.workAgentAuto` in `sessions/state.json` |
| User overrides | `~/.minnow/work-agents.json`, `~/.minnow/prompts/work-agents/<id>/` |

**Built-in ids:** `default`, `builder`, `plan` â†’ `planner`, `research` â†’ `researcher`, plus `reviewer`. Mode auto-map via `defaultForModes` when `workAgentAuto` is true (default).

**Send path:** `resolveActiveWorkAgent()` â†’ `resolveComposedSystemPrompt()` sets `workAgentId` / `workAgentLabel` â†’ `resolveWorkAgentBinding()` picks provider + model **per turn** (does not overwrite `chat.modelId`). Optional `allowedTools` filters the tool list. Status pill: `Generating reply (Builder)â€¦`.

**Legacy system prompt:** `#systemPrompt` textarea remains fallback when composed prompt is empty. Full per-agent editor UI deferred to **Step 20**.

**APIs (`npm start`):**

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/work-agents` | `{ agents, overrides }` |
| `GET` | `/api/work-agents/:id` | Single merged agent |
| `PUT` | `/api/work-agents/:id` | Patch `work-agents.json` override |
| `GET` | `/api/work-agents/:id/prompt?profile=full\|lite` | `{ content, source }` |
| `PUT` | `/api/work-agents/:id/prompt` | Write `~/.minnow/prompts/work-agents/...` |

**Tests:** `test/work-agents/**/*.test.mjs`. Verification: [`documentation/plans/verification/step-08.md`](plans/verification/step-08.md).

### Workspace folder (AI project root)

The **workspace** is the directory where file/git/terminal tools and the file tree operate. It defaults to the directory where `npm start` was launched; users change it from the top bar **folder** button (`#btnWorkspace`) via a **recent workspaces menu** (feature B1), not an immediate OS dialog.

| Concern | Location |
|---------|----------|
| Server root + MRU | `server/workspace/root.js` â€” `getWorkspaceRoot()`, `setWorkspaceRoot()`, `touchRecentWorkspacePath()`, `buildRecentWorkspaceList()`; `~/.minnow/config.json` â†’ `workspace.path` + `workspace.recentPaths` (max **10**, MRU order) |
| API | `GET/PUT /api/workspace`, `POST /api/workspace/pick`, `DELETE /api/workspace/recent` â€” `server/workspace/middleware.js` |
| Folder picker | In-app browser: `GET /api/workspace/browse`, [`src/ui/workspace-folder-picker.ts`](../src/ui/workspace-folder-picker.ts), [`src/styles/workspace-folder-picker.css`](../src/styles/workspace-folder-picker.css). Legacy native picker remains at `POST /api/workspace/pick` (`server/workspace/pick-folder.js`) but **Open new workspaceâ€¦** uses the in-app UI |
| Client state | `src/state/workspace.ts`, `src/config/workspace-api.ts` (`WorkspaceRecentItem`, `removeRecentWorkspace`) |
| Top bar UI | `src/ui/workspace-button.ts` (`applyWorkspaceSwitch`, `#workspacePathLabel` full path left of `#btnWorkspace`), `src/ui/workspace-recent-menu.ts`, `src/styles/workspace-menu.css` (current workspace: `--accent-dim` + ink border; hover: light `--code-inline-bg`, not `--accent-subtle`) |
| Prompt `{{cwd}}` | `src/chat/prompts/compose-context.ts` â†’ `resolveComposeCwd()` uses workspace path when set |

**Menu UX:** Click `#btnWorkspace` â†’ popover (right-aligned to the button, opens left) lists up to 10 recent paths (checkmark on current, muted + **Remove** when folder missing); selecting an existing path `PUT`s without the picker; divider then **Open new workspaceâ€¦** opens the centered folder browser (current folder pinned at top with **This folder**, indented subfolders with â€º chevrons, **Folders** section label, Up, double-click to drill down, **Open folder** / Cancel, Escape / overlay dismiss). Starts at the current workspace when set; browse roots show Home (+ drive letters on Windows). Offline (`npm run dev`): same error as before (no menu). `applyWorkspaceSwitch()` refreshes label, file tree, and calls `applyWorkspaceScopedSession()` when B2 workspace-scoped chats are enabled.

**Server wiring:** `server.js` `resolveSafePath`, git, `execute_command`, terminal default cwd, and LSP path checks use `getWorkspaceRoot()`. Vite and built-in skills/prompts still resolve from the Minnow app root (`getAppRoot()`).

**Tests:** `test/workspace/workspace-api.test.js`, `test/ui/workspace-recent-menu.test.mjs`. Verification: [`documentation/plans/verification/feature-04.md`](plans/verification/feature-04.md).

### File panel (Step 11)

Project file explorer (right) and editable CodeMirror viewer in a horizontal split with chat.

| Concern | Location |
|---------|----------|
| File tree | `src/ui/file-tree.ts` â€” lazy `list_directory`, expand/collapse, `refreshFileTree()` after save |
| **Name filter (F19)** | `#fileTreeSearch` â€” debounced subsequence match on basename; filter mode BFS-indexes via `list_directory` (skips `.git`, `node_modules`, `dist`, `.minnow`) and shows flat results; browse mode when query empty. `src/ui/file-tree-filter.ts`, `src/ui/file-tree-search.ts`. Phase 2 content search not shipped. |
| Viewer | `src/ui/file-viewer.ts` â€” `read_file` / `read_file_range` / `save_file`; **`.md` / `.markdown`** render as read-only GFM preview (`setAssistantBubbleContent`, `.file-viewer-markdown-preview` â€” full pane width; chat `msg-bubble--md` max-width overridden in `file-panel.css`); other files use CodeMirror 6 + GitHub-style highlight (`src/ui/codemirror-theme.ts`); Save button + Ctrl/Cmd+S (editor only); dirty â— on path; large files (>512 KB) load lines 1â€“2000 read-only; LSP completions via `src/ui/file-editor-extensions.ts` + `POST /api/lsp/completion` when LSP enabled |
| Layout | `src/ui/file-layout.ts`, `src/ui/init-file-panel.ts` |
| Parser | `src/lib/list-directory-parse.ts` |
| State / prefs | `src/state/file-panel.ts` â†’ `config.json` `filePanel` via `GET/PUT /api/config/meta` |
| Styles | `src/styles/file-panel.css` |
| Markup | `index.html` â€” `#fileSidebar`, `#workspaceSplit`, `#fileViewerPane` |

**Tree row density (E4 / feature-21):** Default rows are compact (`min-height: 0`, tighter padding in `file-panel.css`); `@media (pointer: coarse)` restores `min-height: var(--touch-min)` (44px) and touch padding. Row hover/selection matches chat sidebar (`.chat-item-row`): fine-pointer `--surface-elevated` hover, `--accent` border when selected. Depth indent: `src/ui/file-tree-indent.ts` (`FILE_TREE_DEPTH_INDENT_PX` = 12, dir/file base 6 / 24), re-exported from `file-tree.ts`.

**Server:** Tree and viewer call `executeTool()` directly (`POST /api/tools`); tool catalog toggles in Settings are **not** required. Offline (`npm run dev`): empty state â€œStart with `npm start`â€¦â€. On boot, after `detectLocalServer()`, `initFilePanel()` and `onFilePanelServerAvailabilityChanged()` load the tree when the server is up (no need to open the Files panel or click refresh).

**Persistence (`filePanel`):** `fileSidebarCollapsed`, `viewerOpen`, `splitRatio` (0.35â€“0.75), `expandedDirs`, `selectedPath`, `treeRoot`. No dedicated `localStorage` key when config API is up.

**Phase 2 â€” drag to composer:** File and folder rows in `src/ui/file-tree.ts` are draggable via `wireTreeRowDrag` (`effectAllowed` `copyMove` for composer copy + tree move; `suppressClick` after drag so clicks still open the viewer). Drop on `#msgInput` / `.input-bar` adds a **workspace reference** chip (`kind: workspace`, MIME `application/x-minnow-workspace-file`) via `src/ui/composer-drop.ts` and `src/attachments/workspace-ref.ts`. On send, `resolveWorkspaceReferences()` loads each path with `read_file` and inlines `<file>` blocks through `buildHistoryUserContent` in `src/tools/loop.ts`.

**Tree CRUD (E1 / feature-18):** Context menu + shortcuts on file/folder rows call `executeTool` (`.file-tree-context-menu` uses light `--bg` popover like `workspace-menu`, not `--surface-elevated`) (`delete_path`, `move_file`, `copy_file`, `save_file`, `make_directory`) through [`src/ui/file-tree-ops.ts`](../src/ui/file-tree-ops.ts) with the same permission/approval gate as chat tools. Feedback via top-bar `setStatus` (not a floating toast). Path helpers: [`src/ui/file-tree-path.ts`](../src/ui/file-tree-path.ts), clipboard: [`src/ui/file-tree-clipboard.ts`](../src/ui/file-tree-clipboard.ts). Menu UI: [`src/ui/file-tree-context-menu.ts`](../src/ui/file-tree-context-menu.ts). Server flag for browse/CRUD: [`src/ui/file-tree-server.ts`](../src/ui/file-tree-server.ts) (synced from `init-file-panel.ts`). **Tests:** `test/file/file-tree-ops.test.mts`; UI modules under tsx use [`test/test-loader.mjs`](../test/test-loader.mjs) (stubs xterm CSS).

**Internal tree move (E3 / feature-20):** Drop a file or folder onto a **folder row** in `#fileTreeHost` â†’ [`showMoveConfirmDialog`](../src/ui/file-tree-move-dialog.ts) (inline `#fileTreeMoveConfirm` strip in `#fileSidebar`, not a native dialog) â†’ [`movePath`](../src/ui/file-tree-ops.ts) via existing `move_file` (no new REST route). Delegation: [`src/ui/file-tree-dnd.ts`](../src/ui/file-tree-dnd.ts) (`initFileTreeDnD` from `init-file-panel.ts`; `dragover` uses `activeDragSourcePath` from capture `dragstart` because `DataTransfer.getData` is empty during `dragover`). Invalid drops (cycle, same parent) use `computeMoveDestination` in `file-tree-path.ts`.

**Tests:** `test/file/list-directory-parse.test.mjs`, `test/file/file-tree-boot.test.mjs`, `test/file/file-tree-filter.test.mjs`, `test/file/file-tree-search.test.mjs`, `test/file/file-tree-filter-render.test.mjs`, `test/file/file-tree-layout.test.mjs` (E4 indent constants), `test/file/file-viewer-save.test.mjs` (happy-dom + tsx), `test/file/path-utils.test.mjs` (path + `computeMoveDestination`), `test/file/file-tree-move-dialog.test.mjs`, `test/file/file-tree-dnd.test.mjs`, `test/file/file-tree-ops.test.mts`, `test/workspace-ref.test.ts`, `scripts/step-11-smoke.mjs`. Verification: [`documentation/plans/verification/step-11.md`](plans/verification/step-11.md), [`documentation/plans/verification/feature-19.md`](plans/verification/feature-19.md), [`documentation/plans/verification/feature-20.md`](plans/verification/feature-20.md), [`documentation/plans/verification/feature-21.md`](plans/verification/feature-21.md).

### Sub-agent orchestration (Step 09)

Parent tool loop can spawn **isolated sub-agents** (separate messages, model, tool subset). Results return as JSON aggregate tool results; child transcripts are **not** appended to parent `chat.history`.

**Visibility (feature 30):** Each spawn shows a **sub-agent card** in the parent chat (`src/ui/sub-agent-cards.ts`) with live status; clicking opens a **slide-over drawer** with a read-only transcript (`src/ui/sub-agent-drawer.ts`, `src/styles/sub-agent-drawer.css`). While a run is active, `src/agents/sub-agent-runner.ts` pushes transcript snapshots through `onMessagesChange` (system/user seed, streaming assistant deltas, tool rounds); `src/agents/orchestrator.ts` copies them onto `run.messages` and emits `sub-agent-events`; the open drawer re-renders on each emit. The orchestrator can **check in** without blocking via **`list_sub_agents`** and **`get_sub_agent_status`** (same executor as spawn/cancel). Terminal runs are copied into `chat.subAgentRuns` (`PersistedSubAgentRun[]` in `src/types.ts`) via `src/state/sub-agent-session-sync.ts` so the drawer works after reload. Spawn rows anchor after the parent tool bubble using `data-tool-call-id` on `.tool-call-msg` (`src/tools/loop.ts`).

| Concern | Location |
|---------|----------|
| Types | `src/agents/types.ts` |
| Config merge | `src/agents/sub-agent-config.ts`, `src/agents/defaults/sub-agents.json` |
| Orchestrator | `src/agents/orchestrator.ts` â€” spawn, cancel, queue, `restartSubAgent`, `cancelAllForParentTurn`, list/status helpers; `deriveSubAgentTerminalReason` + `terminalReason` on `get_sub_agent_status` / aggregate JSON |
| Events | `src/agents/sub-agent-events.ts` |
| Runner | `src/agents/sub-agent-runner.ts` â€” headless tool loop; per-type `maxToolTurns` (defaults: `generalPurpose` 16, `explore` 12; overridable in `sub-agents.json`) |
| Tool subset | `src/agents/sub-agent-tools.ts` |
| Prompts | `src/agents/shipped-sub-agent-prompts.ts`, `src/agents/prompts/sub-agents/*.md` |
| Parent tools | `spawn_sub_agent`, `cancel_sub_agent`, `list_sub_agents`, `get_sub_agent_status` in `src/tools/definitions.ts` |
| Executor | `src/tools/sub-agent-executor.ts`; routed in `src/tools/client.ts` |
| Parent abort | `src/tools/loop.ts` â€” `parentTurnId` + `cancelAllForParentTurn` on `AbortError` |
| Session hydrate | `src/state/sessions.ts` â€” `ensurePersistedSubAgentRuns` |
| Boot | `src/main.ts` â€” `initSubAgentUi()` + `startOrchestrateWatchdog()` after `loadSessionsFromStorage()` |

**Built-in types:** `generalPurpose`, `explore`, `shell`, `explorer` (Step 19 self-heal stub, `maxConcurrent: 1`).

**Config (`sub-agents.json`):** root `enabled`, `globalMaxConcurrent`, `defaultTimeoutMs`, `defaultMaxToolTurns`; per-type `providerId`, `modelId`, `maxConcurrent`, `timeoutMs`, `maxToolTurns`, `allowedTools` (whitelist or null), `deniedTools`, optional `workAgentId`. Hitting the cap sets run status **`failed`** (not `completed`), `get_sub_agent_status` exposes **`success: false`**, and linked board tasks **`failed`** — never **`complete`** (`src/agents/sub-agent-outcome.ts`, `syncBoardTaskOnSettle`, `board_update_task` guard when `assignedRunId` run did not succeed) (MIN-15 / MIN-10).

**Concurrency:** Over-cap spawns stay **`queued`** until a slot frees (FIFO global queue). Slots are tracked with `holdsConcurrencySlot` so cancelled queued runs do not corrupt the cap; `executeRun` wraps prompt setup + runner in one `try/catch` so a failed start always releases the slot and calls `drainQueue()`. Empty per-type `modelId` falls back to the parent chat's `modelId` before `POST /api/generations`.

**Step 19 hooks (exported, not wired):** `restartSubAgent`, `recordToolCallForRun`, `getRunToolCallFingerprint`.

**Persistence:** `GET/PUT /api/config/sub-agents` when `npm start`; client mirror `minnow.subAgents` in `localStorage` when Vite-only. Settled sub-agent transcripts also persist on **`chat.subAgentRuns`** in `sessions/state.json` (capped message list).

**Tests:** `test/sub-agents/**/*.test.mts`. Verification: [`documentation/plans/verification/step-09.md`](plans/verification/step-09.md).

| Method | Path | Purpose |
|--------|------|---------|
| `GET/PUT` | `/api/config/sub-agents` | User overrides for `sub-agents.json` |

### Programmatic prompts API (Step 04)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/prompts/registry` | Built-in + user prompt files parsed |
| `GET` | `/api/prompt-configs` | List custom profiles |
| `GET/PUT/DELETE` | `/api/prompt-configs/:id` | CRUD custom profile JSON |
| `POST` | `/api/prompt-configs/:id/duplicate` | Copy profile |

**Send path:** `resolveOutboundSystemMessages()` (expert routing + `resolveComposedSystemPrompt()` + `loadUserRules()`) â†’ `pushOutboundSystemMessages()` in [`api-system-messages.ts`](../src/tools/api-system-messages.ts) via `buildApiMessages()` in [`loop.ts`](../src/tools/loop.ts) and plain send in [`chat.ts`](../src/api/chat.ts). Produces **one or two** leading `role: system` messages: composed programmatic stack first, then optional global user rules when `rules.json` has `enabled: true` and non-empty `text`. Legacy `#systemPrompt` textarea is fallback when compose returns empty. User rules are **not** a `PART_ORDER` composer part. Sub-agent runs do not receive global user rules (v1).

**User rules (Feature 24):** Settings â†’ **Rules** (`#/settings/rules`). Client: [`src/config/user-rules.ts`](../src/config/user-rules.ts) (`loadUserRules`, `saveUserRules`, `getUserRulesPayloadForSend`); localStorage key `minnow.userRules` when Vite-only. **Tests:** `test/config/rules-crud.test.js`, `test/tools/build-api-messages-rules.test.mts`.

**Tests:** `test/prompts/*.test.mjs` + `test/prompts/*.test.js`. Verification: [`documentation/plans/verification/step-04.md`](plans/verification/step-04.md).

**Step 05 tests:** `test/modes/*.test.mts`. Verification: [`documentation/plans/verification/step-05.md`](plans/verification/step-05.md).

### Config API (`npm start` only)

Registered in [`server/config/middleware.js`](../server/config/middleware.js) before Vite SPA (same CORS as `/api/tools`). Service worker does **not** cache `/api/config/*` (network-only).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/config/ping` | `{ ok, home: ".minnow", homeResolved: true }` |
| `GET` | `/api/config/status` | `{ ok, storage: "home", migrated, schemaVersion }` |
| `GET/PUT` | `/api/config/sessions` | `SessionState` â†” `sessions/state.json` |
| `GET/PUT` | `/api/config/tools` | `ToolConfig` â†” `tools.json` |
| `GET/PUT` | `/api/config/system-prompt` | `SystemPromptSettings` â†” `system-prompt.json` |
| `GET/PUT` | `/api/config/rules` | `UserRulesSettings` â†” `rules.json` (Feature 24) |
| `GET/PUT` | `/api/config/sub-agents` | `sub-agents.json` (Step 09) |
| `GET/PUT` | `/api/config/meta` | `config.json` (merge on PUT) |
| `POST` | `/api/config/migrate` | Browser â†’ disk one-time import |
| `GET/PUT` | `/api/config/file?key=â€¦` | Whitelisted keys only; traversal â†’ **400** |

### Work Agents API (`npm start` only)

Registered in [`server/work-agents/routes.js`](../server/work-agents/routes.js). See **Work Agents (Step 08)** above for paths and behavior.

### Providers API (`npm start` only)

Registered in [`server/providers/routes.js`](../server/providers/routes.js) before Vite SPA. LLM **secrets never** returned from GET; proxy routes attach auth server-side.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/providers` | `{ providers: ProviderPublic[], activeProviderId }` |
| `GET` | `/api/providers/:id` | Public profile + `hasApiKey` / `hasBearer` flags |
| `POST` | `/api/providers` | Create provider dir + `profile.json` |
| `PUT` | `/api/providers/:id` | Update profile (non-secret) |
| `DELETE` | `/api/providers/:id` | Remove provider (**409** if last) |
| `PUT` | `/api/providers/:id/secrets` | Update `secrets.json`; response redacts values |
| `POST` | `/api/providers/:id/set-active` | Sets `config.json` `activeProviderId` |
| `GET` | `/api/providers/:id/models` | Proxy upstream models (auth injected) |
| `POST` | `/api/providers/:id/models/load` | Proxy model load (LM Studio v0) |
| `POST` | `/api/providers/:id/models/unload` | Proxy model unload (LM Studio v0) |

**`apiKind`:** `lm-studio-v0` (default paths `/api/v0/...`) or `openai-v1` (`/v1/...`). **Chat completions** are not proxied on `/api/providers`; all LLM streams use [`/api/generations`](#backend-owned-generations-phase-1).

**Seed:** On first `npm start` with empty `providers/`, creates `lm-studio-local` from legacy `config.json` `serverUrl` or `http://localhost:1234`.

Client: [`src/providers/`](../src/providers/) (`store.ts`, `resolve.ts`, `fetch-models.ts`, `fetch-chat.ts`). Models/load/unload always use `/api/providers/:id/...`; chat uses [`postChatCompletions`](../src/providers/fetch-chat.ts) â†’ `/api/generations` (shim) or [`src/api/generations.ts`](../src/api/generations.ts) (main tool loop).

**Vite-only (`npm run dev`):** No `/api/providers`; client synthesizes a fallback provider id. Settings shows **Provider management requires npm start**.

Client modules: [`src/config/storage-mode.ts`](../src/config/storage-mode.ts), [`api-client.ts`](../src/config/api-client.ts), [`migrate.ts`](../src/config/migrate.ts), [`tool-security-meta.ts`](../src/config/tool-security-meta.ts) (`toolSecurity.filesystemAccess`).

### Migration from `localStorage`

On first load with config API available, the client reads legacy keys and `POST /api/config/migrate`, then removes:

| localStorage key | File |
|------------------|------|
| `minnow-sessions-v1` | `sessions/state.json` |
| `minnow.tools` | `tools.json` |
| `minnow.systemPrompt` | `system-prompt.json` |

Re-run is **idempotent** (`skipped: true` when `config.json` has `migratedFromLocalStorage: true`).

### Vite-only fallback (`npm run dev`)

No `/api/config/*` â†’ client uses **`storageMode: 'localStorage'`** (same keys as before). Settings drawer shows **`#configStorageBanner`**: file-backed config requires `npm start`. **No dual-write.**

Server URL, temperature, and max tokens remain in the settings drawer DOM (not in the session blob).

### `minnow.tools` shape

```json
{
  "enabled": {
    "get_datetime": true,
    "calculate": true,
    "web_search": true,
    "wikipedia_search": true,
    "read_file": false
  },
  "permissions": {
    "read_file": "off",
    "web_search": "ask",
    "save_file": "full"
  },
  "keys": {
    "braveApiKey": ""
  }
}
```

- **`permissions`:** per built-in tool id (and optional `mcp__*` keys), one of **`full`** (no approval modal), **`ask`** (modal before each run), **`off`** (tool hidden from the model). Defaults match legacy **enabled** on first load: previously enabled tools become **`ask`**, disabled become **`off`**.
- **`enabled`:** mirrored from `permissions` (`true` when not `off`) for backward compatibility and older readers.
- **Defaults:** `get_datetime`, `calculate`, `web_search`, `wikipedia_search`, `save_memory`, and **`ask_question`** on by default; `ask_question` uses permission **`full`** (no approval strip â€” the question UI is the gate). Other catalog ids default **off** (`defaultToolConfig()` in [`src/config/defaults.ts`](../src/config/defaults.ts)); merging stored `tools.json` without permissions still preserves **`full`** for `ask_question` when enabled ([`normalizeToolConfig`](../src/tools/config.ts) and server [`validators.js`](../server/config/validators.js)).
- **UI:** Settings drawer and **Settings â†’ Tools** â€” `fillToolsSection()` builds grouped rows with a **permission** `<select>` per tool and global/category **Enable all** controls (bulk sets **`ask`** / **`off`**); list `change` delegates to `setToolPermission()` / `setToolsEnabled()` ([`src/tools/config.ts`](../src/tools/config.ts)), `syncToolSelectAllControls()` keeps bulk checkboxes aligned, `loadToolConfigIntoDrawer()` ([`src/ui/settings.ts`](../src/ui/settings.ts)). On the **full settings page**, `renderToolsSection()` ([`src/ui/settings-sections.ts`](../src/ui/settings-sections.ts)) hydrates from in-memory caches (`loadToolConfigForSettingsUi()`, `loadToolSecurityMeta()` â€” no network on repeat visits; one retry if boot-time `GET /api/config/tools` failed). Generation guard drops stale async renders. Server storage mode does **not** fall back to empty browser `minnow.tools` when `GET /api/config/tools` fails. Adds a server banner, intro copy, **Filesystem access** radios (restrict vs full disk, with confirm when enabling full), then a single **`.settings-tools-panel`** wrapping the tool list and Brave API key row (styles in [`src/styles/settings-page.css`](../src/styles/settings-page.css)); **`.settings-tools-list .tool-group-head`** adds top padding so category headers sit below the list toolbar divider. **Filesystem access** persists as `config.json` â†’ `toolSecurity.filesystemAccess` via [`src/config/tool-security-meta.ts`](../src/config/tool-security-meta.ts). Each time **Settings â†’ Tools** mounts, `clearMount` replaces the Brave key `<input>` â€” input/change listeners are re-attached on that fresh node so the key still persists when revisiting the section (the one-shot `toolsSectionInitialized` gate only wraps `registerToolHandlers()`).
- **Server gating:** Rows with `data-server-required` dim/disable when `detectLocalServer()` fails (no `npm start` ping). `getEnabledToolDefinitions()` omits server tools from the LM Studio request when the flag is false.
- **Offline UX:** Static Tools hint in [`index.html`](../index.html) (`tools-section-hint`: server tools need `npm start`). When ping fails, `#toolsServerBanner` is shown (â€œServer tools need npm start (not npm run dev).â€), `refreshServerToolDisabledState()` dims server rows, disables permission selects, and sets `title` on each. `setToolPermission` reverts enabling a server tool while offline and calls `setStatus('err', â€¦)` with â€œStart with npm start to use file/git tools.â€

### Ask Question cards (Feature 31)

Structured Q&A from the model via **`ask_question`**: [`executeTool`](../src/tools/client.ts) validates args, queues [`enqueueAskQuestion`](../src/tools/ask-question-queue.ts), and shows [`showQuestionCardsModal`](../src/ui/question-cards-modal.ts) in **`#questionHost`** ([`index.html`](../index.html)) **below** **`#toolApprovalHost`**. One question per card, prev/next carousel, synthetic **Other** row, **Submit answers** on the last card only, **Esc** cancels. While open: **`main-column--question-pending`** hides the composer (same pattern as tool approval). **Stop** calls [`forceCloseAskQuestionModal`](../src/ui/question-cards-modal.ts) from [`stop-generation.ts`](../src/chat/stop-generation.ts). Tool results stay JSON in history; the chat bubble uses a numbered list via [`formatAskQuestionResultForDisplay`](../src/ui/format-ask-question-result.ts) and [`renderToolResult`](../src/ui/tool-messages.ts). Types: [`ask-question-types.ts`](../src/tools/ask-question-types.ts). Styles: [`question-cards.css`](../src/styles/question-cards.css).

### Tool approval (execution gate)

Before `POST /api/tools` or browser tools run, [`executeTool`](../src/tools/client.ts) awaits [`ensureToolConfigReady`](../src/tools/config.ts) then calls [`maybeBlockToolForUserApproval`](../src/tools/permission-gate.ts) (**skipped** for `ask_question` â€” it uses its own strip): **`ask`** always shows the approval strip; **`full`** still shows it when a path argument resolves **outside the workspace** while `toolSecurity.filesystemAccess` is **`workspace`**. The strip mounts in **`#toolApprovalHost`** in [`index.html`](../index.html) (above **`#questionHost`**, between **`#chatArea`** and the composer). While it is open, **`#mainColumn`** gets **`main-column--tool-approval-pending`**, which hides **`.input-bar`** (composer) via CSS; the textarea and send button are also disabled until the user chooses **Allow once**, **Always allow** (writes **`full`** for that tool; **`saveToolConfigAsync`** awaits **`PUT /api/config/tools`** when using `npm start`), or **Cancel** (`Error: User denied tool execution`). Optional digit shortcuts **1 / 2 / 3** apply while the strip is open (not only when a button inside it is focused; the composer is disabled so focus often sits on **`<body>`**). They are suppressed if focus is in another editable control outside the host. **Esc** cancels. Queue: [`src/tools/approval-queue.ts`](../src/tools/approval-queue.ts); payload types: [`src/tools/tool-approval-types.ts`](../src/tools/tool-approval-types.ts); UI: [`src/ui/tool-approval-modal.ts`](../src/ui/tool-approval-modal.ts). Sub-agent tools use the same strip with the parent chat id threaded from [`setSubAgentExecutorContext`](../src/tools/sub-agent-executor.ts) â†’ spawn â†’ orchestrator â†’ [`sub-agent-runner.ts`](../src/agents/sub-agent-runner.ts).

### Path policy (server)

- **Workspace-only (default):** [`server.js`](../server.js) `resolveSafePath()` keeps paths under `getWorkspaceRoot()` unless **`toolSecurity.filesystemAccess`** in `config.json` is **`full`** or **`TOOLS_ALLOW_ALL_PATHS=1`** (automation escape hatch). Read from disk per tool request via [`server/config/tool-security.js`](../server/config/tool-security.js) and `AsyncLocalStorage` so nested calls stay scoped.

## Persisted message types (`chat.history`)

Types in [`src/types.ts`](../src/types.ts). The UI and `localStorage` use the `Message` union; LM Studio uses `ApiMessage` (built in `buildApiMessages`).

| Role | Stored shape | Notes |
|------|----------------|-------|
| **user** | `{ role: 'user', content: string }` | Plain string only in history. Attachments are **not** stored as binary: images â†’ `[image: filename.jpg]`; text/PDF â†’ `<file name="â€¦">â€¦</file>` blocks in `content`. |
| **assistant** (text) | `{ role: 'assistant', content, thinking?, stats?, usage? }` | Markdown-rendered in UI; optional metric chips. **`thinking`** is an optional `string[]` of reasoning segments when LM Studio streams separated reasoning (see **Message rendering**). |
| **assistant** (tools) | `{ role: 'assistant', content: string \| null, tool_calls: ToolCall[] }` | OpenAI-style calls: `id`, `type: 'function'`, `function.name`, `function.arguments` (JSON string). |
| **tool** | `{ role: 'tool', tool_call_id, content }` | Result string for one prior call; paired in UI via `tool_call_id`. |

**API-only (not persisted as separate history rows):** `system` prompt; multimodal user `content` as `ContentPart[]` (`text` + `image_url`) for VLM models on the wire ([`buildApiMessages`](../src/tools/loop.ts)).

**UI rendering:** [`renderChatFromHistory`](../src/ui/messages.ts) skips standalone `tool` rows, maps `tool_call_id` â†’ result, and renders [`tool-messages.ts`](../src/ui/tool-messages.ts) bubbles for each `tool_calls` entry. Empty assistant prose (no text, no `thinking`) is not painted. Assistant rows with **`thinking`** get a **Thoughts** toggle ([`thought-bubbles.ts`](../src/ui/thought-bubbles.ts)) above the bubble. **Live** turns use [`appendStreamingAssistantRow`](../src/ui/messages.ts) / [`revealAssistantProseBubble`](../src/ui/messages.ts) so the prose bubble stays hidden until the first streamed token; tool-only rounds call [`removeOrphanStreamingRow`](../src/ui/messages.ts) instead of revealing an empty shell (MIN-11). Empty finalize completions with no prose and no thinking are not persisted to history.

## Multi-chat sessions

The app supports **multiple chat sessions** with a **collapsible left sidebar**. Persisted in **`sessions/state.json`** when `npm start`, else `minnow-sessions-v1` in `localStorage` (key name unchanged; blob **`version`** is **2**).

| Concern | Location |
|---------|----------|
| Schema + migration | `src/types.ts` (`SESSION_SCHEMA_VERSION = 2`), `src/state/sessions.ts`, `src/state/session-workspace-scope.ts` |
| Server validate / migrate | `server/config/validators.js` (accepts v1 input, persists v2) |
| Sidebar filter + Unassigned | `src/ui/sidebar.ts`, `src/styles/sidebar.css` |
| Workspace switch hook | `onWorkspaceChanged()` in `sessions.ts`; `applyWorkspaceScopedSession()` in `sidebar.ts`; `applyWorkspaceSwitch()` in `workspace-button.ts` (B1 recent menu uses same path) |

**Workspace-scoped chats (B2):** Each chat has **`workspacePath`** (normalized absolute root at create; `''` = unassigned). The sidebar lists chats for **`getWorkspacePath()`** only; legacy pre-v2 chats appear under a collapsible **Unassigned** section (`workspacePath === ''`). **New chat** binds the current workspace. **Workspace switch** restores **`lastActiveChatIdByWorkspace`** (per normalized path key) or newest chat on that path, or creates a new empty scoped chat.

**Chat list row dot (`.chat-item-dot`):** Each row has `data-chat-id` on `.chat-item-row`. Visual state is resolved in [`src/ui/chat-item-dot.ts`](../src/ui/chat-item-dot.ts): **idle** (muted `--text-muted`), **unread** (green `--success` on inactive chats after a completed assistant reply since the user last viewed that chat; `chat.unread` + `lastAssistantAt`), **needs-input** (yellow `--warning` while tool approval or `ask_question` UI is open), **thinking** (ring spinner during reasoning SSE on the streaming chat, or on the active chat when `currentGenerationId` is set and the stream phase is `thinking`). The same `data-dot-state` is mirrored on `.chat-item-row` for collapsed-rail styling. Row selection uses `.chat-item-row.active` border/hover only; the dot does not mirror selection accent. `bootstrapActiveChatOpenedTimestamp()` in `main.ts` seeds the â€œopenedâ€ baseline for the initial active chat.

**Collapsed sidebar + work-agent badge (`.chat-item-agent-badge`):** When the chat sidebar is collapsed to the narrow rail (`.chat-sidebar.collapsed:not(.mobile-open)`) and a row shows a work-agent abbrev badge, the status dot is hidden and the badge is centered in the row. Badge fill/border uses the same semantic colors as the dot (`--text-muted`, `--success`, `--warning`, accent ring spinner for **thinking**). Expanded sidebar and mobile drawer keep dot + badge side by side.

**Migration v1â†’v2:** Client `parseSessionStateFromJson` and server `validateSessionState` set `workspacePath: ''` on legacy chats (no auto-bind). Defaults: `src/config/defaults.ts`, `server/config/home.js`.

- Sidebar order is **newest `lastMessageAt` first** (last committed user/assistant/tool history entry); opening or renaming a chat does not reorder. Legacy sessions without `lastMessageAt` fall back to `updatedAt` until the next message.
- At most **50** chats; oldest by `lastMessageAt` (then `updatedAt`) pruned on save (active chat never removed).
- **QuotaExceededError** â†’ status pill hint.
- Delete chat: confirm dialog; deleting active chat prefers another chat in the **same workspace**, or creates a new empty chat scoped to that workspace.

### Stream persistence across reload (feature 22 / C5)

**Main chat (Phase 2b+):** In-flight completions are owned by the Node backend (`server/generations/`). The client persists **`chat.currentGenerationId`** immediately after `POST /api/generations`, then subscribes with replay-from-zero. Refresh re-subscribes via `bootGenerationResumeForChats` / `bootGenerationResumeForChat` (`src/chat/generation-resume.ts`) â€” no re-prompt. **Stop** calls `cancelGeneration` + aborts the local reader (`src/chat/stop-generation.ts`). Stream **404** clears the id and shows: *This reply was lost when the server restarted.* (no auto-retry). Headless callers (sub-agent, reef widget, titles) use `postChatCompletions` â†’ generations with `persist: false`.

| Concern | Location |
|---------|----------|
| Backend | `server/generations/store.js`, `upstream.js`, `routes.js`; wired in `server.js` |
| Client API | `src/api/generations.ts` â€” `createGeneration`, `subscribeToGeneration`, `cancelGeneration` |
| Main send loop | `streamCompletionTurn` in `src/tools/loop.ts` â€” POST + subscribe; `resumeGenerationId` for boot |
| Shim | `src/providers/fetch-chat.ts` â€” synthetic `Response` for legacy SSE readers |
| Types / load | `currentGenerationId` on `Chat`; `clearStaleGenerationIdsOnLoad` in `src/state/sessions.ts`; `server/config/validators.js` accepts id (legacy `pendingTurn` on disk is ignored on hydrate) |
| Boot | `main.ts` â†’ `bootGenerationResumeForChats`; `sidebar.ts` â†’ `bootGenerationResumeForChat` on switch/create |
| Stop | Partial assistant saved to `history` with `stopped: true` + chip (no client checkpoint) |

**Removed (Phase 3):** `pendingTurn` checkpoints, Continue/Discard recovery banners, orphan user/tool-tail auto-retry (`turn-recovery.ts`). Reload resume is **backend generations only** via `currentGenerationId`.

### Programmatic chat titles (Step 07)

On the **first user message** while the chat is still named **`New chat`**, an async **non-streaming** title job runs (`scheduleChatTitleGeneration` in [`src/chat/titles/schedule.ts`](../src/chat/titles/schedule.ts)). The main send path is **not** awaited.

| Topic | Detail |
|-------|--------|
| **Trigger** | First `role: 'user'` row only; placeholder name check is case-insensitive (`New chat` / `New Chat`) |
| **Prompt** | Shipped [`src/chat/prompts/titles/default.md`](../src/chat/prompts/titles/default.md); override `~/.minnow/prompts/titles/default.md` via prompt registry when `npm start` |
| **Config** | `config.json` â†’ `titles.enabled`, `titles.modelId`, `titles.providerId`, `titles.maxTokens`, `titles.temperature` (see [`src/config/titles-meta.ts`](../src/config/titles-meta.ts)); `GET /api/config/meta` merges default `titles` when missing |
| **Provider** | Step 03 `postChatCompletions`; schedule uses resolved send `modelId` / `providerId` (work-agent / UI Designer bindings), then config overrides, then chat fields |
| **Reasoning models** | Title completion uses **`message.content` only** ([`generate.ts`](../src/chat/titles/generate.ts)); empty content â†’ null; [`sanitize.ts`](../src/chat/titles/sanitize.ts) rejects thinking boilerplate and `UNTITLED`; [`schedule.ts`](../src/chat/titles/schedule.ts) falls back to truncated user seed |
| **Apply** | `applyGeneratedChatTitle` only if still placeholder (rename/delete races discard) |
| **UI** | `renderSidebar()` after successful apply only |
| **Delete** | `removeChatById` aborts in-flight title job for that `chatId` |

**Removed:** synchronous first-line truncation (`maybeAutoTitleFromFirstUserMessage`).

**Tests:** `test/titles/*.test.mjs`. Verification: [`documentation/plans/verification/step-07.md`](plans/verification/step-07.md).

### Layout (summary)

- **Desktop:** header toggle collapses sidebar (wide vs narrow rail).
- **Chat list row actions:** rename (âœŽ) and delete (ðŸ—‘) use **32Ã—32px** controls with **no gap** on fine pointers (`sidebar.css`); **`pointer: coarse`** keeps **`--touch-min` (44px)** for touch targets.
- **Session row hover:** fine-pointer hover on non-active rows uses `--surface-elevated` fill; title and rename/delete use `--text-hover` (direct button hover: green/red). **Active** row keeps accent styling on hover (`sidebar.css`).
- **Mobile (â‰¤640px):** sidebar overlay + backdrop; safe-area padding.
- **Stats strip:** `#statsStrip` inference metrics above the terminal; **collapsed by default** (`.is-collapsed`). Toggle **`#btnStats`** in the chat sidebar footer (`initStatsStrip()` in [`stats.ts`](../src/ui/stats.ts), preference `minnow.statsStripOpen` in `localStorage`). Inside an open strip, **`#statsExpandBtn`** still expands the detailed panel on mobile (â‰¤600px) and when the file editor split is open (feature 26).
- **Compact (â‰¤600px):** 16px input (iOS zoom); stats panel grid collapses behind the expand row when the strip is open; settings drawer is full-width with safe-area insets; top-bar **Load/Unload** (`#btnModelLoadUnload`) hidden to preserve model picker space (load dots remain in the picker).
- **Tablet (641â€“899px):** session sidebar **200px**; stats grid **2Ã—2**; Orchestrate kanban **2 columns**.
- **Phone Orchestrate board (â‰¤600px):** header toolbar wraps; lane controls use **44px** touch height; kanban lanes scroll horizontally with snap (one lane per swipe) instead of four squeezed columns.
- **Question cards (â‰¤600px):** `#questionHost` respects safe-area; nav/dismiss/submit/options sized for touch; landscape caps strip height.
- **Touch (`pointer: coarse`):** session rows and top-bar icon buttons meet **`--touch-min` (44px)** without changing fine-pointer desktop density.
- **Operating mode:** segmented control above attachments ([`mode-selector.ts`](../src/ui/mode-selector.ts), `Chat.modeId` per session).
- **Operating mode:** segmented control above attachments ([`mode-selector.ts`](../src/ui/mode-selector.ts), `Chat.modeId` per session).
- **Attachments:** `#fileInput`, `#attachBtn`, `#attachPreview` row above the composer ([`input.css`](../src/styles/input.css), [`initAttachments()`](../src/attachments/store.ts)). Composer column gap **10px**; input row gap **10px**; preview strip **2px** bottom margin when visible. Chips clear from `#attachPreview` only after a **successful** send (same `completedNormally` gate as `clearAttachments()` in the tool loop).
- **Scrollbars:** Global thin theme thumbs in [`global.css`](../src/styles/global.css) (`scrollbar-width: thin`, WebKit 8px thumb on `--border2`); major scroll panes use `scrollbar-gutter: stable` so thumbs do not cover rounded chrome. **`#msgInput`** auto-grows via [`autoResize()`](../src/ui/input.ts) (cap **40vh**, hidden thumb until cap); tests: `test/ui/composer-auto-resize.test.mjs`.
- **Top bar:** Zones in `header.topbar` (left â†’ right): **`.topbar-brand`** (logo + title), **`.topbar-end`** (model row: **Refresh models** `#btnRefreshModels`, picker, optional Load/Unload, then `.status-pill`), **`.topbar-spacer`** (`flex: 1`), **`.topbar-actions`** (contiguous icon buttons: sidebar toggle, workspace, settings; 4px gap). **Inference metrics** `#btnStats` and **terminal** `#btnTerminal` live in **`.chat-sidebar-footer`** (bottom-left of the session sidebar), not the top bar. **File tree** toggle is `#btnFileSidebarCollapse` on the file sidebar header (`applyFileSidebarVisuals` in [`file-layout.ts`](../src/ui/file-layout.ts)): **right chevron** when the panel is expanded (desktop) or the mobile overlay is open; **file-tree icon** when collapsed or closed â€” mirrors chat sidebar direction semantics (collapse toward workspace). **Model row** (`.model-wrap`): custom combobox [`model-select-picker.ts`](../src/ui/model-select-picker.ts) over hidden `#modelSelect`; trigger + `#modelSelectMenu` list show **load dots** (solid green / grey ring) per model; menu rows and trigger use native `title` tooltips (full canonical id + quant/load from `formatModelLabel`, or `option value` fallback); hover/selected rows use `--elevated-fg` on `--accent-subtle` ([`model-select.css`](../src/styles/model-select.css), MIN-7); menu `min-width: max(100%, 20rem)` reduces ellipsis clipping. Header `#modelStateDot` mirrors selection via [`model-state-dot.ts`](../src/ui/model-state-dot.ts); optional **Load/Unload** buttons when provider supports it (A3). **Status pill** (`setStatus` / `setReadyStatus` in [`src/ui/status.ts`](../src/ui/status.ts)): operational messages only â€” after `fetchModels()` success shows **`Ready`**, not `N models, M loaded`; shows full message text (`title` tooltip when copy exceeds 24 characters); provider failures append **Check Settings â†’ Providers**. **New chat** only via sidebar (`chat-new-wide` / `chat-new-compact`). `#btnNewChatTop` removed. `#btnSidebarToggle` (class `topbar-sidebar-toggle`) is **mobile-only** (hidden â‰¥641px); desktop uses `#btnSidebarCollapse` on the sidebar rail. Styles: [`src/styles/topbar.css`](../src/styles/topbar.css) â€” `z-index: 40` so topbar menus (e.g. `#modelSelectMenu`) stack above chat/file sidebars (`34`â€“`36`) and below modals/drawers (`50+`). Tests: `test/ui/topbar-layout.test.mjs`, `test/ui/model-state-dot.test.mts`, `test/api/models-status.test.mjs`.
- **UI hardening:** [`chat-turn-guard.ts`](../src/chat/chat-turn-guard.ts) blocks overlapping turn setup per chat; assistant failures use `.msg-bubble--error` via [`setAssistantErrorBubble`](../src/ui/messages.ts); bubbles use `overflow-wrap: anywhere`; ask-question strip shows live validation when Submit is disabled. Tests: `test/chat/chat-turn-guard.test.mts`.

## Dev server architecture (`server.js`)

Use **`npm start`** for the full stack. **`npm run dev`** is Vite-only (no tool API).

```text
Browser (same origin :5173)
    â”‚
    â”œâ”€â–º GET  /api/config/ping    â†’ { ok: true, homeResolved: true }
    â”œâ”€â–º GET/PUT /api/config/*    â†’ ~/.minnow JSON files
    â”œâ”€â–º GET  /api/tools/ping     â†’ { ok: true }
    â”œâ”€â–º POST /api/tools          â†’ { result: "<string>" }   body: { name, args }
    â”œâ”€â–º POST /api/terminal/run   â†’ { runId, startedAt } (agent one-shot runs)
    â”œâ”€â–º GET  /api/terminal/stream/:runId â†’ SSE (stdout/stderr/exit)
    â”œâ”€â–º POST /api/terminal/session â†’ { sessionId } (interactive PTY)
    â”œâ”€â–º WS   /api/terminal/ws?sessionId= â†’ JSON PTY I/O
    â”œâ”€â–º GET  /api/terminal/shell-profiles â†’ OS-gated shells
    â”œâ”€â–º GET  /api/terminal/history?chatId= â†’ { runs } (agent runs)
    â”œâ”€â–º GET/POST /api/providers/* â†’ registry + proxy (secrets on server only)
    â”‚
    â”œâ”€â–º LLM upstream (direct localhost or proxied /api/providers/:id/*)
    â”‚
    â””â”€â–º Vite SPA (index.html, /src/*, hashed assets)
```

`node server.js` uses Viteâ€™s programmatic API (`createServer` + [`vite.config.ts`](../vite.config.ts)), registers **`configureServer`** middleware **before** the SPA handler, listens on **`PORT`** (default **5173**), logs the URL, and opens the default browser (`start` / `open` / `xdg-open`).

| Route | Method | Response |
|-------|--------|----------|
| `/api/tools/ping` | GET | `{ "ok": true }` |
| `/api/tools` | POST | `{ "name", "args" }` â†’ `{ "result": "<string>" }` |
| `/api/terminal/run` | POST | `{ command, chatId?, args?, shell?, source? }` â†’ `{ runId, startedAt }` |
| `/api/terminal/stream/:runId` | GET | `text/event-stream` â€” `meta`, `stdout`, `stderr`, `exit` |
| `/api/terminal/session` | POST | `{ shellProfileId?, cwd?, cols?, rows? }` â†’ `{ sessionId, shell, â€¦ }` |
| `/api/terminal/session/:id` | DELETE | Kill PTY session |
| `/api/terminal/session/:id/resize` | POST | `{ cols, rows }` |
| `/api/terminal/ws` | WS | `?sessionId=` â€” JSON `{ type: input\|resize\|output\|exit\|meta }` |
| `/api/terminal/shell-profiles` | GET | `{ profiles[], ptyAvailable }` |
| `/api/terminal/sessions` | GET | Optional `?chatId=` â€” live PTY metadata |
| `/api/terminal/history` | GET | `?chatId=` â†’ `{ runs: TerminalRunRecord[] }` (agent runs) |
| `/api/terminal/log/:runId` | GET | `{ text }` log tail |
| `/api/terminal/cancel/:runId` | POST | `{ ok: true }` (SIGTERM when supported) |

- **CORS:** `*` for local dev; **OPTIONS** â†’ 204.
- **Path guard:** `resolveSafePath()` â€” paths under the workspace root unless `toolSecurity.filesystemAccess` is `full` in `config.json` or `TOOLS_ALLOW_ALL_PATHS=1`.
- **Errors:** Handlers return **strings**; failures use `Error: â€¦` prefix (not thrown to the client).
- **Browser-only tools on POST:** Names not in `SERVER_TOOL_HANDLERS` (e.g. `get_datetime`, `calculate`, `web_search`) return `Not implemented: {name}`. Expected â€” the client runs them via [`executeBrowserTool`](../src/tools/browser-executor.ts); only mistaken direct POSTs hit the stub.
- **Timeouts:** `execute_command`, `run_javascript`, `run_python` â€” **30s**.
- **Terminal streaming (Step 10):** [`server/terminal-runner.js`](../server/terminal-runner.js) + [`server/terminal/middleware.js`](../server/terminal/middleware.js). Client panel: [`src/ui/terminal-panel.ts`](../src/ui/terminal-panel.ts), API [`src/api/terminal.ts`](../src/api/terminal.ts). Blocking `POST /api/tools` still uses the same runner via `executeCommandBlocking()` (no SSE).

### Terminal panel (Step 10 + Epic D1 PTY)

Docked **bottom panel** in `.main-column`: **interactive PTY tabs** (xterm.js + WebSocket) for the user, plus a separate **agent run** stream (SSE) and **Agent runs** sidebar. Toggle metrics via `#btnStats` or terminal via `#btnTerminal` (sidebar footer) or **Ctrl+`**. Requires **`npm start`** for PTY; `npm run dev` shows offline banner (no WS). **Chrome:** [`src/styles/terminal.css`](../src/styles/terminal.css) matches bench-instrument panels (stats strip / input bar): hairline borders, `--code-inline-bg` for `#terminalShellHint` and hovers, ink-accent active tabs/history rows, solid bordered controls (no dashed add tab). Tokens: `--code-bg`, `--code-inline-bg` in [`src/styles/tokens.css`](../src/styles/tokens.css).

**Dual backend:** User shell â†’ `@lydell/node-pty`. Agent `execute_command` / `run_javascript` / `run_python` â†’ unchanged `terminal-runner` + SSE (`runCommandWithTerminalStream`).

| Concern | Location |
|---------|----------|
| Panel orchestration | `src/ui/terminal-panel.ts` |
| xterm + WS | `src/ui/terminal-xterm.ts`, `src/api/terminal-pty.ts` |
| Tabs + shell select | `src/ui/terminal-tabs.ts`, `#terminalTabBar`, `#terminalShellSelect` (PTY tabs init when the panel opens; `pagehide` kills PTY sessions) |
| PTY host | `server/terminal/pty-host.js`, `pty-ws.js`, `shell-profiles.js` |
| Agent SSE | `src/api/terminal.ts`, `server/terminal-runner.js` |
| Prefs | `config.json` â†’ `terminal: { open, heightPx, tabs[], activeTabId, defaultShellProfileId }` via [`src/config/terminal-meta.ts`](../src/config/terminal-meta.ts). Agent/sub-agent shell tools **never** auto-open the panel; `#btnTerminal` pulses while a run is in progress. Interactive PTY tabs attach only when the panel is open. Server removes exited PTY sessions so reloads do not hit the 8-session cap. |
| Agent persistence | `Chat.terminalHistory` (last **50** runs); logs `~/.minnow/logs/terminal/<runId>.log` |
| PTY audit | `~/.minnow/logs/terminal/pty-sessions.log` (create/kill only) |

**Shell profiles (OS-gated):** `powershell`, `cmd`, optional WSL `bash` on Windows; `zsh`/`bash` on macOS; `bash` on Linux. `GET /api/terminal/shell-profiles`.

**Windows:** Prefer `@lydell/node-pty` (prebuilt). Stock `node-pty` needs VS Build Tools + `node-gyp`.

**Tests:** `node test/terminal-stream.test.mjs <baseUrl>`; `npm run test:terminal-pty`; unit `test/terminal/*.test.mjs`. Verification: [`documentation/plans/verification/feature-06-09.md`](plans/verification/feature-06-09.md).

**Executor extras (not in the 32-tool settings catalog):**

| Name | Purpose |
|------|---------|
| `web_search_ddg` | DuckDuckGo HTML snippets when Brave key missing (`web_search` routes here via [`client.ts`](../src/tools/client.ts)) |
| `send_notification` | OS notification / dialog |
| `read_document` | PDF attachment extraction (base64 in `args.content`, max **10MB** decoded) |

### PDF attachments (`read_document` + `pdf-parse`)

- Invoked by [`src/attachments/reader.ts`](../src/attachments/reader.ts) when user picks a `.pdf` and `npm start` is up.
- POST `{ name: 'read_document', args: { filename, content } }` where `content` is base64 file bytes.
- Text extraction uses optional **`pdf-parse`** ([`package.json`](../package.json) `optionalDependencies`). If the module is missing, the server returns an install hint string.
- Install when needed: `npm install` (pulls optional deps) or `npm install pdf-parse`.

## Built-in tools (55)

Catalog: [`BUILT_IN_TOOLS`](../src/tools/definitions.ts) — **20** `serverRequired: false` (browser-routed: web, utility, `ask_question`, mode handoff, sub-agent/board orchestration), **35** `serverRequired: true` (Node, including **7** CDP `browser_*`, memory, LSP, Impeccable). Function `name` in each schema matches `executeBrowserTool`, dedicated executors, or `executeServerTool`.

### Browser CDP (7 server, Step 12)

Requires Chrome with `--remote-debugging-port` (default `9222`). Optional env: `MINNOW_BROWSER_URL`. Config: `~/.minnow/config.json` â†’ `browser` (enabled, defaultUrl, allowlist). Handlers: [`server/cdp/`](../server/cdp/).

| id | Purpose |
|----|---------|
| `browser_list` | List page targets |
| `browser_navigate` | Navigate (origin allowlist) |
| `browser_snapshot` | A11y tree + uid cache |
| `browser_click` / `browser_fill` | Act on snapshot uid |
| `browser_eval` | `Runtime.evaluate` in page |
| `browser_screenshot` | PNG + `attachments` for chat UI |

**Screenshot route:** `GET /api/browser/screenshot/:id` serves `~/.minnow/screenshots/{id}.png`.

### Web (4 browser)

| id | Runs on |
|----|---------|
| `web_search` | Browser (Brave API if `braveApiKey` / `api_key`; else client routes to `web_search_ddg` when server up) |
| `wikipedia_search` | Browser |
| `fetch_web_content` | Browser (fetch + strip HTML, ~8KB cap; CORS limits apply) |
| `rag_web_content` | Browser (fetch + sentence scoring by query) |

### Utility (5 browser)

| id | Runs on |
|----|---------|
| `get_datetime` | Browser |
| `calculate` | Browser (whitelist math + `Math`) |
| `read_clipboard` / `write_clipboard` | Browser |
| `get_system_info` | Browser (`navigator`, `screen`, timezone JSON) |

### Chat UI and mode handoff (4 browser-routed)

| id | Runs on |
|----|---------|
| `ask_question` | Browser — structured cards via [`ask-question-queue.ts`](../src/tools/ask-question-queue.ts) |
| `propose_mode_switch` | Browser — `ask_question` presets for mode suggestions |
| `set_chat_mode` | Browser — [`mode-selector.ts`](../src/ui/mode-selector.ts) |
| `create_chat_with_mode` | Browser — [`sidebar.ts`](../src/ui/sidebar.ts) (optional `orchestratePlanPath`) |

### Sub-agents and Orchestrate board (6 browser-routed)

| id | Runs on |
|----|---------|
| `spawn_sub_agent` | Browser — [`sub-agent-executor.ts`](../src/tools/sub-agent-executor.ts) → [`orchestrator.ts`](../src/agents/orchestrator.ts) |
| `cancel_sub_agent` | Browser |
| `list_sub_agents` / `get_sub_agent_status` | Browser |
| `board_init` / `board_update_task` / `board_get_state` | Browser — [`board-tools.ts`](../src/tools/board-tools.ts) |

### Memory and LSP (3 server)

| id | Purpose |
|----|---------|
| `save_memory` | Persist memory entries under `~/.minnow/memory/` |
| `get_lsp_diagnostics` | Diagnostics for a workspace file |
| `list_lsp_servers` | Configured LSP servers |

### Impeccable (2 server)

| id | Purpose |
|----|---------|
| `load_impeccable_context` | Load design context for `/impeccable` |
| `run_impeccable` | Run Impeccable detect/command scripts |

### Files (14 server)

`list_directory`, `read_file`, `read_file_range`, `save_file`, `append_file`, `insert_at_line`, `replace_text_in_file`, `search_in_file`, `make_directory`, `move_file`, `copy_file`, `delete_path`, `find_files`, `get_file_metadata`

### Git (6 server)

`git_status`, `git_diff`, `git_log`, `git_add`, `git_commit`, `git_checkout`

### Code (3 server)

`execute_command`, `run_javascript`, `run_python`

### Tool loop and client

- **`detectLocalServer()`** â€” `GET /api/tools/ping`, **800 ms** timeout ([`src/tools/client.ts`](../src/tools/client.ts)).
- **`executeTool(name, args, context?)`** â€” returns `{ content, attachments? }`; browser executor, terminal stream for code tools, or `POST /api/tools`; merges saved `braveApiKey` into `web_search`.
- **`sendMessageWithTools()`** â€” up to **`MAX_TOOL_TURNS` = 8**; streams SSE, `mergeToolCallDelta` / `finalizeToolCalls`, runs enabled tools, appends assistant + tool messages ([`src/tools/loop.ts`](../src/tools/loop.ts)).
- **Post-tool empty completion** â€” if the model returns `stop` with no prose after tool rows, the loop may run **one** extra round with an ephemeral API user line (`EMPTY_POST_TOOL_CONTINUE_INSTRUCTION` in [`src/tools/turn-continuation.ts`](../src/tools/turn-continuation.ts)); otherwise it **always** commits a final `assistant` row (prose, thinking-only, or `'The model returned no text.'`) and sets status **Ready**. Dev logging: `localStorage.minnowDebugTurns = '1'`.
- **Orphan tool tail recovery** â€” reload when history ends with `tool` (no final assistant): [`hasOrphanToolTailAwaitingReply`](../src/chat/turn-recovery.ts) + retry banner ([`src/ui/pending-turn-recovery.ts`](../src/ui/pending-turn-recovery.ts)); resend via [`resendFromIndex`](../src/chat/resend-from-index.ts).
- **Send entry:** [`src/chat/messaging.ts`](../src/chat/messaging.ts) exports `sendMessage` as alias of `sendMessageWithTools`; `sendMessagePlain` remains for non-tool chat ([`src/api/chat.ts`](../src/api/chat.ts)).

### Browser executor summary

[`executeBrowserTool`](../src/tools/browser-executor.ts) implements web/utility browser tools. [`executeTool`](../src/tools/client.ts) routes `ask_question`, mode handoff, sub-agent, and board tools to dedicated handlers. Returns strings or structured JSON; `Error: …` on failure.

## File attachments

| Concern | Detail |
|---------|--------|
| **Module** | [`src/attachments/`](../src/attachments/) â€” `types.ts`, `store.ts`, `reader.ts` |
| **UI** | Hidden `#fileInput` (multiple), paperclip button, `#attachPreview` chips |
| **Max size** | **10 MB** per file (`MAX_ATTACHMENT_BYTES`; aligns with `read_document`) |
| **Images** | `dataUrl` in memory; API: `image_url` parts when model type is **vlm** (`modelCache`) |
| **Text/code** | Many extensions in `reader.ts`; soft warn if **> 32 KB** (`largeTextWarning` chip) |
| **PDF** | Server `read_document` when `npm start`; else error chip |
| **Other binary** | Unsupported error chip |
| **After send** | `clearAttachments()` only when the send completes **normally** (`completedNormally` in [`sendMessageWithTools`](../src/tools/loop.ts)); abort, errors, and max-tool-turn exits **keep** preview chips so the user can retry |
| **History** | User `content` string with `[image: â€¦]` and/or `<file name="â€¦">` blocks |

## Service worker

[`public/sw.js`](../public/sw.js) â†’ `dist/sw.js`. Cache **`minnow-v5`**.

| Request | Strategy |
|---------|----------|
| `localhost` / `127.0.0.1` (LM Studio) | **Not intercepted** |
| Navigation | **Network-first**, fallback cached `./index.html` |
| `index.html`, `manifest.json` | **Cache-first** |
| Hashed JS/CSS | **Network only** |

Registration in [`src/main.ts`](../src/main.ts): `navigator.serviceWorker.register('sw.js')`.

## Design context

[`PRODUCT.md`](../PRODUCT.md), [`DESIGN.md`](../DESIGN.md), [`.impeccable/design.json`](../.impeccable/design.json).

**Theme:** OKLCH light surfaces, ink `--accent`, soft green user bubbles, JetBrains Mono for code/metrics ([`fonts.css`](../src/styles/fonts.css)). Light `--text-muted` is `oklch(0.52 0.028 250)` for WCAG AA labels/placeholders on sheet white. Markdown blockquotes use a light fill + hairline border (no side-stripe). Boot loader in [`index.html`](../index.html) uses the same OKLCH values as [`tokens.css`](../src/styles/tokens.css). Tool bubbles: `.tool-call-*` in [`messages.css`](../src/styles/messages.css); settings tools UI in [`settings.css`](../src/styles/settings.css).

**Motion:** Product UI timing in [`tokens.css`](../src/styles/tokens.css) (`--duration-fast` 150ms, `--duration-normal` 220ms, `--duration-slow` 350ms, `--ease-out`). Shared panel reveal in [`motion.css`](../src/styles/motion.css). State feedback only: drawer/sidebar scrims fade, mobile sidebars slide on `transform`, metrics bars use `scaleX`, tool/question strips use `minnow-panel-reveal`. No width layout animation on desktop rails. Global `prefers-reduced-motion` in [`global.css`](../src/styles/global.css).

## API usage (providers)

- **Models:** `fetchModels()` â†’ active provider (or per-chat `chat.providerId`) â†’ `fetchModelsForProvider()` â†’ `GET /api/providers/:id/models` (server proxies upstream with secrets). Top-bar `#modelSelect` (native, visually hidden) shows **human-readable labels** via [`formatModelLabel`](../src/lib/format-model-label.ts) (`buildModelOptionHtml`); visible picker is [`model-select-picker.ts`](../src/ui/model-select-picker.ts) with per-row load dots. `option value` and `chat.modelId` remain the canonical LM Studio `id`; each option `title` shows full id + quant + load state. After list refresh: `setReadyStatus()` + `updateModelStateDot()` + `syncModelSelectPicker()`. Load/unload: [`src/api/models.ts`](../src/api/models.ts) (`toggleSelectedModelLoad` â†’ `loadSelectedModel` / `unloadSelectedModel`) when LM Studio v0 provider is active; single `#btnModelLoadUnload` shows **Load** or **Unload** from selection state; inline `onclick` requires `window.toggleSelectedModelLoad` in [`main.ts`](../src/main.ts) `registerWindowHandlers()`.
- **Chat:** Main turns use [`streamCompletionTurn`](../src/tools/loop.ts) â†’ `POST /api/generations` + `GET .../stream`. Headless callers use `postChatCompletions()` â†’ same generations API with `persist: false`. Streaming SSE; when tools enabled, request includes `tools` + `tool_choice: 'auto'` from `getEnabledToolDefinitionsForMode(chat.modeId)`. Reasoning-capable models may emit `delta.reasoning` / `delta.reasoning_content` when the LM Studio developer option is enabled; the client surfaces those separately from assistant prose.
- **Settings UI:** `#providerSelect` switches active provider (`POST .../set-active`); `#serverUrl` shows active base URL (read-only when providers API is up).

## Backend-owned generations (Phase 1)

Server buffers upstream chat/completions streams so clients can attach, detach, and cancel without re-hitting the provider. Wired in [`server.js`](../server.js) after provider middleware.

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/generations` | POST | `{ providerId, body, persist? }` â†’ `{ generationId }` (201); starts upstream pump |
| `/api/generations/:id/stream` | GET | SSE replay + live chunks; `event: end` sentinel when terminal |
| `/api/generations/:id/cancel` | POST | `{ ok: true }`; aborts upstream |
| `/api/generations/:id` | GET | Debug: `status`, `totalBytes`, `startedAt`, `finishedAt`, `errorMessage` |

| Module | Role |
|--------|------|
| [`server/generations/store.js`](../server/generations/store.js) | In-memory `Map`; 16 MiB cap; eviction 30s (default) or 5 min (`persist: true`) |
| [`server/generations/upstream.js`](../server/generations/upstream.js) | Fire-and-forget `fetch` POST to provider chat path |
| [`server/generations/routes.js`](../server/generations/routes.js) | Vite middleware |

**Semantics:** Subscriber `req` `close` only removes that SSE client â€” upstream keeps running. `addSubscriber` registers before replay; `writeToSubscriber` must not drop clients on `res.write` backpressure. Process `exit` calls `deleteGenerationsForProviderShutdown()` (cancel all). Status flow: `pending` â†’ `streaming` â†’ `complete` \| `error` \| `cancelled`.

**Tests:** [`test/api/generations.test.mjs`](../test/api/generations.test.mjs) â€” lifecycle, dual replay+tail, mid-stream disconnect (sequential re-subscribe), cancel. Plan: [`documentation/plans/Build out/backend-owned-generations.md`](plans/Build%20out/backend-owned-generations.md).

## Backend-owned generations (Phase 2a â€” main chat loop)

The tool loopâ€™s `streamCompletionTurn` ([`src/tools/loop.ts`](../src/tools/loop.ts)) uses [`src/api/generations.ts`](../src/api/generations.ts) instead of `postChatCompletions` for main turns:

1. `createGeneration(providerId, body, { persist: true })` â†’ persist `chat.currentGenerationId` immediately via `scheduleSaveSessions()`.
2. `subscribeToGeneration(id, â€¦)` â€” same line-buffer reader as [`src/api/chat.ts`](../src/api/chat.ts); reuses `parseSsePayloads` / `extractStreamDelta` / `mergeStreamMeta`; parses terminal `event: end` in the subscribe layer.
3. Clean end clears `currentGenerationId`; `AbortError` calls `cancelGeneration` then rethrows.

`RunChatTurnOptions.resumeGenerationId` skips POST and only subscribes (boot resume wired in Phase 2b `generation-resume.ts`). Sub-agent, reef, title, and plain `sendMessage` still use `postChatCompletions` until the fetch-chat shim lands.

| Field | Location |
|-------|----------|
| `Chat.currentGenerationId` | [`src/types.ts`](../src/types.ts) |

## Stop generation (feature 14, Epic C1)

While the **active** chat is streaming (`isActiveChatStreaming()` in [`streaming-state.ts`](../src/chat/streaming-state.ts)), the composer primary button (`#sendBtn`) is a **Stop** control (`data-mode="stop"`, class `send-btn--stop`); the textarea stays enabled so the user can draft the next message. **`handleComposerPrimaryAction()`** calls **`stopGeneration()`** â†’ **`chatFetchAbort.abort()`** (v1: one in-flight turn; abort targets the streaming chat even when the user is viewing another thread). When another chat is streaming in the background, the active chat keeps **Send** and shows a composer hint (`composer-stream-hint.ts`: â€œReply in progress in â€¦â€ + **Go to chat**).

## Switch chats while waiting (sidebar multitask)

Users can **`switchChat`** / **`createChat`** while a reply runs in a different thread. Global **`streaming`** + **`streamingChatId`** still track the in-flight turn (v1: one concurrent stream); sidebar dots use the streaming chat id. **`switchChat`** does not abort the fetch; **`renderChatFromHistory`** loads the active thread; the tool loop skips live `#chatArea` DOM when `isStreamDomVisible(chatId)` is false while the backend generation continues. Returning to the streaming chat remounts the stream shell via [`stream-chat-dom.ts`](../src/tools/stream-chat-dom.ts). Sending on the active chat is blocked while a **background** stream runs (`isBackgroundStreamBlockingSend`) so a second turn does not clobber the in-flight chat. Mode/view toggles and expert/plan selects disable only when the **active** chat is streaming. **`deleteChat`** is blocked only for the chat that is currently streaming.

| Concern | Location |
|---------|----------|
| Helpers | [`src/chat/streaming-state.ts`](../src/chat/streaming-state.ts) |
| Sidebar | [`src/ui/sidebar.ts`](../src/ui/sidebar.ts) |
| Loop DOM gate | [`src/tools/loop.ts`](../src/tools/loop.ts), [`src/ui/messages.ts`](../src/ui/messages.ts) (`appendStreamingAssistantRow(forChatId)`) |
| Composer UX | [`src/ui/composer-send.ts`](../src/ui/composer-send.ts), [`src/ui/composer-stream-hint.ts`](../src/ui/composer-stream-hint.ts) |
**Tests:** `test/chat/streaming-state.test.mjs`, `test/ui/sidebar-streaming-switch.test.mjs`, `test/ui/composer-stream-hint.test.mjs`.

| Concern | Location |
|---------|----------|
| Stop API | [`src/chat/stop-generation.ts`](../src/chat/stop-generation.ts) â€” `cancelGeneration` + local abort |
| Composer toggle | [`src/ui/composer-send.ts`](../src/ui/composer-send.ts), [`src/styles/input.css`](../src/styles/input.css) |
| Tool-loop abort | [`src/tools/loop.ts`](../src/tools/loop.ts) â€” partial assistant in `history` with `stopped: true`, cooperative skip of remaining tools (`Stopped by user.`), `cancelAllForParentTurn` on abort |
| Stopped chip | [`src/ui/stopped-affordance.ts`](../src/ui/stopped-affordance.ts), `.msg--stopped` in [`messages.css`](../src/styles/messages.css) |
| History flag | `AssistantMessage.stopped?: boolean` in [`src/types.ts`](../src/types.ts); reload paints chip when set |

**Tests:** `test/chat/stop-generation.test.mts`, `test/chat/finalize-stopped-turn.test.mts`, `test/chat/generation-resume.test.mts`, `test/ui/composer-send.test.mjs`. Verification: [`documentation/plans/verification/feature-14.md`](plans/verification/feature-14.md).

## Message actions (Epic C2 â€” features 15â€“17)

Cursor-style **â‹® menu** on each history-backed user/assistant row (not on in-flight streaming shells).

| Action | Target | Behavior |
|--------|--------|----------|
| **Copy** | User / assistant | Clipboard text from `.msg-bubble` (prose only for tool turns) |
| **Edit** | User | Truncate after row, composer prefilled (skill `[skill: id]` footer stripped), next send updates row + `resendFromIndex` |
| **Regenerate from here** | User | Inclusive truncate â†’ `resendFromIndex` (no duplicate user row) |
| **Remake** | Assistant / tool group | Resend from preceding user message |
| **Delete message** | Any logical turn | Exclusive truncate (atomic assistant + `tool` rows); confirm when multiple rows removed |

| Concern | Location |
|---------|----------|
| Truncate + tail normalize | `src/chat/history-truncate-core.ts`, `src/chat/history-truncate.ts` |
| Resend orchestration | `src/chat/resend-from-index.ts` â†’ `runChatTurn({ pushUser: false })` in `src/tools/loop.ts` |
| Menu UI | `src/ui/message-actions.ts`, `src/styles/message-actions.css` |
| Render indices | `data-history-index`, `data-turn-kind` on `.msg` / tool cards in `renderChatFromHistory` |
| Skill footer parse | `src/skills/history-content.ts` |

**Guards:** All mutating actions blocked while `streaming` (same pattern as `clearChat`). Works with C1 stop: stop first, then regenerate. **v1:** No undo stack; resend does not re-hydrate attachment chips (history placeholders only). `chat.terminalHistory` is not truncated on delete (follow-up).

**Tests:** `test/chat/history-truncate.test.mts`, `test/chat/resend-from-index.test.mts`, `test/ui/message-actions.test.mjs`. Verification: [`documentation/plans/verification/feature-15-16-17.md`](plans/verification/feature-15-16-17.md).

## Message rendering

- **User:** plain `textContent` (includes literal markdown if typed).
- **Assistant:** **marked** + **DOMPurify** + **highlight.js**; streaming debounced ~100 ms.
- **Reasoning / â€œthinkingâ€** (LM Studio **App Settings â†’ Developer**: separate `reasoning_content` and/or `choices.delta.reasoning` for compatible models such as DeepSeek R1 / gpt-oss):
  - **Live stream phases** ([`stream-status.ts`](../src/ui/stream-status.ts), wired from [`messages.ts`](../src/ui/messages.ts), [`loop.ts`](../src/tools/loop.ts), [`chat.ts`](../src/api/chat.ts)): `generating` â†’ optional `thinking` (first reasoning delta) â†’ `generating` again after `endReasoningPhase()` until prose â†’ `prose`. A `.stream-status` row (sibling **before** the hidden prose bubble) shows **Generating responseâ€¦** or **Thinkingâ€¦** with animated dots; `role="status"`, `aria-live="polite"`, `aria-busy` until prose. Hidden after [`revealAssistantProseBubble`](../src/ui/messages.ts) or removed with [`removeOrphanStreamingRow`](../src/ui/messages.ts) when the turn ends with tools only / no visible prose. Respects `prefers-reduced-motion` (static dots).
  - **Live thought bubbles:** [`ThoughtBubbleController`](../src/ui/thought-bubbles.ts) shows one dashed **thought** bubble above the streaming assistant bubble; text appears with a typewriter effect; paragraph breaks (`\n\n`) start a new thought (previous bubble fades out). Boundary splits chain gap/fade work via returned promises (not `tailWork.then` on the in-flight queue â€” that had deadlocked after the first `\n\n`). When the model streams normal **`content`**, the live stage is torn down.
  - **After reply:** a **Thoughts** text button above that assistant bubble expands a read-only list of all segments (same controller module). Segments are stored on the assistant message as **`thinking: string[]`** on the **final** text reply of a user send (tool-loop rounds accumulate into one list).
  - **Parsing:** [`extractReasoningDelta`](../src/api/reasoning.ts) reads SSE chunks without mixing reasoning into `content` ([`extractStreamDelta`](../src/api/chat.ts) stays prose-only).
  - **Prose caret:** inline `.cursor.cursor--prose` (2px accent bar) during markdown stream; not the old solid block cursor.
- **Tool calls/results** ([`tool-messages.ts`](../src/ui/tool-messages.ts), used from history in [`messages.ts`](../src/ui/messages.ts) and intended during live tool turns in [`loop.ts`](../src/tools/loop.ts)):
  - **Collapsed (default):** tool **name** + **Success** or **Failed** (fail when result starts with `Error:` via `isToolResultFailure()`).
  - **Expanded (click):** **Arguments** and **Result** in the `<details>` body / monospace `<pre>` blocks; results capped at **2 KB** in the UI (`RESULT_DISPLAY_CAP`).
  - **Accessibility:** On completion, `.tool-call-msg` gets `role="status"` and `aria-live="polite"`; summary `aria-label` includes name + status + â€œshow detailsâ€; success/fail glyphs expose `aria-label` (not `aria-hidden`); visible **Failed** / **Success** label text for assistive tech.
  - **History:** `renderChatFromHistory` pairs each `tool_calls` entry with its `tool` row via `tool_call_id` and paints completed bubbles (no spinner).
  - **Live:** on `finishReason === 'tool_calls'`, append `renderToolCall` before `executeTool`, then `renderToolResult` with the result string. Tool-only assistant rounds remove the hidden streaming shell when there is no prose; the next model round gets a fresh hidden shell until prose arrives.
- **Errors:** plain text, no markdown class.

## Development commands

| Command | What runs | Tools API | Typical use |
|---------|-----------|-------------|---------------|
| **`npm start`** | `node server.js` â€” Vite + `/api/tools` | Yes | Default dev: tools, git/file ops, PDF attachments, server tool toggles enabled after ping |
| **`npm run dev`** | `vite` only | No | UI/HMR without Node tool handlers; server tools stay disabled in Settings |
| **`npm run build`** | `tsc` + `vite build` â†’ `dist/` | N/A (static deploy; no `server.js` in production unless you host it separately) |
| **`npm run preview`** | `vite preview` | No | Smoke-test production bundle |

### Testing

E2E checklist and manual QA steps: [`documentation/plans/tool-usage-verification.md`](plans/tool-usage-verification.md).

**Step 01 (chat UX / streaming):** [`documentation/plans/verification/step-01.md`](plans/verification/step-01.md) â€” `npm test`, `npm run build`, `scripts/step01-ui-smoke.mjs`.

**Step 02 (`~/.minnow`):** [`documentation/plans/verification/step-02.md`](plans/verification/step-02.md) â€” config API + migration tests with `MINNOW_HOME`.

**Step 03 (providers + auth):** [`documentation/plans/verification/step-03.md`](plans/verification/step-03.md) â€” `test/providers/*.test.js`, provider select UI.

```bash
npm test
npm run build
npx tsx scripts/step01-ui-smoke.mjs http://localhost:<port>   # requires npm start
```

With **`npm start`** running, automated API/browser-unit smoke:

```bash
npx tsx scripts/sa16-smoke.mjs http://localhost:<port>
```

Use the port printed by `server.js` (default **5173**; another port if busy).

### App bootstrap (`initApp`)

[`src/main.ts`](../src/main.ts) calls `markAppReady()` as soon as the module evaluates (Vite CSS is injected), then runs `initApp()` on `DOMContentLoaded` or immediately if the document is already parsed â€” **not** on `window.load` (that event often fires before deferred modules run, which left the loader stuck).

Order in `initApp()`:

1. `await detectConfigServer()` â†’ `await runMigrationIfNeeded()` if server mode.
2. `await loadToolConfigFromStorage()` â€” read `tools.json` (or `minnow.tools`) **before** prompt/session UI so permission state is never stale on first paint; overlapping calls share one in-flight promise and the loader always resolves (falls back to `defaultToolConfig()` on unexpected errors, so Node tests never see a rejected load).
3. `await initPromptSystem()` â€” built-in prompts + user registry from `/api/prompts/registry`.
4. `await initWorkAgentSystem()` â€” work agents from glob + `/api/work-agents` overrides.
5. `await loadSessionsFromStorage()`; `fillSystemPromptPresetSelect()` + `await loadSystemPromptSettings()`.
6. `fillToolsSection()` + `registerToolHandlers()`; `initAttachments()`; `initModeSelector()`; `initWorkAgentDevUi()`.
7. `await detectLocalServer()` â†’ `loadToolConfigIntoDrawer()` (server-required rows depend on ping).
8. `applySidebarVisuals()` + `renderSidebar()`.
9. `await loadProviderSelect()` + `registerProviderHandlers()`.
10. `await fetchModels()` â†’ `syncModelSelectForActiveChat()`, `renderChatFromHistory()`, `renderStatsForChat()`, `renderSidebar()` again.

## Hardening (production edge cases)

- Sidebar rows: no nested buttons; keyboard Enter/Space to switch chats.
- Overlays: Escape closes drawer / mobile sidebar (`dismissOpenLayers`).
- `parseServerBaseUrl()` before LM Studio fetch; `AbortController` on model list and chat.
- Send requires model, temperature 0â€“2, max tokens â‰¥ 1; while streaming the send button is Stop (enabled) and the textarea stays editable.
- Rename capped at 120 characters.

## Key files

| File | Role |
|------|------|
| [`server.js`](../server.js) | Vite + `/api/tools` middleware |
| [`index.html`](../index.html) | HTML shell, drawer, composer, attach UI |
| [`src/main.ts`](../src/main.ts) | Bootstrap, window handlers, SW register |
| [`src/types.ts`](../src/types.ts) | `Message`, `ToolCall`, `ApiMessage`, `ContentPart` |
| [`src/tools/definitions.ts`](../src/tools/definitions.ts) | 55-tool catalog |
| [`src/tools/config.ts`](../src/tools/config.ts) | `minnow.tools` |
| [`src/tools/client.ts`](../src/tools/client.ts) | Router + server detection |
| [`src/tools/loop.ts`](../src/tools/loop.ts) | Tool loop + `buildApiMessages` + composed system prompt |
| [`src/chat/prompts/prompt-composer.ts`](../src/chat/prompts/prompt-composer.ts) | `composeSystemPrompt`, profile/lite rules |
| [`src/chat/prompts/compose-context.ts`](../src/chat/prompts/compose-context.ts) | `buildComposeContext`, `resolveComposedSystemPrompt` |
| [`src/chat/prompts/prompt-configs.ts`](../src/chat/prompts/prompt-configs.ts) | Custom profile CRUD client |
| [`src/api/models.ts`](../src/api/models.ts) | Model list + cache; `fetchModels`, load/unload; populates `#modelSelect` |
| [`src/ui/model-state-dot.ts`](../src/ui/model-state-dot.ts) | Top-bar loaded/unloaded dot + `aria-label` sync |
| [`src/lib/format-model-label.ts`](../src/lib/format-model-label.ts) | Slug parse, humanize, `formatModelLabel`, `buildModelOptionHtml` |
| [`src/providers/store.ts`](../src/providers/store.ts) | List/active provider via `/api/providers` |
| [`src/providers/fetch-chat.ts`](../src/providers/fetch-chat.ts) | `postChatCompletions` (direct/proxy) |
| [`server/providers/routes.js`](../server/providers/routes.js) | Provider CRUD + proxy HTTP |
| [`src/attachments/reader.ts`](../src/attachments/reader.ts) | File processing + PDF POST |
| [`public/sw.js`](../public/sw.js) | PWA service worker |
| [`documentation/context.md`](context.md) | This document |
| [`documentation/plans/feature-audit-roadmap.md`](plans/feature-audit-roadmap.md) | Shipped vs gap audit (agents, Reef, headless, evals) |

