# Minnow — project context

User-facing setup and quick start: [`README.md`](../README.md).

Implementation plan and sub-agent breakdown: [`documentation/plans/tool-usage-subagent-steps.md`](plans/tool-usage-subagent-steps.md).

**To-fix roadmap:** Ordered steps in [`documentation/plans/to-fix-step-order.md`](plans/to-fix-step-order.md) (backlog line numbers match [`documentation/plans/to-fix.md`](plans/to-fix.md)). Per-step **implementation build plans** (with tests and todos): [`documentation/plans/Build out/`](plans/Build%20out/) (`step-01` … `step-20`). **Persistence contract (Step 02+):** `~/.minnow/sessions/state.json` — single session blob, not per-chat files. **Tests (Step 02+):** `npm test` → `node --test`.

## What it is

Minnow is a **Vite + TypeScript** single-page web client for **LM Studio** (local OpenAI-compatible API). UI markup lives in [`index.html`](../index.html); styles and logic are modular under [`src/`](../src/). Production output is emitted to [`dist/`](../dist/) via `npm run build`.

**LM Studio tools + attachments:** The default send path runs an OpenAI-style **tool loop** (`sendMessageWithTools` in [`src/tools/loop.ts`](../src/tools/loop.ts)). **41** built-in tools are defined in [`src/tools/definitions.ts`](../src/tools/definitions.ts); **32** execute on the Node side via **`npm start`** (`server.js` → `POST /api/tools`, including **7** CDP `browser_*` tools). **9** run in the browser. File **attachments** (images, text/code, PDF) use the composer paperclip and multimodal API payloads when a **VLM** model is selected. **`browser_screenshot`** returns inline PNG bubbles via `ToolResultMessage.attachments` and `GET /api/browser/screenshot/:id`.

## Repository layout (Vite)

```
Minnow/
├── index.html              # Vite shell: inline `#app-loader` until `html.app-ready` (set when `main.ts` module runs)
├── server.js               # Dev server: Vite + /api/tools (npm start)
├── package.json
├── tsconfig.json
├── vite.config.ts          # base: './', outDir: dist
├── public/                 # Copied verbatim to dist/ (not bundled)
│   ├── manifest.json       # PWA manifest (start_url: ./)
│   ├── sw.js               # Service worker (cache: minnow-v5)
│   └── icons/              # icon-192.png, icon-512.png
├── src/
│   ├── main.ts             # Entry: CSS imports, window handlers, initApp()
│   ├── types.ts            # Messages, ApiMessage, ToolCall, ContentPart
│   ├── constants.ts        # STORAGE_KEY, PRESET_STORAGE_KEY
│   ├── app-state.ts        # streaming flags, modelCache, abort controllers
│   ├── state/sessions.ts   # localStorage chat sessions
│   ├── api/models.ts       # fetchModels, modelCache, resolveModelInfo; friendly #modelSelect labels
│   ├── api/reasoning.ts    # extractReasoningDelta, splitThinkingSegments (LM Studio)
│   ├── api/chat.ts         # SSE/stream helpers, mergeToolCallDelta, sendMessagePlain
│   ├── chat/
│   │   ├── messaging.ts    # sendMessage → sendMessageWithTools
│   │   ├── modes/          # Step 05: registry, tool-policy
│   │   ├── prompts/        # Step 04 composer; `prompts/titles/` for title templates (Step 07)
│   │   └── titles/         # Step 07: schedule, generate, sanitize
│   ├── ui/                 # sidebar, file-tree, file-viewer, settings, stats, messages, tool-approval-modal, …
│   ├── state/file-panel.ts # file sidebar + viewer prefs
│   ├── lib/
│   │   ├── format-model-label.ts  # Epic A2: humanize model ids for top-bar picker
│   │   └── list-directory-parse.ts
│   ├── skills/               # Step 13: SKILL.md pack, client, builtin-manifest.json
│   ├── tools/
│   │   ├── definitions.ts      # 41-tool catalog (OpenAI function schemas)
│   │   ├── config.ts           # tools.json sync, permissions, enabled defs
│   │   ├── browser-executor.ts # 9 browser-native handlers (not CDP)
│   │   ├── client.ts           # ping, executeTool router, approval gate
│   │   ├── permission-gate.ts  # modal + path policy before tool runs
│   │   ├── approval-queue.ts   # serialized approval requests
│   │   ├── tool-approval-types.ts
│   │   ├── describe-invocation.ts
│   │   ├── path-args.ts
│   │   ├── workspace-path-guard.ts
│   │   └── loop.ts             # buildApiMessages, sendMessageWithTools
│   ├── attachments/
│   │   ├── types.ts
│   │   ├── store.ts        # pending list, preview chips, initAttachments()
│   │   └── reader.ts       # processFile — image, text, PDF
│   ├── markdown/renderer.ts
│   └── styles/
│       ├── fonts.css tokens.css global.css topbar.css sidebar.css
│       ├── messages.css input.css settings.css stats.css file-panel.css tool-approval.css responsive.css
│       └── thoughts.css    # live thought bubbles + Thoughts panel
├── dist/                   # Production build (gitignored)
└── documentation/
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
  config.json              # schemaVersion, activeProviderId, toolSecurity.filesystemAccess, …
  sessions/state.json      # full SessionState blob (all chats — canonical)
  tools.json               # ToolConfig (permissions, mirrored enabled, braveApiKey)
  system-prompt.json       # { presetId, text }
  rules.json               # global user rules { version, enabled, text } (Feature 24)
  memory/                  # scaffold (Step 16)
  providers/               # one dir per provider (Step 03)
    lm-studio-local/
      profile.json         # label, baseUrl, apiKind, connectionMode, paths
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
  backups/                 # scaffold
