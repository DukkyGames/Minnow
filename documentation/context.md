# Minnow — project context

Authoritative technical reference for the codebase. For orientation, start with [`guides/architecture.md`](guides/architecture.md). For setup and commands, see [`guides/setup.md`](guides/setup.md) and [`guides/commands.md`](guides/commands.md). UI key bindings: [`guides/keyboard-shortcuts.md`](guides/keyboard-shortcuts.md). Product overview: [`README.md`](../README.md).

**Also useful:** [`guides/configuration.md`](guides/configuration.md) (storage layout), [`DESIGN.md`](../DESIGN.md) (visual tokens), [`AGENTS.md`](../AGENTS.md) (agent quick reference), [`plans/`](plans/) (in-flight feature plans).

---

## What it is

Minnow is a **local-first AI workspace**: a **Vite + TypeScript SPA**, a **Node tool server** (`server.js`), and an **Electron desktop shell** (Minnow Shell). It targets **LM Studio** and other **OpenAI-compatible** providers.

| Layer | Role |
|-------|------|
| **Electron** (`electron/`) | Desktop window, frameless chrome, `WebContentsView` in-app browser (`browser_*`), packaged in-process server |
| **SPA** (`src/`, `index.html`) | Minnow Shell, Code workspace, chat, modes, tools loop |
| **Tool server** (`server.js`, `server/`) | Vite dev host, `/api/*`, file/git/shell tools, generations SSE, persistence under `~/.minnow` |

- **`npm start`** — Vite + tool server (default port **9473**) + Electron.
- **`npm run dev`** — Vite only; most server features unavailable.
- **`npm run electron:dev`** — Vite + Electron with HMR.

### Operating modes

Four composer modes: **General**, **Build**, **Plan**, **Debug**. **Orchestrate** opens from the sidebar hub. **Super Plan** is a Plan sub-mode. **Desktop**, **Email**, and **Onboarding** are surface-bound (not in the Code composer strip). Nine total in the registry; **Reef** mode was removed in MIN-473.

Registry: [`src/chat/modes/registry.ts`](../src/chat/modes/registry.ts). Tool allowlists: [`src/chat/modes/tool-groups.ts`](../src/chat/modes/tool-groups.ts). Prompts: [`src/chat/prompts/modes/`](../src/chat/prompts/modes/).

**Plan mode** blocks mutating file/git writes except `save_file` / `make_directory` under `documentation/plans/` (client + server guards).

**Super Plan** (`super-plan` mode) runs a sequential pipeline (grill → spec → research → draft/review → present) via [`src/chat/super-plan/controller.ts`](../src/chat/super-plan/controller.ts). The controller owns chat turns for each stage; composer follow-up queue drains are deferred while the pipeline is active so a queued message cannot race the post-interview `spec_confirm` turn. If the loop backs off while a stage is still pending, it schedules a deferred `advanceSuperPlan` retry (stream-end recovery also retries when the hook fires during an in-flight loop). During the **research** stage, [`PlanProgressPanel`](../src/ui/plan-progress-screen.ts) embeds [`ResearchProgressPanel`](../src/research/progress-panel.ts) with `embedded: true` (compact “Deep research” chrome, no nested card, workspace styles in [`plan-progress.css`](../src/styles/plan-progress.css)).

### Minnow apps

Released (all `core`): Chat (desktop), **Code**, **Research**, **Models**, **Brain**, **Issues**, **Scheduler**, **Settings**. Hidden (`releaseState: 'hidden'`, MIN-471): **Compare**, **Bench**, **Experts**, **Calendar**, **Email** — code and tests stay in tree, but they are omitted from every product surface. Routes `#/desktop`, `#/app/{id}`, registry in [`src/os/app-registry.ts`](../src/os/app-registry.ts).

**Issues** (`#/app/issues`, core) is the Linear-style tracker (list + board + detail). UI: split header (brand + quick capture) and filter bar; clickable list column headers to sort (ID / Type / Title / Status / Priority / Labels / Updated — session-only, smart first-click direction; helpers in [`issues-list-sort.ts`](../src/ui/issues-list-sort.ts)); type/status/priority chips; multiselect via row highlight (Ctrl/Cmd+click, Shift+range) with bulk delete; right-click context menu on list rows and board cards (Open, copy ID, select, expand with agent, send to chat / send to background with mode submenus, change status, delete — [`issues-context-menu.ts`](../src/ui/issues-context-menu.ts)); inline label editing on list rows and in the detail sticky header (add via Enter/comma, remove via chip ×, autocomplete from workspace labels — [`issues-labels-field.ts`](../src/ui/issues-labels-field.ts)); detail panel with sticky workflow header (activity chips like **Investigating…** / **Planning…** open the linked sub-agent drawer or board chat), Delete action, click-to-edit description (markdown preview → textarea; blur or Ctrl/Cmd+Enter saves, Escape cancels), and scrollable body. Board view keeps all status lanes on one horizontal row (scroll when narrow). Legacy `#/bugs` hashes redirect via [`resolveLegacyHash`](../src/os/router.ts) — the old All-bugs overlay UI/store/pipeline was removed in MIN-261 Phase 5.

**Code sidebar vs desktop:** the Code chat sidebar Issues button (`btnAllBugs`) embeds `#issuesView` into `#chatArea` inside the Code window (toggle / Back / Escape; same main-column overlay family as Code overview / Code map — see [`issues-page.ts`](../src/ui/issues-page.ts)). While embedded, issue detail opens in-place and does not rewrite the hash to `#/app/issues/ISS-n` (that would foreground the fullscreen Issues app). Dock, menubar app switcher, and `#/app/issues` still launch the fullscreen Issues app.

| Concern | Location |
|---------|----------|
| Persist | `~/.minnow/issues/state.json` ([`src/state/issues-store.ts`](../src/state/issues-store.ts)); Vite-only key `minnow-issues-v1` |
| Taxonomy | `~/.minnow/issues/taxonomy.json` ([`src/issues/taxonomy.ts`](../src/issues/taxonomy.ts), [`issues-taxonomy-store.ts`](../src/state/issues-taxonomy-store.ts)); Vite-only key `minnow-issues-taxonomy-v1`. **Settings → Apps → Issues** edits types, statuses (with workflow roles + board/closed flags), and priorities. Deletes blocked when issues still reference an id. |
| Migration | First load with no issues file reads leftover `bugs/state.json` / `minnow-bugs-v1` (leaves bugs file on disk). `migrateLegacyBugBoardsFromChats` folds any remaining `chat.bugBoard` cards, then strips them. |
| UI | [`src/ui/issues-page.ts`](../src/ui/issues-page.ts), detail [`issues-detail.ts`](../src/ui/issues-detail.ts), styles [`issues.css`](../src/styles/issues.css); deep link `#/app/issues/ISS-n` |
| Tools | `issue_add` / `issue_update` / `issue_link` / `issue_get_state` / `issue_delete` ([`issue-tools.ts`](../src/tools/issue-tools.ts)). Allowed in **General**, **Build**, **Plan**, **Debug**, and **Desktop** ([`tool-groups.ts`](../src/chat/modes/tool-groups.ts) `issues` group). Retired `bug_*` tool names still execute via [`bug-board-tools.ts`](../src/tools/bug-board-tools.ts) for older transcripts but are no longer exposed to models. |
| Workflows | **Send to chat** / **Send to background** mode dropdowns (General, Build, Plan, Debug foreground; Debug + Plan background sub-agents) in the detail workflow toolbar; **Send to board** in the Plan section when `planPath` is set ([`src/chat/issues/pipeline.ts`](../src/chat/issues/pipeline.ts), [`workflow-seeds.ts`](../src/chat/issues/workflow-seeds.ts), [`issues-workflow-menu.ts`](../src/ui/issues-workflow-menu.ts)); triage **Expand with agent** (detail panel + board cards) → shipped `issue-writer`; detail **Open plan** foregrounds Code then opens the plan in the file viewer (`openIssuePlanInEditor`) |
| Git | Branch `issue/iss-n-<slug>`, commit grep `[ISS-n]`, PR via `gh`, GitHub URL chips ([`git-helpers.ts`](../src/chat/issues/git-helpers.ts), [`git-actions.ts`](../src/chat/issues/git-actions.ts)) |
| Plans | `documentation/plans/issues/<id>.md`; board completion → status `review` ([`board-review.ts`](../src/chat/issues/board-review.ts)) |

