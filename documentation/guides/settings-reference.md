# Settings reference

Complete inventory of Minnow settings: where they appear in the UI, what they control, and where they are persisted.

For storage layout and `config.json` overview, see [configuration.md](configuration.md). For the Settings page IA and search catalog, see [`src/ui/settings-catalog.ts`](../../src/ui/settings-catalog.ts) and [settings-page-rebuild-min-130.md](../plans/settings-page-rebuild-min-130.md).

**Last updated:** 2026-07-03

---

## Summary counts

| Item | Count |
|------|------:|
| Settings sidebar categories | 6 |
| Settings sections (areas) | 27 |
| Cataloged searchable fields | ~100 |
| Built-in tools (per-tool permissions) | 89 |
| Composer modes | 6 |
| Built-in experts | 6 |
| Built-in work agents | 7 |
| Built-in sub-agent types | 8 |
| Theme families | 4 |

---

## Settings app structure

Open via **Settings** (`#/settings/<category>`) or legacy `#/settings/<area>`.

| Category | Sections |
|----------|----------|
| **General** | General, Audio |
| **Appearance** | Appearance |
| **Models** | Providers, Routing, Sampler, Thinking, Usage & cost |
| **Agents** | Prompts, Rules, Modes, Experts, Work agents, Agent packs, Sub-agents, Autopilot |
| **Integrations** | Search, Deep Research, Servers, Tools, Skills, MCP, LSP, Editor, Webhooks, OAuth |
| **Advanced** | Orchestration, Evals |

**Integrations hubs** (4 sub-tabs): Web & research · Tools & skills · Dev stack · External.

**Voice** settings moved to **Models app → Voice** (`#/app/models/voice`). Device routing remains under **Settings → Audio**.

---

## 1. General

### General → General

| Setting | Persistence | Notes |
|---------|-------------|-------|
| Enable notifications | `localStorage` (`notification prefs`) | Master bell toggle |
| Silence notifications (dropdown) | `minnow.notifications.muted` | Quick mute from menubar bell popover; blocks new alerts until cleared |
| Chat notifications | notification prefs | Background chat finish/error |
| Task & sub-agent notifications | notification prefs | Orchestrate board + sub-agent events |
| Background job notifications | notification prefs | Scheduler, research, memory/skill proposals |
| Play notification sound | notification prefs | When Minnow is unfocused (Electron: includes alt-tab / minimized) |
| Notification sound | notification prefs | `none`, `chime`, `ping`, `soft`, `pop` |
| Network access | `config.server.networkAccess` | `local` (loopback) vs `lan` (Wi‑Fi). Override: `MINNOW_NETWORK` |
| Terminal behavior | — | Info only: commands run in background |
| Constrained tool calls | `config.toolCalls.useConstrainedDecoding` | JSON Schema on tool turns |
| Connection summary | — | Read-only provider/storage summary |

### General → Audio

| Setting | Persistence |
|---------|-------------|
| Input device | `config.voice.audio.inputDeviceId` |
| Output device | `config.voice.audio.outputDeviceId` |
| Echo cancellation | `config.voice.audio.echoCancellation` |
| Noise suppression | `config.voice.audio.noiseSuppression` |
| Auto gain control | `config.voice.audio.autoGainControl` |

---

## 2. Appearance

Stored primarily in browser `localStorage` (custom token overrides may sync via appearance modules).

| Setting | Options / notes |
|---------|-----------------|
| Theme family | `sage`, `amber`, `cyan`, `coral` |
| Theme mode | `dark`, `light` per family |
| Follow system | Match OS dark/light |
| Desktop wallpaper | MinnowOS wallpaper image |
| Fonts | UI font + mono font stacks |
| Custom colors | Per-token `--mn-*` overrides |

---

## 3. Models

### Providers (`~/.minnow/providers/<id>/`)

| Field | Notes |
|-------|-------|
| ID | Slug (e.g. `lm-studio-local`) |
| Label | Display name |
| Base URL | OpenAI-compatible endpoint |
| API kind | API flavor |
| Auth style | Key placement |
| Models path | e.g. `/v1/models` |
| Chat completions path | e.g. `/v1/chat/completions` |
| API key | Encrypted in `secrets.json` |
| Enabled | On/off |
| Capability probes | Tool calling, constrained decoding (cached) |
| Pricing (optional) | `inputPer1M` / `outputPer1M` for Usage stats |