```

**Built-in prompts** ship under `src/chat/prompts/` (Step 04). **Built-in skills** under `src/skills/` (Step 13). User overrides use `~/.minnow/prompts/` and `~/.minnow/skills/`.

### Skills framework (Step 13)

Cursor-compatible **SKILL.md** skills: YAML front matter + markdown body. Invoked from the composer with **`/`** (slash picker) or by typing `/<skill-id>`.

| Root | Path | Override |
|------|------|----------|
| Built-in | `src/skills/<id>/SKILL.md` | Shipped in repo |
| User | `~/.minnow/skills/<id>/SKILL.md` | Same `name` replaces built-in |

**Merge:** user wins on duplicate `name`; dirs starting with `_` are excluded from the picker (`_example` is author docs only). **Send path:** `parseSlashCommand()` → `resolveActiveSkill()` → `skillBody` in `composeSystemPrompt()` (`skill` part). History stores user text without the raw slash line; footer `[skill: <id>]` when a skill was used.

| Concern | Location |
|---------|----------|
| Types, merge, slash parse | `src/skills/` (`loader.ts`, `parse-slash.ts`, `parse-frontmatter.ts`) |
| Catalog client + offline manifest | `src/skills/client.ts`, `src/skills/builtin-manifest.json` (from `npm run prebuild`) |
| Enable/disable + persistence | `src/skills/config.ts`, `~/.minnow/skills.json`, `GET/PUT /api/config/skills` |
| Settings UI (toggles, editor, add custom) | `src/ui/settings-skills.ts`, `src/skills/skill-settings-api.ts` |
| Custom skill template | `src/skills/_template/SKILL.md` (copied on `POST /api/skills`) |
| Slash picker UI | `src/ui/skill-picker.ts`, `src/styles/skill-picker.css` |
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

**Built-in ids (v1):** `git-commit`, `code-review`, `write-tests`, `explain-code`, `debug-error`, `docs-update`, `refactor-safe`, `security-review`, `browser-automation`, `impeccable` (Step 14), `ui-designer` (Step 15).

### Skills → Impeccable built-in (Step 14)

| Concern | Location |
|---------|----------|
| Built-in skill | `src/skills/impeccable/SKILL.md` (`name: impeccable` → `/impeccable`) |
| Upstream snapshot | `src/skills/impeccable/SKILL.upstream.md` (auto-synced; do not edit) |
| Command references | `src/skills/impeccable/reference/*.md` |
| Scripts | `src/skills/impeccable/scripts/` (`load-context.mjs`, `minnow-context.mjs`, …) |
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
| Model binding | `config.json` → `uiDesigner.providerId`, `uiDesigner.modelId`, `fallbackToChatModel` (default true) |
| Config API | `GET/PUT /api/config/meta` merges `uiDesigner` |
| Runner / preflight | `src/agents/ui-designer/runner.ts`, `preflight.ts` |
| Tool allowlist | `src/agents/ui-designer/tools.ts` — plan mode blocks writes |
| Send wiring | `src/tools/loop.ts` — binding, tool filter, one-turn `workAgentId` pin |
| Impeccable context tool | `load_impeccable_context` → `server/impeccable/load-impeccable-context.js` (script from app root, reads `PRODUCT.md` / `DESIGN.md` / `.impeccable/design.json` from workspace) |
| Impeccable CLI tool | `run_impeccable` → `server/impeccable/run-impeccable.js` |

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

**Config:** `config.json` → `memory.enabled`, `maxInjectCharsFull` / `maxInjectCharsLite`; `features.memoryInjection` gates retrieval on send (default on). **Client:** `src/memory/client.ts` (`fetchMemoryStatus`, `fetchMemoryEntries`, `retrieveMemoryBlock`, `createMemoryEntry`, …); `src/memory/config.ts` (`shouldInjectMemory`). **Settings UI:** `#/settings/memory` — toggle store, live entry count via `GET /api/memory/status`, scrollable list of entries (title, tags, body) via `GET /api/memory/entries?includeBody=1`, per-entry delete, backup/clear actions. **`save_memory`** is enabled by default (permission **ask**). **Tests:** `npm run test:memory`; smoke: `npx tsx scripts/step16-memory-smoke.mjs http://localhost:5173`.

### LSP integration (Step 17)

Language servers run in Node on `npm start`. Defaults in `src/lsp/defaults.json`; user overrides `~/.minnow/lsp.json`.

| Tool | Description |
|------|-------------|
| `get_lsp_diagnostics` | Formatted diagnostics for a relative path |
| `list_lsp_servers` | Configured servers + running state |

**API:** `/api/lsp/status`, `/api/lsp/diagnostics`, `POST /api/lsp/notify` (`{ path, event: open|change|close, text? }` → didOpen/didChange/didClose), `POST /api/lsp/completion` (`{ path, line, character }` → `{ items: [{ label, insertText, kind?, detail? }] }`), `GET/PUT /api/config/lsp` (PUT supports `removeLspIds` for custom server removal). **File viewer:** When LSP is enabled and `npm start` is up, CodeMirror autocomplete calls `src/lsp/completion-client.ts` via `src/ui/file-editor-extensions.ts`; open/edit/save debounce document sync (`src/ui/file-viewer.ts`). **Catalog:** `src/lsp/defaults.json` ships OpenCode-aligned built-ins (typescript, pyright, rust, …); user overrides in `~/.minnow/lsp.json`. **Settings:** `#/settings/lsp` lists all built-in servers (toggle `disabled`), running/idle badges, and an **Add custom language server** form (`src/ui/lsp-settings.ts`, `src/lsp/config-client.ts`). Test-only `fake` server is hidden in UI. **Tests:** `npm run test:lsp` (fake stdio server for `.fake` files + completion API).

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

Off by default (`config.json` → `selfHealing.enabled`). Toggle in **Settings → Features** (persists via `/api/config/file`). When enabled, duplicate sub-agent tool calls trigger tier-1 **restart** via `restartSubAgent()`. Tier 2 (explorer + skill authoring) is deferred.

| Module | Role |
|--------|------|
| `src/agents/self-healing/detector.ts` | Pure repetition heuristics |
| `src/agents/self-healing/controller.ts` | Observe tool log → restart |

**Tests:** `npx tsx --test test/self-healing/**/*.test.mts`.

### Settings page (Step 20)

Full-page settings at `#/settings/<section>` (`src/ui/settings-page.ts`, `src/ui/settings-sections.ts`, `src/styles/settings-page.css`). The sidebar `.settings-nav` stacks section buttons in a column with a small vertical `gap` between them. Topbar gear opens settings; each section loads live data from Step 02–18 APIs (providers, prompt-configs, **rules**, modes, experts, work/sub-agents, tools, MCP, LSP, skills, memory). **Rules** (`#/settings/rules`): enable toggle + textarea for global instructions; explicit **Save rules** persists to `rules.json` when `npm start` is up (offline hint + localStorage mirror otherwise). **Plan granularity** (`large` / `medium` / `small`) lives under **Modes → Plan** (expand the Plan row); persisted in `config.json` via `prompt-meta` (`planGranularity`). Nav clicks update the hash after `setActiveSection`; `openSettings()` skips re-entry when the page is already open on that section so `hashchange` does not race async section renders (duplicate entity lists on work/sub-agents). Async sections (providers, work agents, sub-agents) use a render-generation guard like the Tools panel. **Skills** panel (`#settingsSection-skills` / `#settingsSkillsBody`): each skill shows full description, **Built-In** or **Custom** badge, enable toggle (persisted in `skills.json`), and expandable **Edit SKILL.md**; **Add custom skill** copies `src/skills/_template/SKILL.md` to `~/.minnow/skills/<id>/` via `POST /api/skills` (requires `npm start`). Disabled skills are hidden from the slash picker. Custom prompt configs use `GET/PUT/DELETE /api/prompt-configs` with toolbar New/Save/Duplicate/Delete.

**Editable agents (modes, experts, work agents, sub-agents):** Expand each row in `#/settings/modes`, `#/settings/experts`, `#/settings/work-agents`, or `#/settings/sub-agents` to edit **Full/Lite** prompt bodies and **provider + model** bindings. UI: `src/ui/settings-entity-editor.ts`. APIs: `GET/PUT/DELETE /api/prompts/{modes|experts|sub-agents}/:id/prompt?profile=full|lite` (overrides under `~/.minnow/prompts/`); work agents also use `GET/PUT/DELETE /api/work-agents/:id/prompt` and `PUT /api/work-agents/:id` for `providerId` / `modelId` / `disabled` in `work-agents.json`. Sub-agent type settings persist via `PUT /api/config/sub-agents` (merged full config).

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

`base → mode → expert → work-agent → tool-usage → info → skill → memory`