Renderer crash diagnostics can file Issues cards (type `bug`) when **Settings → Advanced → Health & diagnostics → File renderer errors to Issues** is enabled (`localStorage` `minnow.diagnostics.fileErrorsToIssues`; default **off**). Errors still log locally and appear in the diagnostics viewer regardless.

**Availability:** each app is `core` (always on: Chat, Code, Research, Models, Brain, Scheduler, Issues, Settings) or `optional`, plus a developer `releaseState` (`released` | `hidden`). User preferences store disabled optional ids in `localStorage` key `minnow.os.disabledApps` ([`src/os/app-preferences.ts`](../src/os/app-preferences.ts)). Missing key = all released optional apps enabled. Dock, menubar shortcuts, hash routes, notifications, and `launch_minnow_app` all consult the same selectors. First-run **Choose your apps** (after Appearance) and **Settings → Apps** share [`src/os/app-picker-ui.ts`](../src/os/app-picker-ui.ts): core apps collapse to a read-only “Always included” line; optional apps use quiet toggle cards (dimmed when off, no accent wash when on) with Enable all / Disable all. When no optional apps are released yet, both surfaces show a **Coming soon** empty state instead of an empty card grid. Onboarding **Email** and **Calendar** setup steps are applicable only when the matching app is enabled (`isAppEnabled`) and the tool server is up — disabling those apps in Choose your apps (or Settings) skips their wizard steps.

### Scale

- **111 built-in tools** (103 exposed in a default build; 8 are gated to the hidden Calendar/Email apps) — [`src/tools/definitions.ts`](../src/tools/definitions.ts)
- **15 bundled slash skills** — [`src/skills/`](../src/skills/), manifest via `npm run prebuild`; everything else installs from **Skills Library**
- **8 released apps**, all core — no optional-app picker in this build
- **Nine modes** + work agents, sub-agents, orchestrator boards, Brain wiki

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
│   ├── os/                 # Minnow Shell, router, windows, dock
│   ├── chat/               # Modes, prompts, orchestrate, goal/loop, titles
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

**Canonical session store (HTTP):** `sessions/sessions.db` (SQLite) — GET/PUT still exchange the whole SessionState blob; the SPA flushes with **PATCH** when dirty sets are available (B.2). Chat/group/scalar normalization is shared in [`src/state/session-schema.mjs`](../src/state/session-schema.mjs) (`normalizeChatRow` / `normalizeGroupRow` / `normalizeSessionScalars`) — imported by server validators and client `ensureChatShape` (thin wrapper; no client twin). There is no `MAX_CHATS` hard-trim on save. Kitchen-sink contract: [`test/fixtures/migration/kitchen-sink-sessions-state.json`](../test/fixtures/migration/kitchen-sink-sessions-state.json).

**Sessions SQLite (Phase A → C.2):** On first open, legacy `sessions/state.json` is imported once and renamed to `state.json.migrated`. Whole-blob R/W lives in [`server/config/sessions-repo.js`](../server/config/sessions-repo.js) (the persistence seam; optimistic `rev`/`If-Match` is deferred to the SQLite rebuild — see [`plans/sessions-sqlite-migration.md`](plans/sessions-sqlite-migration.md)). `terminalHistory` is server-owned on PUT/PATCH (only `appendTerminalRun` writes it). **PATCH `/api/config/sessions`** accepts `{ baseVersion, chats?, deleteChatIds?, groups?, deleteGroupIds?, scalars? }` — absent keys mean unchanged; deletes are explicit id lists; dirty chats/groups are full objects. Implemented via `patchResource` → `patchSessionState`. **POST** on the same path is a `sendBeacon` alias for PATCH (beacons cannot PATCH). Headless [`src/headless/persist-chat.ts`](../src/headless/persist-chat.ts) uses PATCH (no GET-splice-PUT). **B.2 SPA flush:** `saveSessionsNow` uses PATCH when `sessionsClientPatchEnabled` (default **ON**) and dirty sets are trusted; full PUT on the first save after load or after a dirty-tracking verifier miss. Flushes are **serialized** (one in-flight network write); mid-flight dirty work sets a follow-up queue. Dirty sets clear only when a successful PATCH/PUT finishes with an unchanged `sessionDirtyEpoch` — so a slow baseline PUT cannot clear a delete that landed during the request and resurrect the chat. `removeChatById` flushes immediately (no debounce). **Electron confirm:** `installAppDialogs` makes sync `window.confirm()` always return `false` (native dialogs break Electron input). Chat/group delete and Brain memory delete use `await appConfirm()` from [`src/ui/app-dialog.ts`](../src/ui/app-dialog.ts). **Chat/group delete (MIN-509):** `removeChatById` in [`src/state/sessions.ts`](../src/state/sessions.ts) records `deletedChatIds`, purges stale `lastActiveChatIdByWorkspace` / `lastActiveChatIdByApp` entries, and when the active chat is removed picks the next listed chat in the same workspace — **Unassigned** rows (`workspacePath === ''`) use `getUnassignedChats`, not `getSidebarListedChatsForWorkspace` (empty key returns none). Sidebar context-menu deletes call `refreshSessionListUIs` in [`src/ui/sidebar.ts`](../src/ui/sidebar.ts) so Code sidebar, desktop rail, and Chat app rail all repaint. Shutdown: serialize the delta; if &lt; 60 KiB use `navigator.sendBeacon` (POST alias); else keepalive whole-blob PUT (Fetch keepalive bodies are capped at 64 KiB — large keepalive PUTs were likely silent no-ops). MIN-408: no PATCH/PUT before `sessionsHydratedFromServer`. Dev builds compare chats against a shadow copy at flush and `console.warn` unmarked mutations (forces PUT fallback). A rotating `state.json.backup` mirror flushes on a 5-minute dirty debounce and on `closeSessionsDb()`. Rollback: `MINNOW_SESSIONS_STORE=json`. Export: `POST /api/config/sessions/export-json`. Hot server consumers use indexed SQLite point lookups — see [`plans/sessions-sqlite-migration.md`](plans/sessions-sqlite-migration.md).

**Lazy history (C.2, flag ON):** Boot uses `GET /api/config/sessions/summaries?workspace=…` — chats omit `history`, include denormalized `messageCount` / `lastMessagePreview`, plus `meta_json` cold fields and non-message children (`runs`, `subAgentRuns`, `activeLoops`, `terminalHistory`). Client flag `sessionsLazyHistoryEnabled` defaults **ON**; `ensureChatHistoryLoaded` (idempotent, in-flight dedupe) hydrates full `GET /api/config/sessions/history/:chatId` on switch / activate / workspace change / before turn mutate. Inflated chats keep `messageCount` so `isSidebarListedChat` / desktop rail can list unloaded chats (`history: []` alone would hide them). `messageCount` is on the shared `CHAT_PASSTHROUGH_KEYS` allowlist and is re-applied after `parseSessionStateFromJson` in `sessionStateFromSummaries` — dropping it made every unloaded chat look empty (blank rails after reload) and let `pruneEphemeralEmptyChats` delete real chats before the first full PUT. Unloaded rows with **missing** `messageCount` stay listable as a fail-safe; explicit `0` still hides ephemeral empties. UI switch paths (`switchChat`, desktop/Chat-app activate, `onWorkspaceChanged`) **await** hydrate before painting — otherwise empty-state landings stick after restart. **Wire saves** (`chatForSessionsWire` / `sessionStateForSessionsWire` in [`src/state/sessions.ts`](../src/state/sessions.ts)) omit the `history` key for chats with `historyLoaded === false` so PATCH/PUT cannot wipe stored messages; server `patchSessionState` / `writeWholeSessionState` skip `syncMessages` when `history` is absent on the wire object. **Never page** history into archive or turn-run absolute-index consumers. FTS5 search: `GET /api/config/sessions/search?q=` (`messages_fts`); UI uses server FTS in server mode and the pure scorer in [`src/chat/chat-search.ts`](../src/chat/chat-search.ts) for localStorage / JSON-store fallback. DEV trap: first `history` read while unloaded `console.error`s with stack. `requireHistory(chat)` throws if unloaded. Task history trim removed — unused chats stay unloaded. OS shell chrome (`syncLoopActiveHint` via page-bridge) no-ops until `sessionState` is loaded — do not call `getActiveChat()` before `loadSessionsFromStorage`.