Also: `config.activeProviderId`.

### Routing

Per routing row: **provider**, **model**, **sampler override**, **thinking mode**, **fallback chain**.

| Row | Persisted in |
|-----|--------------|
| Main chat | Session + global sampler |
| Work agents (see below) | `work-agents.json` |
| Sub-agent types (see below) | `sub-agents.json` |
| UI Designer (skill/runtime) | `config.uiDesigner` |
| Chat title jobs | `config.titles` |
| Goal evaluator | `config.goalEval` |
| Reef widget LLM | Per active chat session |

**Global fallback** (`config.fallbackChains`):

| Field | Default |
|-------|---------|
| `enabled` | `false` |
| `cooldownSeconds` | `60` |
| `maxChainLength` | `4` |
| Per-role chains | `_global`, `default`, `utility`, `research`, `vision` |

### Sampler (`config.sampler`)

Temperature · Top P · Top K · Min P · Repeat penalty · Presence penalty · Max tokens

### Thinking (`config.thinking`)

| Field | Options |
|-------|---------|
| Global default | `on` / `off` |

Per-role overrides in Routing.

### Usage & cost

Read-only token/inference usage (`#/settings/usage`). Distinct from prompt token **estimate** in the settings header.

### Models app → Voice (`config.voice`)

**STT:** backend (`local` / `provider`), streaming dictation, model, language, task, device, compute type, chunk/batch/beam settings, provider API fields, limits (`maxAudioBytes`, `maxDurationSeconds`, `silenceTimeoutSeconds`).

**TTS:** local Qwen or provider API; model, device, dtype, voice clone prompts, speed, format.

See [`src/config/voice-meta.ts`](../../src/config/voice-meta.ts) and [`src/voice/settings-form.ts`](../../src/voice/settings-form.ts).

---

## 4. Agents

### Prompts

| Setting | Persistence |
|---------|-------------|
| Prompt profile | `activePromptProfile` (`full` / `lite` / `custom`) |
| Info preset | `activeInfoPresetId` |
| Setup profiles | `profiles/` bundles |
| Custom prompt configs | Per-part editors (base, mode, expert, info, tool-usage, work-agent, memory, skills) |
| Prompt hub | Browse/edit all prompt files |

### Rules (`rules.json`)

| Setting | Description |
|---------|-------------|
| Enable user rules | |
| Rules text | Global standing instructions |

### Modes (6)

`general` · `build` · `plan` · `orchestrate` · `reef` · `debug`

| Per-mode | Notes |
|----------|-------|
| Tool policy | Default allow/deny (prompts in Prompts hub) |
| Plan granularity | `large` / `medium` / `small` — `config.planning.granularity` |
| Reef widget LLM | Provider/model for active chat |

### Experts (6 built-in)

`general` · `software-engineer` · `data-analyst` · `creative-writer` · `security-reviewer` · `technical-writer`

Roster in Settings; prompts in `~/.minnow/prompts/experts/`. User-created experts supported.

### Work agents (7 built-in)

`default` · `builder` · `planner` · `reviewer` · `researcher` · `ui-designer` · `tester`

Per agent: **enabled**, **max input tokens**, **context policy** (`slide` / `truncate` / `summarize` / `archive`), **archive config**. Models in Routing; prompts in Prompts.

### Agent packs

Enable/disable bundled agent definition packs.

### Sub-agents

**Global** (`sub-agents.json`):

| Setting | Description |
|---------|-------------|
| Enabled | Master toggle |
| Max concurrent | Global cap |
| Default timeout | ms |
| Check-in nudge | ms (0 = off) |
| Max tool turns | Per sub-agent run |

**Types (8):** `generalPurpose`, `explore`, `researcher`, `shell`, `explorer`, `debugger`, `bug-planner`, `reef-widget`

Per type: enabled, max concurrent, timeout, max input tokens, context policy, summary schema, allowed/denied tools, sampler, thinking, provider/model.

### Autopilot (`config.autopilot`)