**Shipped tree:** `src/chat/prompts/` (`base/`, `tool-usage/`, `info/` presets from `SYSTEM_PROMPT_PRESETS`, `modes/` full+lite pairs, `experts/`, …). Reference-only: `_example/`, `modes/_template/MODE_TEMPLATE.md`.

### Operating modes (Step 05)

Four primary modes per chat: **Build**, **Plan**, **Orchestrate**, **Research**.

| Concern | Location |
|---------|----------|
| Registry + tool policy | `src/chat/modes/registry.ts`, `tool-policy.ts` |
| Prompt bodies | `src/chat/prompts/modes/{id}.full.md`, `{id}.lite.md` |
| Template pack | `src/chat/prompts/modes/_template/` |
| UI selector | `src/ui/mode-selector.ts` (above composer in `index.html`) |
| Persistence | `Chat.modeId` in `sessions/state.json` (default `build`) |

**Send path:** `buildComposeContext()` sets `modeId` from active chat → `composeSystemPrompt()` loads `kind: mode` fragment → `getEnabledToolDefinitionsForMode(modeId)` filters tools in `loop.ts`.

**Plan / Research** deny destructive tools at the API (shell, file writes, git mutations per `registry.ts`).

**Tests:** `test/modes/*.test.mts`. Verification: [`documentation/plans/verification/step-05.md`](plans/verification/step-05.md). OpenCode mapping: [`documentation/plans/references/mode-sources.md`](plans/references/mode-sources.md).

### Expert system (Step 06)

Domain personas under `src/chat/prompts/experts/<id>/` (`expert.full.md`, `expert.lite.md`). User overrides: `~/.minnow/prompts/experts/<id>/`.

| Concern | Location |
|---------|----------|
| Registry + routing | `src/chat/experts/registry.ts`, `rules-router.ts`, `resolve.ts` |
| Optional LLM classify | `src/chat/experts/llm-classifier.ts` (not awaited on send — latency) |
| Config | `config.json` → `experts` block; loader `src/config/experts-config.ts` |
| UI | `#expertSelect` in composer strip (`src/ui/expert-select.ts`) |
| Persistence | `Chat.expertSelection`, `Chat.lastResolvedExpertId` in session blob |

**Behavior:** **Auto** re-runs rules router each send; **Manual** pins `expertId` until user selects Auto. `resolveExpertForTurn()` → `resolveComposedSystemPrompt()` sets `expertId` / `expertLabel` for `{{expert}}` interpolation.

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

**Built-in ids:** `default`, `builder`, `plan` → `planner`, `research` → `researcher`, plus `reviewer`. Mode auto-map via `defaultForModes` when `workAgentAuto` is true (default).

**Send path:** `resolveActiveWorkAgent()` → `resolveComposedSystemPrompt()` sets `workAgentId` / `workAgentLabel` → `resolveWorkAgentBinding()` picks provider + model **per turn** (does not overwrite `chat.modelId`). Optional `allowedTools` filters the tool list. Status pill: `Generating reply (Builder)…`.

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

The **workspace** is the directory where file/git/terminal tools and the file tree operate. It defaults to the directory where `npm start` was launched; users can change it from the top bar **folder** button (`#btnWorkspace`).

| Concern | Location |
|---------|----------|
| Server root + persistence | `server/workspace/root.js` — `getWorkspaceRoot()`, `setWorkspaceRoot()`, saved in `~/.minnow/config.json` as `workspace.path` |
| API | `GET/PUT /api/workspace`, `POST /api/workspace/pick` (native folder dialog) — `server/workspace/middleware.js` |
| Native picker | `server/workspace/pick-folder.js` (PowerShell / osascript / zenity) |
| Client state | `src/state/workspace.ts`, `src/config/workspace-api.ts` |
| Top bar UI | `src/ui/workspace-button.ts`, `index.html` `#btnWorkspace` |
| Prompt `{{cwd}}` | `src/chat/prompts/compose-context.ts` → `resolveComposeCwd()` uses workspace path when set |

**Server wiring:** `server.js` `resolveSafePath`, git, `execute_command`, terminal default cwd, and LSP path checks use `getWorkspaceRoot()`. Vite and built-in skills/prompts still resolve from the Minnow app root (`getAppRoot()`).

**Tests:** `test/workspace/workspace-api.test.js`.

### File panel (Step 11)

Project file explorer (right) and editable CodeMirror viewer in a horizontal split with chat.

| Concern | Location |
|---------|----------|
| File tree | `src/ui/file-tree.ts` — lazy `list_directory`, expand/collapse, `refreshFileTree()` after save |
| Viewer | `src/ui/file-viewer.ts` — `read_file` / `read_file_range` / `save_file`, CodeMirror 6 + GitHub-style highlight (`src/ui/codemirror-theme.ts`); Save button + Ctrl/Cmd+S; dirty ● on path; large files (>512 KB) load lines 1–2000 read-only; LSP completions via `src/ui/file-editor-extensions.ts` + `POST /api/lsp/completion` when LSP enabled |
| Layout | `src/ui/file-layout.ts`, `src/ui/init-file-panel.ts` |
| Parser | `src/lib/list-directory-parse.ts` |
| State / prefs | `src/state/file-panel.ts` → `config.json` `filePanel` via `GET/PUT /api/config/meta` |
| Styles | `src/styles/file-panel.css` |
| Markup | `index.html` — `#fileSidebar`, `#workspaceSplit`, `#fileViewerPane` |

**Server:** Tree and viewer call `executeTool()` directly (`POST /api/tools`); tool catalog toggles in Settings are **not** required. Offline (`npm run dev`): empty state “Start with `npm start`…”. On boot, after `detectLocalServer()`, `initFilePanel()` and `onFilePanelServerAvailabilityChanged()` load the tree when the server is up (no need to open the Files panel or click refresh).

**Persistence (`filePanel`):** `fileSidebarCollapsed`, `viewerOpen`, `splitRatio` (0.35–0.75), `expandedDirs`, `selectedPath`, `treeRoot`. No dedicated `localStorage` key when config API is up.

**Phase 2 — drag to composer:** File rows in `src/ui/file-tree.ts` are draggable (5px movement threshold so click still opens the viewer). Drop on `#msgInput` / `.input-bar` adds a **workspace reference** chip (`kind: workspace`, MIME `application/x-minnow-workspace-file`) via `src/ui/composer-drop.ts` and `src/attachments/workspace-ref.ts`. On send, `resolveWorkspaceReferences()` loads each path with `read_file` and inlines `<file>` blocks through `buildHistoryUserContent` in `src/tools/loop.ts`.

**Tests:** `test/file/list-directory-parse.test.mjs`, `test/file/file-tree-boot.test.mjs`, `test/file/file-viewer-save.test.mjs` (happy-dom + tsx), `test/workspace-ref.test.ts`, `scripts/step-11-smoke.mjs`. Verification: [`documentation/plans/verification/step-11.md`](plans/verification/step-11.md).

### Sub-agent orchestration (Step 09)

Parent tool loop can spawn **isolated sub-agents** (separate messages, model, tool subset). Results return as JSON aggregate tool results; child transcripts are **not** appended to parent `chat.history`.