**Test teardown (sessions.db):** `getSessionsDb()` caches better-sqlite3 handles. Suites that open the store (e.g. `initBrainApi` → `readAllChatIds`, scheduler `resolveJobRunModel`) must call `closeSessionsDb()` from [`server/config/sessions-db.js`](../server/config/sessions-db.js) in `after` / `afterEach` **before** `fs.rm` / `rmTestHome`, or Windows teardown hits `EBUSY` on `sessions.db` (+ `-wal`/`-shm`).

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
| `issues/state.json` | Issues app store (MIN-261); migrates from leftover `bugs/state.json` once |
| `issues/taxonomy.json` | Issues types / statuses / priorities catalog (Settings → Issues); workflows resolve status **roles** at runtime |
| `bugs/state.json` | Legacy bug tracker blob — read-only migration source; left on disk after import |
| `compare/`, `benchmarks/`, `evals/` | Compare history, bench runs, eval harness |

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
3. `initOsRouter()` when Minnow enabled.

`initApp()`: tool config → prompts → work agents → sessions → Issues store (migrate leftover bugs if needed) → tool handlers → models → render chat.

Loader dismiss: [`src/boot/app-ready.ts`](../src/boot/app-ready.ts) on `DOMContentLoaded`, not `window.load`.

---

## Chat, sessions, and streaming

### Message types (`chat.history`)

| Role | Shape | Notes |
|------|--------|-------|
| `user` | `{ role, content: string }` | Attachments as `[image: …]` / `<file name="…">` in content |
| `assistant` | `{ role, content, thinking?, thinkingDurationMs?, tool_calls?, stats? }` | Markdown UI; optional `thinking[]` and wall-clock reasoning duration |
| `tool` | `{ role, tool_call_id, content }` | Paired to `tool_calls` in UI |

Wire format may use multimodal `ContentPart[]` for VLMs; built in [`src/tools/loop.ts`](../src/tools/loop.ts) (`buildApiMessages`).

### Multi-chat

- Persisted in `sessions/state.json` (schema version in [`src/types.ts`](../src/types.ts)).
- Each chat has `workspacePath`; sidebar lists current workspace (+ Unassigned legacy).
- Max **50** chats; newest `lastMessageAt` first.
- **Desktop chat** uses a configurable workspace folder (default `~/.minnow/workspace`); change it from the desktop **Files** drawer (MRU select or folder picker). Persisted in `config.json` as `desktopWorkspace.path`. The file tree reloads on switch; `list_directory` tool-cache scopes include `workspaceRoot` so listings from one desktop folder are not reused for another. Legacy Chat app uses `~/.minnow/chats`.
- **Email assistant chats** reuse the chats workspace for normal file permissions but persist with `Chat.appScope === 'email'`, `modeId === 'email'`, and `lastActiveChatIdByApp.email`, so they stay out of Code, Desktop, and Chat app rails.

### Backend-owned generations

Main chat: `POST /api/generations` + `GET .../stream` with replay. Client stores `chat.currentGenerationId`; reload re-subscribes via [`src/chat/generation-resume.ts`](../src/chat/generation-resume.ts). Stop: [`src/chat/stop-generation.ts`](../src/chat/stop-generation.ts).

SSE parsing: [`src/api/sse-parse.ts`](../src/api/sse-parse.ts) — event boundaries and glued JSON chunks; do not `Response.json()` on the generations shim.

**Live metrics (MIN-413):** [`src/chat/streaming-stats.ts`](../src/chat/streaming-stats.ts) updates `chat.lastStats` and the bottom metrics strip during SSE (throttled ~100ms). Provider `usage` from chunks is preferred when `completion_tokens` is present; otherwise completion tokens are estimated from partial assistant prose only (`chars ÷ 4`). Tool-loop rounds roll up via [`aggregateTurnUsageSegments`](../src/chat/orchestrate/stats-math.ts) — sum completions, keep the latest prompt (each API call reports full context, not a delta).

**Thinking duration (MIN-467):** [`ThinkingDurationTracker`](../src/ui/thinking-duration.ts) accumulates wall time only while reasoning SSE is active. [`streamCompletionTurn`](../src/tools/loop.ts) ends the reasoning phase when the first `tool_calls` delta arrives so the live “Thinking…” timer and persisted `thinkingDurationMs` do not include tool-call streaming or execution.

**Turn runs** (`chat.runs`): semantic branches for replay/fork ([`src/state/runs-store.ts`](../src/state/runs-store.ts)), separate from transport generations. Branch picker ([`src/ui/branch-picker.ts`](../src/ui/branch-picker.ts)) calls `activateBranch`, which snapshots the active branch’s continuation into `outputMessages` before swapping so follow-up turns survive switching between branches; it also calls `switchActiveChat` so the next composer send stays on that chat (desktop/chat-app send no longer re-resolves a different sandbox chat when history is already present). After fork/replay turns settle, `loop.ts` calls `refreshBranchPickerAtFork` so the picker appears without reloading the chat.

**Agent undo (MIN-409):** [`src/chat/undo-turn.ts`](../src/chat/undo-turn.ts) rewinds the last settled agent turn to the fork user message (no auto-regenerate). `pruneSupersededRunsAfterTruncate` keeps `outputMessages` so the undone reply stays redoable via the branch picker (including the single-branch “Restore branch” case when history ends at the user row). Orchestrate / board-linked / worktree-isolated chats block Undo in v1 (disabled control + ⋮ item with reason tooltips). UI: `#btnCodeChangeUndo` beside the Code changes strip ([`src/ui/composer-undo.ts`](../src/ui/composer-undo.ts), Uicons `undo` glyph via [`createIcon`](../src/ui/icon.ts)) — **hidden when the workspace is not a git repository** (no snapshot capture) or the undo target turn had no file mutations (`runHadCodeChanges` in [`code-change-ledger.ts`](../src/usage/code-change-ledger.ts)); message ⋮ **Undo turn** still offers chat-only rewind; shared status copy via `UNDO_STATUS`. File-restore confirms use in-app [`appConfirm`](../src/ui/app-dialog.ts) (not sync `window.confirm`). Phase 2 attaches optional git snapshot fields on `TurnRunRecord` (`preTurnSnapshotSha`, `postTurnSnapshotSha`, `headShaAtTurn`, `snapshotCwd`) — persisted through `ensureTurnRuns` — and restores the working tree on undo/redo when SHAs exist. Capture hooks live in [`src/chat/turn-snapshots.ts`](../src/chat/turn-snapshots.ts) (called from `loop.ts` around `createRun` / `finalizeRun`). Concurrent chats sharing one repo: last restore wins. Desktop / Chat-app chrome parity is deferred.

### Tool loop

[`sendMessageWithTools`](../src/tools/loop.ts) → `composeSystemPrompt()` → enabled tools for mode → stream → tool batch → repeat.

Tool approval: [`src/tools/permission-gate.ts`](../src/tools/permission-gate.ts) (`full` / `ask` / `off`). `ask_question` uses its own UI queue ([`src/tools/ask-question-queue.ts`](../src/tools/ask-question-queue.ts)).

### `/goal` and `/loop` (stateful slash commands)

Built-in non-skill slash commands live in [`src/chat/slash-commands/registry.ts`](../src/chat/slash-commands/registry.ts) (picker) and dispatch inside `sendMessageWithTools` **before** skill resolution.

| Command | Role | Persistence |
|---------|------|-------------|
| **`/goal`** | Work until a completion condition; post-turn evaluator continues the chat | `chat.activeGoal` ([`src/chat/goal/`](../src/chat/goal/)) |
| **`/loop`** | Re-run a prompt on a fixed interval or self-paced delay while the app is open and the chat is idle | `chat.activeLoops[]` ([`src/chat/loop/`](../src/chat/loop/)) |