| Group | Settings |
|-------|----------|
| Board defaults | Execution mode (`manual`/`sequential`/`auto`/`afk`), isolation (`auto`/`off`/`per-task`/`per-wave`), max concurrent tasks |
| Test & build retries | Per-task test/build attempts, final test attempts, continue smart-route (`off`/`conservative`/`aggressive`) |
| Heartbeat & stall | Heartbeat interval, progress stall, heartbeat dead (ms) |
| Planner model fallback | Provider + model |
| Self-heal & provisioning | Max self-heal rounds, infra provision timeout, auto-provision infra, auto-restart stalled tasks, guard `cd` outside worktree |

---

## 5. Integrations

### Search (`search.json`)

| Setting | Description |
|---------|-------------|
| Provider | `searxng`, `tavily`, `brave`, `duckduckgo`, `disabled` |
| SearXNG base URL | Or managed instance from Servers |
| Brave / Tavily API keys | |
| Fallback chain | Ordered providers when primary fails |
| Result count | |

### Deep Research (`research.json`)

| Group | Settings |
|-------|----------|
| Research model | Provider + model |
| Search override | Optional provider for research runs |
| Research loop | Max/min rounds, max time/loop, run timeout, max empty rounds |
| Extraction & synthesis | Extraction timeout, concurrency, max URLs/round, max content chars, synthesis window |
| Final report | Max report tokens |

### Servers

Managed **SearXNG** install/start/stop (`~/.minnow/servers/`).

### Tools (`tools.json` + `config.json`)

**Global:**

| Setting | Key |
|---------|-----|
| Constrained tool calls | `toolCalls.useConstrainedDecoding` |
| Main agent max tool turns | `chat.maxToolTurns` |
| Sub-agent max tool turns | `sub-agents.json` → `maxToolTurns` |
| Idle timeout (minutes) | `chat.generationIdleTimeoutMs` |
| Max duration (minutes) | `chat.generationMaxDurationMs` |
| Tool result cache | Session-scoped |
| Filesystem access | `toolSecurity.filesystemAccess`: `workspace` / `full` |

**Browser automation** (`config.browser`): enabled, allow navigate, allowed origin patterns.

**Per-tool permissions:** each of **89 built-in tools** is `off` / `ask` / `full`, plus any `mcp__…` tools from MCP servers.

#### Built-in tools (89)

| Category | Tools |
|----------|-------|
| **Web** | Web search, Wikipedia, Fetch page, Web RAG |
| **Utility** | Date & time, Calculate, Read/write clipboard, System info, Ask question, Set chat mode, Create chat with mode, Launch Minnow app, Propose mode switch, Check reef widget, Save memory, Recall chat context, Recall turn full |
| **Files** | List directory, Read file, Read file lines, Save file, Append file, Insert at line, Replace in file, Search in file, Grep, Make directory, Move/rename, Copy file, Delete path, Find files, File metadata |
| **Git** | Status, Diff, Log, Add, Commit, Checkout |
| **Code** | Run command, Read command log, List/stop running commands, Start/stop background command, Run JavaScript, Run Python, Repo map, Find symbol, Who calls, Read symbol, Explain symbol |
| **Agents** | Spawn/cancel/list/get sub-agent status, Board init/update/set autonomy/get state/report, Delegate tasks, Bug add/update/get state |
| **Browser** | List tabs, Navigate, Request origin access, Snapshot, Click, Fill, Eval, Screenshot |
| **Brain** | Search, Read page, List pages, Write page, Append log, Ingest source |
| **LSP** | Get diagnostics, List LSP servers |
| **Skills** | Load Impeccable context, Run Impeccable |
| **Calendar/Email** | Manage calendar, List mail, Draft reply, Summarize inbox, Generate reply variants, Email action |

### Skills (`skills.json`)

Per skill: enabled/disabled. Custom SKILL.md authoring. **Caveman** skill has intensity setting.

### MCP servers (`~/.minnow/mcp/`)

Per server: id, label, description, command, args, env, enabled. Built-in Context7 server. **Context7 API key** — Settings → MCP password field; encrypted in `~/.minnow/mcp/secrets.json` (or `CONTEXT7_API_KEY` env var).

### Language servers (`lsp.json`)

Per bundled LSP: install/uninstall, enable/disable. See Settings → Language bundles.

### Editor