**Visibility (feature 30):** Each spawn shows a **sub-agent card** in the parent chat (`src/ui/sub-agent-cards.ts`) with live status; clicking opens a **slide-over drawer** with a read-only transcript (`src/ui/sub-agent-drawer.ts`, `src/styles/sub-agent-drawer.css`). The orchestrator can **check in** without blocking via **`list_sub_agents`** and **`get_sub_agent_status`** (same executor as spawn/cancel). Terminal runs are copied into `chat.subAgentRuns` (`PersistedSubAgentRun[]` in `src/types.ts`) via `src/state/sub-agent-session-sync.ts` so the drawer works after reload. Live updates use `src/agents/sub-agent-events.ts` (subscribe/emit from `src/agents/orchestrator.ts`). Spawn rows anchor after the parent tool bubble using `data-tool-call-id` on `.tool-call-msg` (`src/tools/loop.ts`).

| Concern | Location |
|---------|----------|
| Types | `src/agents/types.ts` |
| Config merge | `src/agents/sub-agent-config.ts`, `src/agents/defaults/sub-agents.json` |
| Orchestrator | `src/agents/orchestrator.ts` — spawn, cancel, queue, `restartSubAgent`, `cancelAllForParentTurn`, list/status helpers |
| Events | `src/agents/sub-agent-events.ts` |
| Runner | `src/agents/sub-agent-runner.ts` — headless tool loop (`MAX_SUB_AGENT_TOOL_TURNS = 6`) |
| Tool subset | `src/agents/sub-agent-tools.ts` |
| Prompts | `src/agents/shipped-sub-agent-prompts.ts`, `src/agents/prompts/sub-agents/*.md` |
| Parent tools | `spawn_sub_agent`, `cancel_sub_agent`, `list_sub_agents`, `get_sub_agent_status` in `src/tools/definitions.ts` |
| Executor | `src/tools/sub-agent-executor.ts`; routed in `src/tools/client.ts` |
| Parent abort | `src/tools/loop.ts` — `parentTurnId` + `cancelAllForParentTurn` on `AbortError` |
| Session hydrate | `src/state/sessions.ts` — `ensurePersistedSubAgentRuns` |
| Boot | `src/main.ts` — `initSubAgentUi()` after `loadSessionsFromStorage()` |

**Built-in types:** `generalPurpose`, `explore`, `shell`, `explorer` (Step 19 self-heal stub, `maxConcurrent: 1`).

**Config (`sub-agents.json`):** root `enabled`, `globalMaxConcurrent`, `defaultTimeoutMs`; per-type `providerId`, `modelId`, `maxConcurrent`, `timeoutMs`, `allowedTools` (whitelist or null), `deniedTools`, optional `workAgentId`.

**Concurrency:** Over-cap spawns stay **`queued`** until a slot frees (FIFO global queue).

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

**Send path:** `resolveOutboundSystemMessages()` (expert routing + `resolveComposedSystemPrompt()` + `loadUserRules()`) → `pushOutboundSystemMessages()` in [`api-system-messages.ts`](../src/tools/api-system-messages.ts) via `buildApiMessages()` in [`loop.ts`](../src/tools/loop.ts) and plain send in [`chat.ts`](../src/api/chat.ts). Produces **one or two** leading `role: system` messages: composed programmatic stack first, then optional global user rules when `rules.json` has `enabled: true` and non-empty `text`. Legacy `#systemPrompt` textarea is fallback when compose returns empty. User rules are **not** a `PART_ORDER` composer part. Sub-agent runs do not receive global user rules (v1).

**User rules (Feature 24):** Settings → **Rules** (`#/settings/rules`). Client: [`src/config/user-rules.ts`](../src/config/user-rules.ts) (`loadUserRules`, `saveUserRules`, `getUserRulesPayloadForSend`); localStorage key `minnow.userRules` when Vite-only. **Tests:** `test/config/rules-crud.test.js`, `test/tools/build-api-messages-rules.test.mts`.

**Tests:** `test/prompts/*.test.mjs` + `test/prompts/*.test.js`. Verification: [`documentation/plans/verification/step-04.md`](plans/verification/step-04.md).

**Step 05 tests:** `test/modes/*.test.mts`. Verification: [`documentation/plans/verification/step-05.md`](plans/verification/step-05.md).

### Config API (`npm start` only)

Registered in [`server/config/middleware.js`](../server/config/middleware.js) before Vite SPA (same CORS as `/api/tools`). Service worker does **not** cache `/api/config/*` (network-only).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/config/ping` | `{ ok, home: ".minnow", homeResolved: true }` |
| `GET` | `/api/config/status` | `{ ok, storage: "home", migrated, schemaVersion }` |
| `GET/PUT` | `/api/config/sessions` | `SessionState` ↔ `sessions/state.json` |
| `GET/PUT` | `/api/config/tools` | `ToolConfig` ↔ `tools.json` |
| `GET/PUT` | `/api/config/system-prompt` | `SystemPromptSettings` ↔ `system-prompt.json` |
| `GET/PUT` | `/api/config/sub-agents` | `sub-agents.json` (Step 09) |
| `GET/PUT` | `/api/config/meta` | `config.json` (merge on PUT) |
| `POST` | `/api/config/migrate` | Browser → disk one-time import |
| `GET/PUT` | `/api/config/file?key=…` | Whitelisted keys only; traversal → **400** |

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
| `POST` | `/api/providers/:id/chat/completions` | Proxy SSE/JSON chat (auth injected) |

**`apiKind`:** `lm-studio-v0` (default paths `/api/v0/...`) or `openai-v1` (`/v1/...`). **`connectionMode`:** `direct` (browser → `baseUrl`, localhost) or `proxy` (browser → Minnow server → upstream with secrets).

**Seed:** On first `npm start` with empty `providers/`, creates `lm-studio-local` from legacy `config.json` `serverUrl` or `http://localhost:1234`. Non-localhost providers default to `proxy`.

Client: [`src/providers/`](../src/providers/) (`store.ts`, `resolve.ts`, `fetch-models.ts`, `fetch-chat.ts`). Chat/models use [`postChatCompletions`](../src/providers/fetch-chat.ts) instead of hard-coded `#serverUrl`.

**Vite-only (`npm run dev`):** No `/api/providers`; client uses a single **direct** fallback from read-only (or editable) `#serverUrl`. Settings shows **Provider management requires npm start**.

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