**`/loop` modes:** `/loop 5m <prompt>` (interval; units `s`/`m`/`h`/`d`, sub-minute rounds up to 1m); `/loop <prompt>` (auto delay 1–60m from output change); bare `/loop` (maintenance: `<workspace>/.minnow/loop.md` or built-in checklist). Loops expire after 7 days. A global ticker in [`src/chat/loop/ticker.ts`](../src/chat/loop/ticker.ts) (started from [`src/main.ts`](../src/main.ts)) wakes at each loop's persisted `dueAt` (with a 15s safety poll) so reload/sleep survive and countdown matches fire time. Fires go through [`sendProgrammaticChatText`](../src/tools/loop.ts) so looped text gets full slash/skill resolution. `/goal` and `/loop` are mutually exclusive on a chat. `/clear` clears both. `activeLoops` persist in session storage (shared `normalizeChatRow` via client `ensureChatShape` + server `validateSessionState`). Chat panel: [`src/ui/loop-status.ts`](../src/ui/loop-status.ts) (countdown, interval edit, pause/resume, skip, stop); skip marks the loop due immediately via [`src/chat/loop/skip.ts`](../src/chat/loop/skip.ts) and triggers an immediate ticker wake. Re-synced after transcript paint and OS app foreground changes. Sidebar rows with active loops show a masked [`/icons/loop.svg`](../public/icons/loop.svg) indicator ([`src/ui/chat-item-loop-icon.ts`](../src/ui/chat-item-loop-icon.ts)): rotates while at least one loop is unpaused, static when all are paused.

Naming: `src/tools/loop.ts` is the tool-call/send loop — unrelated to `/loop`. Do not rename it when touching session loops.

---

## Built-in tools