**Ghost text** (`config.editorAiCompletion`): enable, model source (chat vs pinned), debounce, prefix/suffix limits, temperature, max tokens, import context, LSP hover, native FIM, completion cache.

**Code editing** (`config.editorSettings`): word wrap, show whitespace, font size, tab size.

**Intent mode** (`config.editorIntentMode`, limited UI): enabled by default, auto-recheck, debounce, context window, recheck delay, max recheck passes.

### Webhooks (`webhooks.json`)

| Setting | Description |
|---------|-------------|
| Allow local HTTP | `webhooks.allowLocalHttp` (dev) |
| Per subscription | Label, URL, events, enabled, HMAC secret |
| Events | `chat.completed`, `session.created`, `scheduler.job_completed` |

### OAuth (`config.oauth` + `oauth/`)

Google and Microsoft: client ID, client secret (Microsoft: tenant ID). Tokens encrypted under `~/.minnow/oauth/`.

---

## 6. Advanced

### Orchestration (`config.supervisor`)

> **Gap:** Settings → Orchestration section exists in `index.html` (`#settingsSupervisorBody`) but **no full UI renderer is wired yet**. Edit `config.json` directly or use defaults from [`server/config/validators.js`](../../server/config/validators.js).

| Setting | Default |
|---------|---------|
| `enabled` | `true` |
| `autoResume` | `true` |
| `repetitionDetection` | `true` |
| `llmEscalation` | `true` |
| `askUserOnBudgetExhausted` | `true` |
| `stallMs` | `30000` |
| `maxRetriesPerTask` | `3` |
| `orchestratorHeartbeatMs` | `90000` |
| `inProgressNoRunMs` | `45000` |
| `spawnStuckMs` | `30000` |
| `parentSilenceAfterToolMs` | `20000` |
| `subAgentToolSilenceMs` | `60000` |
| `runRestartCap` | `2` |
| `spawnCapPerTask` | `3` |
| `llmEscalationsPerSession` | `10` |
| `llmEscalationTimeoutMs` | `8000` |
| `tickIntervalMs` | `5000` |
| `escalationProviderId` / `escalationModelId` | |
| `repetition.duplicateToolCallThreshold` | `3` |
| `repetition.sameErrorThreshold` | `3` |
| `repetition.maxRestartsPerRun` | `2` |

Legacy `selfHealing` tier1/tier2 in config (superseded by supervisor + autopilot).

### Evals (`~/.minnow/evals/`)

Task packs, suite composer, results leaderboard. Link to Bench app tests from Settings.

---

## Settings outside the Settings app

| Location | Settings |
|----------|----------|
| **Chat top bar** | Provider, model, mode, expert, thinking (per chat), work agent |
| **Chat gear drawer** | Temperature, max tokens (per session) |
| **Brain app → Settings** | Brain synthesis, embeddings, code index (`config.brain.*`) |
| **Calendar app → Settings** | View mode, week start, timezone, calendar CRUD, reset |
| **Email app** | Account management |
| **Scheduler app** | Per-job: schedule, prompt, model, enabled |
| **Research app (run panel)** | Per-run: rounds, category, search provider, model |
| **Reef widgets** | Per-widget settings |
| **Welcome screen** | Workspace path, recent workspaces |

---

## Session & layout persistence (`config.json`)

Not all exposed in Settings UI:

| Block | Key settings |
|-------|--------------|
| `workspace` | Path, recent paths, dev server settings per path |
| `filePanel` | Sidebar, viewer, split ratio, tabs, preview |
| `terminal` | Open, height, auto-open on agent run |
| `titles` | Chat title generation model/settings |
| `goalEval` | /goal loop evaluator model/settings |
| `activePromptProfile`, `activePromptConfigId`, `activeSetupProfileId` | Prompt state |
| `workspaceProfiles`, `workspaceProfileAutoApply` | Per-workspace setup profiles |

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `MINNOW_HOME` | Override `~/.minnow` |
| `PORT` | Dev server port |
| `MINNOW_NETWORK` | `local` / `lan` (overrides Settings network access) |
| `MINNOW_BROWSER` | Open system browser instead of Electron |
| `MINNOW_HEADLESS` / `BROWSER=none` | Don't auto-open window |
| `TOOLS_ALLOW_ALL_PATHS` | Bypass workspace path restriction |
| `MINNOW_OAUTH_REDIRECT_BASE` | OAuth redirect override |
| `MINNOW_DEBUG` | Verbose server logging |
| `MINNOW_I_UNDERSTAND_UNSAFE_AUTOMATION` | UI tools in headless CLI |
| `MINNOW_PLUGIN_UNSAFE` | Unsigned tool plugins |
| `MINNOW_TTS_USE_COMPILE` | Compiled TTS path |
| `MINNOW_ELECTRON` | Internal Electron flag |
| `MINNOW_TEST` | Test mode |