No `/api/config/*` → client uses **`storageMode: 'localStorage'`** (same keys as before). Settings drawer shows **`#configStorageBanner`**: file-backed config requires `npm start`. **No dual-write.**

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
- **Defaults:** `get_datetime`, `calculate`, `web_search`, `wikipedia_search` **on** with **`ask`**; every other catalog id **off** (`defaultToolConfig()` in [`src/config/defaults.ts`](../src/config/defaults.ts)).
- **UI:** Settings drawer and **Settings → Tools** — `fillToolsSection()` builds grouped rows with a **permission** `<select>` per tool and global/category **Enable all** controls (bulk sets **`ask`** / **`off`**); list `change` delegates to `setToolPermission()` / `setToolsEnabled()` ([`src/tools/config.ts`](../src/tools/config.ts)), `syncToolSelectAllControls()` keeps bulk checkboxes aligned, `loadToolConfigIntoDrawer()` ([`src/ui/settings.ts`](../src/ui/settings.ts)). On the **full settings page**, `renderToolsSection()` ([`src/ui/settings-sections.ts`](../src/ui/settings-sections.ts)) hydrates from in-memory caches (`loadToolConfigForSettingsUi()`, `loadToolSecurityMeta()` — no network on repeat visits; one retry if boot-time `GET /api/config/tools` failed). Generation guard drops stale async renders. Server storage mode does **not** fall back to empty browser `minnow.tools` when `GET /api/config/tools` fails. Adds a server banner, intro copy, **Filesystem access** radios (restrict vs full disk, with confirm when enabling full), then a single **`.settings-tools-panel`** wrapping the tool list and Brave API key row (styles in [`src/styles/settings-page.css`](../src/styles/settings-page.css)); **`.settings-tools-list .tool-group-head`** adds top padding so category headers sit below the list toolbar divider. **Filesystem access** persists as `config.json` → `toolSecurity.filesystemAccess` via [`src/config/tool-security-meta.ts`](../src/config/tool-security-meta.ts). Each time **Settings → Tools** mounts, `clearMount` replaces the Brave key `<input>` — input/change listeners are re-attached on that fresh node so the key still persists when revisiting the section (the one-shot `toolsSectionInitialized` gate only wraps `registerToolHandlers()`).
- **Server gating:** Rows with `data-server-required` dim/disable when `detectLocalServer()` fails (no `npm start` ping). `getEnabledToolDefinitions()` omits server tools from the LM Studio request when the flag is false.
- **Offline UX:** Static Tools hint in [`index.html`](../index.html) (`tools-section-hint`: server tools need `npm start`). When ping fails, `#toolsServerBanner` is shown (“Server tools need npm start (not npm run dev).”), `refreshServerToolDisabledState()` dims server rows, disables permission selects, and sets `title` on each. `setToolPermission` reverts enabling a server tool while offline and calls `setStatus('err', …)` with “Start with npm start to use file/git tools.”

### Tool approval (execution gate)

Before `POST /api/tools` or browser tools run, [`executeTool`](../src/tools/client.ts) awaits [`ensureToolConfigReady`](../src/tools/config.ts) then calls [`maybeBlockToolForUserApproval`](../src/tools/permission-gate.ts): **`ask`** always shows the approval strip; **`full`** still shows it when a path argument resolves **outside the workspace** while `toolSecurity.filesystemAccess` is **`workspace`**. The strip mounts in **`#toolApprovalHost`** in [`index.html`](../index.html) (between `#chatArea` and the composer). While it is open, **`#mainColumn`** gets **`main-column--tool-approval-pending`**, which hides **`.input-bar`** (composer) via CSS; the textarea and send button are also disabled until the user chooses **Allow once**, **Always allow** (writes **`full`** for that tool; **`saveToolConfigAsync`** awaits **`PUT /api/config/tools`** when using `npm start`), or **Cancel** (`Error: User denied tool execution`). Optional digit shortcuts **1 / 2 / 3** apply while the strip is open (not only when a button inside it is focused; the composer is disabled so focus often sits on **`<body>`**). They are suppressed if focus is in another editable control outside the host. **Esc** cancels. Queue: [`src/tools/approval-queue.ts`](../src/tools/approval-queue.ts); payload types: [`src/tools/tool-approval-types.ts`](../src/tools/tool-approval-types.ts); UI: [`src/ui/tool-approval-modal.ts`](../src/ui/tool-approval-modal.ts). Sub-agent tools use the same strip with the parent chat id threaded from [`setSubAgentExecutorContext`](../src/tools/sub-agent-executor.ts) → spawn → orchestrator → [`sub-agent-runner.ts`](../src/agents/sub-agent-runner.ts).

### Path policy (server)

- **Workspace-only (default):** [`server.js`](../server.js) `resolveSafePath()` keeps paths under `getWorkspaceRoot()` unless **`toolSecurity.filesystemAccess`** in `config.json` is **`full`** or **`TOOLS_ALLOW_ALL_PATHS=1`** (automation escape hatch). Read from disk per tool request via [`server/config/tool-security.js`](../server/config/tool-security.js) and `AsyncLocalStorage` so nested calls stay scoped.

## Persisted message types (`chat.history`)

Types in [`src/types.ts`](../src/types.ts). The UI and `localStorage` use the `Message` union; LM Studio uses `ApiMessage` (built in `buildApiMessages`).

| Role | Stored shape | Notes |
|------|----------------|-------|
| **user** | `{ role: 'user', content: string }` | Plain string only in history. Attachments are **not** stored as binary: images → `[image: filename.jpg]`; text/PDF → `<file name="…">…</file>` blocks in `content`. |
| **assistant** (text) | `{ role: 'assistant', content, thinking?, stats?, usage? }` | Markdown-rendered in UI; optional metric chips. **`thinking`** is an optional `string[]` of reasoning segments when LM Studio streams separated reasoning (see **Message rendering**). |
| **assistant** (tools) | `{ role: 'assistant', content: string \| null, tool_calls: ToolCall[] }` | OpenAI-style calls: `id`, `type: 'function'`, `function.name`, `function.arguments` (JSON string). |
| **tool** | `{ role: 'tool', tool_call_id, content }` | Result string for one prior call; paired in UI via `tool_call_id`. |

**API-only (not persisted as separate history rows):** `system` prompt; multimodal user `content` as `ContentPart[]` (`text` + `image_url`) for VLM models on the wire ([`buildApiMessages`](../src/tools/loop.ts)).

**UI rendering:** [`renderChatFromHistory`](../src/ui/messages.ts) skips standalone `tool` rows, maps `tool_call_id` → result, and renders [`tool-messages.ts`](../src/ui/tool-messages.ts) bubbles for each `tool_calls` entry. Empty assistant prose (no text, no `thinking`) is not painted. Assistant rows with **`thinking`** get a **Thoughts** toggle ([`thought-bubbles.ts`](../src/ui/thought-bubbles.ts)) above the bubble. **Live** turns use [`appendStreamingAssistantRow`](../src/ui/messages.ts) / [`revealAssistantProseBubble`](../src/ui/messages.ts) so the prose bubble stays hidden until the first streamed token (see **Message rendering** below).

## Multi-chat sessions

The app supports **multiple chat sessions** with a **collapsible left sidebar**. Persisted in **`sessions/state.json`** when `npm start`, else `minnow-sessions-v1` in `localStorage`.

- At most **50** chats; oldest by `updatedAt` pruned on save (active chat never removed).
- **QuotaExceededError** → status pill hint.
- Delete chat: confirm dialog; deleting active chat switches to latest other or creates a new empty session.

### Programmatic chat titles (Step 07)

On the **first user message** while the chat is still named **`New chat`**, an async **non-streaming** title job runs (`scheduleChatTitleGeneration` in [`src/chat/titles/schedule.ts`](../src/chat/titles/schedule.ts)). The main send path is **not** awaited.