Catalog: [`BUILT_IN_TOOLS`](../src/tools/definitions.ts). Config UI: Settings → Tools; quick access from the Code/Chat/**desktop** composer **Tools** popover ([`src/ui/composer-tools-popover.ts`](../src/ui/composer-tools-popover.ts), [`src/styles/composer-tools-popover.css`](../src/styles/composer-tools-popover.css)) with segmented Off/Ask/Full rows, consolidated availability notices, web-search provider (SearXNG, DuckDuckGo, Brave, Tavily — persisted to `search.json` with `tools.json` fallback) + session-cache toggles, and a link to full tool settings; persistence `tools.json` / `minnow.tools`. Optional `appId` on a catalog entry gates exposure through [`getEnabledToolCatalogEntries()`](../src/tools/client.ts) and [`fillToolsSection()`](../src/ui/tools-list.ts): email and calendar tools appear only when `isAppEnabled` for that app (developer `releaseState` plus user `disabledApps`).

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

Invoke via **`/`** slash picker ([`src/ui/skill-picker.ts`](../src/ui/skill-picker.ts)). Built-ins include `git-commit`, `code-review`, `impeccable` (default-on), `ui-designer`, `caveman`, and `partymode`. Only installed skills appear in the picker — remote library packs are absent until installed.

**Matt Pocock pack (MIN-476):** No longer bundled. Install from **Settings → Skills Library** (`matt-pocock` pack, 19 skills: `ask-minnow`, `triage`, `implement`, `handoff`, …). Post-install hook [`server/skills/library/post-install.js`](../server/skills/library/post-install.js) runs [`scripts/matt-pocock-preserves/apply-minnow-patches.mjs`](../scripts/matt-pocock-preserves/apply-minnow-patches.mjs) to apply Minnow renames (`ask-matt` → `ask-minnow`, `/review` → `/code-review`, `/compact` guidance, etc.). Lock file: `skills-lock.json` (`matt-pocock-skills` section). Maintainer sync (hashes only, not bundled): `npm run matt-pocock-skills:sync`.

**Skills Library (MIN-474/475/477):** Curated third-party SKILL.md packs for browse/install from **Settings → Integrations → Skills Library** ([`src/ui/settings-skills-library.ts`](../src/ui/settings-skills-library.ts), section id `skills-library`). Pack registry data: [`src/skills/library/registry.mjs`](../src/skills/library/registry.mjs) (shared with server); types in [`registry.ts`](../src/skills/library/registry.ts) — five curated packs (Matt Pocock, Addy Osmani, Superpowers, last30days, Browserbase); Antigravity and AWS Agent Toolkit are excluded from the curated list. Each pack pins a GitHub `commit` SHA plus `skillsGlobs` for discovery. Prebuilt offline indexes ship at `src/skills/library/index/<pack>.json` (metadata only: `skillId`, `label`, `description`, `subpath`). Regenerate: `npm run skills-library:index` (also runs in `prebuild` via `scripts/generate-skills-library-index.mjs`). Matt Pocock pack declares `postInstallPatch: 'matt-pocock'` for Minnow adaptations on install. Client API: [`src/skills/library-api.ts`](../src/skills/library-api.ts) — fetches library routes when `npm start` is running, falls back to shipped indexes for offline browse.

Skills Library API (`server/skills/library/`, routes in [`middleware.js`](../server/skills/middleware.js)): `GET /api/skills/library/packs` (registry + installed counts), `GET /api/skills/library/packs/:id/index` (offline shipped index), `GET /api/skills/library/search?q=`, `POST /api/skills/library/install` (`{ pack, skillIds[] | all }` or `{ repoUrl, subpath? }`), `POST /api/skills/library/remove` (`{ skillId }` or `{ pack, all: true }`). Installs write to `~/.minnow/skills/<id>/`, record provenance in `~/.minnow/skills/installed-skills.json`, and enable the skill immediately. Network fetches are SSRF-guarded and GitHub-host-only (`api.github.com`, `codeload.github.com`, `raw.githubusercontent.com`). **Skills catalog** (`settings.skills`) remains the enable/disable + custom authoring surface; cross-links between the two sections.

API: `GET /api/skills`, `GET/PUT /api/skills/:id`, `GET/PUT /api/config/skills`.

**Git /api/git (MIN-198 + MIN-409 snapshots):** Programmatic git ops via `POST /api/git` (`op` + args) — [`server/git/git-ops.js`](../server/git/git-ops.js), middleware [`server/git/middleware.js`](../server/git/middleware.js), client [`src/state/git-api.ts`](../src/state/git-api.ts). Agent-undo snapshot ops (MIN-409): `snapshotCreate` builds a **dangling** commit of the working tree using a temp `GIT_INDEX_FILE` (real index + HEAD untouched); `snapshotRestore` takes a safety snapshot first, then `git read-tree --reset -u <tree>` + `git clean -fd` (rewrites index/WT, **does not** move branch tip/HEAD); `snapshotDiff` lists `--name-status` paths between two SHAs or a SHA vs the current WT. Client wrappers: `gitSnapshotCreate` / `gitSnapshotRestore` / `gitSnapshotDiff`.

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

**Live status UI:** While a run is in flight, the runner publishes `livePhase` (`thinking` → `generating` → `tools`) plus partial reasoning and the current tool name via `onLiveActivity` → [`sub-agent-events.ts`](../src/agents/sub-agent-events.ts). Parent chat **cards** ([`sub-agent-cards.ts`](../src/ui/sub-agent-cards.ts)) and the **drawer** ([`sub-agent-drawer.ts`](../src/ui/sub-agent-drawer.ts)) subscribe and mirror main-chat stream indicators (`stream-status`, tool spinner) in the activity transcript ([`transcript-view.ts`](../src/ui/transcript-view.ts) + [`sub-agent-live-status.ts`](../src/ui/sub-agent-live-status.ts)).

**Generation timeouts:** Settings → **Watchdog** (`config.json` → `chat.generationIdleTimeoutMs`, `chat.generationMaxDurationMs`) — upstream idle and max-duration limits while streaming from the model.

### Orchestrate boards

Kanban delivery from plans under `documentation/plans/`. Tools: `board_init`, `board_update_task`, `board_get_state`, `board_report`, `delegate_tasks`. Board member chats get role-scoped tool filters ([`src/chat/modes/orchestrate-tool-filter.ts`](../src/chat/modes/orchestrate-tool-filter.ts)); builder/tester/fixer chats also get `todo_write` for the composer checklist ([`src/tools/todo-tools.ts`](../src/tools/todo-tools.ts), [`src/ui/todo-panel.ts`](../src/ui/todo-panel.ts)).

**Testing guide:** [guides/orchestrate-board-testing.md](guides/orchestrate-board-testing.md) — `npm run test:board`, fake model, `seed:test-board`, `check:board-log`, harness layout. **Manual workflow GUI:** Settings → **Advanced → Board testing** ([`src/ui/settings-board-testing.ts`](../src/ui/settings-board-testing.ts)) — in-process fake model (`POST /api/orchestrate/board-testing/fake-model/*`), seed test board, validate board log JSONL. API: [`server/orchestrate/board-testing/`](../server/orchestrate/board-testing/). Shared seed presets: [`src/dev/test-board-seed.ts`](../src/dev/test-board-seed.ts).

**AFK E2E reliability plan:** [`plans/orchestrate-board-afk-e2e-reliability.md`](plans/orchestrate-board-afk-e2e-reliability.md) — proposed unified scenario catalog, failure-boundary matrix, persisted server/real-git and crash-reload harnesses, Settings scenario runner, soak gates, and hands-off AFK acceptance criteria.

State: `Chat.orchestratePlanPath`, `ChatGroup.orchestrateBoard`, [`src/ui/orchestrate-board.ts`](../src/ui/orchestrate-board.ts). Global defaults (`autopilot` block in `config.json`): Settings → **Autopilot** ([`src/ui/settings-autopilot.ts`](../src/ui/settings-autopilot.ts)) — emphasis-panel layout matching Agents/Rules (board execution, retries, heartbeat, planner fallback, self-heal). Per-board overrides on the board header: execution mode, concurrency, isolation, and **model** (provider + model selects in [`src/ui/orchestrate-board-model-select.ts`](../src/ui/orchestrate-board-model-select.ts); persisted on `orchestrateBoard.modelProviderId` / `modelId`, synced to planner and task chats).

**Board metrics strip (MIN-414):** When the main column is in board view, the bottom inference metrics panel rolls up **all planner + member chat** token totals (ledger-first per chat) and averages per-chat tok/s (completion-weighted via [`averageStatsSegments`](../src/chat/orchestrate/stats-math.ts)). Implementation: [`src/chat/orchestrate/board-stats-aggregate.ts`](../src/chat/orchestrate/board-stats-aggregate.ts); refreshed on board live updates and chat switches so focusing a member chat does not reset totals.

**Board view browse root (MIN-464):** When board view is active and worktree isolation is on, the file explorer, terminal, and Source Control browse cwd follow the board **integration worktree** (not per-task chat worktrees). Chat view continues to sync browse cwd from the active chat's composer run-target. Helpers: [`resolveBoardIntegrationWorktreePath`](../src/state/worktree-isolation.ts), [`syncPanelFromActiveChat`](../src/ui/git-panel.ts).

**File tree context menu — Open in System Explorer:** Right-click a file or folder in the Code file tree to open it in the OS explorer (Windows Explorer / macOS Finder / Linux Files). Files are revealed/selected in their parent folder when the platform supports it; folders open as the explorer root. Client: [`src/ui/reveal-in-system-explorer.ts`](../src/ui/reveal-in-system-explorer.ts) + [`src/ui/file-tree-context-menu.ts`](../src/ui/file-tree-context-menu.ts). Server: `POST /api/workspace/reveal-in-explorer` with `{ path, workspaceRoot? }` ([`server/workspace/reveal-in-explorer.js`](../server/workspace/reveal-in-explorer.js)); path is resolved under the workspace (or allowed worktree override) via `resolveSafePath`.

**File tree + editor tab icons:** [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) (PKief) colorful SVGs in the Code file tree and unified viewer tabs — same associations as VS Code (e.g. `test.ts` → `test-ts`, `vite.config.ts` → `vite`, `README.md` → `readme`). Association resolver: [`src/ui/file-type-icon-resolve.ts`](../src/ui/file-type-icon-resolve.ts); DOM/`<img>` helpers: [`src/ui/file-type-icons.ts`](../src/ui/file-type-icons.ts) (reads `material-icon-theme/dist/material-icons.json`; SVG assets synced to `public/material-icons/` by [`scripts/sync-material-file-icons.mjs`](../scripts/sync-material-file-icons.mjs) on `postinstall` / `prebuild`). Wired from [`file-tree.ts`](../src/ui/file-tree.ts) and [`unified-right-tabs.ts`](../src/ui/unified-right-tabs.ts). License note: [`documentation/THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

**UI chrome icons:** [Flaticon Uicons](https://www.flaticon.com/uicons) (`@flaticon/flaticon-uicons`) — Regular Rounded + Solid Rounded webfont glyphs behind a single registry in [`src/ui/icon.ts`](../src/ui/icon.ts) (`createIcon` / `iconHtml`, 128 semantic names). Styles: [`src/styles/icons.css`](../src/styles/icons.css) (`.icon-svg` sizing via `--mn-icon-size`). CI guard: [`scripts/check-icons.mjs`](../scripts/check-icons.mjs) (`npm run check:icons`, also in `prebuild`). Legacy registries (`src/os/icons.ts`, `mode-icons.ts`, `email-icons.ts`, git/board helpers) delegate to the central API. **Carve-outs:** Material file-type icons (above), provider brand marks in [`model-producer.ts`](../src/providers/model-producer.ts), Minnow fish glyph ([`minnow-glyph.ts`](../src/ui/minnow-glyph.ts)), PWA icons `public/icons/icon-192.png` / `icon-512.png`.

**File tree incremental refresh:** Agent filesystem writes trigger a debounced (500ms) subtree patch instead of a full tree rebuild. [`affectedDirsFromTool`](../src/ui/file-tree.ts) maps mutating tools to parent directories; [`refreshDirectories`](../src/ui/file-tree.ts) re-fetches only those listings and patches `[data-tree-dir]` containers in place. Scroll position, keyboard focus (`data-tree-path`), and expanded folders are preserved across renders. Git status polls patch badge spans in place via [`setFileTreeGitStatus`](../src/ui/file-tree.ts). Auto-refresh wiring: [`file-tree-auto-refresh.ts`](../src/ui/file-tree-auto-refresh.ts) (defers while the user interacts with `#fileTreeHost`; shows a pending dot on `#btnFileTreeRefresh`). `syncFileTreeToPanelWorktree({ force: true })` soft-refreshes when the listing root is unchanged (orchestrate board ticks no longer collapse the tree). Editor saves rely on `save_file` auto-refresh only (no duplicate bridge call).

**Terminal panel (MIN-500):** Bottom dock tabs are Agent (command output) + interactive PTY sessions only ([`src/ui/terminal-tabs.ts`](../src/ui/terminal-tabs.ts), [`src/ui/terminal-panel.ts`](../src/ui/terminal-panel.ts)). Docked resize clamps to a **311px minimum PTY viewport** (`--terminal-xterm-min-height` on `#terminalXtermHost`; panel floor in [`src/ui/terminal-layout.ts`](../src/ui/terminal-layout.ts)). Header **Expand** (`#btnTerminalMaximize`) fills the chat column by hiding composer/messages chrome (`main-column--terminal-maximized`); click again or hide the panel to restore the docked height. The former Dev Server virtual tab / log stream bridge was removed; workspace server logs move to the Dev Servers Code screen. **PTY command history:** per-tab ArrowUp/ArrowDown recall in [`src/ui/terminal-xterm.ts`](../src/ui/terminal-xterm.ts) + [`src/ui/terminal-history-nav.ts`](../src/ui/terminal-history-nav.ts) (`localStorage`, keyed by tab id, 500 entries; survives reload). Tab bar metadata (`tabs`, `activeTabId`, `sessionId` per tab) persists in `config.json` via [`src/config/terminal-meta.ts`](../src/config/terminal-meta.ts); `pagehide` flushes live tabs with keepalive PUT and **does not** kill server PTYs so reload reconnects over WebSocket (scrollback replay from [`server/terminal/pty-ws.js`](../server/terminal/pty-ws.js)); explicit tab close still `DELETE`s the session. Line replace on bash/zsh/WSL uses readline Ctrl+A/Ctrl+K clear; **PowerShell/cmd** pass ArrowUp/Down through to PSReadLine/DOSKEY (`usesShellNativeHistory`). **WSL (Windows):** installed distros are listed in [`server/terminal/shell-profiles.js`](../server/terminal/shell-profiles.js) (`wsl:<distro>` ids); `execute_command` and PTY spawn route through `wsl.exe` when **Settings → General → Chat & terminal → Default shell** (or a per-workspace override in `config.json` `terminal.workspaceShellProfiles`) selects WSL. Path mapping: [`server/terminal/wsl.js`](../server/terminal/wsl.js) (`C:\…` → `/mnt/c/…` via `wsl --cd`). Setup: [guides/setup.md](guides/setup.md#6-optional-setup).
**Pipeline holds (MIN-409):** Non-streaming merge/fixer phases occupy a concurrency slot via ref-counted holds in [`src/state/orchestrate-pipeline-holds.ts`](../src/state/orchestrate-pipeline-holds.ts) (WeakMap keyed by board object identity; TTL-on-read + sweep). `countRunningTaskChats` counts chat slots plus hold-only tasks; `isTaskStalledForRestart` treats held tasks as not stalled. The running-tasks strip shows a non-interactive **Merging** chip for hold-only slots. Sequential → AFK pins `maxConcurrentTasks` to 1 when unset (`setBoardExecutionMode`).

**Fake model server (orchestrate testability):** [`scripts/fake-model-server.mjs`](../scripts/fake-model-server.mjs) — local OpenAI-v1 HTTP stub (`GET /v1/models`, `POST /v1/chat/completions` SSE) driven by ordered scenario JSON (`{ match: { role?, taskId?, nth? }, emit: [...] }`). Default scenario: builder **nth=0** → `board_report` pass; missing-report nudges re-emit `board_report`; **nth≥1** otherwise → prose ack. Per-(role, taskId) counters reset on fake-model start/stop and on board-testing **Seed board**. `npm run fake-model -- --register` writes provider `fake-board` under `~/.minnow/providers/`. Exports `requests` for assertions.

**Test board seed (manual dev):** `npm run seed:test-board` — writes a pre-`board_init` orchestrate folder + planner chat into `~/.minnow` sessions (`scripts/seed-test-board.mts`). Each run creates a **new** board folder by default; pass `--stable-id` to reuse the canonical test ids for CI/log fixtures. Presets: `quick` (3 parallel W1 tasks) or `smoke` (full board-smoke plan). Defaults to `fake-board` / `fake-board-model`. Restart Minnow if it was open during seeding.

**Board log invariant CLI (B3):** [`scripts/check-board-log.mjs`](../scripts/check-board-log.mjs) — `npm run check:board-log -- <groupId|path> [--plan plan.json] [--json]` reads `~/.minnow/logs/orchestrate/<groupId>.jsonl` (or a direct path), parses JSONL (tolerates trailing partial lines; skips `*.bak`), and runs [`checkBoardLog`](../src/state/board-log-invariants.ts). Without `--plan`, `wave-order` and `dependency-order` are skipped. Exit 0/1.

**Board lifecycle test harness:** [`test/orchestrate/_board-flow-helpers.mts`](../test/orchestrate/_board-flow-helpers.mts) — `seedBoard`, `driveBoardToConvergence` (bootstrap slots), and `driveLiveBoard` (real `startTask` / supervision / slot accounting with [`_scripted-turn-runner.mts`](../test/orchestrate/_scripted-turn-runner.mts)). Live mode opts in via `setBoardChatTurnRunner` under `MINNOW_TEST=1`. Suites: [`board-flow-e2e.test.mts`](../test/orchestrate/board-flow-e2e.test.mts), [`board-live-launch.test.mts`](../test/orchestrate/board-live-launch.test.mts).

**Board headless E2E (real `runChatTurn`):** [`test/orchestrate/board-headless-e2e.test.mts`](../test/orchestrate/board-headless-e2e.test.mts) drives the full tool loop via real [`runChatTurn`](../src/tools/loop.ts) with happy-dom ([`_headless-board-dom.mts`](../test/orchestrate/_headless-board-dom.mts)) and a `globalThis.fetch` router ([`_fake-api-router.mts`](../test/orchestrate/_fake-api-router.mts)) for generations, tools, worktree, and board-log mirror capture. Scripted SSE per slot key (`${taskId}:build|test|fix`, `final`) lives in [`_board-quirk-fixtures.mts`](../test/orchestrate/_board-quirk-fixtures.mts) (families A–H: prose-only builds, VERDICT variants, stream corruption, context exceeded, final-test quirks). LLM-quirk TDD matrix + **known red** backlog: [`plans/orchestrate-board-llm-quirk-tdd.md`](plans/orchestrate-board-llm-quirk-tdd.md). Merge-fixer nonsense: [`merge-fixer-llm-quirks.test.mts`](../test/orchestrate/merge-fixer-llm-quirks.test.mts). `npm run test:board` runs the full orchestrate suite (397 tests; five quirk cases intentionally red until product fixes).

### Experts

Personas under `src/chat/prompts/experts/<id>/`. Chats: `Chat.kind === 'expert'`, memory under `pages/experts/<id>/facts/`. UI: Experts' Lab on desktop + `#/experts`.

---

## Minnow Shell

Stage layers in `#osStage` ([`src/os/shell.ts`](../src/os/shell.ts)):

| Layer | Contents |
|-------|----------|
| Desktop | Wallpaper, concierge composer, chat rail, research/experts overlays |
| Windows | Floating apps (Settings, Models, Brain, Bench, Compare, Calendar, …) |
| Side panels | Scheduler list rail |
| Fullscreen apps | Code, Email, Settings-from-Code |

**Menubar status pill** (`#osStatusText` / legacy `#sText`, [`src/ui/status.ts`](../src/ui/status.ts)): operational Ready / loading / error feedback. Frameless Electron chrome uses `user-select: none` for window drag, but the status pill restores selectable text. Error states are click-to-copy (full message → clipboard + toast); selecting text first still allows a normal partial copy.

Presentation modes: `fullscreen` | `window` | `desktop` | `sidePanel` ([`src/os/presentation-mode.ts`](../src/os/presentation-mode.ts)). Settings opened from Code sets `returnToApp: 'code'` (fullscreen); the Settings back control calls [`closeSettings()`](../src/ui/settings-page.ts) so it restores Code instead of falling through to the desktop. `initSettingsPage` is idempotent so duplicate binds cannot stack back handlers. **Scheduler** (`sidePanel`) opens as a right rail overlay via [`toggleSchedulerOverlay()`](../src/os/scheduler-side-panel.ts) from the menubar shortcut and dock — it does not steal foreground from the current app (including fullscreen Code); hash deep links from the desktop still foreground the scheduler instance.

**Desktop chat** is the primary chat surface (`#desktopChatCol`); legacy `#chatView` retained for deep links. **Code** reparents `#appBody` into `#osAppsLayer`. Chat transcript mount + inset overlay routing (sub-agent drawer, goal eval) live in [`src/ui/chat-mount.ts`](../src/ui/chat-mount.ts): Code → `#mainColumn`, desktop → `.mn-os-desktop-chat`, Chat app → `.chat-app-main`.

The Code chat sidebar header keeps its navigation controls ordered as **collapse sidebar**, **search chats**, then **Code overview**. Collapsed to the 48px icon rail ([`src/styles/sidebar.css`](../src/styles/sidebar.css)), orchestrate board folders show only the board group glyph — waves and member chats are hidden until the sidebar expands (or the mobile overlay opens) ([`renderSidebar`](../src/ui/sidebar.ts)).

**Dev Servers screen (MIN-500):** First-class Code section at `#/app/code/dev-server` ([`src/ui/dev-server-screen.ts`](../src/ui/dev-server-screen.ts), [`src/styles/dev-server-screen.css`](../src/styles/dev-server-screen.css)). Sidebar footer rail button `#btnDevServers`. Three-pane layout: server registry (top), collapsible logs (middle), collapsible listening ports (bottom). Logs and ports section headers toggle `aria-expanded` collapse; ports toolbar uses icon refresh + auto-refresh toggle (`aria-pressed`). Add/edit form uses inline checkbox styling for auto-start. Each server row and add/edit form include a **Worktree** `<select>` (from `git worktree list`) so start/restart spawn in the chosen checkout; `worktreeRoot` is persisted on registry rows and optional one-off override via `POST …/start|restart` body. Multi-server registry in `config.json` → `workspace.devServersByPath` ([`server/dev-server/registry.js`](../server/dev-server/registry.js)); runtime state nested under `workspace.devServerByPath[<key>].servers` with legacy flat-row → `servers.primary` migration ([`server/dev-server/manager.js`](../server/dev-server/manager.js)). **Agent tool:** `manage_dev_servers` (`list` / `create` / `update` / `delete` / `start` / `stop` / `restart`) — [`server/dev-server/tool-handler.js`](../server/dev-server/tool-handler.js); `code-exec` group; startup.md-linked rows keep command/cwd/health on disk. **Split-stack** repos (`concurrently` API + Vite): when `startup.md` is `npm run dev`, Minnow expands `package.json` scripts, injects `--port` into client children only, sets `PORT` for the API (`apiPort` in `startup.md` or UI port + 1), and health-checks the UI port ([`server/dev-server/effective-guide.js`](../server/dev-server/effective-guide.js)). APIs: `GET/POST /api/workspace/dev-servers`, `PUT/DELETE …/dev-servers/:id`, `POST …/:id/start|stop|restart`, `GET /api/workspace/ports`, `POST /api/workspace/ports/kill` ([`server/workspace/middleware.js`](../server/workspace/middleware.js), [`server/dev-server/ports.js`](../server/dev-server/ports.js)). Log pane backfills via `fetchTerminalLog` then tails SSE ([`src/ui/dev-server-log-view.ts`](../src/ui/dev-server-log-view.ts)). Hub strip cell is status + open-screen only ([`src/ui/hub-dev-server.ts`](../src/ui/hub-dev-server.ts)). Legacy `/api/workspace/dev-server/*` routes remain primary-server aliases.

Router: [`src/os/router.ts`](../src/os/router.ts). Boot: `initOsPageBridge()` → `initOsShell()` → `initOsRouter()`. **App transitions:** leaving a fullscreen app for desktop chat/research/experts pre-applies desktop surface classes (`prepareDesktop*Surface` in [`desktop-state.ts`](../src/os/desktop-state.ts)) before `showDesktop()` emits so the shell never paints idle hero for a frame; fullscreen app-to-app switches activate the next layer before hiding the previous one and only play the enter animation when opening from the desktop ([`app-host.ts`](../src/os/app-host.ts), `.mn-os-app-enter` in [`minnowos-shell.css`](../src/styles/minnowos-shell.css)).

**Notifications:** menubar bell inbox ([`src/os/notifications-menu.ts`](../src/os/notifications-menu.ts), [`src/notifications/`](../src/notifications/)). Sounds use **packs** under `public/sounds/packs/<packId>/` ([`src/notifications/sound-packs.ts`](../src/notifications/sound-packs.ts)): each pack maps three cues — `turn_complete`, `question`, `tool_turn` — to audio files; notification kinds resolve to a cue at playback time. Default pack **Minnow** ships `turn-complete.wav`, `question.wav`, `tool-turn.mp3`. Prefs: `minnow.notifications.soundPackId` (`default` | `none`), `minnow.notifications.soundOnActiveChat` (play cues while watching the active chat in Code without bell rows). Settings → General → Notifications.

**App switcher:** in-app menubar grid icon ([`src/os/app-switcher-menu.ts`](../src/os/app-switcher-menu.ts)) opens a compact popover with **Desktop** plus the same apps as the dock (`listDockApps`). Hidden on the Desktop view (dock covers that case). Escape / outside click dismisses; opening closes other chrome popovers.

**Desktop prefs** (`minnow.os.*`): wallpaper / layout via [`src/os/desktop-prefs.ts`](../src/os/desktop-prefs.ts); **disabled apps** via `minnow.os.disabledApps` ([`src/os/app-preferences.ts`](../src/os/app-preferences.ts)).

---

## Theme and appearance

16 themes: `<html data-theme="{family}-{mode}">` (8 families × dark/light). **All hex/rgba only in** [`src/styles/tokens.css`](../src/styles/tokens.css); app code uses `--mn-*`.

Runtime: [`src/theme.ts`](../src/theme.ts), Settings → Appearance, desktop wallpaper ([`src/os/wallpaper.ts`](../src/os/wallpaper.ts)).

**`color-mix` gotcha:** Prefer `color-mix(in srgb, …)` (or a solid `--mn-surface-*` token) for fg/bg veils. Mixing near-achromatic `--mn-fg` into `--mn-bg` with `in oklch` can drop hue to `none` and paint a cool lavender wash on warm themes (e.g. coral-light). Dev Server log host uses `--mn-surface-0` for that reason.

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
- **Inbox category tabs (Primary / Social / Other):** local-only labels on `messages.category` / `category_source` and rolled up to `threads.category` (`primary > social > other`). No IMAP folders or server labels. Classifier in [`server/email/categorize.js`](../server/email/categorize.js): user pin → priority-high override → social domain → replied contact → bulk headers → AI `triage.bucket` → triage category fallback → Primary. Deterministic pass runs at ingest in `upsertMessageRow`; AI bucket rides the existing triage call. UI reuses `.email-chrome-segments` on the **Inbox** folder stream ([`src/ui/email/email-inbox.ts`](../src/ui/email/email-inbox.ts)) — not Needs attention or other Views; gated by per-account `categoryTabsEnabled` (default on). Manual **File as…** via `POST /accounts/:id/threads/:threadId/category` (optional remember-sender pin in `sender_category_overrides`). `GET /threads?category=&categoryCounts=1` filters and returns unread tab badges.
- **Inbox stream paging:** the conversation list in [`src/ui/email/email-inbox.ts`](../src/ui/email/email-inbox.ts) loads 40 threads per page with a Prev/Next pager; page/search/account/scope changes clear checkbox selection.
- **Inbox brief:** the triage stream head (`.email-stream-brief`) prefers the LLM narrative digest from `GET /accounts/:id/summary` (`digest.narrative`, generated by [`server/email/digest.js`](../server/email/digest.js)); until that lands, it shows the heuristic count template from `summary.text`. Background regeneration and `digest_updated` SSE swap in the narrative without a manual refresh ([`src/ui/email/email-panel.ts`](../src/ui/email/email-panel.ts) re-renders the triage stream on that event).
- **Actionable digest + assistant:** validated digest groups render as counted review rows below the narrative; selecting one queues the existing pending action and **Ready for review** exposes Apply, Always allow (except delete), and Dismiss. Queueing consumes that group from the cached digest (and identical open pending rows are deduped) so the Review chip cannot reappear and stack duplicates; Apply/Dismiss remove the review row immediately and scrub overlapping digest chips. The General-icon toggle mounts on the far right of the triage readout (or the stream marker when the head is hidden) and opens a persisted, resizable assistant dock ([`src/ui/email/email-assistant-panel.ts`](../src/ui/email/email-assistant-panel.ts)) that reuses shared message rendering, attachments, streaming, auto-scroll, tool approval, and question hosts. Its dedicated `email` mode allows mail, calendar, web, file/document, Brain, utility, and question tools while denying shell, git, boards, settings mutation, browser automation, and unrelated app controls. Closing the dock parks question UI and leaves any generation running as a background stream; notifications route back to Email. Active account/view/thread identifiers are sanitized and injected ephemerally; message bodies remain behind fenced `search_mail` / `get_thread` tools.

---

## LSP, MCP, plugins

**LSP:** Bundled TS/JS + on-demand language bundles; config `~/.minnow/lsp.json`, defaults `src/lsp/defaults.json`. APIs: `/api/lsp/*`. TypeScript 7 no longer ships `tsserver.js`; `tsserver-fallback` (npm alias to TS 5.8) supplies the bundled fallback path for `typescript-language-server`.

**MCP:** Config under `~/.minnow/mcp/`; Context7 built-in for library docs. Tools surface as `mcp__<server>__<tool>`.

**Native tool plugins:** `plugin__*` tools from user plugins ([`documentation/plugins/tool-authoring.md`](plugins/tool-authoring.md)).

---

## Providers and models

Multi-provider registry: `~/.minnow/providers/`. UI: Models app → Providers. Chat uses composite model keys (`providerId` + model id) in [`src/lib/model-select-key.ts`](../src/lib/model-select-key.ts). The top-bar picker and composer model menus share the same catalog via [`src/ui/model-select-picker.ts`](../src/ui/model-select-picker.ts); composer menus resolve **Load/Unload** against the **active chat model** (not the global menubar default) via [`src/ui/model-host-filter-context.ts`](../src/ui/model-host-filter-context.ts).

**One-click presets:** shared catalog in [`src/providers/presets.ts`](../src/providers/presets.ts) — OpenCode Go/Zen, Anthropic, DeepSeek, GitHub Copilot, plus OpenRouter/OpenAI/Groq/Mistral. **Onboarding → Cloud API** shows preset chips with a green check when that provider already has a saved API key (`onboarding-cloud-<preset>` ids in the registry). **Settings → Providers** uses the `settings-general` emphasis-panel layout (like Routing and Usage): grouped picker (local servers, featured APIs, more cloud APIs, then custom), flat provider rows inside the configured panel, and related links to Routing and Usage. Styles: [`src/styles/settings-providers.css`](../src/styles/settings-providers.css).

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

**Document read (agents):** `read_document` extracts plain text from PDF and office files. Prefer `path` (workspace-relative) for on-disk files; `content` (base64) remains for composer attachments. Output is capped (~32k chars) via `capTextOutput`; corrupt `.xlsx` / `.xls` binaries are rejected before parsing.

**Document creation (agents):** `create_pdf`, `create_spreadsheet` (.xlsx), and `create_word_document` (.docx) write binary files via the tool server (`pdf-lib`, `@pdf-lib/fontkit`, `xlsx`, `docx` optional deps). PDF body text uses subsetted Noto fonts (`server/tools/pdf-layout.js` + bundled TTFs under `server/tools/fonts/`) for Latin/Cyrillic/Greek, CJK, and emoji with measured wrapping; unsupported code points become U+FFFD and are reported in the tool result. **File viewer preview:** PDFs embed via `/api/preview/file/*`; spreadsheets and Word docs render HTML via `/api/preview/document-html/*` (uses `xlsx` / `mammoth` / `officeparser` when installed). Document HTML preview sanitizes embedded fragments (`sanitizeDocumentHtml`), caps sheet/row counts, sets CSP + `nosniff` on the preview route, and loads Word/Excel previews in a bare `sandbox` iframe (no scripts / same-origin).

**File viewer recent files:** When no viewer tabs are open, `#fileViewerHost` shows a recent-files empty state ([`src/ui/file-viewer-recent.ts`](../src/ui/file-viewer-recent.ts)) — especially useful on the desktop workspace **Viewer** tab, which stays mounted even with zero tabs. MRU paths are persisted in `config.json` → `filePanel.recentViewerFilesByWorkspace` (keyed by absolute workspace / listing root, max 12 per workspace) via [`src/state/recent-viewer-files.ts`](../src/state/recent-viewer-files.ts). Opens record through `openFileInViewer` / workspace image open; delete/rename prune or remap entries with the file-tree ops sync.

**File viewer dirty detection:** CodeMirror 6 stores documents as LF-only. Loaded/saved baselines are normalized via `normalizeViewerDocText` / `isViewerDocDirty` in [`file-viewer-tab-store.ts`](../src/ui/file-viewer-tab-store.ts) so CRLF files (common on Windows) do not spuriously prompt “Unsaved changes” on close/tab switch. After mount, the viewer rebases `originalContent` to the live CM doc. Leave/close confirms re-snapshot from the editor before prompting. `save_file` still preserves on-disk EOL when writing.

**File viewer text loads:** [`readWorkspaceTextFile`](../src/attachments/workspace-text-read.ts) fetches `GET /api/preview/file/…?raw=1` so HTML is not rewritten. Browser preview omits `raw` and still injects `<base href>` ([`server/preview/middleware.js`](../server/preview/middleware.js)) for relative assets. Async tab loads apply results by path (`setViewerTabLoadState`) so a slow read cannot land on the wrong tab.

**Bench file-tool probes:** every `category: 'files'` tool must appear exactly once in `FILE_TOOL_PROBE_ORDER` ([`src/benchmark/suites/file-tool-fixtures.ts`](../src/benchmark/suites/file-tool-fixtures.ts)); `validateFileToolProbeOrder()` throws on import if a tool is missing. Probe chain is create → read → mutate → `create_pdf` / spreadsheet / Word → `read_document` → `delete_path`.

---

## Electron and packaging

- **Dev:** `npm start` spawns Electron after Vite is up.
- **Package:** `npm run package` → `release/` (NSIS on Windows).
- **Preview browser:** requires Electron (`window.minnow.preview`); hidden in plain browser tabs.
- **Auto-update:** GitHub Releases via `electron-updater` (packaged installs); Settings → General → App updates.
- **System tray:** Close-to-tray is **on by default** (`config.desktopShell.closeToTray`). Closing the window hides Minnow to the tray so chats, agents, and the tool server keep running; tray **Quit Minnow** runs the normal shutdown path. Tray menu: Open, New chat, agent/model status, unload local models, Settings, launch at startup (OS login item — not duplicated in config). Modules: [`electron/tray.ts`](../electron/tray.ts), [`electron/tray-close.ts`](../electron/tray-close.ts), [`electron/login-item.ts`](../electron/login-item.ts), [`src/electron-tray-bridge.ts`](../src/electron-tray-bridge.ts). Settings → General → **Desktop app**.
- **In-app dialogs:** [`src/ui/app-dialog.ts`](../src/ui/app-dialog.ts) replaces blocking native `alert` / `confirm` / `prompt` in the Electron shell with Minnow-styled modals (`installAppDialogs()` at boot; call sites use `await appConfirm()` / `appAlert()` / `appPrompt()`). Overlay z-index `100030` keeps dialogs above shell chrome. **Do not use synchronous `window.confirm()` / `window.alert()` / `window.prompt()` in product SPA code** — in Electron the patched sync APIs cannot block on custom UI (sync `confirm` always returns `false`, sync `prompt` returns `null`).

---

## Testing and CI

- **`npm test`** — discovers `test/**/*.test.{js,mjs,mts,ts}` via [`test/run-all.mjs`](../test/run-all.mjs).
- **`npx tsc --noEmit`** — typecheck (no ESLint config).
- **CI:** [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — Windows + Ubuntu.

Scoped suites: see `package.json` (`test:memory`, `test:brain`, `test:engine`, `test:a11y`, …).

**Accessibility:** [guides/accessibility-audit.md](guides/accessibility-audit.md) — per-app keyboard checklist, NVDA smoke notes, contrast tokens. Regression: `npm run test:a11y` (`test/a11y/`, `test/theme-contrast.test.mts`). Global shortcuts overlay: **`?`** ([`src/ui/shell-keyboard-help.ts`](../src/ui/shell-keyboard-help.ts)) — mounts inside the foreground app layer (or `#osStage` on desktop) with scoped absolute positioning; grouped sections, key chips, scrollable body. Rows tagged with `appId` are omitted when the app is not developer-released (`releaseState: 'hidden'`). Per-chat model picker: **Mod+M** ([`src/ui/composer-model-trigger.ts`](../src/ui/composer-model-trigger.ts)). Streaming SR throttling: [`src/ui/a11y/stream-announcer.ts`](../src/ui/a11y/stream-announcer.ts). App surface cycle: Ctrl+Tab / Ctrl+Shift+Tab ([`src/os/app-focus-cycle.ts`](../src/os/app-focus-cycle.ts)). Window focus cycle: Alt+` ([`src/os/window-focus-cycle.ts`](../src/os/window-focus-cycle.ts)).

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
| [`src/os/shell.ts`](../src/os/shell.ts) | Minnow Shell |
| [`server/runtime/tools-middleware.js`](../server/runtime/tools-middleware.js) | Server tool dispatch |
| [`server/generations/`](../server/generations/) | Buffered upstream streams |
| [`server/config/validators.js`](../server/config/validators.js) | Config + session schema |

---

## Conventions for contributors

- Match surrounding code style; CSS uses `--mn-*` tokens only ([`tokens.css`](../src/styles/tokens.css)).
- Update **this file** when architecture, APIs, or storage change.
- Feature plans and historical notes live in [`documentation/plans/`](plans/) — not here.
- Path safety: file/git tools resolve under workspace root unless `TOOLS_ALLOW_ALL_PATHS=1`.