Full table: [commands.md](commands.md#environment-variables).

---

## Vite-only `localStorage` fallbacks (`npm run dev`)

| Key | Content |
|-----|---------|
| `minnow.tools` | Tool toggles + web search keys |
| `minnow-sessions-v1` | Legacy sessions |
| `minnow.userRules` | Rules mirror |
| `minnow.theme`, `minnow.theme.followSystem`, `minnow.theme.family` | Theme |

Most features require `npm start` for full persistence.

---

## Persistence file map

| File | What it holds |
|------|---------------|
| `config.json` | Global settings (sampler, voice, autopilot, supervisor, memory, synthesis, editor, browser, …) |
| `tools.json` | Per-tool enable + permissions |
| `search.json` | Web search |
| `research.json` | Deep Research |
| `sub-agents.json` | Sub-agent types + globals |
| `work-agents.json` | Work agent overrides |
| `rules.json` | User rules |
| `skills.json` | Skill enable flags |
| `providers/<id>/` | LLM provider profiles + secrets |
| `mcp/` | MCP server configs |
| `lsp.json` | Language servers |
| `webhooks.json` | Webhook subscriptions |
| `oauth/` | Encrypted OAuth tokens |
| `memory/` | Memory entries + vectors |
| `sessions/state.json` | Chats, per-chat model/mode/thinking |
| `profiles/` | Setup profile bundles |
| `prompts/` | Prompt overrides |
| `evals/` | Eval packs + runs |
| `calendar/`, `email/`, `scheduler.json` | App-specific data |

---

## Source of truth in code

| Concern | File |
|---------|------|
| Searchable field catalog | [`src/ui/settings-catalog.ts`](../../src/ui/settings-catalog.ts) |
| Section IDs & nav | [`src/ui/settings-page-types.ts`](../../src/ui/settings-page-types.ts) |
| Section renderers | [`src/ui/settings-sections.ts`](../../src/ui/settings-sections.ts) |
| Config normalization | [`server/config/validators.js`](../../server/config/validators.js) |
| Default meta scaffold | [`server/config/home.js`](../../server/config/home.js) |
| Tool definitions | [`src/tools/definitions.ts`](../../src/tools/definitions.ts) |

---

## Agent settings tools

Desktop and General modes include the **`settings`** tool group (`search_settings`, `get_settings`, `update_settings`).

| Tool | Permission | Notes |
|------|------------|-------|
| `search_settings` | `full` | Returns catalog metadata (key, label, type, sensitivity) — never values |
| `get_settings` | `full` | Server-backed fields from `~/.minnow`; secrets → `[redacted]`; browser fields enriched client-side |
| `update_settings` | `ask` | Approval strip shows human diff; secret/dangerous fields require `confirmed: true` after approval |

**Registry:** [`src/settings/field-registry.ts`](../../src/settings/field-registry.ts) maps catalog keys → `config.json`, `tools.json`, `search.json`, etc. Generated server mirror: `server/settings/registry-manifest.json` (`npm run settings-registry:generate` / `prebuild`).

**HTTP API:** `GET /api/settings/catalog`, `POST /api/settings/read`, `POST /api/settings/update` ([`server/settings/middleware.js`](../../server/settings/middleware.js)).

**Client sync:** [`src/settings/client-sync.ts`](../../src/settings/client-sync.ts) applies `clientPatches` (notifications, theme), refreshes settings sections, dispatches `minnow:settings-changed`.

**Prompt:** [`src/chat/prompts/tool-usage/manage-settings.md`](../../src/chat/prompts/tool-usage/manage-settings.md) (gated when `update_settings` is enabled in General/Desktop).

Plan: [`documentation/plans/settings-agent-tools.md`](../plans/settings-agent-tools.md).