| Topic | Detail |
|-------|--------|
| **Trigger** | First `role: 'user'` row only; placeholder name check is case-insensitive (`New chat` / `New Chat`) |
| **Prompt** | Shipped [`src/chat/prompts/titles/default.md`](../src/chat/prompts/titles/default.md); override `~/.minnow/prompts/titles/default.md` via prompt registry when `npm start` |
| **Config** | `config.json` → `titles.enabled`, `titles.modelId`, `titles.providerId`, `titles.maxTokens`, `titles.temperature` (see [`src/config/titles-meta.ts`](../src/config/titles-meta.ts)); `GET /api/config/meta` merges default `titles` when missing |
| **Provider** | Step 03 `postChatCompletions`; schedule uses resolved send `modelId` / `providerId` (work-agent / UI Designer bindings), then config overrides, then chat fields |
| **Reasoning models** | Title completion reads `message.content` then `reasoning` / `reasoning_content` ([`generate.ts`](../src/chat/titles/generate.ts)) |
| **Apply** | `applyGeneratedChatTitle` only if still placeholder (rename/delete races discard) |
| **UI** | `renderSidebar()` after successful apply only |
| **Delete** | `removeChatById` aborts in-flight title job for that `chatId` |

**Removed:** synchronous first-line truncation (`maybeAutoTitleFromFirstUserMessage`).

**Tests:** `test/titles/*.test.mjs`. Verification: [`documentation/plans/verification/step-07.md`](plans/verification/step-07.md).

### Layout (summary)

- **Desktop:** header toggle collapses sidebar (wide vs narrow rail).
- **Chat list row actions:** rename (✎) and delete (🗑) use **32×32px** controls with **no gap** on fine pointers (`sidebar.css`); **`pointer: coarse`** keeps **`--touch-min` (44px)** for touch targets.
- **Session row hover:** fine-pointer hover on non-active rows uses `--surface-elevated` fill; title and rename/delete use `--text-hover` (direct button hover: green/red). **Active** row keeps accent styling on hover (`sidebar.css`).
- **Mobile (≤640px):** sidebar overlay + backdrop; safe-area padding.
- **Compact (≤600px):** 16px input (iOS zoom), collapsible stats strip.
- **Operating mode:** segmented control above attachments ([`mode-selector.ts`](../src/ui/mode-selector.ts), `Chat.modeId` per session).
- **Operating mode:** segmented control above attachments ([`mode-selector.ts`](../src/ui/mode-selector.ts), `Chat.modeId` per session).
- **Attachments:** `#fileInput`, `#attachBtn`, `#attachPreview` row above the composer ([`input.css`](../src/styles/input.css), [`initAttachments()`](../src/attachments/store.ts)). Composer column gap **10px**; input row gap **10px**; preview strip **2px** bottom margin when visible. Chips clear from `#attachPreview` only after a **successful** send (same `completedNormally` gate as `clearAttachments()` in the tool loop).
- **Top bar:** Three zones in `header.topbar` — **`.topbar-brand`** (logo + title), **`.topbar-actions`** (contiguous icon buttons: sidebar toggle, workspace, files, refresh, terminal, settings; 4px gap), **`.topbar-spacer`** (`flex: 1`), **`.topbar-end`** (model row + `.status-pill`). **Model row** (`.model-wrap`): green/grey **`#modelStateDot`** (`data-model-state` on wrap) reflects selected model `state` from `modelCache` via [`src/ui/model-state-dot.ts`](../src/ui/model-state-dot.ts); `#modelSelect` in `.model-select-inner`; optional **Load/Unload** buttons when provider supports it (A3). **Status pill** (`setStatus` / `setReadyStatus` in [`src/ui/status.ts`](../src/ui/status.ts)): operational messages only — after `fetchModels()` success shows **`Ready`**, not `N models, M loaded`. **New chat** only via sidebar (`chat-new-wide` / `chat-new-compact`). `#btnNewChatTop` removed. `#btnSidebarToggle` (class `topbar-sidebar-toggle`) is **mobile-only** (hidden ≥641px); desktop uses `#btnSidebarCollapse` on the sidebar rail. Styles: [`src/styles/topbar.css`](../src/styles/topbar.css). Tests: `test/ui/topbar-layout.test.mjs`, `test/ui/model-state-dot.test.mts`, `test/api/models-status.test.mjs`.

## Dev server architecture (`server.js`)

Use **`npm start`** for the full stack. **`npm run dev`** is Vite-only (no tool API).

```text
Browser (same origin :5173)
    │
    ├─► GET  /api/config/ping    → { ok: true, homeResolved: true }
    ├─► GET/PUT /api/config/*    → ~/.minnow JSON files
    ├─► GET  /api/tools/ping     → { ok: true }
    ├─► POST /api/tools          → { result: "<string>" }   body: { name, args }
    ├─► POST /api/terminal/run   → { runId, startedAt }
    ├─► GET  /api/terminal/stream/:runId → SSE (stdout/stderr/exit)
    ├─► GET  /api/terminal/history?chatId= → { runs }
    ├─► GET/POST /api/providers/* → registry + proxy (secrets on server only)
    │
    ├─► LLM upstream (direct localhost or proxied /api/providers/:id/*)
    │
    └─► Vite SPA (index.html, /src/*, hashed assets)
```

`node server.js` uses Vite’s programmatic API (`createServer` + [`vite.config.ts`](../vite.config.ts)), registers **`configureServer`** middleware **before** the SPA handler, listens on **`PORT`** (default **5173**), logs the URL, and opens the default browser (`start` / `open` / `xdg-open`).

| Route | Method | Response |
|-------|--------|----------|
| `/api/tools/ping` | GET | `{ "ok": true }` |
| `/api/tools` | POST | `{ "name", "args" }` → `{ "result": "<string>" }` |
| `/api/terminal/run` | POST | `{ command, chatId?, args?, shell?, source? }` → `{ runId, startedAt }` |
| `/api/terminal/stream/:runId` | GET | `text/event-stream` — `meta`, `stdout`, `stderr`, `exit` |
| `/api/terminal/history` | GET | `?chatId=` → `{ runs: TerminalRunRecord[] }` |
| `/api/terminal/log/:runId` | GET | `{ text }` log tail |
| `/api/terminal/cancel/:runId` | POST | `{ ok: true }` (SIGTERM when supported) |

- **CORS:** `*` for local dev; **OPTIONS** → 204.
- **Path guard:** `resolveSafePath()` — paths under the workspace root unless `toolSecurity.filesystemAccess` is `full` in `config.json` or `TOOLS_ALLOW_ALL_PATHS=1`.
- **Errors:** Handlers return **strings**; failures use `Error: …` prefix (not thrown to the client).
- **Browser-only tools on POST:** Names not in `SERVER_TOOL_HANDLERS` (e.g. `get_datetime`, `calculate`, `web_search`) return `Not implemented: {name}`. Expected — the client runs them via [`executeBrowserTool`](../src/tools/browser-executor.ts); only mistaken direct POSTs hit the stub.
- **Timeouts:** `execute_command`, `run_javascript`, `run_python` — **30s**.
- **Terminal streaming (Step 10):** [`server/terminal-runner.js`](../server/terminal-runner.js) + [`server/terminal/middleware.js`](../server/terminal/middleware.js). Client panel: [`src/ui/terminal-panel.ts`](../src/ui/terminal-panel.ts), API [`src/api/terminal.ts`](../src/api/terminal.ts). Blocking `POST /api/tools` still uses the same runner via `executeCommandBlocking()` (no SSE).

### Terminal panel (Step 10)

Docked **bottom panel** in `.main-column` (below `.stats-strip`, after chat + composer + metrics): live command output, per-chat history, user **Run** input. Styling matches the light bench-instrument UI (`terminal.css`). Toggle: `#btnTerminal` or **Ctrl+`**.

| Concern | Location |
|---------|----------|
| UI | `src/ui/terminal-panel.ts`, `src/styles/terminal.css`, `#terminalPanel` in `index.html` |
| Stream client | `src/api/terminal.ts` — `startTerminalRun`, `streamTerminalRun` (fetch + SSE parser) |
| Tool integration | `executeTool(..., { chatId, toolCallId })` streams `execute_command` / `run_javascript` / `run_python` when server is up |
| Prefs | `config.json` → `terminal: { open, heightPx, autoOpenOnAgentRun }` via [`src/config/terminal-meta.ts`](../src/config/terminal-meta.ts) |
| Persistence | `Chat.terminalHistory` (last **50** runs) in `sessions/state.json`; full logs in `~/.minnow/logs/terminal/<runId>.log` |

**Tests:** `node test/terminal-stream.test.mjs <baseUrl>` (server must be running). Verification: [`documentation/plans/verification/step-10.md`](plans/verification/step-10.md).

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

## Built-in tools (39)

Catalog: [`BUILT_IN_TOOLS`](../src/tools/definitions.ts) — **9** `serverRequired: false` (utility/web in tab), **30** `serverRequired: true` (Node, including **7** CDP `browser_*`). Function `name` in each schema matches `executeBrowserTool` / `executeServerTool`.

### Browser CDP (7 server, Step 12)

Requires Chrome with `--remote-debugging-port` (default `9222`). Optional env: `MINNOW_BROWSER_URL`. Config: `~/.minnow/config.json` → `browser` (enabled, defaultUrl, allowlist). Handlers: [`server/cdp/`](../server/cdp/).

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

### Files (14 server)

`list_directory`, `read_file`, `read_file_range`, `save_file`, `append_file`, `insert_at_line`, `replace_text_in_file`, `search_in_file`, `make_directory`, `move_file`, `copy_file`, `delete_path`, `find_files`, `get_file_metadata`

### Git (6 server)

`git_status`, `git_diff`, `git_log`, `git_add`, `git_commit`, `git_checkout`

### Code (3 server)

`execute_command`, `run_javascript`, `run_python`

### Tool loop and client

- **`detectLocalServer()`** — `GET /api/tools/ping`, **800 ms** timeout ([`src/tools/client.ts`](../src/tools/client.ts)).
- **`executeTool(name, args, context?)`** — returns `{ content, attachments? }`; browser executor, terminal stream for code tools, or `POST /api/tools`; merges saved `braveApiKey` into `web_search`.
- **`sendMessageWithTools()`** — up to **`MAX_TOOL_TURNS` = 8**; streams SSE, `mergeToolCallDelta` / `finalizeToolCalls`, runs enabled tools, appends assistant + tool messages ([`src/tools/loop.ts`](../src/tools/loop.ts)).
- **Send entry:** [`src/chat/messaging.ts`](../src/chat/messaging.ts) exports `sendMessage` as alias of `sendMessageWithTools`; `sendMessagePlain` remains for non-tool chat ([`src/api/chat.ts`](../src/api/chat.ts)).

### Browser executor summary

[`executeBrowserTool`](../src/tools/browser-executor.ts) implements all nine browser tools; returns strings, `Error: …` on failure.

## File attachments

| Concern | Detail |
|---------|--------|
| **Module** | [`src/attachments/`](../src/attachments/) — `types.ts`, `store.ts`, `reader.ts` |
| **UI** | Hidden `#fileInput` (multiple), paperclip button, `#attachPreview` chips |
| **Max size** | **10 MB** per file (`MAX_ATTACHMENT_BYTES`; aligns with `read_document`) |
| **Images** | `dataUrl` in memory; API: `image_url` parts when model type is **vlm** (`modelCache`) |
| **Text/code** | Many extensions in `reader.ts`; soft warn if **> 32 KB** (`largeTextWarning` chip) |
| **PDF** | Server `read_document` when `npm start`; else error chip |
| **Other binary** | Unsupported error chip |
| **After send** | `clearAttachments()` only when the send completes **normally** (`completedNormally` in [`sendMessageWithTools`](../src/tools/loop.ts)); abort, errors, and max-tool-turn exits **keep** preview chips so the user can retry |
| **History** | User `content` string with `[image: …]` and/or `<file name="…">` blocks |

## Service worker

[`public/sw.js`](../public/sw.js) → `dist/sw.js`. Cache **`minnow-v5`**.

| Request | Strategy |
|---------|----------|
| `localhost` / `127.0.0.1` (LM Studio) | **Not intercepted** |
| Navigation | **Network-first**, fallback cached `./index.html` |
| `index.html`, `manifest.json` | **Cache-first** |
| Hashed JS/CSS | **Network only** |

Registration in [`src/main.ts`](../src/main.ts): `navigator.serviceWorker.register('sw.js')`.

## Design context

[`PRODUCT.md`](../PRODUCT.md), [`DESIGN.md`](../DESIGN.md), [`.impeccable/design.json`](../.impeccable/design.json).

**Theme:** OKLCH light surfaces, ink `--accent`, soft green user bubbles, JetBrains Mono for code/metrics ([`fonts.css`](../src/styles/fonts.css)). Tool bubbles: `.tool-call-*` in [`messages.css`](../src/styles/messages.css); settings tools UI in [`settings.css`](../src/styles/settings.css).

## API usage (providers)

- **Models:** `fetchModels()` → active provider (or per-chat `chat.providerId`) → `fetchModelsForProvider()` — **direct** `GET {baseUrl}{modelsPath}` or **proxy** `GET /api/providers/:id/models`. Top-bar `#modelSelect` shows **human-readable labels** via [`formatModelLabel`](../src/lib/format-model-label.ts) (`buildModelOptionHtml`); `option value` and `chat.modelId` remain the canonical LM Studio `id`; each option `title` shows full id + quant + load state (option text omits `(loaded)` — load state is the **model-state dot**). After list refresh: `setReadyStatus()` + `updateModelStateDot()`. Load/unload: [`src/api/models.ts`](../src/api/models.ts) (`loadSelectedModel`, `unloadSelectedModel`) when LM Studio v0 provider is active.
- **Chat:** `postChatCompletions()` — **direct** `POST {baseUrl}{chatCompletionsPath}` or **proxy** `POST /api/providers/:id/chat/completions`. Streaming SSE; optional non-streaming fallback; when tools enabled, request includes `tools` + `tool_choice: 'auto'` from `getEnabledToolDefinitionsForMode(chat.modeId)` (user toggles + server ping + mode policy). Reasoning-capable models may emit `delta.reasoning` / `delta.reasoning_content` when the LM Studio developer option is enabled; the client surfaces those separately from assistant prose.
- **Settings UI:** `#providerSelect` switches active provider (`POST .../set-active`); `#serverUrl` shows active base URL (read-only when providers API is up).

## Message rendering

- **User:** plain `textContent` (includes literal markdown if typed).
- **Assistant:** **marked** + **DOMPurify** + **highlight.js**; streaming debounced ~100 ms.
- **Reasoning / “thinking”** (LM Studio **App Settings → Developer**: separate `reasoning_content` and/or `choices.delta.reasoning` for compatible models such as DeepSeek R1 / gpt-oss):
  - **Live stream phases** ([`stream-status.ts`](../src/ui/stream-status.ts), wired from [`messages.ts`](../src/ui/messages.ts), [`loop.ts`](../src/tools/loop.ts), [`chat.ts`](../src/api/chat.ts)): `generating` → optional `thinking` (first reasoning delta) → `generating` again after `endReasoningPhase()` until prose → `prose`. A `.stream-status` row (sibling **before** the hidden prose bubble) shows **Generating response…** or **Thinking…** with animated dots; `role="status"`, `aria-live="polite"`, `aria-busy` until prose. Hidden after [`revealAssistantProseBubble`](../src/ui/messages.ts). Respects `prefers-reduced-motion` (static dots).
  - **Live thought bubbles:** [`ThoughtBubbleController`](../src/ui/thought-bubbles.ts) shows one dashed **thought** bubble above the streaming assistant bubble; text appears with a typewriter effect; paragraph breaks (`\n\n`) start a new thought (previous bubble fades out). Boundary splits chain gap/fade work via returned promises (not `tailWork.then` on the in-flight queue — that had deadlocked after the first `\n\n`). When the model streams normal **`content`**, the live stage is torn down.
  - **After reply:** a **Thoughts** text button above that assistant bubble expands a read-only list of all segments (same controller module). Segments are stored on the assistant message as **`thinking: string[]`** on the **final** text reply of a user send (tool-loop rounds accumulate into one list).
  - **Parsing:** [`extractReasoningDelta`](../src/api/reasoning.ts) reads SSE chunks without mixing reasoning into `content` ([`extractStreamDelta`](../src/api/chat.ts) stays prose-only).
  - **Prose caret:** inline `.cursor.cursor--prose` (2px accent bar) during markdown stream; not the old solid block cursor.
- **Tool calls/results** ([`tool-messages.ts`](../src/ui/tool-messages.ts), used from history in [`messages.ts`](../src/ui/messages.ts) and intended during live tool turns in [`loop.ts`](../src/tools/loop.ts)):
  - **Collapsed (default):** tool **name** + **Success** or **Failed** (fail when result starts with `Error:` via `isToolResultFailure()`).
  - **Expanded (click):** **Arguments** and **Result** in the `<details>` body / monospace `<pre>` blocks; results capped at **2 KB** in the UI (`RESULT_DISPLAY_CAP`).
  - **Accessibility:** On completion, `.tool-call-msg` gets `role="status"` and `aria-live="polite"`; summary `aria-label` includes name + status + “show details”; success/fail glyphs expose `aria-label` (not `aria-hidden`); visible **Failed** / **Success** label text for assistive tech.
  - **History:** `renderChatFromHistory` pairs each `tool_calls` entry with its `tool` row via `tool_call_id` and paints completed bubbles (no spinner).
  - **Live:** on `finishReason === 'tool_calls'`, append `renderToolCall` before `executeTool`, then `renderToolResult` with the result string. Tool-only assistant rounds remove the hidden streaming shell when there is no prose; the next model round gets a fresh hidden shell until prose arrives.
- **Errors:** plain text, no markdown class.

## Development commands

| Command | What runs | Tools API | Typical use |
|---------|-----------|-------------|---------------|
| **`npm start`** | `node server.js` — Vite + `/api/tools` | Yes | Default dev: tools, git/file ops, PDF attachments, server tool toggles enabled after ping |
| **`npm run dev`** | `vite` only | No | UI/HMR without Node tool handlers; server tools stay disabled in Settings |
| **`npm run build`** | `tsc` + `vite build` → `dist/` | N/A (static deploy; no `server.js` in production unless you host it separately) |
| **`npm run preview`** | `vite preview` | No | Smoke-test production bundle |

### Testing

E2E checklist and manual QA steps: [`documentation/plans/tool-usage-verification.md`](plans/tool-usage-verification.md).

**Step 01 (chat UX / streaming):** [`documentation/plans/verification/step-01.md`](plans/verification/step-01.md) — `npm test`, `npm run build`, `scripts/step01-ui-smoke.mjs`.

**Step 02 (`~/.minnow`):** [`documentation/plans/verification/step-02.md`](plans/verification/step-02.md) — config API + migration tests with `MINNOW_HOME`.

**Step 03 (providers + auth):** [`documentation/plans/verification/step-03.md`](plans/verification/step-03.md) — `test/providers/*.test.js`, provider select UI.

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

[`src/main.ts`](../src/main.ts) calls `markAppReady()` as soon as the module evaluates (Vite CSS is injected), then runs `initApp()` on `DOMContentLoaded` or immediately if the document is already parsed — **not** on `window.load` (that event often fires before deferred modules run, which left the loader stuck).

Order in `initApp()`:

1. `await detectConfigServer()` → `await runMigrationIfNeeded()` if server mode.
2. `await loadToolConfigFromStorage()` — read `tools.json` (or `minnow.tools`) **before** prompt/session UI so permission state is never stale on first paint; overlapping calls share one in-flight promise and the loader always resolves (falls back to `defaultToolConfig()` on unexpected errors, so Node tests never see a rejected load).
3. `await initPromptSystem()` — built-in prompts + user registry from `/api/prompts/registry`.
4. `await initWorkAgentSystem()` — work agents from glob + `/api/work-agents` overrides.
5. `await loadSessionsFromStorage()`; `fillSystemPromptPresetSelect()` + `await loadSystemPromptSettings()`.
6. `fillToolsSection()` + `registerToolHandlers()`; `initAttachments()`; `initModeSelector()`; `initWorkAgentDevUi()`.
7. `await detectLocalServer()` → `loadToolConfigIntoDrawer()` (server-required rows depend on ping).
8. `applySidebarVisuals()` + `renderSidebar()`.
9. `await loadProviderSelect()` + `registerProviderHandlers()`.
10. `await fetchModels()` → `syncModelSelectForActiveChat()`, `renderChatFromHistory()`, `renderStatsForChat()`, `renderSidebar()` again.

## Hardening (production edge cases)

- Sidebar rows: no nested buttons; keyboard Enter/Space to switch chats.
- Overlays: Escape closes drawer / mobile sidebar (`dismissOpenLayers`).
- `parseServerBaseUrl()` before LM Studio fetch; `AbortController` on model list and chat.
- Send requires model, temperature 0–2, max tokens ≥ 1; composer disabled while streaming.
- Rename capped at 120 characters.

## Key files

| File | Role |
|------|------|
| [`server.js`](../server.js) | Vite + `/api/tools` middleware |
| [`index.html`](../index.html) | HTML shell, drawer, composer, attach UI |
| [`src/main.ts`](../src/main.ts) | Bootstrap, window handlers, SW register |
| [`src/types.ts`](../src/types.ts) | `Message`, `ToolCall`, `ApiMessage`, `ContentPart` |
| [`src/tools/definitions.ts`](../src/tools/definitions.ts) | 41-tool catalog |
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
| [`documentation/plans/tool-usage-subagent-steps.md`](plans/tool-usage-subagent-steps.md) | Sub-agent implementation plan |
