# Minnow — project context

User-facing setup and quick start: [`README.md`](../README.md).

**Feature gap audit (2026):** [`documentation/plans/feature-audit-roadmap.md`](plans/feature-audit-roadmap.md) — shipped vs partial vs missing across agents, Reef, trace/replay, and settings. **Electron desktop wrapper (in progress):** [Linear project](https://linear.app/minnowai/project/electron-wrapper-549883cbfbe1) — [MIN-109](https://linear.app/minnowai/issue/MIN-109) runtime extraction shipped; [MIN-110](https://linear.app/minnowai/issue/MIN-110) `electron/` shell + `electron:dev`; [MIN-111](https://linear.app/minnowai/issue/MIN-111) in-process Connect + `sirv` host for `electron:prod`; [MIN-112](https://linear.app/minnowai/issue/MIN-112) `WebContentsView` preview via `window.minnow.preview` ([`electron/preview-host.ts`](../electron/preview-host.ts)); [MIN-113](https://linear.app/minnowai/issue/MIN-113) Windows NSIS packaging via `electron-builder` (`npm run package` → `release/`); index [`documentation/plans/electron-wrapper.md`](plans/electron-wrapper.md). **Local eval harness (audit #21, shipped MIN-57):** task packs, suite matrix runner, LLM rubric grading, leaderboard in Settings → Evals; `~/.minnow/evals/`. Plan: [`documentation/plans/Build out/feature-21-local-eval-harness.md`](plans/Build%20out/feature-21-local-eval-harness.md). QA: [`documentation/plans/verification/feature-21-eval-harness.md`](plans/verification/feature-21-eval-harness.md). **In-app LLM Benchmark screen (Bench, planned):** [`documentation/plans/benchmark-system-implementation.md`](plans/benchmark-system-implementation.md) — active-model integration battery + run history (complements Feature 21). **#03 Context budgets per agent (plan):** [`documentation/plans/Build out/feature-03-context-budgets.md`](plans/Build%20out/feature-03-context-budgets.md). **#07 Sub-agent budgets + structured summaries (shipped MIN-43):** [`documentation/plans/Build out/feature-07-sub-agent-budgets.md`](plans/Build%20out/feature-07-sub-agent-budgets.md). **#09 Sampler presets per agent (built):** per work-agent and sub-agent-type `sampler` objects merged at send time in [`src/agents/resolve-sampler.ts`](../src/agents/resolve-sampler.ts) → [`src/tools/loop.ts`](../src/tools/loop.ts) and [`src/agents/sub-agent-runner.ts`](../src/agents/sub-agent-runner.ts); defaults in [`src/agents/defaults/work-agent-samplers.json`](../src/agents/defaults/work-agent-samplers.json) and [`src/agents/defaults/sub-agents.json`](../src/agents/defaults/sub-agents.json). Plan: [`documentation/plans/Build out/feature-09-sampler-presets.md`](plans/Build%20out/feature-09-sampler-presets.md). **#10 Constrained decoding for tool calls (MIN-46, built):** optional `response_format` JSON Schema on tool turns when probe + settings allow; [`src/providers/capability-probe.ts`](../src/providers/capability-probe.ts), [`src/providers/tool-call-schema.ts`](../src/providers/tool-call-schema.ts), [`src/tools/parse-tool-arguments.ts`](../src/tools/parse-tool-arguments.ts); persistence `~/.minnow/providers/<id>/capabilities.json` and `config.json` → `toolCalls.useConstrainedDecoding`. Plan: [`documentation/plans/Build out/feature-10-constrained-decoding.md`](plans/Build%20out/feature-10-constrained-decoding.md). **#12 Prompt diffing (shipped MIN-47):** compare-to-shipped-default in Settings (`src/ui/prompt-diff-panel.ts`, `src/chat/prompts/text-diff.ts`); `GET ?baseline=builtin` on `/api/prompts/.../prompt` and work-agent prompt routes; per-part reset on custom prompt configs. Plan: [`documentation/plans/Build out/feature-12-prompt-diffing.md`](plans/Build%20out/feature-12-prompt-diffing.md). **#13 Prompt profiles / setup bundles (shipped MIN-49):** named portable bundles under `~/.minnow/profiles/` (prompt meta + agent overrides + tool permissions); export/import, one-click activate, per-workspace default + optional auto-apply on workspace switch. Plan: [`documentation/plans/Build out/feature-13-prompt-profiles.md`](plans/Build%20out/feature-13-prompt-profiles.md). APIs: `server/profiles/`; UI: Settings → Prompting (`src/ui/settings-profiles.ts`). **#20 Multi-model conversation (plan):** [`documentation/plans/Build out/feature-20-multi-model-conversation.md`](plans/Build%20out/feature-20-multi-model-conversation.md). **Sub-agent orchestration** is documented below under **Sub-agent orchestration (Step 09)**; verification: [`documentation/plans/verification/step-09.md`](plans/verification/step-09.md).

**To-fix roadmap:** Backlog in [`documentation/plans/to-fix.md`](plans/to-fix.md). **Implementation build plans** (with tests and todos): [`documentation/plans/Build out/`](plans/Build%20out/) — `switch-chats-while-waiting`, `reef-files-minnow-home`, `reef-optional-save-prompt`, `no-auto-open-terminal`, `no-restart-finished-chat`, `llm-mode-switch-suggestions`, `fix-chat-titles-thinking-leak`, `files-sidebar-close-arrow` (line numbers in each plan link to `to-fix.md`). Product backlog plans remain `feature-01` … `feature-30` in the same folder. **Persistence contract (Step 02+):** `~/.minnow/sessions/state.json` — single session blob, not per-chat files. **Tests (Step 02+):** `npm test` → `node --test` (JS suites), then `tsx --import ./test/test-loader.mjs --test` (TS/UI; loader stubs `.css` / xterm).

## Odysseus port plan pack

Implementation-ready plans for the 13 selected Odysseus-to-Minnow candidate ports live in [`documentation/plans/Odysseus port/`](plans/Odysseus%20port/). Start with the folder [`README.md`](plans/Odysseus%20port/README.md) for dependency order and Linear tracking ([project](https://linear.app/minnowai/project/odysseus-to-minnow-port-9e0acc5cf9c9)). **Prompt-injection defense (shipped MIN-124):** [`src/lib/untrusted.mjs`](../src/lib/untrusted.mjs) + [`server/security/untrusted.js`](../server/security/untrusted.js) fence untrusted text with `<<<UNTRUSTED_SOURCE_DATA source="…">>>` … `<<<END_UNTRUSTED_SOURCE_DATA>>>`; policy in [`default.full.md`](../src/chat/prompts/base/default.full.md) / [`default.lite.md`](../src/chat/prompts/base/default.lite.md) and sub-agent prompts. Injection sites: memory retrieve (`server/memory/retrieve.js`), web fetch/RAG (`server/tools/fetch-web-content.js`), Deep Research extraction (`server/research/extractor.js`), `read_document` + composer text attachments, research report discuss (`src/research/panel.ts`), and server tool middleware (`server/runtime/tools-middleware.js` for web/search/MCP). Deferred v1: skill body injection, browser CDP text, sub-agent structured outcomes. Tests: `test/security/untrusted.test.mjs`, `test/memory/untrusted.test.mjs`. **Encrypted credential storage (shipped MIN-117):** [`server/security/secret-box.js`](../server/security/secret-box.js) — AES-256-GCM envelopes for secrets at rest; file key at `~/.minnow/.key` (`0o600` on Unix). Provider `secrets.json` files migrate from plaintext on first read via [`server/providers/store.js`](../server/providers/store.js). Shared helpers: `readEncryptedJsonFile` / `writeEncryptedJsonFile` for downstream webhook/email/calendar/voice/image stores. **Key loss:** deleting or rotating `.key` makes encrypted secrets unrecoverable — re-enter credentials in Settings → Providers. Tests: `test/security/secret-box.test.mjs`, `test/security/secret-migration.test.mjs`.

## Product backlog (features 01–29)

Assignable pack: [`documentation/plans/product_backlog_agents_48a41af9.plan.md`](plans/product_backlog_agents_48a41af9.plan.md). Build plans: [`documentation/plans/Build out/`](plans/Build%20out/) (`feature-01` … `feature-30`). Verification: [`documentation/plans/verification/`](plans/verification/).

| ID | Slug | Status | Primary commit (`Large-Feature-Add`) |
| --- | --- | --- | --- |
| 01 | topbar-grouped-actions | Shipped | `5f3adb9` |
| 02 | lsp-full-catalog | Shipped | settings wave + `8ad1447` (fixture) |
| 03 | workspace-scoped-chats | Shipped | `5bc076a` |
| 04 | recent-workspaces-menu | Shipped | workspace API + UI tests |
| 05 | thinking-duration | Shipped | `ade9c45` |
| 06–09 | terminal-pty | Shipped | `15cc1dc` |
| 10 | model-display-names | Shipped | `bf63994` |
| 11–12 | load-unload-model | Shipped | `2d49c52` |
| 12–13 | model-picker-right-dots | Shipped | `b4735b6` |
| 14 | stop-generation | Shipped | `9df9f12` |
| 15–17 | message-actions | Shipped | `618f7c3` |
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

**Integration QA (2026-05-21):** Reef widget chart templates/snippets use theme tokens only (`var(--mn-accent)`, `color-mix(in srgb, var(--mn-accent) …)` for multi-series/heatmap levels — no hex). `node --test test/chat/reef/*.test.mjs` convention suites pass (24 tests). Full `npm test` may still report unrelated failures (e.g. `messages-stream-row` session init).

## MinnowOS shell (desktop launcher)

Shipped on branch `cursor/minnowos-redesign-30a6`. Wraps the SPA in an OS-style shell: menubar + concierge input (brand mark uses [`MINNOW_GLYPH_HEADER_HTML`](../src/ui/minnow-glyph.ts) — same filled fish glyph as the legacy topbar `logo-mark`), desktop (concierge hero; bottom **dock** launcher in [`dock-launcher.ts`](../src/os/dock-launcher.ts) on `#osDockLayer`, always visible on desktop, hidden in apps with an up-arrow reveal tab and down-arrow hide control; legacy `grid`/`concierge` `desktopLayout` values auto-migrate to `dock`), app instances with mini-previews (desktop launcher only — hidden while a foreground app is open), and hash routes `#/desktop` / `#/app/{code|chat|research|experts|bench|settings}`. **Smart concierge agent:** [`src/os/concierge-agent.ts`](../src/os/concierge-agent.ts) — on submit, one non-streaming structured LLM call (`resolveConciergePlan`) picks the target app, refines the seed, and sets `LaunchOptions` (`modeId`, `workspacePath`, `autoRun`, `settingsSection`); keyword routing in [`intent-routing.ts`](../src/os/intent-routing.ts) is the offline/failure fallback. Code auto-start: [`code-launch.ts`](../src/os/code-launch.ts) switches workspace, creates a mode-scoped chat, and sends via `sendMessageWithTools`. Research respects explicit `autoRun` from the planner. Plan: [`documentation/plans/smart-concierge-agent.md`](plans/smart-concierge-agent.md). **Menubar model chip** (`.mn-os-mb-chip`): opens a fixed popover ([`src/os/model-chip-menu.ts`](../src/os/model-chip-menu.ts)) to pick, load, unload, and refresh models via the shared `#modelSelect` catalog — used when the legacy topbar is hidden (desktop and non-code apps). The popover includes an **All / Local / Cloud** host filter ([`model-select-picker.ts`](../src/ui/model-select-picker.ts); preference `minnow-model-host-filter`) that filters rows by `data-provider-host` on each `<option>` (derived from provider `baseUrl` in [`format-model-label.ts`](../src/lib/format-model-label.ts) via [`provider-host.ts`](../src/providers/provider-host.ts)). The legacy top-bar picker uses the same filter bar inside `.model-select-popover`. **Menubar notifications bell** (`.mn-os-mb-bell`): opens a fixed popover ([`src/os/notifications-menu.ts`](../src/os/notifications-menu.ts)) listing background app instances with unread counts (`AppInstance.unread` / `msg` from [`noteAgentMessage`](../src/os/instances.ts)); click a row to foreground that app, or **Mark all read** via `clearAllUnread()`. **Menubar clock** (`.mn-os-mb-time`): `startMenubarClock()` in [`menubar.ts`](../src/os/menubar.ts) ticks on minute boundaries and resyncs on `visibilitychange` (replaces the old 30s `setInterval`). **Code app** reparents existing `#appBody` + topbar + `#welcomeView` into `#osAppsLayer`; the legacy `#topbar` is **hidden** in Code (model picker + load/unload via menubar chip; workspace beside the model chip in `.mn-os-mb-right`). `#workspacePathLabel` + `#btnWorkspace` reparent via [`workspace-menubar.ts`](../src/os/workspace-menubar.ts). Mobile chat drawer: `.mn-os-mb-chat-toggle` in the menubar (replaces `#btnSidebarToggle`). When the workspace is still default, `openWelcome()` hides `#appBody` and applies `.welcome-page--os-overlay` so the picker fills the Code app below the menubar only. Settings, Research, Experts, and Benchmark reuse their full-page `<main>` elements inside the app layer. Concierge routing: LLM planner [`concierge-agent.ts`](../src/os/concierge-agent.ts) with keyword fallback [`intent-routing.ts`](../src/os/intent-routing.ts). Router: [`router.ts`](../src/os/router.ts). Boot: `initOsPageBridge()` → `initOsShell()` → `initOsRouter()` in [`main.ts`](../src/main.ts). CSS: `src/styles/minnowos-*.css`. Design prototype: [`documentation/reference/minnowos/`](../reference/minnowos/). Plan: [`documentation/plans/minnowos-redesign.md`](plans/minnowos-redesign.md). Tests: `test/os/*.test.mts` (includes `concierge-agent.test.mts`, `code-launch.test.mts`).

## Theme system (palette tokens)

Eight composed themes on `<html data-theme="{family}-{mode}">` (families: **sage**, **amber**, **cyan**, **coral**; modes: **dark**, **light**). Palette hex/rgba lives only in [`src/styles/tokens.css`](../src/styles/tokens.css); the rest of the app uses **`--mn-*`** CSS variables (22 core tokens per theme plus extended semantics derived with `color-mix`).

| Key | Purpose |
|-----|---------|
| `minnow.theme` | Explicit `ThemeId` (e.g. `sage-dark`) when not following the OS |
| `minnow.theme.followSystem` | `'1'` when mode tracks `prefers-color-scheme` |
| `minnow.theme.family` | Active family while follow-system is on (default **sage**); when follow-system is off, `getStoredFamily()` derives from `minnow.theme` so the settings picker stays in sync |

**Runtime:** [`src/theme.ts`](../src/theme.ts) (`getStoredTheme`, `applyTheme`, `setThemeFamily`, `setThemeMode`, `setFollowSystem`, legacy `light`/`dark`/`system` migration). [`src/ui/theme.ts`](../src/ui/theme.ts) syncs highlight.js dark stylesheet, xterm, **custom color overrides** ([`src/appearance/custom-theme.ts`](../src/appearance/custom-theme.ts)), and **font stacks** ([`src/appearance/fonts.ts`](../src/appearance/fonts.ts)); CodeMirror selection uses `--mn-selection-bg` + `minnowEditorColorSchemeTheme` in [`src/ui/codemirror-theme.ts`](../src/ui/codemirror-theme.ts) (overrides CM6 light `#d9d9d9` when `cm-dark` is unset). **FOUC:** inline script in [`index.html`](../index.html) sets `data-theme` and reads custom `--mn-bg` for `theme-color` when custom colors are enabled; critical CSS uses per-family fallbacks until `tokens.css` loads. `applyTheme()` clears any legacy inline tokens. `initTheme()` adds `theme-ready` and removes `theme-no-transition` after first paint. **Settings → Appearance:** live bench preview strip, 2×2 theme family grid with window mocks, segmented dark/light toolbar, wallpaper grid (16:10), side-by-side font specimens, collapsible custom token editor with per-token color swatch + alpha sliders ([`src/appearance/color-format.ts`](../src/appearance/color-format.ts), [`src/ui/settings-appearance-colors.ts`](../src/ui/settings-appearance-colors.ts)), and `settings-select` dropdown styling ([`src/styles/settings-appearance.css`](../src/styles/settings-appearance.css)); preset families ([`src/ui/settings-theme.ts`](../src/ui/settings-theme.ts)), font presets/uploads, and desktop wallpaper catalog. **Desktop wallpaper:** [`src/os/wallpaper.ts`](../src/os/wallpaper.ts) — underwater (default), minnow fish ([`minnow-fish.ts`](../src/os/wallpaper/minnow-fish.ts) boids canvas tinted with `--mn-accent` via [`minnow-glyph-white.svg`](../public/logos/minnow-glyph-white.svg)), aurora, starfield, grain, mesh, gradient, flat, custom image (IndexedDB via [`src/appearance/asset-store.ts`](../src/appearance/asset-store.ts)); prefs in `minnow.os.*` ([`src/os/desktop-prefs.ts`](../src/os/desktop-prefs.ts)). **Reef iframes:** [`src/chat/reef/theme-forward.ts`](../src/chat/reef/theme-forward.ts) forwards `--mn-*`, radii, fonts; watches `data-theme` and inline `style` for custom overrides. **Tests:** `test/theme.test.mts`, `test/theme-contrast.test.mts`, `test/appearance/*.test.mts`, `test/chat/reef/theme-forward.test.mts`. Plans: [`documentation/plans/token-theme-system.md`](plans/token-theme-system.md), [`documentation/plans/custom-themes-backgrounds.md`](plans/custom-themes-backgrounds.md). Design source: Color Scheme Exploration (PDF/HTML).

| Key | Purpose (custom appearance) |
|-----|-----------------------------|
| `minnow.appearance.customEnabled` | `'1'` when inline `--mn-*` overrides are active |
| `minnow.appearance.customTokens` | JSON map of core token keys → color values |
| `minnow.appearance.fonts` | `{ ui, mono }` preset or upload refs |
| `minnow.os.wallpaper` | Desktop wallpaper mode id |
| `minnow.os.wallpaperImageId` | IndexedDB asset id when mode is `custom` |
| `minnow.os.wallpaperImageFit` | `cover` or `contain` for custom image |

## What it is

Minnow is a **Vite + TypeScript** single-page web client for **LM Studio** and other **OpenAI-compatible local providers** (multi-provider routing via `~/.minnow/providers/`). UI markup lives in [`index.html`](../index.html); styles and logic are modular under [`src/`](../src/). Production output is emitted to [`dist/`](../dist/) via `npm run build`.

**LM Studio tools + attachments:** The default send path runs an OpenAI-style **tool loop** (`sendMessageWithTools` in [`src/tools/loop.ts`](../src/tools/loop.ts)). **59** built-in tools are defined in [`src/tools/definitions.ts`](../src/tools/definitions.ts) (Orchestrate `board_*` trio, bug tracker `bug_*` trio, sub-agent spawn/status, mode handoff, memory, LSP, Impeccable, etc.); **35** are `serverRequired` and execute on the Node side via **`npm start`** (`server.js` → `POST /api/tools`, including **7** CDP `browser_*` tools). **21** are browser-routed (`serverRequired: false`), including web/utility tools, `ask_question`, mode handoff, and sub-agent/board orchestration tools (spawn/status via [`src/tools/sub-agent-executor.ts`](../src/tools/sub-agent-executor.ts) / [`src/tools/board-tools.ts`](../src/tools/board-tools.ts), not raw `POST /api/tools`). File **attachments** (images, text/code, PDF, office documents) use the composer paperclip and multimodal API payloads when a **VLM** model is selected. **`browser_screenshot`** returns inline PNG bubbles via `ToolResultMessage.attachments` and `GET /api/browser/screenshot/:id`.

## Repository layout (Vite)

```
Minnow/
├── index.html              # Vite shell: inline `#app-loader` until `html.app-ready` (set when `main.ts` module runs)
├── server.js               # Dev server: Vite + /api/* (npm start)
├── server/                 # Config, tools, providers, generations, MCP, memory, …
├── package.json
├── tsconfig.json
├── vite.config.ts          # base: './', outDir: dist
├── public/                 # Copied verbatim to dist/ (not bundled)
│   ├── manifest.json       # PWA manifest (start_url: ./)
│   ├── sw.js               # Service worker (cache: minnow-v7)
│   └── icons/              # PWA icons; add-folder.png (**New group**); folder.png (collapsed rail group folders)
├── src/
│   ├── main.ts             # Entry: CSS imports, initTheme(), window handlers, initApp()
│   ├── types.ts            # Messages, ApiMessage, ToolCall, ContentPart
│   ├── constants.ts        # STORAGE_KEY, PRESET_STORAGE_KEY; theme keys re-exported from theme.ts
│   ├── theme.ts            # 8 palette themes (4 families × dark/light), storage, applyTheme, initTheme
│   ├── app-state.ts        # streaming flags, modelCache, abort controllers
│   ├── chat/streaming-state.ts # per-chat streaming helpers (active vs background)
│   ├── chat/context-usage.ts # MIN-13 context budget + breakdown sections
│   ├── agents/             # Sub-agent orchestrator, runner, work agents, UI Designer
│   ├── providers/          # Multi-provider store, fetch-models, resolve
│   ├── state/sessions.ts   # Sessions API + ~/.minnow mirror
│   ├── api/models.ts       # fetchModels (multi-provider), modelCache, resolveModelInfo, composite select keys
│   ├── api/reasoning.ts    # extractReasoningDelta, splitThinkingSegments (LM Studio)
│   ├── api/chat.ts         # SSE/stream helpers, mergeToolCallDelta, sendMessagePlain
│   ├── api/generations.ts  # Backend-owned generations client (POST/subscribe/cancel)
│   ├── chat/
│   │   ├── messaging.ts    # sendMessage → sendMessageWithTools
│   │   ├── generation-resume.ts # boot re-subscribe via currentGenerationId
│   │   ├── modes/          # Step 05: registry, tool-policy
│   │   ├── orchestrate/    # Orchestrate: plan paths, list plans (find_files), send gate
│   │   ├── reef/           # Reef mode: widget iframes + bridge (Phase 2)
│   │   ├── prompts/        # Step 04 composer; `prompts/titles/` for title templates (Step 07)
│   │   └── titles/         # Step 07: schedule, generate, sanitize
│   ├── ui/                 # sidebar, hub.ts (empty-chat landing), theme.ts (Appearance), settings, stats, messages, tool-approval-modal, question-cards-modal, …
│   ├── state/file-panel.ts # file sidebar + viewer prefs
│   ├── lib/
│   │   ├── format-model-label.ts  # Epic A2: humanize model ids; top-bar option HTML + provider suffix
│   │   ├── model-select-key.ts    # Composite #modelSelect value encode/decode (multi-provider)
│   │   ├── context-length.ts      # loaded vs max context from model rows
│   │   └── list-directory-parse.ts
│   ├── skills/               # Step 13: SKILL.md pack, client, builtin-manifest.json
│   ├── tools/
    │   │   ├── definitions.ts      # 59-tool catalog (OpenAI function schemas)
│   │   ├── config.ts           # tools.json sync, permissions, enabled defs
│   │   ├── browser-executor.ts # Web/utility browser handlers (ask_question via client + UI; sub-agent/board via dedicated executors)
│   │   ├── client.ts           # ping, executeTool router, approval gate, ask_question → UI queue
│   │   ├── permission-gate.ts  # modal + path policy before tool runs
│   │   ├── approval-queue.ts   # serialized approval requests
│   │   ├── ask-question-queue.ts
│   │   ├── ask-question-types.ts
│   │   ├── tool-approval-types.ts
│   │   ├── describe-invocation.ts
│   │   ├── path-args.ts
│   │   ├── workspace-path-guard.ts
│   │   └── loop.ts             # buildApiMessages, sendMessageWithTools
│   ├── attachments/
│   │   ├── types.ts
│   │   ├── store.ts        # pending list, preview chips, initAttachments()
│   │   └── reader.ts       # processFile — image, text, PDF, office
│   ├── markdown/renderer.ts
│   └── styles/
│       ├── fonts.css tokens.css global.css topbar.css sidebar.css
│       ├── messages.css input.css settings.css stats.css file-panel.css tool-approval.css question-cards.css responsive.css
│       └── thoughts.css    # live thought bubbles + Thoughts panel
├── dist/                   # Production build (gitignored)
├── build/icon.ico          # Windows app icon (≥256×256; used by electron-builder)
├── electron/               # Desktop shell (MIN-110+): main.ts, preload.ts → electron/dist/
├── release/                # electron-builder output (gitignored; NSIS installer + win-unpacked)
└── documentation/
    └── archive/          # Historical only: migrate-extract snapshots (_extracted-app.js, _extracted-body.html)
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
  .key                     # AES-256 secret-box key (32 random bytes, base64, 0o600; never in git)
  config.json              # schemaVersion, activeProviderId, toolSecurity.filesystemAccess, …
  sessions/state.json      # full SessionState blob (all chats — canonical)
  tools.json               # ToolConfig (permissions, mirrored enabled; legacy webSearchProvider + keys)
  search.json              # SearchConfig (provider, SearXNG URL, keys, fallback chain, resultCount)
  servers.json             # ManagedServersConfig (per-server enabled, autoStart, port; Phase 0: searxng)
  research.json            # ResearchConfig (dedicated model, engine limits for Deep Research)
  system-prompt.json       # { presetId, text }
  rules.json               # global user rules { version, enabled, text } (Feature 24)
  memory/                  # scaffold (Step 16)
  providers/               # one dir per provider (Step 03)
    lm-studio-local/
      profile.json         # label, baseUrl, apiKind, paths, optional constrainedToolCalls override
      secrets.json         # encrypted envelope (AES-256-GCM via secret-box; 0o600 on Unix; never in git)
      capabilities.json    # per-model matrix (MIN-48) + structured-output flags (#10)
  mcp/                     # scaffold (Step 18)
  lsp/                     # scaffold (Step 17)
  prompt-configs/          # custom composer part presets (Step 04)
  profiles/                # setup bundles: prompt + agents + tools (#13 MIN-49)
  profiles/_rollback/      # optional pre-activate snapshots
  prompts/                 # user prompt overrides (Step 04; work-agents/ subdir Step 08)
  work-agents.json         # per-agent provider/model/disabled overrides (Step 08)
  agent-packs/             # drop-in agent pack folders (Feature #16)
  agent-packs.json         # per-pack enabled flags (Feature #16)
  sub-agents.json          # sub-agent types, concurrency, tool allow/deny (Step 09)
  bugs/state.json          # global bug tracker (MIN-16)
  logs/sub-agents/         # optional per-run debug transcripts (Step 09)
  logs/servers/            # managed local server stdout/stderr (<id>.log)
  logs/terminal/           # full stdout/stderr per runId (Step 10)
  servers/                 # managed installs: <id>/venv, settings.yml, meta.json; shared python/
  screenshots/             # browser_screenshot PNGs (Step 12)
  skills/                  # user skills (Step 13)
  skills.json              # per-skill enabled flags (Step 20 settings)
  reef/
    widgets/               # synced built-in templates (read)
    modules/               # user-saved custom widgets (read/write after ask_question)
  backups/                 # scaffold
  benchmarks/              # Bench run JSON (`<run-id>.json`, last 20 listed via API)
  evals/
    config.json            # maxConcurrency, grader provider/model, transcript flags
    packs/<id>/pack.json   # user task packs (override built-in by id)
    runs/<suiteRunId>/     # manifest.json, leaderboard.json, cells/<task>__<model>.json
```

### Local eval harness (Feature 21 / MIN-57)

User-defined **task packs** (prompt, tool allow/deny, rubric) run across multiple **provider/model targets** with isolated headless tool loops (no parent chat pollution). **Settings → Evals** (`#/settings/evals`): Packs, Run, Results (leaderboard + JSON export). Requires **`npm start`** for persistence APIs.

| Piece | Location |
|-------|----------|
| Types, pack schema, loader merge | `src/evals/types.ts`, `pack-schema.ts`, `pack-loader.ts` |
| Runner + grader + scheduler | `src/evals/runner.ts`, `grader.ts`, `suite-scheduler.ts` |
| Leaderboard aggregation | `src/evals/leaderboard.ts` |
| Built-in starter pack | `src/evals/packs/coding-smoke/pack.json` |
| REST client | `src/evals/eval-api.ts` |
| Server API + disk store | `server/evals/middleware.js`, `scan.js`, `run-store.js`, `pack-store.js` |
| UI | `src/ui/settings-evals.ts`, `src/styles/settings-evals.css` |
| Tests | `npm run test:evals` → `test/evals/**` |

### Benchmark (Bench)

Unified **Benchmarking** app at `#/benchmark` / `#/app/bench` (OS **Benchmarking** app). Tabbed UI: **Overview** (multi-model comparison grid with animated tok/s and quality bars, MinnowOS-style), **Charts** (flat sections: run toolbar, summary strip with deltas, per-run comparison, test-family matrix, ranked weak spots, score-over-runs trend with sparse axis labels, all-time best), **Tests** (integration + standard + custom catalog, prompt drawer, pack editor, full-tier JSON import), **Run** (model roster, integration suite toggles, standard mini/full packs, linear run flow). **`header.topbar` stays visible** while open.

**Multi-model campaigns:** `runBenchmarkCampaign()` (`src/benchmark/campaign-runner.ts`) runs integration suites per target via `matrix-scheduler.ts` (concurrency from eval config). Model **roster** in `sessionStorage` (`minnow.benchmark.roster`); Run tab adds models via provider/model dropdowns (`roster-picker.ts`, same catalog as Settings) plus **Add active** from the top-bar model. **Standard benchmarks** (tiered): bundled mini packs in `src/benchmark/standard/packs/` and bundled full packs in `src/benchmark/standard/packs/full/` (MMLU ~14k, GSM8K ~8.8k, ARC ~1.2k, HumanEval 164, TruthfulQA ~817). Full tier loads lazily via `preloadBundledFullPacks()`; user imports via Tests tab still override bundled full. Regenerate with `npm run build:benchmark-packs`. Campaign persistence: `GET/POST /api/benchmarks/campaigns`, `GET /api/benchmarks/models` → `~/.minnow/benchmarks/campaigns/`; legacy single-run JSON at `~/.minnow/benchmarks/*.json` unchanged.

**Settings → Evals** redirects to `#/app/bench/tests` (eval APIs under `/api/evals/*` unchanged; custom packs still in `~/.minnow/evals/packs/`).

**Run tab** is a distilled linear flow: roster → **run order** (parallel / sequential, when roster has 2+ models) → standard packs (inline tier) → presets + integration suites + Run/Stop, then progress (while running), **model cards** (multi-model: per-target progress; click a card to view that model's tests), results strip (after completion), history, and dense test rows. Session resume (`active-run-session.ts`) uses legacy single-model path when resuming. Campaign phase UI lives on **Overview** (progress bar), not a duplicate stepper on Run.

| Piece | Location |
|-------|----------|
| Runner + suites | `src/benchmark/` (`runner.ts`, `llm-driver.ts`, `suites/*`); **Coding** runnable probes (`suites/coding.ts` + `coding-code.ts` / `coding-run.ts`) ask for a fenced Node script, extract it, run via `run_javascript` when `npm start` is up, and grade **stdout** (FizzBuzz, reverse, fib, JSON, regex, bug fix); SQL / type explanation / judge cases stay text-only. **Skills** probes in `suites/skill-probes.ts` (per-skill prompt + `regex` / `tool` / `tool-or-regex` pass; `ask-user` → `ask_question`; skips when SKILL body missing or server required). Suite headers use `computeSuiteResultStats` in `scoring.ts`: `passed/total · N%` where **N%** is pass rate among non-skipped tests (same as `passed / (passed + failed)`); skipped tests count in `total` but not in the percentage. Live UI updates the header on each `test-done`. |
| Per-test descriptions (POLISH-004 / MIN-94) | `src/benchmark/test-catalog.ts` — `resolveTestDescription()` + `listExpectedTestsForSuites()`; static copy for capability/speed/coding, templates for `tool-*` and `skill-*`. **Tests** tab and transcript drawer show full descriptions; Run tab rows are title + meta only. `SUITE_INTROS` remain in catalog for Tests coverage. Plan: [`documentation/plans/Bug Fixes/POLISH-004-benchmark-test-descriptions.md`](plans/Bug%20Fixes/POLISH-004-benchmark-test-descriptions.md). |
| UI | `src/ui/benchmark-page.ts`, `src/ui/benchmark/*` (tabs, overview, charts, tests, `model-run-cards.ts`, **`copy.ts`** user-facing labels), `src/styles/benchmark-page.css` — tabs only (OS menubar supplies app chrome); underline tabs aligned with Research; `--mn-*` tokens; `benchmark-mono` / `benchmark-muted` utilities; Overview bench-grid; roster; parallel/sequential schedule; multi-model progress cards; standard toggles; Run tab: flat sections, **test-types grid** (Academic pills + tier select + Minnow pills + Run on aligned rows via `display:contents`), results strip, history, dense test rows. **Run** accepts Academic-only, Minnow-only, or mixed selections (`hasSelectedBenchmarkWork`); Academic cells render live via `cell-done` and summary from campaign aggregates when no integration run exists. Copy uses **run** (not campaign), **Minnow tests** (integration suites), **Academic benchmarks** (MMLU/ARC/etc.). |
| Campaign engine | `src/benchmark/campaign-runner.ts`, `campaign-types.ts`, `campaign-persistence.ts`, `matrix-scheduler.ts`, `aggregates.ts`, `roster.ts` |
| Standard LLM packs | `src/benchmark/standard/` (`packs/*.json`, `harnesses/` per-dataset scorers, `runner.ts`, `catalog.ts`); import script `scripts/fetch-benchmark-dataset.mjs` |
| Persistence | `GET/POST/DELETE /api/benchmarks`, `GET /api/benchmarks/:id` (legacy runs); `GET/POST /api/benchmarks/campaigns`, `GET /api/benchmarks/campaigns/:id`, `GET /api/benchmarks/models`, `GET/POST /api/benchmarks/datasets` → `~/.minnow/benchmarks/`; `localStorage` fallback for campaigns (`minnow.benchmarks.campaigns`, cap 10) and runs (`minnow.benchmarks.history`, cap 5) |
| History browse | `#benchmarkHistorySelect` loads a saved run into the main panel (summary + suite cards). While a run is **in progress**, browsing history does not overwrite `lastRun` or `liveRunDrawerMeta`; progress keeps updating in memory and the **Current run** button (`#btnBenchmarkBackToCurrent`) plus a **Current run (in progress)** history option restore the live panel. |
| Background + reload | Leaving `#/benchmark` (`closeBenchmark`) **does not** call `stopRun()` — the run keeps going and `openBenchmark()` / `syncBenchmarkPageOnOpen()` restores the live panel. **`sessionStorage`** (`minnow.benchmark.activeRun` via `active-run-session.ts`) checkpoints after each suite/test; on app init `tryResumeBenchmarkFromSession()` continues remaining suites (suite-level skip via `RunBenchmarkOptions.resume`). **Stop** or run completion clears the session. Mid-suite reload may re-run the interrupted suite. |
| Transcript drill-down (POLISH-005) | Click any test card (finished, **running**, or **stopped**) → `benchmark-transcript-drawer.ts` (read-only messages/tools; reuses `transcript-view.ts`). Works **during** a live run and after **Stop** (not only on completed runs): `liveTestResults` accumulates each `test-done` payload; cancelled runs commit a partial `lastRun` for summary + lookup. **Academic** cards (`data-cell-id`, `liveStandardCells`) open the same drawer with pack label + one-shot transcript from `standard/runner.ts` (`BenchmarkCellResult.transcript`). Running/stopped probes without a transcript show a targeted empty state. User multimodal turns render full prompt text plus inline images via `api/message-content.ts`; assistant rows use the same text normalizer (string or structured `content` parts). `TestResult.transcript` / `transcriptMeta` captured via `buildTestResult` in suites; `prepareBenchmarkRunForPersistence` trims oversized JSON before POST. Old runs without `transcript` show empty-state + `details`. |
| Headless smoke | `node scripts/benchmark-headless.mjs http://localhost:5173` |
| Tests | `npm run test:benchmark` |
| Cancel / Stop | Campaign cancel may persist partial results when `persistPartialOnCancel` is set. Legacy single-run cancel: `run-cancelled`, partial UI commit on Stop. Combined **Run** → **Stop** while active. |

Completions use `postChatCompletions` with `persist: false` (no chat session pollution). **Speed headline tok/s** uses `finalizeResponseMeta` (same `buildClientStats` + `reconcileCompletionStats` as chat). Benchmark TTFT is the first SSE `choices` chunk; `resolveDecodeSeconds` falls back to full stream wall time when a late token burst would imply implausible tok/s (same correction as inflated chat stats). **`llm-driver.ts`** streams via `createSseEventBuffer` / `feedSseEventBuffer` (same `\n\n` framing as chat). **`runToolLoop`** returns `preserveLastToolCalls` output so Tools suite scoring still sees the tool batch from the call turn after a follow-up text turn (without this, every probe reported `no matching tool call`). **`sse-parse.ts`** emits **every** concatenated JSON object in one `data:` line (llmster / LM Studio glued chunks — not only the first). **`stream-text.ts`** accumulates prose via `BenchmarkStreamTextAccumulator` + `StreamingContentAccumulator` (indexed/cumulative `content` parts); when prose stays empty it falls back to `BenchmarkStreamReasoningAccumulator` + `resolveBenchmarkCompletionText` (reasoning-only models on longer prompts). **`completion-messages.ts`** injects a direct-reply system prompt; benchmark completions default to **`BENCHMARK_MAX_TOKENS` (131072)** in `llm-driver.ts` unless a caller overrides `maxTokens` on `runOneShot` / `runToolLoop` (matches the Settings sampler ceiling). **`OneShotResult`** exposes separate `contentText` / `reasoningText`; Academic MCQ scoring prefers main `content` but falls back to reasoning when `finishReason === 'length'` (truncated thinking runs); `harnesses/mcq.ts` `normalizeLetter` takes the final/conclusion letter (not the first `A) …` option mention). Retries once when main content stayed empty (even if reasoning filled merged `text`); **`tryBenchmarkNonStreamingFallback`** runs before and after that retry. `completionTextFromFallback` prefers `content` then reasoning. Transcript drill-down (`transcript-view.ts`) also reads `reasoning` / `reasoning_content` on assistant rows. **`cap-multimodal`** uses inline fish photo fixture (`src/benchmark/fixtures/multimodal-probe-fish.png` → `multimodal-probe-image.ts` via `scripts/embed-multimodal-probe-image.mjs`). **`cap-stream`** / **`cap-multimodal`** use `streamCompletionTestDetails` (up to 320-char preview on pass). Distinct from planned Feature 21 eval harness (`~/.minnow/evals/`, multi-model matrix). Plan: [`documentation/plans/benchmark-system-implementation.md`](plans/benchmark-system-implementation.md).

**Standard benchmark harnesses** (`src/benchmark/standard/harnesses/`): `scoreStandardItemHarness()` routes by `pack.scoring` — **MCQ** letter match (MMLU, ARC, TruthfulQA full), **GSM8K** `####` numeric extraction with last-number fallback, **regex** proxy for TruthfulQA mini (not the paper's generative metric), **HumanEval** Python `check(entry_point)` via `run_python` (`coding-run-python.ts`, requires `npm start`). Mini HumanEval pack is a 5-item Python subset of the full 164-task pack; regenerate with `npm run build:benchmark-packs`.

**Integration suites (five):** **Quick** = capability + speed; **Full** = capability, speed, tools, skills, coding. The former **Modes** integration suite was removed; `modeMatrixPassed` on saved runs stays `0` for backward-compatible JSON.

**Benchmark file workspace:** File-tool probes run only under `~/.minnow/benchmark-workspace` (not the Code workspace or `~/.minnow/benchmarks/` run JSON). Server: `server/benchmark-workspace/` (`ensureBenchmarkWorkspace` on bootstrap, `GET /api/benchmark-workspace`); allowlisted as a third `workspaceRoot` beside Code + chats (`server/chats-workspace/paths.js`). Client: `src/lib/benchmark-workspace.ts`, `src/benchmark/benchmark-workspace.ts`. **Tools** suite runs file-category tools first in order `save_file` → `read_file` (content verify `MINNOW_BENCH_MARKER`) → mutate probes on `.minnow-bench/fixture.txt` → `delete_path` (`src/benchmark/suites/file-tool-fixtures.ts`); programmatic prelude/finally clears stale `.minnow-bench/` on aborted runs. Git tools still use the default Code workspace.

**Tools suite sandbox (BUG-006):** All benchmark tool execution routes through `executeBenchmarkTool` (`src/benchmark/execute-tool-sandbox.ts`) with `benchmarkAutonomous: true` so permission **Ask** and path-ack modals never block runs; optional `workspaceRoot` is forwarded to `POST /api/tools`. Emit-only / UI tools (`ask_question`, `propose_mode_switch`, `request_browser_origin_access`, spawn/board tools) return immediate stub JSON. Plan: [`documentation/plans/Bug Fixes/BUG-006-benchmark-tools-suite-hang.md`](plans/Bug%20Fixes/BUG-006-benchmark-tools-suite-hang.md) · Linear [MIN-67](https://linear.app/minnowai/issue/MIN-67/bug-006-benchmark-stuck-on-tools-suite).

**Built-in prompts** ship under `src/chat/prompts/` (Step 04). **Built-in skills** under `src/skills/` (Step 13). User overrides use `~/.minnow/prompts/` and `~/.minnow/skills/`.

### Skills framework (Step 13)

Cursor-compatible **SKILL.md** skills: YAML front matter + markdown body. Invoked from the composer with **`/`** (slash picker) or by typing `/<skill-id>`.

| Root | Path | Override |
|------|------|----------|
| Built-in | `src/skills/<id>/SKILL.md` | Shipped in repo |
| User | `~/.minnow/skills/<id>/SKILL.md` | Same `name` replaces built-in |

**Merge:** user wins on duplicate `name`; dirs starting with `_` are excluded from the picker (`_example` is author docs only). **Send path:** `parseSlashCommand()` → `resolveActiveSkill()` → `skillBody` in `composeSystemPrompt()` (`skill` part). For `/impeccable <command>`, `augmentImpeccableSkillBody()` in `src/skills/impeccable-client.ts` appends the matching `reference/<command>.md` from `GET /api/skills/impeccable/reference/:command` before UI Designer augmentation (`src/tools/loop.ts`). History stores user text without the raw slash line; footer `[skill: <id>]` when a skill was used.

| Concern | Location |
|---------|----------|
| Types, merge, slash parse | `src/skills/` (`loader.ts`, `parse-slash.ts`, `parse-frontmatter.ts`) |
| Catalog client + offline manifest | `src/skills/client.ts`, `src/skills/builtin-manifest.json` (from `npm run prebuild`) |
| Enable/disable + persistence | `src/skills/config.ts`, `~/.minnow/skills.json`, `GET/PUT /api/config/skills` |
| Settings UI (toggles, editor, add custom) | `src/ui/settings-skills.ts`, `src/skills/skill-settings-api.ts` |
| Custom skill template | `src/skills/_template/SKILL.md` (copied on `POST /api/skills`) |
| Slash picker UI | `src/ui/skill-picker.ts`, `src/styles/skill-picker.css` (row hover/`--active`: `--surface-elevated` + nested `--elevated-fg` on label, id, desc, badge — same pattern as chat sidebar rows) |
| Server scan + API | `server/skills/scan.js`, `server/skills/middleware.js`, `server/skills/user-skills.js` |

**API** (same CORS as `/api/tools`; requires `npm start` for user skills):

| Route | Response |
|-------|----------|
| `GET /api/skills/ping` | `{ ok: true }` |
| `GET /api/skills` | `{ skills: SkillListItem[] }` (no body) |
| `GET /api/skills/:id` | `{ skill: SkillDetail }` or 404 (`raw` = full SKILL.md) |
| `GET /api/skills/impeccable/reference/:command` | `{ content }` — vendored `reference/<command>.md` for client auto-injection |
| `POST /api/skills` | Create user skill from `_template/SKILL.md` (`{ id, label? }`) |
| `PUT /api/skills/:id` | Save SKILL.md (`{ content }`; user override path) |
| `GET/PUT /api/config/skills` | `{ enabled: Record<string, boolean>, caveman?: { pinByDefault, defaultIntensity } }` |

**Built-in ids (v1):** `git-commit`, `code-review`, `write-tests`, `explain-code`, `debug-error`, `docs-update`, `refactor-safe`, `security-review`, `browser-automation`, `ask-user` (Feature 31), `impeccable` (Step 14), `ui-designer` (Step 15), `caveman`.

### Skills → Caveman built-in

Ultra-compressed reply mode from [juliusbrussee/caveman](https://github.com/JuliusBrussee/caveman) (MIT). Invoke with **`/caveman`** or **`/caveman <intensity>`** (`lite`, `full`, `ultra`, `wenyan-lite`, `wenyan-full`, `wenyan-ultra`). Stays pinned per chat until dismiss (composer chip), **`stop caveman`**, or **`normal mode`**.

| Concern | Location |
|---------|----------|
| Built-in skill | `src/skills/caveman/SKILL.md` (`name: caveman` → `/caveman`) |
| Upstream snapshot | `src/skills/caveman/SKILL.upstream.md` (optional; `npm run caveman:sync`) |
| Client augment | `src/skills/caveman-client.ts` — appends `## Active intensity` in `loop.ts` |
| Sticky pin resolver | `src/skills/pinned-skill.ts` — slash vs `chat.pinnedSkill`, stop phrases |
| Session field | `Chat.pinnedSkill` in `src/types.ts`, persisted in `src/state/sessions.ts` |
| Composer chip | `src/ui/composer-pinned-skill.ts` — intensity select + unpin |
| Settings defaults | Skills card → pin on new chats + default intensity (`src/skills/config.ts`, `~/.minnow/skills.json`) |
| Sync script | `scripts/sync-caveman-skill.mjs` — `npm run caveman:sync` (manual; not postinstall) |

**Tests:** `npm run test:skills` (includes `test/skills/caveman-client.test.mts`, `test/skills/pinned-skill.test.mts`). Benchmark probe: `caveman` in `src/benchmark/suites/skill-probes.ts`. Plan: [`documentation/plans/add-caveman-skill.md`](plans/add-caveman-skill.md).

### Skills → Impeccable built-in (Step 14)

| Concern | Location |
|---------|----------|
| Built-in skill | `src/skills/impeccable/SKILL.md` (`name: impeccable` → `/impeccable`) |
| Upstream snapshot | `src/skills/impeccable/SKILL.upstream.md` (auto-synced; do not edit) |
| Command references | `src/skills/impeccable/reference/*.md` |
| Harness routing | `server/impeccable/command-routing.js` (`HARNESS_COMMANDS`, `parseImpeccableSubcommand`, …) |
| Reference API | `GET /api/skills/impeccable/reference/:command` → `server/impeccable/reference-handler.js` (64k cap) |
| Client augment (slash) | `src/skills/impeccable-client.ts` — fetches reference into skill body in `loop.ts` |
| Scripts | `src/skills/impeccable/scripts/` (`load-context.mjs`, `minnow-context.mjs`, …) |
| Postinstall / sync | `scripts/sync-impeccable-skill.mjs` (vendors from `.agents/skills/impeccable` after `npx impeccable skills install -y`) |
| npm scripts | `impeccable:sync`, `impeccable:update`, `impeccable:detect` |
| Design context (read-only for skill) | `PRODUCT.md`, `DESIGN.md`, optional `.impeccable/design.json` (`load_impeccable_context` returns `hasDesignJson`; soft success when sidecar absent — [BUG-012 plan](plans/Bug%20Fixes/BUG-012-impeccable-design-json.md)) |

**Harness vs CLI:** Sub-commands such as `teach`, `audit`, and `shape` are harness workflows — `/impeccable <cmd>` injects `reference/<cmd>.md` (see `## Active Impeccable command` in the augmented skill body). **`/impeccable craft`** also injects **`shape.md`** as `## Prerequisite workflow: shape` (`HARNESS_PREREQUISITE_COMMANDS` in `impeccable-client.ts`). The upstream npm CLI only exposes `detect` and `skills`; do not run `npx impeccable teach`. **`run_impeccable`** accepts only **`detect`** (CLI) and **`live`** (bundled script). Mistaken harness calls return guidance plus the full reference markdown (`harnessCommandGuidanceWithReference`).

`npm install` runs `postinstall` sync (non-strict by default; set `IMPECCABLE_SYNC_STRICT=1` in CI). Post-sync patches: `scripts/impeccable-preserves/apply-minnow-patches.mjs` (`{{command_prefix}}` → `/`, craft Step 1). Override built-in: `~/.minnow/skills/impeccable/SKILL.md` (user wins on duplicate `name`).

**Tests:** `npm run test:skills-impeccable`, `npm run test:impeccable`. Plan: [`documentation/plans/fix-impeccable-harness-routing.md`](plans/fix-impeccable-harness-routing.md). Verification: [`documentation/plans/verification/step-14.md`](plans/verification/step-14.md).

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
| Impeccable context tool | `load_impeccable_context` → `server/impeccable/load-impeccable-context.js` (reads `PRODUCT.md` / `DESIGN.md` / optional sidecar; `hasDesignJson: false` + setup hint when `.impeccable/design.json` missing) |
| Impeccable CLI/scripts tool | `run_impeccable` → `server/impeccable/run-impeccable.js` (`detect`, `live` only; harness commands use `/impeccable`) |

**Modes:** `plan` (default, no file mutations) or `implement` (UI paths only). Composer hint after picking `/ui-designer`.

**Tests:** `npm run test:ui-designer`; `node scripts/step15-smoke.mjs`. Verification: [`documentation/plans/verification/step-15.md`](plans/verification/step-15.md).

### Memory system (Step 16)

Persistent notes under `~/.minnow/memory/` (`index.json` + `entries/<uuid>.md`). Injected via composer `memory` part (`src/chat/prompts/memory/*.md` wraps `{{memory}}` around the retrieved block) when enabled; retrieved blocks are **fenced as untrusted** (`source="memory"`) in `server/memory/retrieve.js`. **Retrieve fallback:** keyword queries with no token matches still inject recent/pinned entries (`server/memory/retrieve.js`). **Sub-agents:** `buildSubAgentSystemPrompt` in [`src/agents/sub-agent-prompt.ts`](../src/agents/sub-agent-prompt.ts) injects the same memory block (task text as query) and `save_memory` guidance when the tool is allowed. **Save guidance:** full/lite base prompts + memory templates tell the model to call `save_memory` for explicit “remember this” requests and stable preferences/facts (not secrets or one-off state).

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

Language servers run in Node on `npm start`. Defaults in `src/lsp/defaults.json`; user overrides `~/.minnow/lsp.json`. **TypeScript/JavaScript** uses bundled `typescript-language-server` + `typescript` from Minnow’s `node_modules` (`$minnow:typescript-language-server` in defaults; resolved in `server/lsp/resolve-command.js`) with `initializationOptions.tsserver.fallbackPath` pointing at bundled `tsserver.js` (TLS v4+ — no `--tsserver-path` CLI). **Phase 3 language bundles:** lightweight npm servers (pyright, yaml, bash, dockerfile, graphql, vscode-html/css) ship in app `package.json` (`prebundled: true` in `src/lsp/bundles.json`); heavy binaries install on demand to `~/.minnow/lsp-servers` via Settings → **Language bundles** (`server/lsp/bundle-installer.js` runs `npm` with `shell: true` on Windows — `npm.cmd` + `shell: false` throws `spawn EINVAL`). Resolver order: workspace `node_modules` → app bundle → managed dir → PATH (`server/lsp/paths.js`). **vscode-langservers-extracted v4** entrypoints live under `lib/*-language-server/node/*ServerMain.js` (`resolveVscodeLangserversExtractedEntry` in `server/lsp/resolve-command.js` falls back to legacy v3 flat `lib/*ServerMain.js` paths). APIs: `GET/POST /api/lsp/bundles*`. Plan: [`documentation/plans/editor/phase-3-language-bundles.md`](plans/editor/phase-3-language-bundles.md). File URIs use `pathToFileURL` for correct Windows `file:///C:/…` roots. Spawn **cwd** and `rootUri` follow **`getWorkspaceRoot()`**; switching workspace calls `shutdownAllLsp()` so servers restart on the new root.

| Tool | Description |
|------|-------------|
| `get_lsp_diagnostics` | Formatted diagnostics for a relative path |
| `list_lsp_servers` | Configured servers + running state |

**API:** `/api/lsp/status`, `/api/lsp/diagnostics`, `POST /api/lsp/notify` (`{ path, event: open|change|close, text? }` → didOpen/didChange/didClose), `POST /api/lsp/completion` (`{ path, line, character }` → `{ items: [{ label, insertText, textEditRange?, textEditInsertRange?, textEditReplaceRange?, kind?, … }] }` — server normalizes LSP `textEdit` / `InsertReplaceEdit`; client picks insert vs replace span), `POST /api/lsp/hover` → `{ hover: { contents } }` (AI hover client reads `hover.contents`), `POST /api/lsp/definition`, `POST /api/lsp/signature`, `POST /api/lsp/diagnostics-structured` (`{ path, text? }` — optional `text` is the CM6 buffer so unsaved edits are not overwritten by disk; raw `{ diagnostics: [{ message, severity, range, … }] }` for CM6 lint), `POST /api/lsp/resolve` (`completionItem/resolve`), `GET/PUT /api/config/lsp` (PUT supports `removeLspIds` for custom server removal). **`$minnow:` package resolution** (`server/lsp/resolve-command.js`): workspace `node_modules` → app bundle → `~/.minnow/lsp-servers` → PATH. **File viewer (Phase 2 LSP UX):** When LSP is enabled and `npm start` is up, `src/ui/file-editor-extensions.ts` + `src/ui/lsp-editor/*` provide autocomplete (snippets + resolve `additionalTextEdits`), diagnostics squiggles + lint gutter (`@codemirror/lint`), hover tooltips, signature help on `(`/`,`, go-to-definition (**F12** / Mod-click → `openFileInViewer`); header shows error/warning counts. Client: `src/lsp/completion-client.ts`; server: `server/lsp/manager.js` (`getLspHover`, `getLspDefinition`, `getLspSignatureHelp`, `getLspStructuredDiagnostics`, `resolveLspCompletion`). Plan: [`documentation/plans/editor/phase-2-lsp-ux.md`](plans/editor/phase-2-lsp-ux.md). Open/edit/save debounce document sync (`src/ui/file-viewer.ts`). Autocomplete/tooltip chrome uses Minnow tokens in `src/ui/codemirror-theme.ts` (`EditorView.theme`) plus `src/styles/file-panel.css` overrides (replaces CodeMirror’s default light popup). **Tab** accepts the dropdown (`defaultKeymap: false`; `file-editor-keymap.ts`); **Enter** inserts a newline. AI ghost text still wins **Tab** when visible (`file-editor-ai-extensions.ts`). **Catalog:** `src/lsp/defaults.json` lists only Minnow-shipped npm LSPs (typescript, pyright, html, css, graphql, yaml, bash, dockerfile) plus bundle-backed binaries (rust-analyzer, gopls, clangd, lua-ls, terraform-ls, zls); optional ecosystem tools are not pre-registered — add them via **Custom server** or install a bundle in Settings. User overrides in `~/.minnow/lsp.json`. **Settings:** `#/settings/lsp` — grouped page in `src/ui/lsp-settings.ts` (`#settingsLspBody`, `settings-section--lsp` max ~56rem): **Status** toolbar (master enable + mono counts), **Language servers** by bundle category (Web, Python, Systems, Scripting, Other from `bundles.json`, plus **Core** for app-shipped entries like TypeScript, **Custom** for user `lsp.json` rows). Each catalog row has **Installed** and **Enabled** toggles (install/uninstall optional binaries; enable when installed), Running/Idle/Not installed pills, and inline install progress. **Custom server** (details + stdio form). Cross-links to Editor/Tools/MCP. Requires `npm start`; persists `~/.minnow/lsp.json` through `src/lsp/config-client.ts` (`GET`/`PUT` `/api/config/lsp`; config middleware must pass this path to `createLspMiddleware`, not 404). Test-only `fake` server is hidden in UI. **`server/lsp/manager.js`** + **`server/lsp/resolve-command.js`** spawn bundled or custom stdio servers; `ENOENT` hints to run `npm install` in the Minnow app folder. **Tests:** `npm run test:lsp` (fake stdio server, bundled TLS resolve, workspace root, spawn ENOENT, completion API).

**Editor fundamentals (Phase 1):** File viewer CodeMirror baseline in `src/ui/editor-core-extensions.ts` (history, `Prec.low` default/search/fold keymaps, bracket match/close, folding gutter, find/replace panel `top: true` via custom `MinnowSearchPanel` in `src/ui/editor-search-panel.ts` + `file-panel.css`, multi-cursor, active line). Languages via `@codemirror/language-data` (`src/ui/editor-language.ts`). Display prefs in `config.json` → `editorSettings` (`src/config/editor-settings.ts`: font size, tab size, word wrap, whitespace). **Settings → Editor → Code editing** (`src/ui/editor-fundamentals-settings.ts`). Keymap stack: `Prec.highest` AI ghost Tab/Esc, `Prec.high` Minnow Tab (LSP accept/indent) + Esc blur, then core defaults. Plan: [`documentation/plans/editor/phase-1-editor-fundamentals.md`](plans/editor/phase-1-editor-fundamentals.md). **Tests:** `test/ui/editor-language.test.mts`, `test/ui/editor-core-extensions.test.mts`, `test/config/editor-settings-meta.test.js`.

**Editor AI inline completion (POLISH-006 / MIN-104, Phase 4 v2):** Optional Copilot-style ghost text after idle debounce (`config.json` → `editorAiCompletion`, default **off**). Uses `createGeneration` + `subscribeToGeneration` with `persist: false` (parsed SSE chunks; reasoning-channel fallback for models that omit `delta.content`). Outbound body always merges **thinking off** via `thinkingToCompletionBody` (ignores chat/global thinking toggles). **Phase 4:** import-line + optional LSP hover context in chat prompts (`src/lsp/hover-client.ts`, graceful 404); Qwen Coder native FIM (`<|fim_prefix|>` … `<|fim_middle|>`) with chat fallback; in-memory completion cache keyed by `hash(filePath, prefixTail, suffixHead)` (`src/ui/editor-ai-completion-cache.ts`); **Tab** full accept, **Ctrl/Cmd+→** partial accept (word/line), **Esc** dismiss (`Prec.highest`). **Quick Edit (Mod-K):** `src/ui/editor-quick-edit/` — selection panel, streams via `/api/generations`, inline diff + Accept/Reject/Retry; styles in `src/styles/editor-quick-edit.css`. **Context menu:** right-click selection → **Add selection to chat** (fenced `` ```lang path:lines ``) or **Quick edit**; markdown preview toggles preserved when no selection. Modules: `src/config/editor-ai-completion.ts` (`maxTokens` default 256, toggles `includeImportContext`, `includeLspHover`, `useNativeFim`, `enableCompletionCache`), `src/ui/editor-ai-completion-prompt.ts`, `src/ui/editor-ai-completion-client.ts`, `src/ui/file-editor-ai-extensions.ts`. Mounted only for editable buffers. **Settings:** `#/settings/editor` — Ghost text + Prompt context toggles; `src/ui/editor-ai-settings.ts`. Plan: [`documentation/plans/editor/phase-4-ai-features.md`](plans/editor/phase-4-ai-features.md). **Tests:** `test/ui/editor-ai-completion-prompt.test.mts`, `test/ui/file-editor-ai-keymap.test.mts`.

### Managed local servers (SearXNG)

Optional **managed SearXNG** runs on loopback for Deep Research and `web_search_searxng` without Docker. Config: `servers.json` (`enabled`, `autoStart`, `port`; default port **8899**). Install layout under `~/.minnow/servers/` (`server/servers/paths.js`): per-server venv + `settings.yml`, shared **python-build-standalone** 3.12 (`20250205`). Provisioner installs upstream SearXNG from a pinned GitHub zip (`server/servers/searxng.js`, ref `e964708c0` — not PyPI/git+pip, which breaks on Windows). On **Windows**, `patchValkeydbForWindows()` patches `searx/valkeydb.py` (upstream imports Unix-only `pwd` at module load; limiter stays off in generated `settings.yml`). Patches apply at install, on `getSpawnSpec`, and repair existing installs on start. Standalone Python must resolve `runtime/python.exe` (not `Lib/venv` template stubs). **`npm start`** calls `initServersApi()` → `autoStartEnabledServers()` (starts only when installed + enabled + autoStart; never auto-installs). **`getManagedSearxngUrl()`** returns `http://127.0.0.1:<port>` when SearXNG is enabled and healthy.

| API | Purpose |
|-----|---------|
| `GET /api/servers/ping` | Health + home path |
| `GET /api/servers` | Catalog + install/running state |
| `POST /api/servers/:id/install` | Download Python, venv, pip install SearXNG |
| `POST /api/servers/:id/start` \| `stop` \| `restart` | Process lifecycle |
| `DELETE /api/servers/:id` | Uninstall |
| `PUT /api/servers/:id/enabled` \| `autostart` \| `port` | Update `servers.json` |
| `GET /api/servers/:id/logs` | Ring-buffer tail |

Module: `server/servers/` (`catalog.js`, `manager.js`, `routes.js`, `provisioner.js`). Wired in `server/runtime/bootstrap.js`, `middlewares.js`; `server.js` logs Servers API URL and `shutdownAllServers()` on exit/SIGINT/SIGTERM.

**Search integration (Phase 4):** `server/research/search.js` `loadSearchSettings()` calls `getManagedSearxngUrl()` and overrides `searxngUrl` when managed SearXNG is enabled and healthy. The `web_search_searxng` tool uses the same path via `loadSearchSettings()` in `server/runtime/tools-middleware.js`.

**Settings UI (Phase 5):** `#/settings/servers` (`src/ui/settings-servers-section.ts`, `src/servers/client.ts`, `src/config/servers-config.ts`) — install/start/stop, enabled/autoStart/port, install job polling, log tail. **Search** section shows a read-only note and link when managed SearXNG is active (`src/ui/settings-search-section.ts`).

**Tests (Phase 6):** `npm run test:servers` — `test/servers/manager.test.mjs` (install job lifecycle, start/stop + health mock, `autoStartEnabledServers` selection; uses `setManagerSpawnOverrideForTests` / `setManagerFetchOverrideForTests` / `setInstallProvisionOverrideForTests` with temp `MINNOW_HOME`), `test/servers/searxng-provisioner.test.mjs` (`settings.yml` json format + secret + loopback + port, `getSpawnSpec`, install meta). Config CRUD: `GET`/`PUT /api/config/servers` in `test/config/api-crud.test.js`. UI: `test/ui/settings-servers-section.test.mts`, `settings-sections.test.mjs` (`servers` case), `settings-page-html.test.mjs`, `settings-search-index.test.mjs`. Wired into the main `npm test` chain.

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

### Native tool plugins (Feature #17 — built)

Drop-in **local** tools without MCP: `~/.minnow/tools/<pluginId>/{tool.json,handler.mjs}`, scanned by [`server/tools/scan.js`](../server/tools/scan.js), executed via [`server/tools/loader.js`](../server/tools/loader.js), exposed as `plugin__<pluginId>__<functionName>` (hyphens in id → underscores in the namespace segment). APIs: `GET /api/plugins/tools`, `POST /api/plugins/reload`, `POST /api/plugins/scaffold` ([`server/tools/middleware.js`](../server/tools/middleware.js)). Client cache: `refreshPluginToolCache()` in [`src/tools/client.ts`](../src/tools/client.ts); merged into `getEnabledToolDefinitionsForMode()` with MCP tools. Pack enable flags: `tools.json` → `plugins`; permissions use namespaced ids (default `ask`). Settings: **Tools → Plugins** ([`src/ui/settings-plugins.ts`](../src/ui/settings-plugins.ts)). Authoring: [`documentation/plugins/tool-authoring.md`](plugins/tool-authoring.md). Tests: `npm run test:plugins`.

### Manual Orchestrate board (parse-only LLM + human-operated Kanban)

Orchestrate mode is **parse-only** for the LLM: read the plan, call **`board_init`** once (per-task `build` / `test`), then stop. Execution is **manual** on the board and in linked **task chats** (no supervisor, no `report_orchestrator_status`, no play/pause Resume).

| Module | Role |
|--------|------|
| [`src/state/orchestrate-board-store.ts`](../src/state/orchestrate-board-store.ts) | Pure board mutators (`initBoard`, `updateTask`, wave rollup, `applyOpenBoardWaveCollapse` on board open) |
| [`src/state/orchestrate-board-actions.ts`](../src/state/orchestrate-board-actions.ts) | Shared ops: `startTask`, `stopTask`, `moveTaskStatus`, `startWave` (concurrency queue), `toggleWaveCollapsed` |
| [`src/ui/orchestrate-board.ts`](../src/ui/orchestrate-board.ts) | Interactive Kanban: Start/Stop, status buttons, Start wave; **collapsible wave sections** (caret on `BoardWave.collapsed`, persisted on the board). **Open collapse (2026-06):** `applyOpenBoardWaveCollapse` runs on board open (`openBoardGroup`, full `renderBoardView`) — all waves collapse except those with `in_progress` tasks. **Collapsed waves (2026-06):** `.board-wave-compact` shows lane count row (Plan / Run / Test / Done) plus horizontal scroll strip of `.board-wave-compact__chip` tokens (mono id, truncated title, semantic status dot); header adds mono `complete/total` progress; chip click expands the wave. **Live refresh:** `refreshBoardDom` updates header metrics every tick but rebuilds kanban only when `buildKanbanRefreshKey` changes; defers rebuild while a kanban `select` / `input` / `textarea` is focused (not buttons — Reopen, wave caret, Start must repaint immediately after click). **Board view chrome (2026-06):** flat header bench (`.board-header__bench` mono metrics + thin progress track), unified four-lane kanban surface (dividers, not nested column cards), lane counts. **Task cards (2026-06):** `.board-task-card` top row (mono `W1-A` id + category chip + agent badge), clamped title, mono **activity** line (`.board-task-card__activity` via [`task-activity.ts`](../src/chat/orchestrate/task-activity.ts): live `getMainTurnActivity` tool labels while the task chat streams, idle last tool/message from `deriveOrchestratorLastActivity`, or sub-agent run summary when no task chat yet), **related chats** list (`.board-task-card__chats` / `.board-task-card__chat-row` from [`task-chats.ts`](../src/chat/orchestrate/task-chats.ts): primary `task.chatId`, `Chat.boardTaskId`, or `Task {id}:` name prefix in the board folder; max 2 rows + “+N more”), footer bench (Start/Stop, ghost advance buttons with stroke icons: forward, check, recycle); `--running` / `--alert` tints; **card click (2026-06):** planned/blocked cards open inline **task plan panel** ([`board-task-plan-panel.ts`](../src/ui/board-task-plan-panel.ts): build/test specs, wave, link to full plan); in-progress/testing/complete/failed cards call `openBoardTaskChat` → `switchChat` (footer, activity, and chat rows excluded). Selected planned card uses `--selected` ring. Board header no longer duplicates chat-view icon (composer toggle remains). (`orchestrate-board.css`). `buildKanbanRefreshKey` fingerprints activity + chat list; `subscribeMainTurnActivity` in `ensureBoardSession` repaints kanban on tool-phase changes. |
| [`src/ui/orchestrate-hub.ts`](../src/ui/orchestrate-hub.ts) | **Chat sidebar footer** Orchestrate icon (`#btnOrchestrate`, `.chat-sidebar-footer-btn`, raster `public/icons/orchestrate.png` via `.icon-img` in `index.html`): plan-screen-aligned overlay in `#chatArea` (**Boards & plans** title, workspace mono line `#orchestrateHubWorkspace`), bordered **Start from plan** workflow (`#orchestrateHubPlanSelect`, Refresh, Make a plan, **Open board**) with live **plan preview** (`#orchestrateHubPlanPreview`, `refreshOrchestrateHubPlanPreview` + `read_file` → `mountPlanPreviewContent`) and **Recent boards** list rows (`listWorkspaceOrchestrateBoardGroups`, progress bar when tasks exist). **Make a plan** → plan screen; **Open board** → `getOrCreateBoardGroup`, board view (`renderBoardView` / onboarding), and `kickoffOrchestrateBoardBuild` when no `orchestrateBoard` yet; row click → existing board via `openBoardGroup`. `renderChatFromHistory` paints board view whenever `ChatGroup.viewMode === 'board'` (not only when a board exists). Orchestrate is **not** in the composer mode strip (`listComposerModes()`). Styles: [`src/styles/orchestrate-hub.css`](../src/styles/orchestrate-hub.css) |
| [`src/ui/orchestrate-plan-screen.ts`](../src/ui/orchestrate-plan-screen.ts) | **Plan authoring screen** (`#orchestratePlanScreen` in `#chatArea`, class `chat-area--plan-screen`): hub-aligned centered overlay (eyebrow + title + lede per phase); phases **prompt → working → questions → preview → error**; **Start planning** runs Plan-mode `runChatTurn`; working phase uses pulsed status dot + rotating status lines + mono tool subline; stream end uses `findLastPlanSavePath` + `read_file` preview (`mountPlanPreviewContent`); embedded `ask_question` via `#orchestratePlanScreenQuestions`; **View chat** suspend + `#orchestratePlanBanner` resume; `isOrchestratePlanScreenSuppressingChatDom(chatId)` hides stream DOM. Styles: [`src/styles/orchestrate-plan-screen.css`](../src/styles/orchestrate-plan-screen.css) |
| [`src/chat/streaming-state.ts`](../src/chat/streaming-state.ts) + [`src/app-state.ts`](../src/app-state.ts) | **Concurrent streams:** `streamingChatIds`, per-chat `abortByChatId`; background task chats do not block the active composer |
| [`src/state/chat-groups.ts`](../src/state/chat-groups.ts) | Sidebar folders own Orchestrate boards (`ChatGroup.orchestrateBoard`, `orchestratePlanPath`, `viewMode`, `plannerChatId`). Planner (parse) chats link via `Chat.boardGroupId` and sit in the folder via `Chat.groupId` (`linkPlannerChatToBoardFolder` in `getOrCreateBoardGroup`); `SessionState.activeBoardGroupId` selects which folder’s kanban fills `#chatArea`. **Drag** chats onto headers (`src/ui/sidebar-chat-dnd.ts`); board folders (`.chat-group-header--has-board`) open board view on header click (`openBoardGroup` focuses planner chat when returning from a task chat) and show `.active` selection while open (sidebar chat rows suppress `.active` highlight during board view) |
| [`src/chat/orchestrate/plan-complete-ui.ts`](../src/chat/orchestrate/plan-complete-ui.ts) | One-shot completion message when all tasks are `complete` (`board.completionShownAt`) |
| [`src/chat/orchestrate/plan-from-history.ts`](../src/chat/orchestrate/plan-from-history.ts) | `findLastPlanSavePath(history)` — newest successful `save_file` under `documentation/plans/` (used by plan screen preview on `subscribeChatStreamEnd`) |
| [`src/chat/orchestrate/plan-preview.ts`](../src/chat/orchestrate/plan-preview.ts) | `parsePlanFrontMatter`, `splitPlanMarkdown`, `planMarkdownForDisplay` (body after YAML, or synthesized GFM when body empty), `mountPlanPreviewContent` / `buildPlanPreviewDom` — full plan markdown via `setAssistantBubbleContent` on `.plan-preview__body.msg-bubble--md` (hub plan picker + plan-screen preview phase) |

**Task chat:** `startTask` creates or reuses a **Build-mode** chat (planner’s provider/model, default **Builder** work agent), sets `Chat.boardTaskId` to the board task id, seeds a user message (plan path + task id + build/test specs), and runs `runChatTurn` in the background without switching the active chat. **`board_get_state` / `board_update_task`** resolve the folder’s planner chat from `ExecuteToolContext.chatId` (main loop, sub-agent parent, or linked task chat via `boardGroupId`); **`board_init`** still requires an Orchestrate-mode planner chat. **Stop** calls `stopGeneration(taskChatId)` and keeps the transcript. Default **`maxConcurrentTasks`** = 3 on the board (queued wave starts drain on `notifyChatStreamEnded`). **Task errors** (`.board-task-card__error`, from failed sub-agent runs or `board_update_task`) are cleared when a task is **Reopen**ed (`moveTaskStatus` → `planned`) or **Start**ed again. **Board return:** task-card chat rows call `switchChat`; reopening the board (sidebar folder header or board toggle) calls `openBoardGroup`, which focuses the planner chat when a member task chat was active. While `ChatGroup.viewMode === 'board'`, `isStreamDomVisible` / `appendBubble` suppress live DOM for **all** active chats (including Build-mode task streams), except the transient orchestrator init split.

**Tests:** `test/chat/concurrent-streams.test.mts`, `test/state/chat-groups.test.mts`, `test/orchestrate/plan-complete.test.mts`, `test/chat/orchestrate/plan-from-history.test.mts`, `test/chat/orchestrate/plan-preview.test.mts`, `test/chat/orchestrate/task-activity.test.mts`, `test/chat/orchestrate/task-chats.test.mts`, `test/ui/orchestrate-board-header-status.test.mjs`, `test/ui/orchestrate-board-live-update.test.mjs` (wave collapse, task card activity/chats), `test/chat/modes/composer-modes.test.mts`, `test/ui/orchestrate-hub.test.mts`, `test/ui/orchestrate-plan-screen.test.mts`.

### Settings page (Step 20)

Full-page settings at `#/settings/<section>` (`src/ui/settings-page.ts`, `src/ui/settings-page-types.ts`, `src/ui/settings-layout.ts`, `src/ui/settings-switch.ts`, `src/ui/settings-sections.ts`, `src/styles/settings-page.css`). Boolean settings use **toggle switches** (`.settings-switch`, `role="switch"`) via `createSettingsSwitch` / `upgradeSettingsCheckboxes`; skills and agent packs share the same control. Sidebar `.settings-nav` uses **grouped labels** (App · Models & APIs · Prompting & memory · Agents · Tools & integrations · Advanced) via `SETTINGS_NAV_GROUPS` in `settings-page-types.ts`; each section has a `settings-lead` intro in `index.html`. **Editor** (`#/settings/editor`) holds file-viewer AI inline completion; **Language servers** (`#/settings/lsp`, `src/ui/lsp-settings.ts`) is LSP-only with status toolbar, server list, and bundle install rows. **General** groups Appearance (theme), Chat & terminal, Connection summary (active provider + cross-links), and Quick drawer note. **Search** / **Deep Research** / **Servers** (`settings-search-section.ts`, `settings-research-section.ts`, `settings-servers-section.ts`) — `search.json`, `research.json`, managed SearXNG (`servers.json` + `/api/servers/*`). **Tools** groups structured tool arguments (global constrained decoding), turn limits, permissions/cache, filesystem, browser allowlist, and catalog. **Memory** (`#/settings/memory`) combines store toggle and **inject on send** (`features.memoryInjection`). **Orchestration** (`#/settings/features`, nav label) reserved for future orchestrate settings (supervisor UI removed). Topbar gear opens settings; each section loads live data from Step 02–18 APIs. **Rules** (`#/settings/rules`): enable toggle + textarea; **Save rules** → `rules.json` when `npm start` is up. **Plan granularity** under **Modes → Plan**. Nav clicks update hash after `setActiveSection`; `openSettings()` skips re-entry when already on that section. Async sections use render-generation guards. **Skills**: enable toggle, **Edit SKILL.md**, **Add custom skill** via `POST /api/skills`. Custom prompt configs: toolbar New/Save/Duplicate/Delete. Plan: [`documentation/plans/settings-pages-redesign.md`](plans/settings-pages-redesign.md).

**Cost / token observability (Feature #14 / MIN-50):** Per-chat `chat.tokenLedger` persists in the session blob (`entries[]` capped at 200; `totals` and `bySource` always accumulate). Ingestion: main tool loop and legacy `sendMessage` (`recordMainChatTurnUsage`), each sub-agent SSE turn on the parent chat (`recordSubAgentTurnUsage`), title job (`source: title`), Reef `callLLM` (`source: reef-widget`). Provider optional `pricing` on `~/.minnow/providers/<id>/profile.json` (validated server-side; exposed on `ProviderPublic`). USD via `src/usage/pricing.ts` (`inputPer1M` / `outputPer1M`, model → `*` → default). UI: Settings → **Usage** (`#/settings/usage`, `src/ui/settings-usage.ts`); pricing editor on provider edit forms (`src/ui/settings-providers.ts`). Stats strip `#stripCost` shows last entry cost when priced. Distinct from Feature 25 prompt **estimate** and MIN-13 **next-send** context ring. Plan: [`documentation/plans/Build out/feature-14-cost-token-observability.md`](plans/Build%20out/feature-14-cost-token-observability.md). Verification: [`documentation/plans/verification/feature-14.md`](plans/verification/feature-14.md).

**Chat code change stats:** Server tools return optional `codeChange` (`additions`, `deletions`, `path`/`paths`, `source`, capped `diffLines`) from [`server/tools/line-diff-stats.js`](../server/tools/line-diff-stats.js), [`server/tools/git-change-stats.js`](../server/tools/git-change-stats.js), and [`server/tools/workspace-change-snapshot.js`](../server/tools/workspace-change-snapshot.js) via [`server/runtime/tools-middleware.js`](../server/runtime/tools-middleware.js). Sources: file mutations (`file-tool`), `git_commit` (`git-commit`), foreground `execute_command` git snapshot (`command-snapshot`) or single-file heuristic (`command-heuristic`). `POST /api/tools` includes `codeChange` in JSON; backfill uses `POST /api/tools/code-change-for-commit` `{ sha }`. [`src/tools/client.ts`](../src/tools/client.ts) records `chat.codeChangeTotals` and `sessionState.codeChangeTotalsByWorkspace` ([`src/usage/code-change-ledger.ts`](../src/usage/code-change-ledger.ts)) when `context.chatId` is set (sub-agents use `parentChatId`). History backfill: [`src/usage/code-change-backfill.ts`](../src/usage/code-change-backfill.ts) on session load. UI: `+`/`−` badges and unified diff in [`src/ui/tool-messages.ts`](../src/ui/tool-messages.ts); `#codeChangeStrip` ([`src/ui/code-change-strip.ts`](../src/ui/code-change-strip.ts)); hub **Agent changes** + sidebar stats ([`src/ui/workspace-code-change.ts`](../src/ui/workspace-code-change.ts)). Plan: [`documentation/plans/chat-code-change-tracking.md`](plans/chat-code-change-tracking.md).

**Settings global finder:** `#settingsSearchInput` in `#settingsSearchFinder` (registry-driven index in `src/ui/settings-search-index.ts`, ranking in `settings-search-rank.ts`, navigation in `settings-search-navigate.ts`, UI in `settings-search-finder.ts`). **MinnowOS:** while Settings is open, [`src/os/settings-search-menubar.ts`](../src/os/settings-search-menubar.ts) reparents the finder into `#osMenubarSettingsSearchSlot` inside `#osMenubarCenter` (centered menubar slot); closing Settings returns it to `#settingsSearchFinderSlot` in `.settings-page-header`. Legacy (non-OS) layout keeps the finder in the page header. **Ctrl/Cmd+K** focuses the finder while settings is open (skipped when `#settingsPromptsHubSearch` is focused). Choosing a result opens the section via existing hash routing, awaits `refreshSettingsSection`, then scrolls to `data-settings-search-key` (tool rows/categories, toggle rows, groups) or falls back to the section’s first `.settings-group`. Does not mirror queries into the Prompts hub local search.

**Prompt token estimate (Feature 25 / F4):** While settings is open, `#settingsPromptTokenEstimate` in `.settings-page-header` (right-aligned via `margin-left: auto`) shows **~N tokens (estimate)** for the next main-chat send (active session). **Prompting** adds `#settingsPromptTokenBreakdown` (System · History · Tools · Rules). Heuristic: `chars ÷ 4` (`estimateTokensFromText` in `src/chat/prompts/token-estimate-core.ts`). `resolveOutboundPromptEstimate()` in `src/chat/prompts/token-estimate.ts` mirrors send via `resolveOutboundSystemMessages()`, full `chat.history`, and mode-filtered tool JSON (work-agent allowlist + UI Designer filter). UI: `src/ui/settings-prompt-estimate.ts`. Refreshes on settings open, section change, and profile/part toggles (300 ms debounce). Not provider `usage.prompt_tokens`. Verification: [`documentation/plans/verification/feature-25.md`](plans/verification/feature-25.md).

**Context budgets per agent (MIN-39):** Optional `maxInputTokens` and `contextEnforcementPolicy` (`summarize` | `slide` | `truncate`) on **work agents** (`WorkAgentDefinition` / `~/.minnow/work-agents.json`) and **sub-agent types** (`SubAgentTypeConfig` / `sub-agents.json`). Enforcement runs in [`src/chat/context-budget.ts`](../src/chat/context-budget.ts) immediately before each provider payload: `applyContextBudget()` after `buildApiMessages()` in [`src/tools/loop.ts`](../src/tools/loop.ts) (main tool loop) and before each sub-agent completion in [`src/agents/sub-agent-runner.ts`](../src/agents/sub-agent-runner.ts). Effective ceiling is `min(agentCap, modelLimit) × 0.9` when both are set; **v1 only enforces when `maxInputTokens` is set** on the active agent/type. Leading `system` messages stay pinned; policies drop whole user→assistant/tool turns to preserve `tool_calls` / `tool` pairs. Settings → Work agents / Sub-agents expose cap + policy. Tests: [`test/chat/context-budget.test.mts`](../test/chat/context-budget.test.mts). Plan: [`documentation/plans/Build out/feature-03-context-budgets.md`](plans/Build%20out/feature-03-context-budgets.md).

**Context window usage (MIN-13 / BUG-019):** In-chat **context fill** indicator distinct from the bottom metrics strip (tok/s, TTFT). `#contextUsageRing` in `#composerControls` (after the thinking toggle): compact 24px SVG ring (no button chrome); light grey track, ink `--accent` stroke fill for used share; warning fill at ≥85% (`--warning`). Hover tooltip: model name, limit, used/remaining (approx.). Click opens `#contextUsageBreakdown` popover with per-section token rows and bars (System, Rules, Tools, History, optional **In progress (estimate)**, Composer/Attachments). Data: `getContextBudget()` / `assembleContextBudget()` in [`src/chat/context-usage.ts`](../src/chat/context-usage.ts) merges `resolveOutboundPromptEstimate()` (persisted `chat.history`, including assistant `thinking` segments) + pending `#msgInput` + `getPendingAttachments()` + in-flight overlay from [`src/chat/context-in-flight.ts`](../src/chat/context-in-flight.ts) (streaming prose, live reasoning, unfinalized tool-call JSON during `runChatTurn`). **Context limit** uses the effective window, not catalog max: `resolveContextLimit()` prefers `chat.modelInfo.context_length` from the last LM Studio completion, then `loaded_context_length` on a loaded row from `GET /api/v0/models`, then `max_context_length` (same precedence as `contextLengthFromModelRow()` in [`src/lib/context-length.ts`](../src/lib/context-length.ts)). Shows **last turn API** `prompt_tokens` when `chat.lastStats` has them; section sizes stay heuristic. UI: [`src/ui/context-usage-ring.ts`](../src/ui/context-usage-ring.ts), [`src/ui/context-usage-breakdown.ts`](../src/ui/context-usage-breakdown.ts), [`src/styles/context-usage.css`](../src/styles/context-usage.css). Refreshes on history paint (`renderChatFromHistory` / `renderStatsForChat`), model change, composer input, attachments, tool permission changes, and **during active turns** via debounced `scheduleContextUsageRefresh()` from [`src/tools/loop.ts`](../src/tools/loop.ts) (SSE prose/reasoning deltas, each `chat.history.push`, turn `finally`). `updateStrip()` alone does not refresh the ring. Tests: [`test/chat/context-usage.test.mts`](../test/chat/context-usage.test.mts).

**Models hub (Feature 02):** Settings → **Models** (`#/settings/model-routing`, nav label; hash id unchanged) is the consolidated per-role surface: **Main chat** (top-bar provider/model + global sampler + per-chat thinking), work agents, sub-agent types, background jobs (UI Designer, titles), and Reef widget LLM on the **active chat**. Each row has provider/model selects, **Effective** readout, and an **Advanced (sampler · thinking)** disclosure for roles that support it. Catalog: `src/settings/model-routing-catalog.ts`; UI: `src/ui/settings-model-routing.ts`; shared selects: `src/ui/settings-model-binding.ts` (`inline` layout). Entity sections link here instead of duplicating bindings.

**Prompts hub:** Settings → **Prompts** (`#/settings/prompting`) keeps profile tabs, setup bundles, per-part editors, and token estimate at the top; **All role prompts** (`src/ui/settings-prompts-hub.ts`, `#settingsPromptsHubMount`) adds search + type filters and lazy expandable editors for modes, experts, work agents, and sub-agents (`mountPromptFileEditor` / `mountWorkAgentPromptEditor`). Rules filter links to `#/settings/rules`. Modes/Experts/Work agents/Sub-agents sections keep structural config only and cross-link to Prompts.

**Sampler (Feature 09):** Settings → **Sampler** (`#/settings/sampler`) holds **global defaults** only (`config.json` → `sampler` via `src/config/sampler-meta.ts`, merged with `DEFAULT_SAMPLER_GLOBAL` in `parseSamplerGlobalBlock()` so sparse persisted blocks still populate all fields in the UI; mirrored to composer `#temperature` / `#maxTokens`). Per-role sampler overrides moved to **Models** → Advanced. UI: `src/ui/settings-sampler.ts`, fields: `src/ui/settings-sampler-fields.ts`.

**Thinking mode toggles:** Settings → **Thinking** (`#/settings/thinking`) sets global default **`on`** (`config.json` → `thinking.defaultMode` via `src/config/thinking-meta.ts`). Per-role tri-state overrides (`inherit` | `on` | `off`) live in **Models** → Advanced. Composer `#composerThinkingControl` is a single brain icon toggle (`src/ui/composer-thinking.ts`, `/icons/thinking-brain.png`) inline after mode segments: **on** / **off** appearance (muted when off), default **inherit** (shows resolved stack; tooltip), click cycles override (`inherit` → opposite of resolved → toggle explicit → back to inherit). Writes `Chat.thinkingMode`. Resolution: `src/agents/resolve-thinking.ts`; request fields: `src/agents/thinking-to-body.ts`. Plan: [`documentation/plans/Build out/feature-thinking-mode-toggles.md`](plans/Build%20out/feature-thinking-mode-toggles.md).

**Editable agents (structural):** `#/settings/modes` (tool policy, plan granularity, Reef widget LLM), `#/settings/experts` (Experts hub + roster), `#/settings/work-agents` (enable, context budget), `#/settings/sub-agents` (global limits + per-type concurrency/timeouts). Prompts and model bindings: **Prompts** and **Models** hubs. **Prompt diffing (#12):** compare UI on hub editors and Prompting part panels. APIs unchanged: `GET/PUT/DELETE /api/prompts/...`, `/api/work-agents/:id/prompt`, `PUT /api/work-agents/:id`, `PUT /api/config/sub-agents`.

**Tests:** `npm test`, `npm run build`, `test/ui/settings-sections.test.mjs`, `test/ui/settings-page-html.test.mjs`, `test/ui/settings-search-index.test.mjs`, `test/ui/settings-search-rank.test.mjs`, `test/ui/settings-search-finder.test.mjs`. Verification: [`documentation/plans/verification/step-20.md`](plans/verification/step-20.md).

**Tests:** `npm run test:skills`; `node scripts/s13-skills-smoke.mjs` (set `MINNOW_HOME` for override fixture). Verification: [`documentation/plans/verification/step-13.md`](plans/verification/step-13.md).

**Vite-only (`npm run dev`):** picker uses `builtin-manifest.json` + lazy `import.meta.glob` in `client.ts` for built-in bodies (glob is no-op under Node/tsx tests); user skills need `npm start`.

### Programmatic prompts (Step 04)

Composable system prompt at send time via `composeSystemPrompt()` ([`src/chat/prompts/prompt-composer.ts`](../src/chat/prompts/prompt-composer.ts)).

| Profile | `config.json` | Behavior |
|---------|---------------|----------|
| **full** | `activePromptProfile: "full"` | All applicable parts, full templates |
| **lite** | `activePromptProfile: "lite"` | Short/lite bodies, `info`/`memory` off by default |
| **custom** | `"custom"` + `activePromptConfigId` | Per-part enable + `contentOverride` from `prompt-configs/<id>.json` |

**Setup profiles (#13):** Settings → Prompting → **Setup profile** toolbar applies a bundle that can set the rows above plus work-agent/sub-agent bindings and global tool permissions. `prompt-configs/` remains the low-level custom composer store; profiles may embed `parts` or reference an existing prompt-config id.

**Composition order** (single `system` message, `\n\n---\n\n` separators):

`base → mode → expert → work-agent → tool-usage → info → skill → memory`

**Shipped tree:** `src/chat/prompts/` (`base/`, `tool-usage/`, `info/` presets from `SYSTEM_PROMPT_PRESETS`, `modes/` full+lite pairs, `experts/`, …). Reference-only: `_example/`, `modes/_template/MODE_TEMPLATE.md`.

### Operating modes (Step 05)

Six primary modes per chat: **General**, **Build**, **Plan**, **Orchestrate**, **Reef**, **Debug**. **General** is first in the mode picker; new chats still default to **Build** (`DEFAULT_MODE_ID`). General uses a lighter prompt and exposes **all enabled tools** to the model; **each tool run requires user approval** in the approval strip (overrides global Full and auto-approve patterns while in General). **Debug** uses `modes/debug.*.md` (bug investigation, `bug_*` tools, All bugs board). Global bug Kanban remains at sidebar **All bugs** / `#/bugs` ([`src/ui/bug-board.ts`](../src/ui/bug-board.ts)). (inline chat widgets via `reef-widget` fences; prompts in `modes/reef.*.md`, copy-paste templates in `src/chat/reef/widgets/*.md` — **15 full templates:** calculator, calculator-with-chart, slider-graph, tabs, form, data-table, comparison, checklist, stats-dashboard, pie-chart, heatmap, quiz, qa-callllm, timeline, unit-converter; **6 composable snippets** (`snippet-*.md`): chart-line, chart-bar, table, stat-card, input-row, sparkline).

| Concern | Location |
|---------|----------|
| Registry + tool policy | `src/chat/modes/registry.ts`, `tool-policy.ts` — Plan allows **`save_file`** / **`make_directory`** only under `documentation/plans/` (`plan-write-guard.ts` in the browser; mirrored in `server/tools/plan-write-guard.js` on `POST /api/tools` when `modeId` is `plan` or `planMode: true`; prompts in `modes/plan.*.md`; `save_file` creates parent dirs on the server) |
| Prompt bodies | `src/chat/prompts/modes/{id}.full.md`, `{id}.lite.md` |
| Template pack | `src/chat/prompts/modes/_template/` |
| UI mode selector | `src/ui/mode-selector.ts` (in `#composerControls` in `index.html`) |
| Orchestrate plan control | `#orchestratePlanStrip.orchestrate-plan-control` moves into `.input-wrap` and replaces `#msgInput` while visible (`.input-bar--orchestrate-plan`) — `src/ui/orchestrate-plan-selector.ts`, shared population in `src/ui/orchestrate-plan-picker.ts`, `src/styles/orchestrate-plan-selector.css`; mode segments + thinking stay in `#composerControls` (hub grid row 1). Strip stays **hidden** while Orchestrate + no `orchestrateBoard` + `viewMode === board` (board onboarding panel owns plan pick); refresh on mode/chat/workspace change and when server tools become available (`init-file-panel.ts`); missing `documentation/plans/` maps to `no_plans_dir` in `list-plans.ts` |
| Orchestrate view toggle (Phase 4) | Split toggles: `#btnViewModeToggleBoard` (composer column above `#sendBtn`) and `#btnViewModeToggleChat` (board `board-header__controls`, between Plan and play/pause) — `src/ui/view-mode-toggle.ts`, `src/styles/view-mode-toggle.css`; sets `Chat.viewMode` (`chat` \| `board`); enabled in Orchestrate mode anytime (including mid-stream; plan optional); hidden/disabled outside Orchestrate or when the target view is already active (`[hidden]` + `.hidden` + `display:none !important` so `.icon-btn` flex does not override); sync on mode/chat/plan change (`loop.ts`, sidebar, plan selector, board header wire) |
| Plan listing | `src/chat/orchestrate/list-plans.ts` (`find_files`); path rules `src/chat/orchestrate/plan-path.ts`; history recovery `plan-from-history.ts`; preview `plan-preview.ts` |
| Send gate (Orchestrate) | `src/chat/orchestrate/send-gate.ts` + `sendMessageWithTools` in `src/tools/loop.ts` (requires `Chat.orchestratePlanPath`; empty composer uses default line) |
| Manual Orchestrate board | `src/state/orchestrate-board-actions.ts`, `src/ui/orchestrate-board.ts` — parse-only `board_init`, manual task chats, concurrent streams, sidebar groups. Prompts: `orchestrate.full.md` / `orchestrate.lite.md` v3 |
| Persistence | `Chat.modeId` and optional `Chat.orchestratePlanPath` in `sessions/state.json` (default mode `build`; plan path normalized in `ensureChatShape`); server: `server/config/validators.js` + `orchestrate-plan-path.js` |
| Bug tracker (MIN-16) | Bugs persist in `~/.minnow/bugs/state.json` (`GET/PUT /api/config/bugs`), not on chats. Each bug has `workspacePath`; `chatId` is set when **Investigate** creates a Build-mode investigation chat. Columns: Reported → Investigating → Planned → Fixing → Complete. Kanban card layout (POLISH-010): **title → description → meta** (severity pill, workspace, chat) with stacked add form. Store: `src/state/bug-board-store.ts`, events: `bug-board-events.ts`. Legacy `chat.bugBoard` migrates on boot. Tools: `bug_add`, `bug_update`, `bug_get_state` (All bugs screen only). UI: `src/ui/bug-board.ts`, `#globalBugsList`, `#btnAllBugs`. Global route `#/bugs` (`src/ui/global-bugs-page.ts`): hides `#appBody` but keeps **`header.topbar`** visible (POLISH-015) so model/workspace/benchmark/settings stay reachable; page sub-header has Back + filters/Kanban in flex-fill below topbar. Opening settings or benchmark closes bugs. Pipeline: `src/chat/bug-board/pipeline.ts`. Tests: `test/state/bug-board-store.test.mts`, `test/tools/bug-board-tools.test.mts`, `test/state/global-bugs.test.mts`, `test/ui/global-bugs-page.test.mjs`. Plan: [`documentation/plans/min-16-global-bugs.md`](plans/min-16-global-bugs.md). |
| Board View | Folder-owned: `ChatGroup.orchestrateBoard`, `ChatGroup.viewMode`, `SessionState.activeBoardGroupId`; planner `Chat.boardGroupId` (legacy `Chat.orchestrateBoard` / `Chat.viewMode` migrate on load to v5). **MIN-5:** With no board store yet, Board view shows `.board-onboarding` (`mountBoardOnboardingPanel` in `orchestrate-board.ts`, shared options in `orchestrate-plan-picker.ts`): plan `<select>` with single-plan auto-select, Refresh, **Start** (sends `BOARD_ONBOARDING_KICKOFF_MESSAGE`), Open plan, Chat view; **loading UI** — mono status strip + ink dot pulse while plans load (`data-board-onboarding-busy=plans`); during `board_init` (`init`) the setup form hides (`.board-onboarding__setup`), the panel flattens to bench chrome (`.board-onboarding__panel--busy`), shows plan basename + indeterminate progress (`.board-onboarding__init-lead`) and a live-shaped Kanban skeleton (`.kanban-grid.board-onboarding__kanban-skeleton` with task tile pulses) via `syncBoardOnboardingBusyUI` / `refreshBoardOnboardingIfMounted` from `loop.ts`; `#orchestratePlanStrip` is hidden (`shouldHideComposerPlanStripForOrchestrateBoardOnboarding`); entering Orchestrate without a board sets `viewMode: board` (`mode-selector.ts`). **Board init split (transient):** During the parent orchestrator stream that runs `board_init`, `#chatArea` mounts `.board-init-split` (top: onboarding preview or live Kanban via `board-init-split__board`; bottom: streaming assistant + tool rows via `board-init-split__chat` until `board_init` creates `orchestrateBoard`, then split tears down immediately (`syncOrchestrateInitSplitChrome` from `loop.ts`) for full board-only view while the stream may continue) — `src/ui/orchestrate-board-init-split.ts` (`isOrchestrateBoardInitSplitActive`, `getOrchestrateChatMountElement`, `syncOrchestrateInitSplitChrome`); `#mainColumn.main-column--orchestrate-init-split` keeps composer hidden but allows stream DOM (`isStreamDomVisible`, `appendBubble`, `loop.ts` tool paint); stream end tears down split and returns to full board-only view. Kickoff strings: `src/ui/orchestrate-board-kickoff.ts`. Store: `src/state/orchestrate-board-store.ts`, `src/state/orchestrate-board-events.ts` (`emitBoardChange` → live kanban refresh). Tools: `board_init`, `board_update_task`, `board_get_state` (`src/tools/board-tools.ts`) — **`board_init`** uses `tasks[].id` + non-empty `waves`; **`board_update_task`** uses **`task_id`** (not `id`); **`spawn_sub_agent`** uses **`board_task_id`**. Schemas: `src/tools/definitions.ts`; copy-paste JSON examples in `orchestrate.*.md` § Board tool API. UI: `src/ui/orchestrate-board.ts` (header **status badge** via `deriveBoardHeaderStatus` — **MIN-35:** Complete before Stalled/Stopped; `isUserStoppedChat` only on latest assistant + incomplete work; stall badge via `shouldShowOrchestrateStallBadge` (semantic chips: warning/success/danger) plus **activity chip** (`deriveOrchestratorLastActivity` in `chat/orchestrate/last-activity.ts` — last tool label or message preview up to 240 chars; width fits label with `max-width` ellipsis cap; click opens Chat view via `setOrchestrateViewMode('chat')`); toolbar layout with icon-only **Plan** · **Chat** · **play/pause** controls on the right (`board-header__controls`, `wireBoardHeaderControls` in `orchestrate-board.ts`); play/pause toggles Start/Resume vs Stop from streaming state (`aria-pressed` when running); board view toggle in composer above send; onboarding panel **Build board** (no board yet), wave **Start wave**, and task-card actions share `.board-btn` / `.board-btn--compact` (aligned with `model-action-btn` / hub workflow buttons); plan and agent `<select>`s use `.board-select` (settings-field focus ring + chevron); header icon buttons use `.icon-btn` / `.board-header__icon-btn` (`view-mode-toggle.css`, fine-pointer danger hover on stop); subscribes on empty board; in-place `refreshBoardDom` + 1s live tick (pause-aware elapsed via `timerAccumulatedMs` / `timerSegmentStartedAt` in `orchestrate-board-store.ts` — runs while streaming/tasks/sub-agents are active, pauses when stopped/idle; tick keeps syncing the board session chat even in Chat view); kanban task cards show agent badge and open `openSubAgentDrawer` on click), `src/styles/orchestrate-board.css` (board view: `.board-root` flex-fills `#chatArea` inside existing `.chat-area` padding; kanban columns scroll per-column); dispatch in `renderChatFromHistory` (`messages.ts`); board-only streaming guards (`appendBubble`, `appendStreamingAssistantRow`, `sub-agent-cards.ts`, tool-call DOM in `loop.ts`). Board mode: `#mainColumn.main-column--board-view` hides `.input-bar` and `#chatJumpLatest` (no in-board composer); toggle in top bar `#btnViewModeToggle`. Controls: stop orchestrator, **Open plan** (opens `orchestratePlanPath` in split file viewer as rendered markdown), **Resume** (fixed resume line). New user messages: switch to Chat view or use header controls. No inline plan sidebar — plans use `openFileInViewer` + markdown preview for `.md`. `activeParentTurnId` on board in `loop.ts`. Prompts: `orchestrate.*.md` (no `documentation/progress/`). Tests: `test/state/orchestrate-board-shape.test.mts`, `test/orchestrate/board-store.test.mts`, `test/tools/board-tools.test.mts`, `test/orchestrate/orchestrator-board-link.test.mts`, `test/ui/view-mode-toggle.test.mjs`, `test/ui/orchestrate-board-streaming.test.mjs`, `test/ui/orchestrate-board-init-split.test.mjs`, `test/ui/board-onboarding-busy.test.mjs`, `test/ui/orchestrate-board-live-update.test.mjs`, `test/prompts/orchestrate-board-prompt.test.mjs`; `test/orchestrate/**` in `npm test`. Verification: [`documentation/plans/verification/feature-orchestrate-board.md`](plans/verification/feature-orchestrate-board.md). Plan: [`documentation/plans/shiny-minsky-board-view.md`](plans/shiny-minsky-board-view.md) |

### Reef mode widgets (inline iframes)

Closed ` ```reef-widget ` fences in assistant bubbles mount as sandboxed iframes in **all chat modes** (General, Build, Plan, Orchestrate, Reef); only **Reef** mode (or `reef-widget` sub-agent) should **author** new fences. While that bubble is still streaming (`setAssistantBubbleContent` with `streaming: true`), each fence shows a **pending** row (phase label + dot pulse) instead of raw highlighted code; the final non-streaming render runs static fence lint (`widget-fence-lint.ts`), iframe prelude probes (script errors, chart height ≥ 48px, no scientific-notation axis ticks), then reveals the widget. On validation failure the host may run a **silent repair** loop (`widget-repair.ts`: patch fence in history, re-mount, keep “Checking widget…”) up to two attempts, then a soft “Preview unavailable” placeholder — not the technical error list. Mounting does **not** use the global `app-state.streaming` flag (it can stay true until after the final render).

| Concern | Location |
|---------|----------|
| Mount pipeline | `src/chat/reef/` (`widget-block-detector.ts`, `widget-fence-body.ts`, `widget-fence-lint.ts`, `widget-fence-markdown.ts`, `widget-pending-ui.ts`, `widget-iframe.ts`, `widget-error-ui.ts`, `widget-repair.ts`, `widget-validation.ts`, `theme-forward.ts`, `widget-prelude.ts`, `widget-bridge.ts`, `run-widget-completion.ts`) |
| Renderer hook | `mountReefWidgets(bubble, { bubbleStreaming, modeId })` at end of `setAssistantBubbleContent` in `src/markdown/renderer.ts`; history render passes `chat.modeId` via `appendBubble` meta |
| Bridge init | `initReefBridge()` in `src/main.ts` |
| Styles | `src/styles/reef-widgets.css` |
| Widget LLM overrides | `Chat.reefWidgetProviderId`, `Chat.reefWidgetModelId`; Settings → Modes → Reef (`src/ui/reef-widget-settings.ts`) |
| Widget library | **15 templates** + **6 snippets** under `src/chat/reef/widgets/`; catalog in `modes/reef.full.md` (Templates table + Snippets subsection); lite prompt notes `snippet-*.md`. Tools: `@minnow/reef/widgets/<name>.md` (read-only; synced to `~/.minnow/reef/widgets/` on `npm start`). **User modules:** `@minnow/reef/modules/<slug>.md` (read/write under `~/.minnow/reef/modules/`, scaffolded on `npm start`; `server/reef/widget-paths.js` + `resolveSafePath` in `server.js`) |
| User modules | Custom widgets saved only after **`ask_question`** confirmation → `@minnow/reef/modules/<slug>.md` under `~/.minnow/reef/modules/` (scaffold on `npm start`; path resolution in `server/reef/widget-paths.js`). Prompt rules: `modes/reef.full.md` § User module library; `/ask-user` skill preset. Plan: [`documentation/plans/Build out/reef-optional-save-prompt.md`](plans/Build%20out/reef-optional-save-prompt.md) |
| **Artifacts** | Versioned co-edited documents at `~/.minnow/reef/artifacts/<id>/` (`manifest.json` + `v1.md`, `v2.md`, …). API: `GET/POST/PUT /api/reef/artifacts` (`server/reef/artifact-store.js`, `artifact-paths.js`, `routes.js`). Tools: `@minnow/reef/artifacts/<id>` via `resolveSafePath` in `server.js` (`read_file` → current version; `save_file` → append version). Bridge: `window.minnow.editArtifact` + `subscribeEdits` (`widget-bridge.ts`); pending edits injected on next send (`artifact-context.ts` → `loop.ts`). Tool-output promotion: `artifact-promotion.ts` after `executeTool`. Bind widgets with `<!-- artifact: slug -->` in fence body (`artifact-fence.ts`). Plan: [`documentation/plans/Build out/feature-04-reef-artifacts.md`](plans/Build%20out/feature-04-reef-artifacts.md) |

**Sandbox:** `iframe sandbox="allow-scripts"` only (no `allow-same-origin`). CSP + esm.sh importmap inside srcdoc (`react@19` / `react-dom@19/client` without `?dev` so widget code and Recharts share one React instance). Theme tokens forwarded from host `html[data-theme]`.

**Bridge (`window.minnow` in iframe):** `sendPrompt(text)` → fills `#msgInput` (user sends); `callLLM({ messages })` → host streams via `postChatCompletions`; `openLink(url)` → confirm + new tab; `requestResize()` → re-measure iframe document height so the host matches widget content (charts should call this from `useLayoutEffect` after layout); `editArtifact({ artifactId, content })` → debounced append to `~/.minnow/reef/artifacts/` and queue for the main agent on the next user Send.

**Charts (Recharts):** Host srcdoc injects baseline CSS (`.rw-chart` / `.mw-chart` → 220px tall) and the prelude sizes chart wrappers plus parents of `.recharts-responsive-container` when height collapses to ~0 (including after async ESM load via `MutationObserver`). Prelude also fails validation when responsive container height &lt; 48px or axis tick text uses scientific notation. Templates/snippets use hardened axes: `YAxis` `type="number"`, `width={60}`, `tickFormatter` with `toFixed` (not `toExponential`), `margin.left` ≥ 36, prefer `React.createElement` for chart trees. Agents should call browser tool **`check_reef_widget`** (`src/tools/reef-widget-check.ts`) on the fence body before finishing. **`reef-widget` fences are not passed to highlight.js** — mount runs before hljs so the unknown `reef-widget` language warnings do not spam the console during stream or after mount.

**JSX guard:** Before Babel, the iframe runner auto-quotes `color: var(--mn-fg)` → `color: 'var(--mn-fg)'` in widget scripts (`widget-jsx-guard.ts`); prompts tell models to quote tokens in `style={{ }}` (bare `var()` is valid only in `<style>` CSS).

**Iframe sizing:** Host owns iframe width (100% of bubble) and height (from prelude `resize` messages). Widgets must not set outer iframe dimensions or `100vh`. Prelude posts resize on load plus delayed passes (0 / 100 / 400 ms), then `validateResult` (~500 ms) so the host can reveal or show errors before the user sees a broken iframe.

**Tests:** `test/chat/reef/*.test.mts`, `test/chat/reef/*.test.mjs` (template/snippet conventions, `reef-prompts-catalog.test.mjs`, `reef-save-prompt.test.mjs`). Plan: [`documentation/plans/feature-reef-mode-widgets.md`](plans/feature-reef-mode-widgets.md), expansion: [`documentation/plans/reef-widget-library-expansion.md`](plans/reef-widget-library-expansion.md). Verification: [`documentation/plans/verification/feature-reef.md`](plans/verification/feature-reef.md).

**Send path:** `buildComposeContext()` sets `modeId` (and `orchestratePlanPath` when mode is Orchestrate) from active chat → `composeSystemPrompt()` loads `kind: mode` fragment with `{{orchestrate_plan}}` where applicable → `getEnabledToolDefinitionsForMode(modeId)` filters tools in `loop.ts`.

**Plan** denies destructive tools at the API (shell, file writes outside `documentation/plans/`, git mutations per `registry.ts`).

**Deep Research (dedicated panel, not a composer mode):** Full-page **`#/research`** (legacy) / **`#/app/research`** (MinnowOS). Handoff-aligned UI in `#researchView.dr` (`.dr-*` layout in `src/styles/research-page.css`). **Run** tab: query textarea, rounds (Auto/1–5), category (Auto/technical/academic/news/market/general), optional search/provider/model overrides, **Research** / **Cancel**, live **progress stepper** + source feed (`src/research/progress-panel.ts`; feed titles link to sources in a new tab), structured in-app brief (`parse-brief.ts`, `report-view.ts` — TL;DR, findings, sources, follow-ups), **Export** (visual report — Electron preview or new tab), **Discuss**, **Refine**, **Run again**. Completion calls `noteAgentMessage('research', …)` for OS notification badges. Concierge **seed** auto-starts a run via `openResearch({ seed, autoRun: true })`. **Library** tab: compact search/sort/archived toolbar + 2-column card grid; card overflow menu for report/discuss/refine/archive/delete (`src/research/library.ts`). Library sort (`recent` / `oldest` / `alpha`) parses ISO `completed_at` / `started_at` in `listResearchLibrary()` — do not use `Number()` on ISO strings. **Engine settings** footer link opens Settings → Deep Research. Client: `src/research/{types,client,categories,panel,library,progress-panel,parse-brief,report-view}.ts`. Settings → **Search** + **Deep Research** (`research.json` / `search.json`). Server categories migrated in `server/research/prompts.js` (`normalizeResearchCategory` + legacy aliases for persisted runs). The composer **Research** mode was removed in Phase 7 of [`documentation/plans/deep-research-port.md`](plans/deep-research-port.md). The **`researcher`** sub-agent and **Researcher** work agent remain for orchestrator fan-out. **Server:** `server/research/*`. Plan: [`documentation/plans/research-app-rebuild.md`](plans/research-app-rebuild.md). Tests: `npm run test:research`; UI: `test/ui/research-*.test.mts`, `test/research/progress-panel.test.mts`, `test/research/parse-brief.test.mts`.

**Mode handoff (LLM suggestions):** Shared rules in `src/chat/prompts/tool-usage/mode-handoff.md` — appended by `composeSystemPrompt()` for General, Build, Plan, Orchestrate, and Reef. Host tools (browser, default on): **`propose_mode_switch`** (standard `ask_question` presets), **`set_chat_mode`** (`setChatMode` in `mode-selector.ts`), **`create_chat_with_mode`** (`createChatWithMode` in `sidebar.ts` — optional `orchestratePlanPath`, seed user message). Reef visualization from other modes: **`spawn_sub_agent`** `type: reef-widget` (read-only template tools), post the fence in the parent thread (mounts in any mode; switch to Reef only if the user wants to keep editing widgets). Tests: `test/prompts/mode-handoff-prompt.test.mjs`, `test/tools/mode-handoff-tools.test.mjs`. Plan: [`documentation/plans/Build out/llm-mode-switch-suggestions.md`](plans/Build%20out/llm-mode-switch-suggestions.md).

**Tests:** `test/modes/*.test.mts`, `test/orchestrate/*.test.mts`. Verification: [`documentation/plans/verification/step-05.md`](plans/verification/step-05.md). OpenCode mapping: [`documentation/plans/references/mode-sources.md`](plans/references/mode-sources.md).

### Reef widgets (Phase 2)

Assistant markdown with complete ` ```reef-widget ` fences mounts as sandboxed iframes after the bubble™s final non-streaming render (any mode); while streaming, pending labels replace visible fence code. Host preflight captures `error` / `unhandledrejection` and posts `validateResult` before reveal.

| Concern | Location |
|---------|----------|
| Public API | `src/chat/reef/index.ts` — `mountReefWidgets`, `unmountReefWidgetsInChat`, `initReefBridge` |
| Fence scan + host | `widget-block-detector.ts` (pending UI while bubble streams; iframe when `bubbleStreaming` is false; marks `data-reef-mounted`) |
| iframe srcdoc | `widget-iframe.ts` (CSP, esm.sh import map, prelude, theme CSS) |
| Theme tokens | `theme-forward.ts` (`html[data-theme]` observer) |
| Bridge API | `widget-prelude.ts` (`window.minnow`), `widget-bridge.ts` (postMessage host; origin allowlist `null` + host origin; `event.source` must match registered iframe; host replies use targetOrigin `null`) |
| Widget LLM | `run-widget-completion.ts` (SSE, no tools); overrides `Chat.reefWidgetProviderId` / `reefWidgetModelId` |
| Settings UI | Settings → Modes → Reef (`src/ui/reef-widget-settings.ts`) |
| Styles | `src/styles/reef-widgets.css` |
| Integration | `markdown/renderer.ts` (post-render mount), `main.ts` (`initReefBridge`), `mode-selector.ts` (unmount + re-render on mode change) |

**Tests:** `test/chat/reef/*.test.mts` (24 tests, happy-dom).

**Widget library (snippets):** Six composable `snippet-*.md` files — `snippet-chart-line`, `snippet-chart-bar` (Recharts), `snippet-table`, `snippet-stat-card`, `snippet-input-row`, `snippet-sparkline` (SVG, embed in stat card `.rw-spark`). Full templates (15) cover end-to-end UIs including `qa-callllm` (`callLLM` + `onChunk` streaming). Conventions: description + bullets above one ` ```reef-widget ` fence; **no hex colors** (use `var(--*)` and `color-mix` with forwarded tokens for charts/heatmaps); snippets omit title chrome.

### Expert system (Step 06)

Domain personas under `src/chat/prompts/experts/<id>/` (`expert.full.md`, `expert.lite.md`). User overrides: `~/.minnow/prompts/experts/<id>/`.

| Concern | Location |
|---------|----------|
| Registry | `src/chat/experts/registry.ts`, `expert-meta-parse.ts`, `expert-markdown.ts` |
| Greeting | `src/chat/experts/greet.ts` (`generateExpertGreeting` on new expert chat) |
| Config | `config.json` → `experts.enabled`; loader `src/config/experts-config.ts` |
| Experts hub (MIN-59) | `#/experts` / `#/app/experts`, topbar `#btnExpertLab` → `openExperts()`; `src/ui/experts/experts-hub.ts`, `src/styles/experts-hub.css`, `src/styles/experts-summon.css` — MinnowOS split-pane layout (roster left, MODEL / SYSTEM PROMPT / CHATS detail right, header **New expert**); prototype: `documentation/reference/minnowos/project/src/more-apps.jsx` (`ExpertsApp`); expert-scoped sidebar reuses `chat-new-wide` + `chat-list` + `appendChatRow` |
| Expert-scoped chat | `src/ui/experts/experts-scope.ts`; `#appBody[data-scope=expert]`; sidebar via `src/ui/sidebar.ts` |
| Settings | `src/ui/experts-settings.ts` (enable toggle); Settings → Experts → **Open Experts** |
| Persistence | `Chat.kind === 'expert'`, `Chat.expertId`, `Chat.expertSelection` `{ mode: 'manual', expertId }`; legacy `expert-lab` chats pruned on load |

**Experts:** Full-screen hub — gallery of specialists (each with its own chat list), **Make your own expert** (LLM draft via [`create-expert.ts`](../src/chat/experts/create-expert.ts) + [`expert-creator`](../src/chat/prompts/info/expert-creator.full.md)), **Edit** / **Delete** on user-owned tiles. **New chat** runs a summon overlay (`#expertsSummon`) while `generateExpertGreeting()` seeds the first assistant message, then opens the normal chat shell with a scoped sidebar (only that expert’s threads). Expert chats use the standard composer + `runChatTurn` (attachments, streaming, tools) but **General mode only** — `#modeSelector` and `#composerThinkingWrap` are hidden when `#appBody[data-scope=expert]`; new expert threads get `modeId: 'general'` and `setChatMode` rejects other modes for `kind === 'expert'`. **LM Studio / Qwen Jinja:** seeded greetings stay in UI history but [`foldLeadingAssistantPreamble`](../src/api/provider-message-normalize.ts) folds leading assistant rows into the outbound system block before the first user turn (avoids “No user query found in messages” / Channel Error). First-send **title** jobs are deferred until the main turn completes so title + chat completions do not hit the provider concurrently. Prompt injection: manual `expertSelection` / `kind: 'expert'` → `resolveExpertContextForSend` → `{{expert}}` part in [`prompt-composer.ts`](../src/chat/prompts/prompt-composer.ts). **No auto-routing** on regular chats. Front matter: `id`, `kind: expert`, `label`, optional `description`, `icon`, `accent`, `tagline`, `greeting` (no routing keywords). APIs: `PUT/DELETE /api/prompts/experts/:id/prompt`, `DELETE /api/prompts/experts/:id`.

**Built-in ids:** `general`, `software-engineer`, `technical-writer`, `data-analyst`, `creative-writer`, `security-reviewer`. Template: `src/chat/prompts/experts/_template/`.

**Config keys (`experts`):** `enabled` (boolean).

**Tests:** `test/experts/**/*.test.mjs`, `test/chat/experts/*.test.mjs`, `test/ui/expert-lab-custom-expert.test.mjs` (hub DOM). Verification: [`documentation/plans/verification/step-06.md`](plans/verification/step-06.md).

### Work Agents (Step 08)

Task-specific agents with per-agent prompts, optional provider/model binding, and composer `work-agent` part.

| Concern | Location |
|---------|----------|
| Types + registry | `src/agents/work-agent-types.ts`, `work-agent-registry.ts` |
| Sampler presets | `src/agents/sampler-types.ts`, `resolve-sampler.ts`, `defaults/work-agent-samplers.json` |
| Binding resolver | `src/agents/resolve-work-agent-binding.ts` |
| Turn resolution | `src/agents/resolve-work-agent.ts`, `set-work-agent.ts` (S09 hook) |
| Shipped prompts | `src/chat/prompts/work-agents/<id>/agent.{full,lite}.md`, `registry.json` |
| Prompt API client | `src/agents/work-agent-prompt-api.ts` |
| Dev UI | `src/ui/work-agent-dev.ts` (`?dev=1` shows `#workAgentSelect`) |
| Persistence | `Chat.workAgentId`, `Chat.workAgentAuto` in `sessions/state.json` |
| User overrides | `~/.minnow/work-agents.json`, `~/.minnow/prompts/work-agents/<id>/` |

**Built-in ids:** `default`, `general` → General mode, `build` → `builder`, `plan` → `planner`, plus `reviewer` and `researcher` (manual / sub-agent fan-out; no composer Research mode). Mode auto-map via `defaultForModes` when `workAgentAuto` is true (default).

**Send path:** `resolveActiveWorkAgent()` → `resolveComposedSystemPrompt()` sets `workAgentId` / `workAgentLabel` → `resolveWorkAgentBinding()` picks provider + model **per turn** (does not overwrite `chat.modelId`). **`resolveSamplerPreset({ kind: 'work-agent' })`** merges persisted global `sampler` (+ live drawer overrides for temperature / max tokens) → shipped role defaults (`work-agent-samplers.json`) → `work-agents.json` partial `sampler` override, then `applySamplerToBody()` before `streamCompletionTurn`. Passthrough agent `default` skips role defaults. Optional `allowedTools` filters the tool list. Status pill: `Generating reply (Builder)…`.

**Legacy system prompt:** `#systemPrompt` textarea remains fallback when composed prompt is empty. Full per-agent editor UI deferred to **Step 20**.

**APIs (`npm start`):**

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/work-agents` | `{ agents, overrides }` — includes enabled **pack** agents (`source: "pack"`) |
| `GET` | `/api/work-agents/:id` | Single merged agent |
| `PUT` | `/api/work-agents/:id` | Patch `work-agents.json` override (`providerId`, `modelId`, `sampler`, …) |
| `GET` | `/api/work-agents/:id/prompt?profile=full\|lite` | `{ content, source }` — pack prompts from `~/.minnow/agent-packs/<pack>/` when no user override |
| `PUT` | `/api/work-agents/:id/prompt` | Write `~/.minnow/prompts/work-agents/...` |
| `GET` | `/api/agent-packs` | `{ packs: AgentPackListItem[] }` — scan + validation |
| `GET` | `/api/agent-packs/:id` | Single pack |
| `PATCH` | `/api/agent-packs/:id` | `{ enabled: boolean }` → `agent-packs.json` |

**Agent packs (Feature #16):** Drop-in folders under `~/.minnow/agent-packs/<id>/manifest.json` declare extra work agents with ids `packId.agentKey`. Server: `server/agent-packs/` (`scan.js`, `validate.js`, `routes.js`); client merge: [`src/agents/pack-loader.ts`](../src/agents/pack-loader.ts), [`src/agents/init-work-agents.ts`](../src/agents/init-work-agents.ts); Settings → **Agent packs** (`src/ui/settings-agent-packs.ts`). Schema: [`src/agents/schema/agent-pack.schema.json`](../src/agents/schema/agent-pack.schema.json). Author docs: [`documentation/agent-packs/README.md`](agent-packs/README.md). Plan: [`documentation/plans/Build out/feature-16-agent-pack-plugin.md`](plans/Build%20out/feature-16-agent-pack-plugin.md).

**Tests:** `test/work-agents/**/*.test.mjs`, `test/server/agent-packs-scan.test.mjs`, `test/agents/pack-loader.test.mts`, `test/agents/sampler-resolve.test.mts`. Verification: [`documentation/plans/verification/step-08.md`](plans/verification/step-08.md).

### Workspace folder (AI project root)

The **workspace** is the directory where file/git/terminal tools and the file tree operate. It defaults to the directory where `npm start` was launched; users change it from the **folder** button (`#btnWorkspace`) via a **recent workspaces menu** (feature B1), not an immediate OS dialog. In **MinnowOS Code**, `#workspacePathLabel` + `#btnWorkspace` reparent into the menubar right cluster beside the model chip ([`workspace-menubar.ts`](../src/os/workspace-menubar.ts)); the top bar keeps an empty `#workspaceControlSlot` home anchor.

**Welcome screen (POLISH-016):** When `GET /api/workspace` reports `isDefault: true` (workspace still equals the Minnow app root), boot opens [`src/ui/welcome-page.ts`](../src/ui/welcome-page.ts) at `#/welcome` instead of the chat shell (`#appBody` hidden). In **MinnowOS**, opening the Code app triggers the same welcome when the workspace is default (`app-host.ts`); `#appBody` stays hidden until a folder is chosen (navigation via OS menubar). **Open project** uses the in-app folder picker; **Create new project** is an inline wizard (name → `POST /api/workspace/mkdir` under `newProjectParent`, usually `~/Projects`); **Recent workspaces** mirrors the top-bar MRU. **Continue in Minnow folder** dismisses welcome for the session only. Full-page routes (`#/settings`, `#/bugs`, `#/benchmark`, `#/experts`) skip auto-welcome on boot. Top bar stays visible with `.topbar--welcome` (brand + Settings only). Open/create controls require `GET /api/tools/ping` (`npm start`); `openWelcome()` re-runs `detectLocalServer()` and `onWelcomeServerAvailabilityChanged()` (from `initApp` after the first ping) refreshes the banner/buttons so MinnowOS does not leave them disabled when the Code app opens before `initApp` finishes.

| Concern | Location |
|---------|----------|
| Server root + MRU | `server/workspace/root.js` — `getWorkspaceRoot()`, `setWorkspaceRoot()`, `touchRecentWorkspacePath()`, `buildRecentWorkspaceList()`; `~/.minnow/config.json` → `workspace.path` + `workspace.recentPaths` (max **10**, MRU order) |
| API | `GET/PUT /api/workspace` (`GET` includes `newProjectParent` for welcome create flow), `POST /api/workspace/pick`, `DELETE /api/workspace/recent` — `server/workspace/middleware.js` |
| Folder picker | In-app browser: `GET /api/workspace/browse`, `POST /api/workspace/mkdir` (create subfolder), [`src/ui/workspace-folder-picker.ts`](../src/ui/workspace-folder-picker.ts), [`src/styles/workspace-folder-picker.css`](../src/styles/workspace-folder-picker.css). UI: breadcrumb path nav, stroke folder icons (`.icon-svg`), file-tree-style rows, footer selection preview, header close + nav icon buttons (Up / New folder). Legacy native picker remains at `POST /api/workspace/pick` (`server/workspace/pick-folder.js`) but **Open new workspace…** uses the in-app UI |
| Client state | `src/state/workspace.ts`, `src/config/workspace-api.ts` (`WorkspaceRecentItem`, `removeRecentWorkspace`) |
| Workspace UI | `src/ui/workspace-button.ts` (`applyWorkspaceSwitch`, `#workspacePathLabel` full path left of `#btnWorkspace`), `src/os/workspace-menubar.ts` (Code app → menubar right, beside model chip), `src/ui/workspace-recent-menu.ts`, `src/styles/workspace-menu.css` (current workspace: `--accent-dim` + ink border; hover: light `--code-inline-bg`, not `--accent-subtle`) |
| Prompt `{{cwd}}` | `src/chat/prompts/compose-context.ts` → `resolveComposeCwd()` uses workspace path when set |

**Menu UX:** Click `#btnWorkspace` → popover (right-aligned to the button, opens left) lists up to 10 recent paths (checkmark on current, muted + **Remove** when folder missing); selecting an existing path `PUT`s without the picker; divider then **Open new workspace…** opens the centered folder browser (current folder pinned at top with **This folder**, indented subfolders with › chevrons, **Folders** section label, Up, **New folder** when inside a directory, double-click to drill down, **Open folder** / Cancel, Escape / overlay dismiss). Starts at the current workspace when set; browse roots show Home (+ drive letters on Windows). Offline (`npm run dev`): same error as before (no menu). `applyWorkspaceSwitch()` refreshes label, file tree, and calls `applyWorkspaceScopedSession()` when B2 workspace-scoped chats are enabled.

**Server wiring:** `server/runtime/path-access.js` `resolveSafePath` (canonical boundary via [`server/workspace/safe-path.js`](../server/workspace/safe-path.js) `fs.realpathSync`), git, `execute_command`, terminal default cwd, and LSP path checks use `getWorkspaceRoot()` (or `getEffectiveWorkspaceRoot()` when `POST /api/tools` passes a validated `workspaceRoot`). Vite and built-in skills/prompts still resolve from the Minnow app root (`getAppRoot()` / `setAppRoot()` for packaged hosts).

### Chats workspace (MinnowOS Chat App — step 1)

Sandbox under **`~/.minnow/chats/`** for chat-scoped files (attachments, exports). Bootstrapped by `ensureChatsWorkspace()` in [`server/runtime/bootstrap.js`](../server/runtime/bootstrap.js) (also scaffolded in `ensureMinnowLayout()`).

| Concern | Location |
|---------|----------|
| Paths + allowlist | [`server/chats-workspace/paths.js`](../server/chats-workspace/paths.js) — `getChatsWorkspacePath()`, `ensureChatsWorkspace()`, `isAllowedWorkspaceRoot()` (Code workspace **or** chats path), `resolveSafeChatsPath()` |
| List / download | [`server/chats-workspace/list.js`](../server/chats-workspace/list.js), [`server/chats-workspace/routes.js`](../server/chats-workspace/routes.js) |
| API | `GET /api/chats-workspace` (`{ path, fileCount }`), `GET /api/chats-workspace/list?path=`, `GET /api/chats-workspace/download?path=` — [`server/chats-workspace/middleware.js`](../server/chats-workspace/middleware.js) |
| Tool override | `POST /api/tools` optional `workspaceRoot` — validated against allowlist; scoped via `runWithToolContext` / `getEffectiveWorkspaceRoot()` in [`server/runtime/path-access.js`](../server/runtime/path-access.js) |
| Client | [`src/lib/chats-workspace.ts`](../src/lib/chats-workspace.ts) — `getChatsWorkspacePath()`, `fetchChatsWorkspaceInfo()`, `listChatsWorkspaceFiles()`, `downloadChatsWorkspaceFile()` |

**Tests:** `test/chats-workspace/api.test.mjs`, `test/workspace/workspace-api.test.js`, `test/workspace/safe-path.test.js`, `test/ui/workspace-recent-menu.test.mjs`, `test/ui/welcome-page.test.mjs`. Verification: [`documentation/plans/verification/feature-04.md`](plans/verification/feature-04.md).

### Assistant session scope (MinnowOS Chat App — step 2)

Assistant chats live in session state with `workspacePath` set to the chats sandbox (`~/.minnow/chats`). They are separate from Code workspace chats and hidden from the Code sidebar.

| Concern | Location |
|---------|----------|
| Session field | `SessionState.lastActiveChatIdByApp` — e.g. `{ chat: '<chat-id>' }` in [`src/types.ts`](../src/types.ts) |
| Pure helpers | [`src/state/session-workspace-scope.ts`](../src/state/session-workspace-scope.ts) — `getChatsForChatsWorkspace`, `getAssistantChats`, `createAssistantChat`, `resolveActiveAssistantChatId`, `rememberActiveChatForApp` |
| Sessions API | [`src/state/sessions.ts`](../src/state/sessions.ts) — `activateAssistantChatForApp`, persists `lastActiveChatIdByApp` when the Chat app is foreground |
| Client | [`src/state/chat-app-sessions.ts`](../src/state/chat-app-sessions.ts) — `isAssistantChat`, `ensureActiveAssistantChat()` |
| Code sidebar filter | [`src/ui/sidebar.ts`](../src/ui/sidebar.ts) — excludes chats whose `workspacePath` matches the chats sandbox (`isChatsWorkspacePath`) |
| Path helpers | [`src/lib/chats-workspace.ts`](../src/lib/chats-workspace.ts) — `getCachedChatsWorkspacePath`, `isChatsWorkspacePath` |

New assistant chats default to `modeId: 'general'`, `workAgentAuto: true`, and the chats workspace path.

### Chat app UI shell (MinnowOS Chat App — step 3)

Full-page Chat app at `#/app/chat` with session rail, message scroll shell, composer, and collapsible outputs drawer.

| Concern | Location |
|---------|----------|
| Markup | `index.html` — `#chatView` (`.chat-app-page`): `#chatAppSessionList`, `#chatAppArea`, `#chatAppInput`, `#chatAppSendBtn`, `#chatAppFiles` |
| Styles | [`src/styles/chat-app.css`](../src/styles/chat-app.css) — layout ported from prototype `apps.css` |
| Page module | [`src/ui/chat-app.ts`](../src/ui/chat-app.ts) — `openChatApp(seed?)`, `closeChatApp()`, `initChatApp()`, session rail via `getAssistantChats` + `appendChatRow` |
| OS host | [`src/os/app-host.ts`](../src/os/app-host.ts) — reparents `#chatView` into `#osAppsLayer`; `openAppPage('chat')` → `openChatApp` |
| Registry copy | [`src/os/app-registry.ts`](../src/os/app-registry.ts) — “General assistant — tools, files, and app routing” |

Messaging send loop is wired (step 5); outputs file tree + download is wired (step 6).

### Composer / transcript mount refactor (MinnowOS Chat App — step 4)

Code and Chat apps share send + history render paths via parameterized DOM surfaces.

| Concern | Location |
|---------|----------|
| Composer surface | [`src/ui/composer-surface.ts`](../src/ui/composer-surface.ts) — `getActiveComposerSurface()`, `resolveComposerSurface()`, `registerComposerSurface()`; Chat → `#chatAppInput` / `#chatAppSendBtn`, Code → `#msgInput` / `#sendBtn` |
| Chat mount | [`src/ui/chat-mount.ts`](../src/ui/chat-mount.ts) — `resolveChatMount()`, `getActiveChatMountElement()`, `runWithChatMount()`; Chat foreground → `#chatAppArea` |
| History render | [`src/ui/messages.ts`](../src/ui/messages.ts) — `renderChatFromHistory(chat, mount?)` (default `#chatArea`); non-Code mounts skip hub/board/plan Code-only branches |
| Send loop | [`src/tools/loop.ts`](../src/tools/loop.ts) — `sendMessageWithTools(composer?)`, `RunChatTurnOptions.composerSurface`; tool-call paint uses `getActiveChatMountElement()` |
| Messaging API | [`src/chat/messaging.ts`](../src/chat/messaging.ts) — `sendMessage(composer?)` delegates to `sendMessageWithTools` |
| Streaming affordance | [`src/ui/composer-send.ts`](../src/ui/composer-send.ts) — steer/stop/send button state reads `getActiveComposerSurface()`; Chat app uses dedicated `#btnChatAppStop` |
| Foreground detect | [`src/ui/chat-mount.ts`](../src/ui/chat-mount.ts) — `isChatAppForeground()` (OS shell or `#/app/chat` hash) drives composer, mount, stream DOM, and tool `workspaceRoot` |
| Tool workspace | [`src/tools/client.ts`](../src/tools/client.ts) — `executeServerTool` sends `workspaceRoot` from `getChatsWorkspacePath()` when Chat app is foreground |
| Approvals / Q&A | [`index.html`](../index.html) — `#chatAppToolApprovalHost`, `#chatAppQuestionHost`; modals resolve hosts via `isChatAppForeground()` |

### Chat app messaging (MinnowOS Chat App — step 5)

| Concern | Location |
|---------|----------|
| Send / stop | [`src/ui/chat-app.ts`](../src/ui/chat-app.ts) — `handleChatAppSend()` → `ensureActiveAssistantChat()` + `sendMessage()` / `handleComposerPrimaryAction()` (steer); `#btnChatAppStop` → `stopGeneration()` |
| Transcript | `renderChatFromHistory(chat, '#chatAppArea')` on send end, thread switch, and `subscribeChatStreamEnd` |
| Session rail | `appendChatRow` + `activateAssistantChat`; new chat via `createAssistantChat` (General mode) |
| Attachments | Shared `#fileInput` + `#chatAppAttachPreview`; [`initAttachments()`](../src/attachments/store.ts) wires `#btnChatAppAttach` |
| Stream DOM | [`isStreamDomVisible`](../src/chat/streaming-state.ts) returns true when `isChatAppForeground()` |

**Tests:** `test/state/chat-app-sessions.test.mts`.

### Chat app outputs panel (MinnowOS Chat App — step 6)

| Concern | Location |
|---------|----------|
| List / download API | [`src/lib/chats-workspace.ts`](../src/lib/chats-workspace.ts) — `listChatsWorkspaceFiles(path?)`, `downloadChatsWorkspaceFile(relativePath)` |
| Outputs UI | [`src/ui/chat-app-outputs.ts`](../src/ui/chat-app-outputs.ts) — lazy tree in `#chatAppFilesBody`, per-file download, empty state |
| Refresh | Debounced (~300ms) after successful mutating `executeTool` when Chat app is foreground — `scheduleChatAppOutputsRefreshAfterTool` via [`runWithFileTreeAutoRefresh`](../src/ui/file-tree-auto-refresh.ts); also `refreshChatAppOutputsPanel()` on open, surface render, and `subscribeChatStreamEnd` |
| Styles | [`src/styles/chat-app.css`](../src/styles/chat-app.css) — `.chat-app-outputs-tree`, row + download button |
| Collapse | `#btnChatAppOutputsToggle` in [`src/ui/chat-app.ts`](../src/ui/chat-app.ts) toggles `.is-collapsed` on `#chatAppFiles` |

**Tests:** `test/ui/chat-app-html.test.mjs` (markup), `test/chats-workspace/api.test.mjs` (list/download allowlist).

### launch_minnow_app tool (MinnowOS Chat App — step 7)

| Concern | Location |
|---------|----------|
| Tool definition | [`src/tools/definitions.ts`](../src/tools/definitions.ts) — `launch_minnow_app({ app_id, seed? })`, browser-native (`serverRequired: false`) |
| Executor | [`src/tools/os-launch-tool.ts`](../src/tools/os-launch-tool.ts) — calls [`launchApp`](../src/os/router.ts); returns JSON `{ ok, appId, hash }` |
| Browser routing | [`src/tools/browser-executor.ts`](../src/tools/browser-executor.ts) — `case 'launch_minnow_app'` |
| Default enable | [`src/config/defaults.ts`](../src/config/defaults.ts) — enabled with `ask` permission (General-mode approval gate) |
| Prompt guidance | [`src/chat/prompts/tool-usage/launch-minnow-app.md`](../src/chat/prompts/tool-usage/launch-minnow-app.md) — appended in General mode when tool enabled ([`prompt-composer.ts`](../src/chat/prompts/prompt-composer.ts)) |

**Tests:** `test/tools/launch-minnow-app.test.mts`.

### Menubar polish (MinnowOS Chat App — step 8)

| Concern | Location |
|---------|----------|
| Session rail toggle | [`src/os/menubar.ts`](../src/os/menubar.ts) — `.mn-os-mb-chat-toggle` visible when Code or Chat is foreground ([`menubar-visibility.ts`](../src/os/menubar-visibility.ts)); Chat calls [`toggleChatAppSessionRail()`](../src/ui/chat-app.ts) |
| Rail collapse | [`src/ui/chat-app.ts`](../src/ui/chat-app.ts) — `applyChatAppRailVisuals()`, mobile-only `.is-rail-hidden` on `#chatView` |
| Concierge seed | [`openChatApp(seed?)`](../src/ui/chat-app.ts) — `applyConciergeSeed()` auto-sends first user message when history is empty (concierge + `launch_minnow_app`); [`clearForegroundSeed()`](../src/os/instances.ts) drops instance seed after a successful send |
| App copy | [`src/os/app-registry.ts`](../src/os/app-registry.ts) — Chat `description`: “General assistant — tools, files, and app routing”; grid tiles show `description` via [`desktop.ts`](../src/os/desktop.ts) |
| Workspace menubar | [`workspace-menubar.ts`](../src/os/workspace-menubar.ts) — repo picker only when Code is foreground (lives in `.mn-os-mb-right` beside the model chip) |

### Chat app tests and verification (MinnowOS Chat App — step 9)

| Area | Test file |
|------|-----------|
| HTML shell (`#chatView`, composer, outputs) | [`test/ui/chat-app-html.test.mjs`](../test/ui/chat-app-html.test.mjs) |
| Assistant session filter + `lastActiveChatIdByApp` | [`test/state/chat-app-sessions.test.mts`](../test/state/chat-app-sessions.test.mts) |
| Chats workspace path guard + download API | [`test/chats-workspace/api.test.mjs`](../test/chats-workspace/api.test.mjs) |
| `launch_minnow_app` executor (incl. `chat` + seed) | [`test/tools/launch-minnow-app.test.mts`](../test/tools/launch-minnow-app.test.mts) |
| OS `launchApp('chat')` / `openChatApp` / `closeChatApp` + seed | [`test/os/router.test.mts`](../test/os/router.test.mts) — `chat app OS integration` describe block; [`test/ui/chat-app-lifecycle.test.mjs`](../test/ui/chat-app-lifecycle.test.mjs) (source contracts) |
| Menubar session-rail toggle (Code vs Chat) | [`test/os/menubar-chat-toggle.test.mts`](../test/os/menubar-chat-toggle.test.mts) |
| Chat launcher copy | [`test/os/app-registry-chat.test.mts`](../test/os/app-registry-chat.test.mts) |

**Router seed:** [`launchApp`](../src/os/router.ts) stashes `pendingLaunchOptions` (concierge `seed`) when navigation is hash-only so `launchApp('chat', { seed })` from `#/desktop` still reaches [`launchInstance`](../src/os/instances.ts).

**Node test loader:** [`test/test-loader.mjs`](../test/test-loader.mjs) stubs `*.css?url` (e.g. `highlight.js` in [`theme.ts`](../src/ui/theme.ts)) so importing [`chat-app.ts`](../src/ui/chat-app.ts) under `tsx --test` does not throw on `export default {};?url`.

Run subset: `node --test test/ui/chat-app-html.test.mjs test/chats-workspace/api.test.mjs` and `npx tsx --import ./test/test-loader.mjs --test test/state/chat-app-sessions.test.mts test/tools/launch-minnow-app.test.mts test/os/router.test.mts`.

### File panel (Step 11)

Project file explorer (right) and editable CodeMirror viewer in a horizontal split with chat.

| Concern | Location |
|---------|----------|
| File tree | `src/ui/file-tree.ts` — lazy `list_directory`, expand/collapse, `refreshFileTree()` after manual refresh, workspace switch, viewer save, and tree CRUD. `invalidateFileTreeCache()` also busts session `list_directory` / `find_files` tool-cache entries for the workspace (file tree uses `executeTool` without `chatId`). **`src/ui/file-tree-auto-refresh.ts`** schedules a debounced (~300ms) `refreshFileTree()` after successful mutating `executeTool` results (`save_file`, `append_file`, `insert_at_line`, `replace_text_in_file`, `make_directory`, `move_file`, `copy_file`, `delete_path`) when the file-tree server is up; wired via `runWithFileTreeAutoRefresh` in `src/tools/client.ts`. |
| **Name filter (F19)** | `#fileTreeSearch` — debounced subsequence match on basename; filter mode BFS-indexes via `list_directory` (skips `.git`, `node_modules`, `dist`, `.minnow`) and shows flat results; browse mode when query empty. `src/ui/file-tree-filter.ts`, `src/ui/file-tree-search.ts`. Phase 2 content search not shipped. |
| Viewer | `src/ui/file-viewer.ts` — multi-tab strip (`src/ui/file-viewer-tabs.ts`, `#fileViewerTabs`); per-tab state in `src/ui/file-viewer-tab-store.ts` (one CodeMirror mount for the active tab; buffer snapshotted on switch). **Workspace tabs** persist in `filePanel.openViewerTabs` + `activeViewerTab` (max 20); **chat attachment / image tabs** are ephemeral (`.minnow/attachments/…`, not restored on reload). Re-open same workspace path **focuses** the existing tab. `read_file` / `read_file_range` / `save_file`; workspace images as read-only preview; **`.md` / `.markdown`** GFM preview by default with right-click **Open as code** / **Open as preview**; code-ref / go-to-definition activate the target tab; selection right-click **Add selection to chat** / **Quick edit**; Save + Ctrl/Cmd+S (active tab); header **Close** closes active tab and hides split when empty; large files (>512 KB) read-only excerpt; LSP only on active document |
| Layout | `src/ui/file-layout.ts`, `src/ui/init-file-panel.ts` |
| **Preview browser (MIN-105 / MIN-112)** | `src/ui/preview-panel.ts` — toggle `#btnPreviewToggle` in `#fileSidebar` header (`.file-sidebar-preview-toggle`; stays visible on collapsed rail, stacked under `#btnFileSidebarCollapse`; `is-active` when `rightPaneMode === 'preview'`). Right split pane `#previewPane` (mutually exclusive with `#fileViewerPane` in v1). Workspace HTML/assets via `GET /api/preview/file/*` ([`server/preview/middleware.js`](../server/preview/middleware.js), same `resolveSafePath` as tools; blocks `node_modules`, `dist`, `.git`, `.vite`, `.minnow`; caps concurrent streams). **Electron:** embedded guest is a `WebContentsView` (`partition: persist:minnow-preview`, sandbox + context isolation) positioned over `#previewBody` through `window.minnow.preview` IPC ([`electron/preview-host.ts`](../electron/preview-host.ts), [`electron/preload.ts`](../electron/preload.ts)); new-tab navigations open in the system browser; media/geolocation/notifications denied by default. **Desktop (default):** `npm start` auto-launches Electron ([`scripts/spawn-electron.mjs`](../scripts/spawn-electron.mjs)). Preview guest: Chromium `WebContentsView` ([`electron/preview-host.ts`](../electron/preview-host.ts)) with a dedicated session ([`electron/preview-session.ts`](../electron/preview-session.ts)) that strips `X-Frame-Options` / `frame-ancestors` (fixes `ERR_BLOCKED_BY_RESPONSE` on sites like Google). Workspace files load via **`webContents.loadFile`** (not the Vite URL) so the SPA `index.html` is not served by mistake; HTTP preview still serves `/api/preview/file/*` with an injected `<base href>` for relative assets ([`server/preview/middleware.js`](../server/preview/middleware.js)). Address bar: workspace paths, `https://…`, `file://…`, Windows/Unix absolute paths. Set `MINNOW_BROWSER=1` for a system browser tab. **Browser-only fallback:** `#previewFrame` + embed-block hints ([`preview-embed-detect.ts`](../src/ui/preview-embed-detect.ts)). Topbar back/forward/reload, address bar, loading spinner, **Auto-reload** (`preview.reload()` in Electron, 250ms debounce on `emitFileSaved`). Persisted: `filePanel.rightPaneMode`, `previewSource`, `previewAutoReload`. Distinct from CDP screencast mirror (POLISH-011). |
| Preview events | `src/state/preview-events.ts` — `emitFileSaved` / `onFileSaved` |
| Parser | `src/lib/list-directory-parse.ts` |
| State / prefs | `src/state/file-panel.ts` → `config.json` `filePanel` via `GET/PUT /api/config/meta` |
| Styles | `src/styles/file-panel.css`, `src/styles/preview-panel.css` |
| Markup | `index.html` — `#fileSidebar`, `#workspaceSplit`, `#fileViewerPane`, `#previewPane` |

**Tree row density (E4 / feature-21):** Default rows are compact (`min-height: 0`, tighter padding in `file-panel.css`); `@media (pointer: coarse)` restores `min-height: var(--touch-min)` (44px) and touch padding. Row hover/selection matches chat sidebar (`.chat-item-row`): fine-pointer `--surface-elevated` hover, `--accent` border when selected. Depth indent: `src/ui/file-tree-indent.ts` (`FILE_TREE_DEPTH_INDENT_PX` = 12, dir/file base 6 / 24), re-exported from `file-tree.ts`.

**Server:** Tree and viewer call `executeTool()` directly (`POST /api/tools`); tool catalog toggles in Settings are **not** required. Offline (`npm run dev`): empty state “Start with `npm start`…”. On boot, after `detectLocalServer()`, `initFilePanel()` and `onFilePanelServerAvailabilityChanged()` load the tree when the server is up (no need to open the Files panel or click refresh).

**Persistence (`filePanel`):** `fileSidebarCollapsed`, `viewerOpen` (legacy; kept in sync with `rightPaneMode`), `rightPaneMode` (`viewer` | `preview` | null), `previewSource` (`workspace` path or `url`), `previewAutoReload`, `splitRatio` (0.35–0.75), `expandedDirs`, `selectedPath`, `openViewerTabs`, `activeViewerTab` (workspace paths only; `selectedPath` stays in sync with the active tab for tree highlight), `treeRoot`. **Workspace switch** clears viewer tabs (`applyWorkspaceSwitch` in `workspace-button.ts`). Legacy configs with only `selectedPath` migrate into `openViewerTabs` on load. No dedicated `localStorage` key when config API is up.

**Phase 2 — drag to composer:** File and folder rows in `src/ui/file-tree.ts` are draggable via `wireTreeRowDrag` (`effectAllowed` `copyMove` for composer copy + tree move; `suppressClick` after drag so clicks still open the viewer). Drop on `#msgInput` / `.input-bar` calls `attachWorkspacePathToComposer()` in `src/ui/workspace-composer-link.ts` (wired from `src/ui/composer-drop.ts`, MIME `application/x-minnow-workspace-file`): **text/code files** insert the project-relative path into the composer (agents use `read_file`; matches `path/to/file` in the base prompt). **Images** still queue a workspace chip (`kind: workspace`) and on send `resolveWorkspaceReferences()` loads bytes via `src/attachments/workspace-image-read.ts` → `kind: image` + `dataUrl` for VLM (`[image: name]` + `image_url` parts in `src/tools/loop.ts`). Paperclip / OS file picker attachments are unchanged (inlined `<file>` blocks for text/PDF).

**Tree CRUD (E1 / feature-18):** Context menu + shortcuts on file/folder rows call `executeTool` (`.file-tree-context-menu` uses light `--bg` popover like `workspace-menu`, not `--surface-elevated`) (`delete_path`, `move_file`, `copy_file`, `save_file`, `make_directory`) through [`src/ui/file-tree-ops.ts`](../src/ui/file-tree-ops.ts) with the same permission/approval gate as chat tools. **Rename (BUG-018):** **Rename…** / **F2** use inline edit on the tree row ([`file-tree-rename.ts`](../src/ui/file-tree-rename.ts) → `commitRename` → `move_file`), not `window.prompt`; cancel/unchanged names show status text; **F2** works with CodeMirror focused when a file is open in the viewer. **New file / folder:** folder row or empty-tree background → **New File…** / **New Folder…** opens an inline name field ([`file-tree-create.ts`](../src/ui/file-tree-create.ts) → `commitCreate` → `save_file` / `make_directory`), same input styling as rename; parent folder auto-expands; blocked while the file filter is active. Clicks and key events on rename/create inputs stop propagation so caret placement and typing (including Space) do not open files or toggle folders. `EBUSY`/`EPERM` from `move_file` map to actionable status messages. Feedback via top-bar `setStatus` (not a floating toast). Path helpers: [`src/ui/file-tree-path.ts`](../src/ui/file-tree-path.ts), clipboard: [`src/ui/file-tree-clipboard.ts`](../src/ui/file-tree-clipboard.ts). Menu UI: [`src/ui/file-tree-context-menu.ts`](../src/ui/file-tree-context-menu.ts). Server flag for browse/CRUD: [`src/ui/file-tree-server.ts`](../src/ui/file-tree-server.ts) (synced from `init-file-panel.ts`). **Tests:** `test/file/file-tree-ops.test.mts`; UI modules under tsx use [`test/test-loader.mjs`](../test/test-loader.mjs) (stubs xterm CSS).

**Internal tree move (E3 / feature-20):** Drop a file or folder onto a **folder row** in `#fileTreeHost` → [`showMoveConfirmDialog`](../src/ui/file-tree-move-dialog.ts) (inline `#fileTreeMoveConfirm` strip in `#fileSidebar`, not a native dialog) → [`movePath`](../src/ui/file-tree-ops.ts) via existing `move_file` (no new REST route). Delegation: [`src/ui/file-tree-dnd.ts`](../src/ui/file-tree-dnd.ts) (`initFileTreeDnD` from `init-file-panel.ts`; `dragover` uses `activeDragSourcePath` from capture `dragstart` because `DataTransfer.getData` is empty during `dragover`). Invalid drops (cycle, same parent) use `computeMoveDestination` in `file-tree-path.ts`.

**Tests:** `test/file/list-directory-parse.test.mjs`, `test/file/file-tree-boot.test.mjs`, `test/file/file-tree-filter.test.mjs`, `test/file/file-tree-search.test.mjs`, `test/file/file-tree-filter-render.test.mjs`, `test/file/file-tree-layout.test.mjs` (E4 indent constants), `test/file/file-viewer-save.test.mjs` (happy-dom + tsx), `test/file/file-viewer-tab-store.test.mts`, `test/file/path-utils.test.mjs` (path + `computeMoveDestination`), `test/file/file-tree-move-dialog.test.mjs`, `test/file/file-tree-dnd.test.mjs`, `test/file/file-tree-ops.test.mts`, `test/file/file-tree-auto-refresh.test.mts`, `test/workspace-ref.test.ts`, `test/attachments/image-path.test.ts`, `test/server/preview-middleware.test.mjs`, `test/ui/preview-panel.test.mts`, `test/state/file-panel-preview.test.mts`, `scripts/step-11-smoke.mjs`. Plan: [`documentation/plans/Build out/file-viewer-tabs.md`](plans/Build%20out/file-viewer-tabs.md). Verification: [`documentation/plans/verification/step-11.md`](plans/verification/step-11.md), [`documentation/plans/verification/feature-19.md`](plans/verification/feature-19.md), [`documentation/plans/verification/feature-20.md`](plans/verification/feature-20.md), [`documentation/plans/verification/feature-21.md`](plans/verification/feature-21.md).

### Vibe Coding Hub (empty chat landing)

When the active chat has **no messages**, `renderChatFromHistory()` paints the **Vibe Coding Hub** into `#chatArea` instead of the legacy empty state ([`src/ui/hub.ts`](../src/ui/hub.ts), [`src/styles/hub.css`](../src/styles/hub.css)). The hub relocates `.input-bar` into `#hubComposerSlot` (class `input-bar--hub`, `main-column--hub`) so mode segments sit inside the bordered composer shell; `#contextUsageRing` lives in `#composerControls` after the thinking toggle (`index.html`). In **Orchestrate** mode the plan `<select>` fills the hub input row (not the mode toolbar) via `input-bar--orchestrate-plan`. **Recent threads** (`.hub-tile`) use a title + mode chip row, a single-line relative time, and a single-line last-run stats row (`tok/s · TTFT · tok` spans, nowrap). **Dev server cell** ([`src/ui/hub-dev-server.ts`](../src/ui/hub-dev-server.ts)): workspace-scoped lifecycle driven by **`{workspaceRoot}/startup.md`** (YAML frontmatter: `command`, optional `cwd`, `healthUrl`, `port`, `stop.command`; template [`documentation/templates/startup.md`](templates/startup.md)). **Port** and **network** (This PC vs LAN) are editable in the hub strip and persist under `config.json` → `workspace.devServerSettingsByPath` (debounced on `input`, flushed on `blur` and **before** `POST …/start` so the port field does not revert to `5173`); [`server/dev-server/effective-guide.js`](../server/dev-server/effective-guide.js) merges them at start (health probe on `127.0.0.1`, spawn env `PORT`/`HOST`, Vite-style `--port`/`--host` when applicable). `mergeConfigMeta` preserves `devServerSettingsByPath` / `devServerByPath` when run state is written. Without `startup.md` → **Set up** spawns a `generalPurpose` agent to author it. **Stopped** → primary click **`POST /api/workspace/dev-server/start`** (managed spawn; shell sub-agent fallback if the API fails). Status polls promote **`starting` → `running`** when `healthUrl` becomes healthy. Agents that call **`start_background_command`** with the guide command (or `register_dev_server: true`) sync into the same managed row. **Running** → primary click **`POST /api/workspace/dev-server/stop`**; when **starting** or **running**, a clickable **`#hubDevServerUrl`** link shows the dev URL (`localhost` + hub port, derived from `healthUrl` when set) and opens it in the **in-app preview panel** ([`openUrlInPreviewPanel`](../src/ui/preview-panel.ts)); logs stream in the background via [`ensureDevServerStream`](../src/ui/terminal-panel.ts) into the **Dev server** tab; **Console** opens that tab ([`openDevServerConsole`](../src/ui/terminal-panel.ts)); hub teardown calls [`stopDevServerStream`](../src/ui/terminal-panel.ts). Requires **`npm start`** (`isLocalServerAvailable`); Vite-only shows **server offline**. APIs: `GET /api/workspace/startup`, `GET /api/workspace/dev-server/status`, `GET|PUT /api/workspace/dev-server/settings`, `POST …/start`, `POST …/stop` ([`server/dev-server/manager.js`](../server/dev-server/manager.js)). Run state: `workspace.devServerByPath`. **Mode changes** call `setChatMode()` → `renderChatFromHistory()`; empty chats re-mount the hub. **Orchestrate board** must call `teardownHub()` before replacing `#chatArea` children. `teardownHub()` always **restores `.input-bar` to `#mainColumn` before** removing `#vibeHub` (the bar lives in `hub-composer-slot`). Empty chats selecting **Orchestrate** keep `viewMode: 'chat'` (hub visible) until there is history or an `orchestrateBoard`; use the board toggle to open kanban. Live metrics: `GET /api/workspace/loc`, `GET /api/system/vram`. Intent chips: [`src/ui/hub-intents.ts`](../src/ui/hub-intents.ts) — Build / Plan / Debug / Explain → modes + composer prefill (icons: `/icons/hub-build.png`, `/icons/hub-plan.png`, `/icons/benchmark.png`, `/icons/expert-lab.png`). Tests: `test/ui/hub.test.mts`, `test/ui/hub-dom.test.mts`, `test/ui/hub-dev-server.test.mts`, `test/workspace/startup-parse.test.js`, `test/workspace/dev-server-api.test.js`, `test/workspace/dev-server-manager.test.js`. Plan: [`documentation/plans/hub-dev-server-startup.md`](plans/hub-dev-server-startup.md).

### Sub-agent orchestration (Step 09)

Parent tool loop can spawn **isolated sub-agents** (separate messages, model, tool subset). Results return as JSON aggregate tool results; child transcripts are **not** appended to parent `chat.history`.

**Visibility (feature 30):** Each spawn shows a **sub-agent card** in the parent chat (`src/ui/sub-agent-cards.ts`) with live status; clicking opens a **slide-over drawer** with a **structured outcome** (summary, findings, artifacts) and a collapsible read-only transcript (`src/ui/sub-agent-drawer.ts`, `src/styles/sub-agent-drawer.css`). While a run is active, `src/agents/sub-agent-runner.ts` pushes transcript snapshots through `onMessagesChange` (system/user seed, streaming assistant deltas, tool rounds); `src/agents/orchestrator.ts` copies them onto `run.messages` and emits `sub-agent-events`; the open drawer re-renders on each emit. **`list_sub_agents`** / **`get_sub_agent_status`** are **session-scoped** (any parent turn in the same chat; merged with `chat.subAgentRuns` after reload). Terminal runs are copied into `chat.subAgentRuns` (`PersistedSubAgentRun[]` in `src/types.ts`, including `structuredOutcome` / `budgetEvents`) via `src/state/sub-agent-session-sync.ts` so the drawer works after reload. Spawn rows anchor after the parent tool bubble using `data-tool-call-id` on `.tool-call-msg` (`src/tools/loop.ts`).

**Event-driven completion push (Build / General / Plan / Reef):** `spawn_sub_agent` defaults to **`wait: false`**. When a run settles, [`sub-agent-completion-push.ts`](../src/agents/sub-agent-completion-push.ts) coalesces pending completions and resumes the parent via `resumeParentChatWithMessage` (`suppressUserEcho: true`) once the chat is idle (`notifyChatStreamEnded` from [`loop.ts`](../src/tools/loop.ts)). Copy: [`sub-agent-resume-message.ts`](../src/chat/orchestrate/sub-agent-resume-message.ts). **Orchestrate** mode is excluded (supervisor owns stall recovery). Optional **check-in nudge** (`checkInNudgeMs`, default **120000**, Settings → Sub-agents; `0` disables) fires one non-cancelling parent note while a run is still active. Idempotent delivery tracks `deliveredRunIds`; transport errors retry once.

**Budgets + structured handoff (MIN-43 / feature #7):** Per-type `maxInputTokens` and `contextEnforcementPolicy` (`summarize` | `slide` | `truncate`) are enforced in `sub-agent-runner.ts` via shared [`src/chat/context-budget.ts`](../src/chat/context-budget.ts) before each completion; unrecoverable overflow sets `terminalReason: context_budget`. On success the runner runs a **final non-tool turn** that must parse to `SubAgentStructuredOutcome` (`summary`, `findings[]`, `artifacts[]`) validated against preset `summarySchema` ids in [`sub-agent-summary-schemas.ts`](../src/agents/sub-agent-summary-schemas.ts) (default `minnow.sub-agent.v1`). When the provider probe reports structured output, that final turn may attach `response_format` from [`sub-agent-outcome-response-format.ts`](../src/agents/sub-agent-outcome-response-format.ts) (strip-and-retry on upstream rejection, same pattern as constrained tool calls). **Tool rounds:** if the model returns no `tool_calls` deltas but puts JSON `{"tool_calls":[...]}` in assistant text (common with some local stacks), [`constrained-tool-content.ts`](../src/providers/constrained-tool-content.ts) merges those into normal `ToolCall[]` in both the sub-agent runner and main [`loop.ts`](../src/tools/loop.ts) stream path. If tools are enabled and **no tool round has run yet**, a one-line user **tool-use nudge** (`SUB_AGENT_TOOL_USE_NUDGE_INSTRUCTION` in [`turn-continuation.ts`](../src/tools/turn-continuation.ts)) requests another round before finalization (when `turn < maxToolTurns - 1`). **Preflight:** with the **default** runner only, an empty resolved `modelId` fails fast (`orchestrator.ts` after binding) so runs do not hit the provider with no model; injected test runners skip this gate. **Diagnostics:** empty final completion → `Empty response from provider on final turn`; parse/validation failures include a short text preview in `run.error` / `structuredOutcomeParseError`. The runner uses `StreamingContentAccumulator` plus reasoning-channel fallback (same pattern as benchmarks) for SSE and non-streaming fallback; if the work turn already returned valid outcome JSON in assistant prose, it is accepted without a separate finalization call; when `response_format` yields an empty body, finalization retries once without `response_format`. While a run is **running**, `get_sub_agent_status` / the drawer use `lastMessagePreview` for `summary` and omit `outcome` (no premature “no text output” placeholder). Dev console: `localStorage.minnowDebugSubAgent = '1'` logs work turns and finalization previews (`[sub-agent]` prefix). Parent tools receive `outcome` plus top-level `summary` in aggregate JSON (~32 KB cap in `formatAggregateResult`); full child transcripts stay in the drawer only. Sub-agents are mode-agnostic: any composer mode that exposes `spawn_sub_agent` (Build, Orchestrate, General, etc.) shares this runner.

| Concern | Location |
|---------|----------|
| Types | `src/agents/types.ts` |
| Config merge | `src/agents/sub-agent-config.ts`, `src/agents/defaults/sub-agents.json` |
| Orchestrator | `src/agents/orchestrator.ts` — spawn, cancel, queue, `restartSubAgent`, `cancelAllForParentTurn`, `parentChatRuns` session index, list/status helpers; `deriveSubAgentTerminalReason` + `terminalReason` on `get_sub_agent_status` / aggregate JSON |
| Completion push | `src/agents/sub-agent-completion-push.ts` — terminal delivery + check-in nudge (non-orchestrate) |
| Events | `src/agents/sub-agent-events.ts` |
| Runner | `src/agents/sub-agent-runner.ts` — headless tool loop; global `maxToolTurns` from sub-agents config; context budget enforcement; **`resolveSamplerPreset({ kind: 'sub-agent' })`** (not parent drawer temperature; default `max_tokens` 2048); optional `response_format` on final JSON turn when probed; content-JSON tool merge; tool nudge before premature finalization; structured JSON final turn; accumulates `usage` / `stats` on `SubAgentRun` for Orchestrate metrics rollup (MIN-36) |
| Content-json tool merge | `src/providers/constrained-tool-content.ts` — also wired in `src/tools/loop.ts` `streamCompletionTurn` |
| Structured outcome | `src/agents/sub-agent-structured-outcome.ts`, `src/agents/sub-agent-summary-schemas.ts` |
| Sampler presets | `src/agents/sampler-types.ts`, `resolve-sampler.ts` |
| Tool subset | `src/agents/sub-agent-tools.ts` |
| Prompts | `src/agents/shipped-sub-agent-prompts.ts`, `src/agents/prompts/sub-agents/*.md` |
| Parent tools | `spawn_sub_agent`, `cancel_sub_agent`, `list_sub_agents`, `get_sub_agent_status` in `src/tools/definitions.ts` |
| Executor | `src/tools/sub-agent-executor.ts`; routed in `src/tools/client.ts` |
| Parent abort | `src/tools/loop.ts` — `parentTurnId` + `cancelAllForParentTurn` on `AbortError` |
| Session hydrate | `src/state/sessions.ts` — `ensurePersistedSubAgentRuns` |
| Boot | `src/main.ts` — `initSubAgentUi()` + `startOrchestrateWatchdog()` after `loadSessionsFromStorage()` |

**Built-in types:** `generalPurpose`, `explore`, `shell`, `explorer` (Step 19 self-heal stub, `maxConcurrent: 1`).

**Config (`sub-agents.json`):** root `enabled`, `globalMaxConcurrent`, `defaultTimeoutMs`, **`checkInNudgeMs`** (parent check-in while sub-agent runs; default 120000; `0` off), **`maxToolTurns`** (all sub-agent types; Settings → Tools), optional `defaultMaxInputTokens`, `defaultContextEnforcementPolicy`, `defaultSummarySchema`; per-type `providerId`, `modelId`, `maxConcurrent`, `timeoutMs`, `maxInputTokens`, `contextEnforcementPolicy`, `summarySchema`, optional **`sampler`** (`temperature`, `topP`, `topK`, `minP`, `repetitionPenalty`, `maxTokens`) (Settings → **Sampler** per-type overrides), `allowedTools` (whitelist or null), `deniedTools`, optional `workAgentId`. Legacy per-type `maxToolTurns` and `defaultMaxToolTurns` are migrated on load. Hitting the tool-turn cap sets run status **`failed`** with `terminalReason: max_tool_turns`; context budget exhaustion uses **`context_budget`**. `get_sub_agent_status` exposes **`success: false`** and **`outcome`** when terminal; linked board tasks **`failed`** — never **`complete`** when the run did not succeed (`src/agents/sub-agent-outcome.ts`, `syncBoardTaskOnSettle`, `board_update_task` guard) (MIN-15 / MIN-10). Orchestrate supervisor R2 empty-summary detection prefers `structuredOutcome.summary` (`src/agents/supervisor/detector.ts`).

**Concurrency:** Over-cap spawns stay **`queued`** until a slot frees (FIFO global queue). Slots are tracked with `holdsConcurrencySlot` so cancelled queued runs do not corrupt the cap; `executeRun` wraps prompt setup + runner in one `try/catch` so a failed start always releases the slot and calls `drainQueue()`. Empty per-type `modelId` falls back to the parent chat's `modelId` before `POST /api/generations`.

**Step 19 hooks (exported, not wired):** `restartSubAgent`, `recordToolCallForRun`, `getRunToolCallFingerprint`.

**Persistence:** `GET/PUT /api/config/sub-agents` when `npm start`; client mirror `minnow.subAgents` in `localStorage` when Vite-only. Settled sub-agent transcripts also persist on **`chat.subAgentRuns`** in `sessions/state.json` (capped message list).

**Tests:** `test/sub-agents/**/*.test.mts`, `test/agents/sampler-resolve.test.mts`, `test/agents/sampler-server.test.mjs`. Verification: [`documentation/plans/verification/step-09.md`](plans/verification/step-09.md).

| Method | Path | Purpose |
|--------|------|---------|
| `GET/PUT` | `/api/config/sub-agents` | User overrides for `sub-agents.json` |

### Programmatic prompts API (Step 04)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/prompts/registry` | Built-in + user prompt files parsed |
| `GET` | `/api/prompt-configs` | List custom profiles |
| `GET/PUT/DELETE` | `/api/prompt-configs/:id` | CRUD custom profile JSON |
| `POST` | `/api/prompt-configs/:id/duplicate` | Copy custom composer preset |

### Setup profiles API (Feature #13 / MIN-49)

Portable **Minnow setup profiles** (distinct from terminal **shell profiles**). Stored as `~/.minnow/profiles/<id>.json` (`schemaVersion: 1`). `config.json` tracks `activeSetupProfileId`, `workspaceProfiles` (normalized path → profile id), and `workspaceProfileAutoApply` (default **false**).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/profiles` | List `{ id, label, updatedAt }` |
| `GET/PUT/DELETE` | `/api/profiles/:id` | CRUD bundle |
| `POST` | `/api/profiles/:id/duplicate` | `{ newId, newLabel? }` |
| `POST` | `/api/profiles/:id/activate` | Apply bundle to `config.json`, `tools.json`, `work-agents.json`, `sub-agents.json`, optional `rules.json` / `skills.json`; may mirror embedded `parts` into `prompt-configs/` |
| `POST` | `/api/profiles/capture` | Snapshot current live settings into new/existing id |
| `POST` | `/api/profiles/import` | `{ bundle, mode: 'create' \| 'replace' }` |
| `GET` | `/api/profiles/:id/export` | Download `*.minnow-profile.json` |
| `POST` | `/api/profiles/migrate-from-prompt-configs` | One-shot import `prompt-configs/*.json` → profiles |
| `PUT` | `/api/profiles/workspace-default` | `{ workspacePath, profileId \| null }` |

**Client:** [`src/config/profiles-client.ts`](../src/config/profiles-client.ts). **Server:** [`server/profiles/`](../server/profiles/). **Tests:** `test/profiles/*.test.mjs`.

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
| `GET/PUT` | `/api/config/sessions` | `SessionState` ← `sessions/state.json` |
| `GET/PUT` | `/api/config/tools` | `ToolConfig` ← `tools.json` |
| `GET/PUT` | `/api/config/system-prompt` | `SystemPromptSettings` ← `system-prompt.json` |
| `GET/PUT` | `/api/config/rules` | `UserRulesSettings` ← `rules.json` (Feature 24) |
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
| `PUT` | `/api/providers/:id/secrets` | Update encrypted `secrets.json`; response redacts values |
| `POST` | `/api/providers/:id/set-active` | Sets `config.json` `activeProviderId` |
| `GET` | `/api/providers/:id/models` | Proxy upstream models (auth injected) |
| `POST` | `/api/providers/:id/models/load` | Proxy model load (LM Studio v0) |
| `POST` | `/api/providers/:id/models/unload` | Proxy model unload (LM Studio v0) |
| `GET` | `/api/providers/:id/capabilities` | Read `capabilities.json` (or `{ models: {} }` when missing) |
| `POST` | `/api/providers/:id/capabilities/probe` | Per-model matrix probe; optional `{ modelIds?, selectedModelId? }` |
| `POST` | `/api/providers/:id/probe-capabilities` | Structured-output probe (`response_format` / json_schema); body optional `{ modelId?, selectedModelId? }` — requires a **loaded** model (resolved from catalog when omitted) |

**`capabilities.json`:** Provider-level `structuredOutput`, `structuredOutputWithTools`, `structuredOutputStreaming`, `probeError` (#10). Per-model `vision`, `tools`, `streaming`, `grammar`, `contextLength`, `loadState`, `sources`, `probeErrors` (MIN-48). **Vision catalog signal:** `type === 'vlm'` **or** LM Studio 0.4.8+ upstream `capabilities.vision: true` on `type: llm` rows — normalized to `catalogVision` in [`normalizeModelsResponse`](../server/providers/paths.js) (upstream `capabilities` stripped before merge). Probes run only from **Settings → Providers → Edit provider**: **Probe models** (`POST .../capabilities/probe`; on `lm-studio-v0`, defaults to **loaded** models only, up to 8 — no chat probes against unloaded rows) and **Probe structured output** (`POST .../probe-capabilities`; requires a **loaded** model) are separate actions. **Refresh models** loads the list and merges any existing `capabilities.json` from disk but does not probe. Server: [`capabilities-store.js`](../server/providers/capabilities-store.js), [`capability-probe.js`](../server/providers/capability-probe.js). Client: [`model-capabilities.ts`](../src/providers/model-capabilities.ts), [`capability-probe.ts`](../src/providers/capability-probe.ts) (structured output), [`vision-model.ts`](../src/providers/vision-model.ts), picker [`capability-badges.ts`](../src/providers/capability-badges.ts).

**`apiKind`:** `lm-studio-v0` (default paths `/api/v0/...`) or `openai-v1` (`/v1/...`). **Chat completions** are not proxied on `/api/providers`; all LLM streams use [`/api/generations`](#backend-owned-generations-phase-1).

**Seed:** On first `npm start` with empty `providers/`, creates `lm-studio-local` from legacy `config.json` `serverUrl` or `http://localhost:1234`.

Client: [`src/providers/`](../src/providers/) (`store.ts`, `resolve.ts`, `fetch-models.ts`, `model-capabilities.ts`, `fetch-chat.ts`). Models/load/unload always use `/api/providers/:id/...`; chat uses [`postChatCompletions`](../src/providers/fetch-chat.ts) → `/api/generations` (shim) or [`src/api/generations.ts`](../src/api/generations.ts) (main tool loop).

**Vite-only (`npm run dev`):** No `/api/providers`; client synthesizes a fallback provider id. Settings → **Providers** shows an offline hint and hides the add form until `npm start` is running.

**Settings → Providers** (`#/settings/providers`): lists registered backends from `GET /api/providers`, **Set active**, **Remove** (when more than one), **Add provider**, and per-row **Edit provider** (label, base URL, API style, **models path**, **chat completions path**, auth, enabled, **constrained tool calls** override, **Probe models** / **Probe structured output**, optional new API key → `POST`/`PUT /api/providers` + `PUT .../secrets`). Row badge: `Structured output: yes/no/unknown` from `capabilities.json`. Global **Constrained tool calls** lives under **Settings → Tools** (`config.json` → `toolCalls.useConstrainedDecoding`, default **off**); per-provider override on edit forms. Paths default per `apiKind` (`/v1/...` or `/api/v0/...`); changing API style resets paths when they still match the previous defaults (custom paths e.g. OpenCode Go `/zen/go/v1/...` are preserved). Client: [`src/ui/settings-providers.ts`](../src/ui/settings-providers.ts), [`src/providers/paths.ts`](../src/providers/paths.ts), [`src/providers/store.ts`](../src/providers/store.ts), [`src/config/tool-calls-meta.ts`](../src/config/tool-calls-meta.ts).

**Constrained tool loop:** When enabled and probed capable, [`src/tools/loop.ts`](../src/tools/loop.ts) and [`src/agents/sub-agent-runner.ts`](../src/agents/sub-agent-runner.ts) attach per-turn `response_format` from [`buildToolCallResponseFormat`](../src/providers/tool-call-schema.ts) (enabled tools only, max 8 branches). Upstream **400** mentioning `response_format` / `json_schema` triggers one strip-and-retry without constraints. Invalid or blank tool JSON after a constrained turn surfaces errors via [`parseToolArguments`](../src/tools/parse-tool-arguments.ts) (`Tool arguments were not valid JSON.` / `Tool arguments were empty.`); legacy turns still coerce bad JSON to `{}`. Before `POST /api/tools`, [`validateToolRequiredArgs`](../src/tools/validate-tool-required-args.ts) rejects missing required schema fields (e.g. `read_file` without `path`) with a model-actionable message instead of the server’s `Path is required`. [`mergeContentJsonToolCalls`](../src/providers/constrained-tool-content.ts) keeps streamed tool-call ids but replaces empty SSE `arguments` (`{}`) with the fuller `tool_calls` JSON from assistant `content` when both are present. Generations upstream HTTP errors call `markError` instead of buffering HTML error pages; clients surface `event: end` `status: "error"` via [`postChatCompletions`](../src/providers/fetch-chat.ts) / [`streamCompletionTurn`](../src/tools/loop.ts). Harmony / `gpt-oss` model ids are denylisted. Dev log: `localStorage.minnowDebugConstrained = '1'`.

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

Server URL remains in the settings drawer DOM (not in the session blob). **Temperature** and **max tokens** are edited in the drawer for quick tweaks and persisted under `config.json` → `sampler` (Settings → **Sampler** global defaults); drawer values override saved temperature / max tokens on send when set.

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
    "default": {
      "read_file": "off",
      "web_search": "ask",
      "save_file": "full"
    },
    "perAgent": {
      "sub-agent:shell": { "execute_command": "full" }
    },
    "patterns": [
      {
        "id": "pattern-11111111-1111-1111-1111-111111111111",
        "toolId": "execute_command",
        "agentScope": "*",
        "argPath": "command",
        "match": "startsWith",
        "value": "git status"
      }
    ]
  },
  "keys": {
    "braveApiKey": "",
    "tavilyApiKey": ""
  },
  "webSearchProvider": "duckduckgo"
}
```

- **`permissions`:** layered policy — **`default`** (global per tool id, plus optional `mcp__*` keys), **`perAgent`** (sparse `agentKey → toolId → mode`), **`patterns`** (auto-approve when args match; `startsWith` / `equals` only, max 64). Each mode is **`full`** (no approval strip), **`ask`** (strip before each run), or **`off`** (hidden from the model). Legacy flat `permissions: { "read_file": "ask" }` loads into **`default`** on read ([`normalizeToolConfig`](../src/tools/config.ts), server [`validators.js`](../server/config/validators.js)).
- **`enabled`:** mirrored from **`permissions.default`** only (`true` when not `off`) for backward compatibility.
- **Agent keys:** `main`, `work-agent:<id>` (from chat `workAgentId`), `sub-agent:<type>` (from sub-agent runs). Resolution: [`permission-resolve.ts`](../src/tools/permission-resolve.ts) — pattern match → per-agent → default; global **`off`** is a hard stop.
- **Settings → Tools:** [`mountToolApprovalRulesSection`](../src/ui/tool-approval-settings.ts) — pattern list CRUD and per-agent override matrix below the global tool table.
- **Defaults:** `get_datetime`, `calculate`, `web_search`, `wikipedia_search`, `save_memory`, **`ask_question`**, and mode-handoff tools (`set_chat_mode`, `create_chat_with_mode`, `propose_mode_switch`) enabled on first run; every enabled built-in id uses permission **`ask`** (Requires permission). Other catalog ids default **off** (`defaultToolConfig()` in [`src/config/defaults.ts`](../src/config/defaults.ts)); legacy `tools.json` without a `permissions` block is backfilled the same way ([`normalizeToolConfig`](../src/tools/config.ts), server [`validators.js`](../server/config/validators.js)).
- **UI:** Settings drawer and **Settings → Tools** — `fillToolsSection()` builds grouped rows with a **permission** `<select>` per tool and global/category **Enable all** controls (bulk sets **`ask`** / **`off`**); list `change` delegates to `setToolPermission()` / `setToolsEnabled()` ([`src/tools/config.ts`](../src/tools/config.ts)), `syncToolSelectAllControls()` keeps bulk checkboxes aligned, `loadToolConfigIntoDrawer()` ([`src/ui/settings.ts`](../src/ui/settings.ts)). On the **full settings page**, `renderToolsSection()` ([`src/ui/settings-sections.ts`](../src/ui/settings-sections.ts)) hydrates from in-memory caches (`loadToolConfigForSettingsUi()`, `loadToolSecurityMeta()` — no network on repeat visits; one retry if boot-time `GET /api/config/tools` failed). Generation guard drops stale async renders. Server storage mode does **not** fall back to empty browser `minnow.tools` when `GET /api/config/tools` fails. Adds a server banner, intro copy, **Filesystem access** radios (restrict vs full disk, with confirm when enabling full), then a single **`.settings-tools-panel`** wrapping the tool list and Brave API key row (styles in [`src/styles/settings-page.css`](../src/styles/settings-page.css)); **`.settings-tools-list .tool-group-head`** adds top padding so category headers sit below the list toolbar divider. **Filesystem access** persists as `config.json` → `toolSecurity.filesystemAccess` via [`src/config/tool-security-meta.ts`](../src/config/tool-security-meta.ts). Each time **Settings → Tools** mounts, `clearMount` replaces the Brave key `<input>` — input/change listeners are re-attached on that fresh node so the key still persists when revisiting the section (the one-shot `toolsSectionInitialized` gate only wraps `registerToolHandlers()`).
- **Server gating:** Rows with `data-server-required` dim/disable when `detectLocalServer()` fails (no `npm start` ping). `getEnabledToolDefinitions()` omits server tools from the LM Studio request when the flag is false.
- **Offline UX:** Static Tools hint in [`index.html`](../index.html) (`tools-section-hint`: server tools need `npm start`). When ping fails, `#toolsServerBanner` is shown (“Server tools need npm start (not npm run dev).”), `refreshServerToolDisabledState()` dims server rows, disables permission selects, and sets `title` on each. `setToolPermission` reverts enabling a server tool while offline and calls `setStatus('err', …)` with “Start with npm start to use file/git tools.”
- **Multi-list sync (Feature 28):** `refreshAllToolListUis()` in [`src/tools/config.ts`](../src/tools/config.ts) runs `loadToolConfigIntoDrawer()` then `syncToolSelectAllControls()` on `#toolsList`, `#settingsToolsList`, and `#composerToolsList` ([`src/ui/tools-list.ts`](../src/ui/tools-list.ts); composer variant omits per-tool descriptions). **Tests:** [`test/tools/tools-list-sync.test.mjs`](../test/tools/tools-list-sync.test.mjs) (source contracts + happy-dom runtime sync; `test-loader` stubs xterm/css).

### Ask Question cards (Feature 31)

Structured Q&A from the model via **`ask_question`**: [`executeTool`](../src/tools/client.ts) validates args (`questions[]` with `id`, `prompt`, and `options[]` of `{id,label}` — see [`ask-question-schema.ts`](../src/tools/ask-question-schema.ts) and [`diagnoseAskQuestionItem`](../src/tools/ask-question-types.ts) for field-name hints), queues [`enqueueAskQuestion`](../src/tools/ask-question-queue.ts) (passes **`chatId`** for abort routing and plan-screen embed), and shows [`showQuestionCardsModal`](../src/ui/question-cards-modal.ts) in **`#questionHost`** ([`index.html`](../index.html)) **below** **`#toolApprovalHost`**. One question per card, prev/next carousel, synthetic **Other** row; **single-question single-select** (e.g. browser allowlist) **auto-submits** when an option is chosen; multi-question flows use **Submit answers** on the last card only. **Esc** cancels. [`user-prompt-lock.ts`](../src/ui/user-prompt-lock.ts) refcount keeps the composer disabled across sequential strips (tool approval → allowlist cards) so Stop/Send cannot steal clicks. While open: **`main-column--question-pending`** hides the composer (same pattern as tool approval). **Stop** calls [`forceCloseAskQuestionModal`](../src/ui/question-cards-modal.ts) from [`stop-generation.ts`](../src/chat/stop-generation.ts). Tool results stay JSON in history; the chat bubble uses a numbered list via [`formatAskQuestionResultForDisplay`](../src/ui/format-ask-question-result.ts) and [`renderToolResult`](../src/ui/tool-messages.ts). **Enforcement:** when `ask_question` is enabled, `composeSystemPrompt()` appends [`tool-usage/ask-question-enforcement.md`](../src/chat/prompts/tool-usage/ask-question-enforcement.md); the main tool loop ([`loop.ts`](../src/tools/loop.ts)) and sub-agent runner ([`sub-agent-runner.ts`](../src/agents/sub-agent-runner.ts)) detect multiple-choice prose via [`prose-question-detect.ts`](../src/tools/prose-question-detect.ts) and retry once with an ephemeral correction (`PROSE_QUESTION_RETRY_INSTRUCTION` in [`turn-continuation.ts`](../src/tools/turn-continuation.ts)). **No prose retry on image turns** (pending `dataUrl` or `[image: …]` in history) — dash-bullet descriptions plus an echoed user `?` are not treated as MCQ. **`buildApiMessages`** binds pending `image_url` parts to the user row that contains `[image: …]`, not a later steer line. Work agents that whitelist tools must include `ask_question` where they need user choices (Planner, Orchestrator, UI Designer). Prompt/schema guidance: `tool-usage/default.full.md`, `/ask-user` skill. Styles: [`question-cards.css`](../src/styles/question-cards.css).

### Tool approval (execution gate)

Before `POST /api/tools` or browser tools run, [`executeTool`](../src/tools/client.ts) awaits [`ensureToolConfigReady`](../src/tools/config.ts) then calls [`maybeBlockToolForUserApproval`](../src/tools/permission-gate.ts) (**skipped** for `ask_question` — it uses its own strip). Effective mode comes from [`resolveEffectivePermission`](../src/tools/permission-resolve.ts): matching **patterns** or per-agent **`full`** skip the permission strip even when global mode is **`ask`**; **`full`** still shows the strip when a path argument resolves **outside the workspace** while `toolSecurity.filesystemAccess` is **`workspace`** (strip copy notes “Tool permission is Full, but…” for that case). **General mode** forces **`ask`** before every tool via [`applyGeneralModeApprovalGate`](../src/tools/permission-resolve.ts), even when Settings show **Full** or auto-approve patterns — by design ([`general.full.md`](../src/chat/prompts/modes/general.full.md)). Settings **Grant full permission to all tools** sets global **`permissions.default`** and **`permissions.perAgent['*']`** for built-ins so sub-agents inherit **Full** in Build/Plan/Orchestrate/etc. The strip mounts in **`#toolApprovalHost`** in [`index.html`](../index.html) (above **`#questionHost`**, between **`#chatArea`** and the composer). While it is open, **`#mainColumn`** gets **`main-column--tool-approval-pending`**, which hides **`.input-bar`** (composer) via CSS; the textarea and send button are also disabled until the user chooses **Allow once**, **Always allow** / **Always allow for this agent** (writes **`permissions.default[toolId] = 'full'`** for `main`, or **`permissions.perAgent[agentKey][toolId] = 'full'`** for work/sub agents; **`saveToolConfigAsync`** awaits **`PUT /api/config/tools`** when using `npm start`), or **Cancel** (`Error: User denied tool execution`). Optional digit shortcuts **1 / 2 / 3** apply while the strip is open (not only when a button inside it is focused; the composer is disabled so focus often sits on **`<body>`**). They are suppressed if focus is in another editable control outside the host. **Esc** cancels. Queue: [`src/tools/approval-queue.ts`](../src/tools/approval-queue.ts); payload types: [`src/tools/tool-approval-types.ts`](../src/tools/tool-approval-types.ts); UI: [`src/ui/tool-approval-modal.ts`](../src/ui/tool-approval-modal.ts). Main-loop tools pass `workAgentId` from the chat; sub-agent tools pass `subAgentType` from [`sub-agent-runner.ts`](../src/agents/sub-agent-runner.ts) / orchestrator.

### Path policy (server)

- **Workspace-only (default):** [`server/runtime/path-access.js`](../server/runtime/path-access.js) `resolveSafePath()` keeps paths under `getWorkspaceRoot()` using `path.resolve` plus [`server/workspace/safe-path.js`](../server/workspace/safe-path.js) `realpath` prefix checks (blocks symlink escapes). Full access when **`toolSecurity.filesystemAccess`** in `config.json` is **`full`** or **`TOOLS_ALLOW_ALL_PATHS=1`** (automation escape hatch). Read from disk per tool request via [`server/config/tool-security.js`](../server/config/tool-security.js) and `AsyncLocalStorage` so nested calls stay scoped.

## Persisted message types (`chat.history`)

Types in [`src/types.ts`](../src/types.ts). The UI and `localStorage` use the `Message` union; LM Studio uses `ApiMessage` (built in `buildApiMessages`).

| Role | Stored shape | Notes |
|------|----------------|-------|
| **user** | `{ role: 'user', content: string }` | Plain string only in history. Attachments are **not** stored as binary: images → `[image: filename.jpg]`; text/PDF → `<file name="…">…</file>` blocks in `content`. **Chat UI (MIN-31):** [`renderUserMessageBubble`](../src/ui/user-message-bubble.ts) + [`parseHistoryUserContent`](../src/chat/user-message-parts.ts) show clickable `.msg-attach-chip` instead of inlined file bodies; chips open read-only snapshots in the file viewer. |
| **assistant** (text) | `{ role: 'assistant', content, thinking?, stats?, usage? }` | Markdown-rendered in UI; optional metric chips. **`thinking`** is an optional `string[]` of reasoning segments when LM Studio streams separated reasoning (see **Message rendering**). |
| **assistant** (tools) | `{ role: 'assistant', content: string \| null, tool_calls: ToolCall[] }` | OpenAI-style calls: `id`, `type: 'function'`, `function.name`, `function.arguments` (JSON string). |
| **tool** | `{ role: 'tool', tool_call_id, content }` | Result string for one prior call; paired in UI via `tool_call_id`. |

**API-only (not persisted as separate history rows):** `system` prompt; multimodal user `content` as `ContentPart[]` (`text` + `image_url`) for VLM models on the wire ([`buildApiMessages`](../src/tools/loop.ts)).

**UI rendering:** [`renderChatFromHistory`](../src/ui/messages.ts) skips standalone `tool` rows, maps `tool_call_id` → result, and renders [`tool-messages.ts`](../src/ui/tool-messages.ts) bubbles for each `tool_calls` entry. Empty assistant prose (no text, no `thinking`) is not painted. Assistant rows with **`thinking`** get a **Thoughts** toggle ([`thought-bubbles.ts`](../src/ui/thought-bubbles.ts)) above the bubble. **Live** turns use [`appendStreamingAssistantRow`](../src/ui/messages.ts) / [`revealAssistantProseBubble`](../src/ui/messages.ts) so the prose bubble stays hidden until the first streamed token; tool-only rounds call [`removeOrphanStreamingRow`](../src/ui/messages.ts) instead of revealing an empty shell (MIN-11). Empty finalize completions with no prose and no thinking are not persisted to history.

**Vibe Coding Hub (empty chat):** When the active chat has **no history** (and is not Orchestrate board view), [`renderHub`](../src/ui/hub.ts) replaces the legacy empty-state placeholder inside `#chatArea`. The hub shows an ambient status line (model, tok/s, optional VRAM), workspace heading, **relocates the real `.input-bar`** into a centered slot (`.input-bar--hub` CSS grid: mode strip + thinking + context ring on row 1, plan/message input on row 2, send column spanning both rows; restored on first message via [`teardownHub`](../src/ui/hub.ts)), a project strip (**dev server** cell via [`hub-dev-server.ts`](../src/ui/hub-dev-server.ts) and `startup.md`; LOC; session count; workspace token totals), intent chips (Build / Plan / Debug / Explain → modes + composer prefill via [`hub-intents.ts`](../src/ui/hub-intents.ts)), and up to six recent workspace chats as `.hub-tile` buttons (3×2 grid) (title + mode chip; relative time on its own line; last-run stats on one nowrap mono row). Styles: [`src/styles/hub.css`](../src/styles/hub.css). Live data: [`refreshHubLiveData`](../src/ui/hub.ts) on stats updates, workspace switch, and session save. Server probes (require `npm start`): `GET /api/workspace/loc`, dev-server routes under `/api/workspace/*` ([`server/dev-server/`](../server/dev-server/)), and `GET /api/system/vram` (`nvidia-smi` best-effort).

## Multi-chat sessions

The app supports **multiple chat sessions** with a **collapsible left sidebar**. Persisted in **`sessions/state.json`** when `npm start`, else `minnow-sessions-v1` in `localStorage` (key name unchanged; blob **`version`** is **5**).

| Concern | Location |
|---------|----------|
| Schema + migration | `src/types.ts` (`SESSION_SCHEMA_VERSION = 5`), `src/state/sessions.ts`, `src/state/session-workspace-scope.ts` |
| Server validate / migrate | `server/config/validators.js` (accepts v1–v5 input, persists v5; includes `groups`, `activeBoardGroupId`, `boardGroupId`) |
| Sidebar filter + Unassigned | `src/ui/sidebar.ts`, `src/styles/sidebar.css` |
| Workspace switch hook | `onWorkspaceChanged()` in `sessions.ts`; `applyWorkspaceScopedSession()` in `sidebar.ts`; `applyWorkspaceSwitch()` in `workspace-button.ts` (B1 recent menu uses same path) |

**Lookup before hydrate:** `findChatById` returns `undefined` when `sessionState` is still null (tests, early boot) instead of throwing from `requireSessionState()`, so callers such as sub-agent model binding can fall back to type defaults.

**Workspace-scoped chats (B2):** Each chat has **`workspacePath`** (normalized absolute root at create; `''` = unassigned). The sidebar lists chats for **`getWorkspacePath()`** only; legacy pre-v2 chats appear under a collapsible **Unassigned** section (`workspacePath === ''`). **New chat** binds the current workspace. **Workspace switch** restores **`lastActiveChatIdByWorkspace`** (per normalized path key) or newest chat on that path, or creates a new empty scoped chat.

**Chat list row dot (`.chat-item-dot`):** Each row has `data-chat-id` on `.chat-item-row`. Visual state is resolved in [`src/ui/chat-item-dot.ts`](../src/ui/chat-item-dot.ts): **idle** (muted `--text-muted`), **unread** (green `--success` on inactive chats after a completed assistant reply since the user last viewed that chat; `chat.unread` + `lastAssistantAt`), **needs-input** (yellow `--warning` while tool approval or `ask_question` UI is open), **thinking** (ring spinner during reasoning SSE on the streaming chat, or on the active chat when `currentGenerationId` is set and the stream phase is `thinking`). The same `data-dot-state` is mirrored on `.chat-item-row` for collapsed-rail styling. Row selection uses `.chat-item-row.active` border/hover only; the dot does not mirror selection accent. `bootstrapActiveChatOpenedTimestamp()` in `main.ts` seeds the “opened” baseline for the initial active chat.

**Collapsed sidebar + work-agent badge (`.chat-item-agent-badge`):** When the chat sidebar is collapsed to the narrow rail (`.chat-sidebar.collapsed:not(.mobile-open)`) and a row shows a work-agent abbrev badge, the status dot is hidden and the badge is centered in the row (`width: 100%` on `.chat-item-row` so the rail hit target is not shrink-wrapped to the glyph). Badge is `inline-flex` with horizontal padding so the pill grows with abbrev length; fill/border uses the same semantic colors as the dot (`--text-muted`, `--success`, `--warning`). **Thinking** keeps the abbrev upright and animates only an outer accent ring via `::after` (same `tool-call-spin` / reduced-motion behavior as `.chat-item-dot__spinner`). Expanded sidebar and mobile drawer keep dot + badge side by side.

**Migration v1→v2:** Client `parseSessionStateFromJson` and server `validateSessionState` set `workspacePath: ''` on legacy chats (no auto-bind). Defaults: `src/config/defaults.ts`, `server/config/home.js`.

- Sidebar order is **newest `lastMessageAt` first** (last committed user/assistant/tool history entry); opening or renaming a chat does not reorder. Legacy sessions without `lastMessageAt` fall back to `updatedAt` until the next message.
- At most **50** chats; oldest by `lastMessageAt` (then `updatedAt`) pruned on save (active chat never removed).
- **QuotaExceededError** → status pill hint.
- Delete chat: confirm dialog; deleting active chat prefers another chat in the **same workspace**, or creates a new empty chat scoped to that workspace.

### Stream persistence across reload (feature 22 / C5)

**Main chat (Phase 2b+):** In-flight completions are owned by the Node backend (`server/generations/`). The client persists **`chat.currentGenerationId`** immediately after `POST /api/generations`, then subscribes with replay-from-zero. Refresh re-subscribes via `bootGenerationResumeForChats` / `bootGenerationResumeForChat` (`src/chat/generation-resume.ts`) — no re-prompt. **Stop** calls `cancelGeneration` + aborts the local reader (`src/chat/stop-generation.ts`). Stream **404** clears the id and shows: *This reply was lost when the server restarted.* (no auto-retry). Headless callers (sub-agent, reef widget, titles) use `postChatCompletions` → generations with `persist: false`.

| Concern | Location |
|---------|----------|
| Backend | `server/generations/store.js`, `upstream.js`, `routes.js`; wired in `server.js` |
| Client API | `src/api/generations.ts` — `createGeneration`, `subscribeToGeneration`, `cancelGeneration` |
| Main send loop | `streamCompletionTurn` in `src/tools/loop.ts` — POST + subscribe; `resumeGenerationId` for boot |
| Shim | `src/providers/fetch-chat.ts` — synthetic `Response` for legacy SSE readers |
| Types / load | `currentGenerationId` on `Chat`; `clearStaleGenerationIdsOnLoad` in `src/state/sessions.ts`; `server/config/validators.js` accepts id (legacy `pendingTurn` on disk is ignored on hydrate) |
| Boot | `main.ts` → `bootGenerationResumeForChats`; `sidebar.ts` → `bootGenerationResumeForChat` on switch/create |
| Stop | Partial assistant saved to `history` with `stopped: true` + chip (no client checkpoint) |

**Removed (Phase 3):** `pendingTurn` checkpoints, Continue/Discard recovery banners, orphan user/tool-tail auto-retry (`turn-recovery.ts`). Reload resume is **backend generations only** via `currentGenerationId`.

### Trace and replay (feature 01 / MIN-37)

**Turn runs** are semantic fork records parallel to linear `chat.history`. Each user-message fork can have multiple **`TurnRunRecord`** branches (`chat.runs[]`) with a captured **`TurnSnapshot`** (model, provider, composed system prompt, tool allowlist, sampler) and stored **`outputMessages`** for branch switching without re-calling the LLM.

| Layer | Lifetime | Purpose |
|-------|----------|---------|
| `server/generations/*` | Minutes (in-memory) | SSE reconnect / stop (transport bytes) |
| `chat.runs` | Session (`state.json`) | Replay, fork with model swap, branch picker |

| Concern | Location |
|---------|----------|
| Types | `TurnSnapshot`, `TurnRunRecord`, `chat.runs`, `chat.activeBranchByFork` in `src/types.ts` |
| Store | `src/state/runs-store.ts` — `createRun`, `activateBranch`, `pruneSupersededRunsAfterTruncate` |
| Snapshot | `src/chat/turn-snapshot.ts` |
| Fork / replay API | `src/chat/fork-from-run.ts`; `resendFromIndex` delegates here |
| Turn hook | `runChatTurn` in `src/tools/loop.ts` — `replaySnapshot`, finalize on complete/stop/error |
| UI | `src/ui/branch-picker.ts`, `src/ui/fork-model-dialog.ts`, message menu **Replay** / **Fork with different model…** |
| Styles | `src/styles/branch-picker.css` |
| QA | [`documentation/plans/verification/feature-01-trace-replay.md`](plans/verification/feature-01-trace-replay.md) |

**Distinction:** Replay creates a **new** backend `generationId`; the run record is the source of truth for replay *intent*, not the generation byte buffer.

### Programmatic chat titles (Step 07)

On the **first user message** while the chat is still named **`New chat`**, an async **non-streaming** title job runs (`scheduleChatTitleGeneration` in [`src/chat/titles/schedule.ts`](../src/chat/titles/schedule.ts)). The main send path is **not** awaited.

| Topic | Detail |
|-------|--------|
| **Trigger** | First `role: 'user'` row only; placeholder name check is case-insensitive (`New chat` / `New Chat`) |
| **Prompt** | Shipped [`src/chat/prompts/titles/default.md`](../src/chat/prompts/titles/default.md); override `~/.minnow/prompts/titles/default.md` via prompt registry when `npm start` |
| **Config** | `config.json` → `titles.enabled`, `titles.modelId`, `titles.providerId`, `titles.maxTokens`, `titles.temperature` (see [`src/config/titles-meta.ts`](../src/config/titles-meta.ts)); `GET /api/config/meta` merges default `titles` when missing |
| **Provider** | Step 03 `postChatCompletions`; schedule uses resolved send `modelId` / `providerId` (work-agent / UI Designer bindings), then config overrides, then chat fields |
| **Reasoning models** | Title completion uses **`message.content` only** ([`generate.ts`](../src/chat/titles/generate.ts)); never promotes `reasoning` / `reasoning_content`; mirrored content (identical to reasoning) is dropped; empty or sanitized-out content → null; [`sanitize.ts`](../src/chat/titles/sanitize.ts) rejects expanded thinking boilerplate (openers + substring markers) and `UNTITLED`; [`schedule.ts`](../src/chat/titles/schedule.ts) falls back to truncated user seed |
| **Apply** | `applyGeneratedChatTitle` only if still placeholder (rename/delete races discard) |
| **UI** | `renderSidebar()` after successful apply only |
| **Delete** | `removeChatById` aborts in-flight title job for that `chatId` |

**Removed:** synchronous first-line truncation (`maybeAutoTitleFromFirstUserMessage`).

**Tests:** `test/titles/*.test.mjs`. Verification: [`documentation/plans/verification/step-07.md`](plans/verification/step-07.md).

### Layout (summary)

- **Desktop:** header toggle collapses sidebar (wide vs narrow rail).
- **Chat list density:** `.chat-list` uses **2px** row gap; `.chat-item-row` padding **6px 10px** (meta lines **2px** apart). Fine-pointer rename/delete are **28×28px**; **`pointer: coarse`** keeps **`--touch-min` (44px)** buttons and **10px** vertical row padding (`responsive.css`).
- **Session row hover:** fine-pointer hover on non-active rows uses `--surface-elevated` fill; title and rename/delete use `--text-hover` (direct button hover: green/red). **Active** row keeps accent styling on hover (`sidebar.css`).
- **Mobile (┤640px):** sidebar overlay + backdrop; safe-area padding.
- **Stats strip:** `#statsStrip` inference metrics above the terminal; **collapsed by default** (`.is-collapsed`). Toggle **`#btnStats`** in the chat sidebar footer (`initStatsStrip()` in [`stats.ts`](../src/ui/stats.ts), preference `minnow.statsStripOpen` in `localStorage`). Desktop `.stats-panel` is a **7-column** grid (four inference stats, compact **Est. cost**, token bars, model info) in [`stats.css`](../src/styles/stats.css). Per-turn timing comes from browser wall clock (`buildClientStats` / `resolveDecodeSeconds` in [`chat.ts`](../src/api/chat.ts)); provider `stats` are merged only when they agree with `usage.completion_tokens` and wall clock (`reconcileCompletionStats`), avoiding inflated tok/s when the server reports decode-only seconds. When measured decode time implies burst throughput above `MAX_PLAUSIBLE_TOKENS_PER_SECOND` (2000), tok/s is recomputed from full stream duration instead of a sub-millisecond slice.
- **Agent activity panel (MIN-51 / feature #15):** `#agentActivityPanel` lists every in-flight worker across chats (main turn, sub-agents, title job, Reef widget LLM). Toggle **`#btnAgentActivity`** in the chat sidebar footer (`initAgentActivityPanel()` in [`agent-activity-panel.ts`](../src/ui/agent-activity-panel.ts), preference `minnow.agentActivityOpen`). Row cards use `--surface-2` (not `--surface-elevated`) so light theme keeps dark text on a light fill ([`agent-activity-panel.css`](../src/styles/agent-activity-panel.css)). Snapshot builder: [`agent-activity-registry.ts`](../src/state/agent-activity-registry.ts); buses: [`main-turn-activity.ts`](../src/chat/main-turn-activity.ts), [`sub-agent-events.ts`](../src/agents/sub-agent-events.ts), [`titles/activity-events.ts`](../src/chat/titles/activity-events.ts), [`reef/activity-events.ts`](../src/chat/reef/activity-events.ts). Sub-agent rows use `liveCurrentToolName` on [`SubAgentRun`](../src/agents/types.ts). Verification: [`documentation/plans/verification/feature-15-agent-activity.md`](plans/verification/feature-15-agent-activity.md). Inside an open strip, **`#statsExpandBtn`** still expands the detailed panel on mobile (┤600px) and when the file editor split is open (feature 26). **Orchestrate (MIN-36):** `chat.lastStats` and the strip sum **parent + sub-agent** token counts for the active parent turn; tok/s / TTFT / generation time are averaged (TPS weighted by completion tokens). Rollup: [`stats-math.ts`](../src/chat/orchestrate/stats-math.ts), [`stats-aggregate.ts`](../src/chat/orchestrate/stats-aggregate.ts); sub-agent SSE usage in [`sub-agent-runner.ts`](../src/agents/sub-agent-runner.ts); live refresh via [`stats-live.ts`](../src/chat/orchestrate/stats-live.ts) when background sub-agents settle.
- **Compact (┤600px):** 16px input (iOS zoom); stats panel grid collapses behind the expand row when the strip is open; settings drawer is full-width with safe-area insets; top-bar **Load/Unload** (`#btnModelLoadUnload`) hidden to preserve model picker space (load dots remain in the picker).
- **Tablet (641–899px):** session sidebar **200px**; stats grid **2×2**; Orchestrate kanban **2 columns**.
- **Phone Orchestrate board (┤600px):** header toolbar wraps; lane controls use **44px** touch height; kanban lanes scroll horizontally with snap (one lane per swipe) instead of four squeezed columns.
- **Question cards (┤600px):** `#questionHost` respects safe-area; nav/dismiss/submit/options sized for touch; landscape caps strip height.
- **Touch (`pointer: coarse`):** session rows and top-bar icon buttons meet **`--touch-min` (44px)** without changing fine-pointer desktop density.
- **Operating mode:** segmented control above attachments ([`mode-selector.ts`](../src/ui/mode-selector.ts), `Chat.modeId` per session).
- **Operating mode:** segmented control above attachments ([`mode-selector.ts`](../src/ui/mode-selector.ts), `Chat.modeId` per session).
- **Attachments:** `#fileInput`, `#attachBtn`, `#attachPreview` row above the composer ([`input.css`](../src/styles/input.css), [`initAttachments()`](../src/attachments/store.ts)). Composer column gap **10px**; input row gap **10px**; preview strip **2px** bottom margin when visible. Chips clear from `#attachPreview` only after a **successful** send (same `completedNormally` gate as `clearAttachments()` in the tool loop).
- **Scrollbars:** Global thin theme thumbs in [`global.css`](../src/styles/global.css) (`scrollbar-width: thin`, WebKit 8px thumb on `--border2`); major scroll panes use `scrollbar-gutter: stable` so thumbs do not cover rounded chrome. **`#msgInput`** auto-grows via [`autoResize()`](../src/ui/input.ts) (cap **40vh**, hidden thumb until cap); tests: `test/ui/composer-auto-resize.test.mjs`.
- **Top bar:** Zones in `header.topbar` (left → right): **`.topbar-brand`** (logo + title), **`.topbar-end`** (model row: **Refresh models** `#btnRefreshModels`, picker, optional Load/Unload, then `.status-pill`), **`.topbar-spacer`** (`flex: 1`), **`.topbar-actions`** (contiguous icon buttons: sidebar toggle, workspace, benchmark `#btnBenchmark`, settings; 4px gap). Stays visible on **`#/bugs`** (POLISH-015); settings/benchmark full-page routes still hide it. **All bugs** `#btnAllBugs`, **inference metrics** `#btnStats`, **agent activity** `#btnAgentActivity`, **terminal** `#btnTerminal`, and **orchestrate boards** `#btnOrchestrate` live in **`.chat-sidebar-footer`** (pinned bottom of `#chatSidebar`, sibling of **`#chatSidebarMain`**). **`.chat-sidebar-main`** is a flex column (`flex: 1; min-height: 0; overflow: hidden`) so **`.chat-list`** scrolls while the footer stays fixed; not in the top bar. **File tree** toggle is `#btnFileSidebarCollapse` on the file sidebar header; **preview browser** toggle is `#btnPreviewToggle` beside it (`applyFileSidebarVisuals` in [`file-layout.ts`](../src/ui/file-layout.ts)): **right chevron** when the panel is expanded (desktop) or the mobile overlay is open; **file-tree icon** when collapsed or closed — mirrors chat sidebar direction semantics (collapse toward workspace). **Model row** (`.model-wrap`): custom combobox [`model-select-picker.ts`](../src/ui/model-select-picker.ts) over hidden `#modelSelect`; trigger + `#modelSelectMenu` list show **load dots** (solid green / grey ring) per model; menu rows and trigger use native `title` tooltips (full canonical id + quant/load from `formatModelLabel`, or `option value` fallback); hover/selected rows use `--elevated-fg` on `--accent-subtle` ([`model-select.css`](../src/styles/model-select.css), MIN-7); open menu shows full `optionText` (`width: max-content`, labels without ellipsis); closed trigger keeps single-line ellipsis with wider `.model-wrap` (420px). Header `#modelStateDot` mirrors selection via [`model-state-dot.ts`](../src/ui/model-state-dot.ts); optional **Load/Unload** buttons when provider supports it (A3). **Status pill** (`setStatus` / `setReadyStatus` in [`src/ui/status.ts`](../src/ui/status.ts)): operational messages only — after `fetchModels()` success shows **`Ready`**, not `N models, M loaded`; shows full message text (`title` tooltip when copy exceeds 24 characters); provider failures append **Check Settings → Providers**. **New chat** only via sidebar (`chat-new-wide` / `chat-new-compact`). `#btnNewChatTop` removed. `#btnSidebarToggle` (class `topbar-sidebar-toggle`) is **mobile-only** (hidden ┴641px); desktop uses `#btnSidebarCollapse` on the sidebar rail. Styles: [`src/styles/topbar.css`](../src/styles/topbar.css) — `z-index: 40` so topbar menus (e.g. `#modelSelectMenu`) stack above chat/file sidebars (`34`–`36`) and below modals/drawers (`50+`). Tests: `test/ui/topbar-layout.test.mjs`, `test/ui/model-state-dot.test.mts`, `test/api/models-status.test.mjs`.
- **UI hardening:** [`chat-turn-guard.ts`](../src/chat/chat-turn-guard.ts) blocks overlapping turn setup per chat; assistant failures use `.msg-bubble--error` via [`setAssistantErrorBubble`](../src/ui/messages.ts); bubbles use `overflow-wrap: anywhere`; ask-question strip shows live validation when Submit is disabled. Tests: `test/chat/chat-turn-guard.test.mts`.

## Dev server architecture (`server.js`)

Use **`npm start`** for the full stack. **`npm run dev`** is Vite-only (no tool API).

```text
Browser (same origin :5173)
    │
    ├─§ GET  /api/config/ping    → { ok: true, homeResolved: true }
    ├─§ GET/PUT /api/config/*    → ~/.minnow JSON files
    ├─§ GET  /api/tools/ping     → { ok: true }
    ├─§ POST /api/tools          → { result: "<string>" }   body: { name, args, modeId? }
    ├─§ POST /api/terminal/run   → { runId, startedAt } (agent one-shot runs)
    ├─§ GET  /api/terminal/stream/:runId → SSE (stdout/stderr/exit)
    ├─§ POST /api/terminal/session → { sessionId } (interactive PTY)
    ├─§ WS   /api/terminal/ws?sessionId= → JSON PTY I/O
    ├─§ GET  /api/terminal/shell-profiles → OS-gated shells
    ├─§ GET  /api/terminal/history?chatId= → { runs } (agent runs)
    ├─§ GET/POST /api/providers/* → registry + proxy (secrets on server only)
    │
    ├─§ LLM upstream (direct localhost or proxied /api/providers/:id/*)
    │
    └─§ Vite SPA (index.html, /src/*, hashed assets)
```

`node server.js` uses Vite™s programmatic API (`createServer` + [`vite.config.ts`](../vite.config.ts)), registers **`configureServer`** middleware **before** the SPA handler via [`server/runtime/middlewares.js`](../server/runtime/middlewares.js) (`applyMinnowMiddlewares`), runs [`server/runtime/bootstrap.js`](../server/runtime/bootstrap.js) (`bootstrapMinnowRuntime`) before listen, listens on **`PORT`** (default **5173**), logs the URL, and opens the default browser (`start` / `open` / `xdg-open`) unless `BROWSER=none`, `MINNOW_HEADLESS=1`, or `MINNOW_ELECTRON=1`. Path guard and tools dispatch: [`server/runtime/path-access.js`](../server/runtime/path-access.js), [`server/runtime/tools-middleware.js`](../server/runtime/tools-middleware.js). App install root: `getAppRoot()` / `setAppRoot()` in [`server/workspace/root.js`](../server/workspace/root.js).

| Route | Method | Response |
|-------|--------|----------|
| `/api/tools/ping` | GET | `{ "ok": true }` |
| `/api/tools` | POST | `{ "name", "args", "modeId"? }` → `{ "result": "<string>" }` (Plan mode writes enforced server-side when `modeId` is `plan`) |
| `/api/terminal/run` | POST | `{ command, chatId?, args?, shell?, source? }` → `{ runId, startedAt }` |
| `/api/terminal/stream/:runId` | GET | `text/event-stream` — `meta`, `stdout`, `stderr`, `exit` |
| `/api/terminal/session` | POST | `{ shellProfileId?, cwd?, cols?, rows? }` → `{ sessionId, shell, … }` |
| `/api/terminal/session/:id` | DELETE | Kill PTY session |
| `/api/terminal/session/:id/resize` | POST | `{ cols, rows }` |
| `/api/terminal/ws` | WS | `?sessionId=` — JSON `{ type: input\|resize\|output\|exit\|meta }` |
| `/api/terminal/shell-profiles` | GET | `{ profiles[], ptyAvailable }` |
| `/api/terminal/sessions` | GET | Optional `?chatId=` — live PTY metadata |
| `/api/terminal/history` | GET | `?chatId=` → `{ runs: TerminalRunRecord[] }` (agent runs) |
| `/api/terminal/log/:runId` | GET | `{ text }` log tail |
| `/api/terminal/cancel/:runId` | POST | `{ ok: true }` (SIGTERM when supported) |

- **CORS:** `*` for local dev; **OPTIONS** → 204.
- **Path guard:** `resolveSafePath()` — paths under the workspace root after `realpath` canonicalization (`server/workspace/safe-path.js`) unless `toolSecurity.filesystemAccess` is `full` in `config.json` or `TOOLS_ALLOW_ALL_PATHS=1`. Client approval UX uses string prefix rules in `src/tools/workspace-path-guard.ts` (server remains authoritative).
- **Errors:** Handlers return **strings**; failures use `Error: …` prefix (not thrown to the client).
- **Browser-only tools on POST:** Names not in `SERVER_TOOL_HANDLERS` (e.g. `get_datetime`, `calculate`, `web_search`) return `Not implemented: {name}`. Expected — the client runs them via [`executeBrowserTool`](../src/tools/browser-executor.ts); only mistaken direct POSTs hit the stub.
- **Timeouts:** Blocking `execute_command`, `run_javascript`, `run_python` — **30s**. `execute_command` with **`background: true`** has no timeout (detached via `createBackgroundRun`).
- **Background shell tools:** `read_command_log`, `list_running_commands`, `stop_command`; `execute_command` also accepts `stop: true` + `run_id`. Plan: [`documentation/plans/execute-command-background.md`](plans/execute-command-background.md).
- **Terminal streaming (Step 10):** [`server/terminal-runner.js`](../server/terminal-runner.js) + [`server/terminal/middleware.js`](../server/terminal/middleware.js). Client panel: [`src/ui/terminal-panel.ts`](../src/ui/terminal-panel.ts), API [`src/api/terminal.ts`](../src/api/terminal.ts). Blocking chat `execute_command` uses SSE (`runCommandWithTerminalStream`); **`background: true` skips SSE** and uses `POST /api/tools`. Blocking tools middleware path uses `executeCommandBlocking()` (no SSE).

### Terminal panel (Step 10 + Epic D1 PTY)

Docked **bottom panel** in `.main-column`: **interactive PTY tabs** (xterm.js + WebSocket) for the user, plus two fixed virtual tabs — **Agent** (agent command SSE) and **Dev server** (hub dev-server logs) — then user PTY tabs and **+**. Tab order: Agent → Dev server → PTY tabs → **+**. Virtual tab ids `__minnow_agent__` and `__minnow_dev_server__` ([`isDevServerTabId`](../src/ui/terminal-tabs.ts)) disconnect PTY WebSocket when selected. Dev server pane: `#terminalDevServerPane` / `#terminalDevServerOutput`. Hub **start** attaches logs **stream-only** via [`ensureDevServerStream`](../src/ui/terminal-panel.ts) (panel stays closed; not the Agent tab). Hub **Console** opens the **Dev server** tab via [`openDevServerConsole`](../src/ui/terminal-panel.ts); teardown uses [`stopDevServerStream`](../src/ui/terminal-panel.ts). Agent tab keeps past-run dropdown in its toolbar. Toggle metrics via `#btnStats` or terminal via `#btnTerminal` (sidebar footer) or **Ctrl+`**. Requires **`npm start`** for PTY; `npm run dev` shows offline banner (no WS). **Chrome:** [`src/styles/terminal.css`](../src/styles/terminal.css) matches bench-instrument panels (stats strip / input bar): hairline borders, `--code-inline-bg` for `#terminalShellHint` and hovers, ink-accent active tabs, solid bordered controls (no dashed add tab). Tokens: `--code-bg`, `--code-inline-bg` in [`src/styles/tokens.css`](../src/styles/tokens.css).

**Dual backend:** User shell → `@lydell/node-pty`. Agent blocking `execute_command` / `run_javascript` / `run_python` → `terminal-runner` + SSE (`runCommandWithTerminalStream`). Background `execute_command` → server `createBackgroundRun` only (no SSE). User **Stop** aborts the SSE stream and `POST /api/terminal/cancel/:runId`.

| Concern | Location |
|---------|----------|
| Panel orchestration | `src/ui/terminal-panel.ts` |
| xterm + WS | `src/ui/terminal-xterm.ts`, `src/api/terminal-pty.ts` |
| Tabs + shell select | `src/ui/terminal-tabs.ts`, `#terminalTabBar`, `#terminalShellSelect` (PTY tabs init when the panel opens; `pagehide` kills PTY sessions) |
| PTY host | `server/terminal/pty-host.js`, `pty-ws.js`, `shell-profiles.js` |
| Agent SSE | `src/api/terminal.ts`, `server/terminal-runner.js` |
| Dev server SSE | [`ensureDevServerStream`](../src/ui/terminal-panel.ts) → Dev server tab; hub Console → [`openDevServerConsole`](../src/ui/terminal-panel.ts) |
| Background spawn | [`createBackgroundRun`](../server/terminal-runner.js) — no 30s timeout; **`detached: true` only when `process.platform !== 'win32'`** (Windows detached spawn opens an extra console `windowsHide` cannot hide) |
| Prefs | `config.json` → `terminal: { open, heightPx, tabs[], activeTabId, defaultShellProfileId }` via [`src/config/terminal-meta.ts`](../src/config/terminal-meta.ts). Agent/sub-agent shell tools **never** auto-open the panel; `#btnTerminal` pulses while a run is in progress. Interactive PTY tabs attach only when the panel is open. Server removes exited PTY sessions so reloads do not hit the 8-session cap. |
| Agent persistence | `Chat.terminalHistory` (last **50** runs); logs `~/.minnow/logs/terminal/<runId>.log` |
| PTY audit | `~/.minnow/logs/terminal/pty-sessions.log` (create/kill only) |

**Shell profiles (OS-gated):** `powershell`, `cmd`, optional WSL `bash` on Windows; `zsh`/`bash` on macOS; `bash` on Linux. `GET /api/terminal/shell-profiles`.

**Windows:** Prefer `@lydell/node-pty` (prebuilt). Stock `node-pty` needs VS Build Tools + `node-gyp`.

**Tests:** `node test/terminal-stream.test.mjs <baseUrl>`; `npm run test:terminal-pty`; unit `test/terminal/*.test.mjs`; `test/ui/terminal-tabs-dev-server.test.mts` (Agent → Dev server tab order, `isDevServerTabId`). Verification: [`documentation/plans/verification/feature-06-09.md`](plans/verification/feature-06-09.md).

**Executor extras (not in the 32-tool settings catalog):**

| Name | Purpose |
|------|---------|
| `web_search_ddg` | DuckDuckGo HTML search ([`web-search-ddg.js`](../server/tools/web-search-ddg.js); `searchDdgStructured` + text formatter; bot challenges return an actionable error) |
| `web_search_tavily` | Tavily Search API ([`web-search-tavily.js`](../server/tools/web-search-tavily.js); `searchTavilyStructured`; API key from `search.json` or `tools.json`) |
| `web_search_searxng` | SearXNG JSON search ([`web-search-searxng.js`](../server/tools/web-search-searxng.js); `GET {searxngUrl}/search?format=json`; used by Deep Research chain and available as a server tool) |
| `send_notification` | OS notification / dialog |
| `read_document` | PDF + office attachment text extraction (base64 in `args.content`, max **10MB** decoded) |

### Document attachments (`read_document` + optional parsers)

- Invoked by [`src/attachments/reader.ts`](../src/attachments/reader.ts) when the user picks a **PDF** or **office** file (Excel `.xlsx`/`.xls`, Word `.docx`, PowerPoint `.pptx`, OpenDocument, RTF, etc.) and `npm start` is up.
- Server: [`server/tools/read-document.js`](../server/tools/read-document.js) — PDF via `pdf-parse`, spreadsheets via `xlsx`, `.docx` via `mammoth`, other legacy/presentation formats via `officeparser` (all optionalDependencies).
- POST `{ name: 'read_document', args: { filename, content } }` where `content` is base64 file bytes.
- Extracted office content is stored as `kind: 'text'` attachments; PDF stays `kind: 'pdf'`.
- Text extraction uses optional **`pdf-parse`** ([`package.json`](../package.json) `optionalDependencies`). If the module is missing, the server returns an install hint string.
- Install when needed: `npm install` (pulls optional deps) or `npm install pdf-parse`.

## Built-in tools (57)

Catalog: [`BUILT_IN_TOOLS`](../src/tools/definitions.ts) — browser-routed tools (web, utility, `ask_question`, mode handoff, sub-agent/board orchestration), server-required tools (Node: memory, LSP, Impeccable, file/git/code), and **7** `previewRequired` `browser_*` tools (Electron only). Function `name` in each schema matches `executeBrowserTool`, dedicated executors, `executeBrowserPreviewTool`, or `executeServerTool`.

### Built-in preview browser (7 renderer + 1 client, Step 12)

Requires the **Minnow desktop shell** (Electron `WebContentsView` preview panel). Plain `npm start` in an external browser tab hides `browser_*` tools; if invoked without the shell they return a clear desktop-shell error. Config: `~/.minnow/config.json` → `browser` (`enabled`, `allowNavigate`, `allowedOriginPatterns` — one origin glob per line, normalized on save). **Settings → Tools → Built-in browser automation** edits patterns via [`src/ui/settings-browser.ts`](../src/ui/settings-browser.ts) and `PUT /api/config/meta` (invalidates server allowlist cache in [`server/config/store.js`](../server/config/store.js)). Agents are taught via [`src/chat/prompts/tool-usage/browser-allowlist.md`](../src/chat/prompts/tool-usage/browser-allowlist.md): call **`browser_navigate` directly** when the origin is already allowlisted; otherwise **`ask_question`** → **`request_browser_origin_access`** → navigate. [`src/tools/browser-navigation-gate.ts`](../src/tools/browser-navigation-gate.ts) matches cached patterns ([`browser-allowlist-match.ts`](../src/tools/browser-allowlist-match.ts)) before `GET /api/browser/allowlist/check`; [`request_browser_origin_access`](../src/tools/client.ts) skips the tool-approval strip when the origin is already allowed. Automation IPC: [`electron/preview-host.ts`](../electron/preview-host.ts) + [`src/tools/browser-preview-tools.ts`](../src/tools/browser-preview-tools.ts) (`window.minnow.preview.execJs`, `capturePage`, `navigateAndWait`, …). Allowlist + screenshot storage remain server-side under [`server/cdp/allowlist.js`](../server/cdp/allowlist.js) and [`server/cdp/paths.js`](../server/cdp/paths.js).

| id | Purpose |
|----|---------|
| `browser_list` | Active preview URL/title |
| `browser_navigate` | Navigate shared preview; opens the right-hand preview split + Electron guest (`revealPreviewPanelForAgentNavigation`); origin allowlist) |
| `request_browser_origin_access` | Ask user to allow an origin before/at navigate (client) |
| `browser_snapshot` | DOM tree + `data-mn-uid` markers |
| `browser_click` / `browser_fill` | Act on snapshot uid |
| `browser_eval` | JS in preview page context |
| `browser_screenshot` | PNG + `attachments` for chat UI |

**Routes:** `POST /api/browser/screenshot` `{ dataBase64 }`; `GET /api/browser/screenshot/:id` (PNG); `GET /api/browser/allowlist/check?url=`; `POST /api/browser/allowlist/approve` `{ url, mode: "once" \| "persist" }`; `POST /api/browser/allowlist/consume` `{ url }` (one-time grants).

### Web (4 browser)

| id | Runs on |
|----|---------|
| `web_search` | User-selected provider ([`web-search-routing.ts`](../src/tools/web-search-routing.ts)): **Brave** in browser (`braveApiKey` / `api_key`), **Tavily** via `web_search_tavily`, **DuckDuckGo** via `web_search_ddg`; no silent fallback |
| `wikipedia_search` | Browser |
| `fetch_web_content` | Server when `npm start` (Node HTTP fetch + strip, ~8KB); browser fallback (CORS limits) |
| `rag_web_content` | Server when `npm start` (same fetch + sentence scoring); browser fallback |

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
| `board_init` / `board_update_task` / `board_get_state` | Browser — [`board-tools.ts`](../src/tools/board-tools.ts) (`chatId` from tool loop / sub-agent parent; task chats resolve planner via `boardGroupId`) |

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
| `run_impeccable` | CLI/scripts only: `detect`, `live` (not teach/audit/shape — use `/impeccable` harness) |

### Files (15 server)

`list_directory`, `read_file`, `read_file_range`, `save_file`, `append_file`, `insert_at_line`, `replace_text_in_file`, `search_in_file`, `grep`, `make_directory`, `move_file`, `copy_file`, `delete_path`, `find_files`, `get_file_metadata`

### Git (6 server)

`git_status`, `git_diff`, `git_log`, `git_add`, `git_commit`, `git_checkout`

### Code (3 server)

`execute_command`, `run_javascript`, `run_python`

### Tool loop and client

- **`detectLocalServer()`** — `GET /api/tools/ping`, **800 ms** timeout ([`src/tools/client.ts`](../src/tools/client.ts)).
- **`executeTool(name, args, context?)`** — returns `{ content, attachments? }`; browser executor, terminal stream for code tools, or `POST /api/tools`; `web_search` reads **`search.json`** first (Settings → **Search**), then legacy `tools.json` keys/provider ([`mergeWebSearchSettings`](../src/config/search-config.ts), [`resolveWebSearchExecution`](../src/tools/web-search-routing.ts)). **Session result cache** ([`src/tools/result-cache.ts`](../src/tools/result-cache.ts)): after approval/plan guards, read-mostly tools memoize on `(name, normalized-args)` per workspace + `chatId`; mutating tools bust matching entries in **all chat scopes for that workspace** (so agent writes invalidate the file tree’s `__no_chat__` listings); manual tree refresh calls `invalidateCachedDirectoryListingsForCurrentWorkspace()`; cleared on workspace switch; toggle in Settings → Tools (`toolCache.enabled`, default on). Debug: `localStorage.minnowDebugToolCache = '1'`.
- **`sendMessageWithTools()`** — tool loop capped by **`chat.maxToolTurns`** (default **100**, range 1–128; **Settings → Tools**, persisted in `config.json` via [`src/config/chat-meta.ts`](../src/config/chat-meta.ts)); upstream stream timeouts **`chat.generationIdleTimeoutMs`** (default **25 min**, 30 s–30 min) and **`chat.generationMaxDurationMs`** (default **60 min**, 1–240 min) in the same block (**Generation timeouts** on Settings → Tools). Sub-agents and evals use **`sub-agents.json` `maxToolTurns`** (default **100**). streams SSE, `mergeToolCallDelta` / `finalizeToolCalls`, runs enabled tools, appends assistant + tool messages ([`src/tools/loop.ts`](../src/tools/loop.ts)). `MAX_TOOL_TURNS` in code is the default constant only.
- **Post-tool empty completion** — if the model returns `stop` with no prose after tool rows, the loop may run **one** extra round with an ephemeral API user line (`EMPTY_POST_TOOL_CONTINUE_INSTRUCTION` in [`src/tools/turn-continuation.ts`](../src/tools/turn-continuation.ts)); otherwise it **always** commits a final `assistant` row (prose, thinking-only, or `'The model returned no text.'`) and sets status **Ready**. Dev logging: `localStorage.minnowDebugTurns = '1'`.
- **Orphan tool tail recovery** — reload when history ends with `tool` (no final assistant): [`hasOrphanToolTailAwaitingReply`](../src/chat/turn-recovery.ts) + retry banner ([`src/ui/pending-turn-recovery.ts`](../src/ui/pending-turn-recovery.ts)); resend via [`resendFromIndex`](../src/chat/resend-from-index.ts).
- **Send entry:** [`src/chat/messaging.ts`](../src/chat/messaging.ts) exports `sendMessage` as alias of `sendMessageWithTools`; `sendMessagePlain` remains for non-tool chat ([`src/api/chat.ts`](../src/api/chat.ts)).

### Browser executor summary

[`executeBrowserTool`](../src/tools/browser-executor.ts) implements web/utility browser tools. [`executeTool`](../src/tools/client.ts) routes `ask_question`, mode handoff, sub-agent, and board tools to dedicated handlers. Returns strings or structured JSON; `Error: …` on failure.

## File attachments

| Concern | Detail |
|---------|--------|
| **Module** | [`src/attachments/`](../src/attachments/) — `types.ts`, `store.ts`, `reader.ts` |
| **UI** | Hidden `#fileInput` (multiple), paperclip button, `#attachPreview` composer chips; sent user rows use `.msg-attach-chip` in the bubble ([`user-message-bubble.ts`](../src/ui/user-message-bubble.ts)) |
| **Max size** | **10 MB** per file (`MAX_ATTACHMENT_BYTES`; aligns with `read_document`) |
| **Images** | `dataUrl` in memory; API: `image_url` parts when model type is **vlm** (`modelCache`) |
| **Text/code** | Many extensions in `reader.ts`; soft warn if **> 32 KB** (`largeTextWarning` chip) |
| **PDF** | Server `read_document` when `npm start`; else error chip |
| **Office** | Excel, Word, PowerPoint, OpenDocument, RTF — same `read_document` path; optional `xlsx`, `mammoth`, `officeparser` on the server |
| **Other binary** | Unsupported error chip |
| **After send** | `clearAttachments()` only when the send completes **normally** (`completedNormally` in [`sendMessageWithTools`](../src/tools/loop.ts)); abort, errors, and max-tool-turn exits **keep** preview chips so the user can retry |
| **History** | User `content` string with `[image: …]` and/or `<file name="…">` blocks |

## Service worker

[`public/sw.js`](../public/sw.js) → `dist/sw.js`. Cache **`minnow-v7`**.

| Request | Strategy |
|---------|----------|
| `localhost` / `127.0.0.1` (LM Studio) | **Not intercepted** |
| Navigation | **Network-first**, fallback cached `./index.html` |
| `index.html`, `manifest.json` | **Network-first** (precache only for offline fallback) |
| Hashed JS/CSS | **Network only** |

Registration in [`src/main.ts`](../src/main.ts): `navigator.serviceWorker.register('sw.js')`.

## Design context

[`PRODUCT.md`](../PRODUCT.md), [`DESIGN.md`](../DESIGN.md), [`.impeccable/design.json`](../.impeccable/design.json).

**Theme:** OKLCH light surfaces, ink `--accent`, soft green user bubbles, JetBrains Mono for code/metrics ([`fonts.css`](../src/styles/fonts.css)). Light `--text-muted` is `oklch(0.52 0.028 250)` for WCAG AA labels/placeholders on sheet white. Markdown blockquotes use a light fill + hairline border (no side-stripe). Boot loader in [`index.html`](../index.html) uses the same OKLCH values as [`tokens.css`](../src/styles/tokens.css). Tool bubbles: `.tool-call-*` in [`messages.css`](../src/styles/messages.css); settings tools UI in [`settings.css`](../src/styles/settings.css).

**Motion:** Product UI timing in [`tokens.css`](../src/styles/tokens.css) (`--duration-fast` 150ms, `--duration-normal` 220ms, `--duration-slow` 350ms, `--ease-out`). Shared panel reveal in [`motion.css`](../src/styles/motion.css). State feedback only: drawer/sidebar scrims fade, mobile sidebars slide on `transform`, metrics bars use `scaleX`, tool/question strips use `minnow-panel-reveal`. No width layout animation on desktop rails. Global `prefers-reduced-motion` in [`global.css`](../src/styles/global.css).

## API usage (providers)

- **Models:** `fetchModels()` loads **every enabled provider** in parallel via [`fetchModelsForAllProviders`](../src/providers/fetch-all-models.ts) → per-provider `fetchModelsForProvider()` → `GET /api/providers/:id/models`. The top-bar `#modelSelect` uses `<optgroup>` per provider and a **composite** `<option value>` (`providerId` + ASCII unit separator + canonical model id) from [`encodeModelSelectKey`](../src/lib/model-select-key.ts) so duplicate upstream ids across backends do not collide. Labels append the provider name (`buildTopBarModelOptionHtml` in [`format-model-label.ts`](../src/lib/format-model-label.ts)); `data-provider-id`, `data-provider-host` (`local` | `cloud` from provider `baseUrl`), and `data-supports-load-unload` drive picker filtering and the Load/Unload affordance per row. `modelCache` keys match those composite values; [`getModelRowForSelectOrCanonicalId`](../src/api/models.ts) resolves stats / vision / context UI from either the select value or a bare model id + `chat.providerId`. Changing the picker sets both `chat.providerId` and `chat.modelId` ([`sidebar.ts`](../src/ui/sidebar.ts)). After refresh: `setReadyStatus()` + `updateModelStateDot()` + `syncModelSelectPicker()`. Load/unload: [`src/api/models.ts`](../src/api/models.ts) targets the **selected** provider when it supports LM Studio v0 load/unload (`toggleSelectedModelLoad`). **Custom model picker UI** ([`renderModelSelectMenuRows`](../src/ui/model-select-picker.ts), shared by the top bar and OS menubar chip): **All / Local / Cloud** segmented filter (`minnow-model-host-filter`); flattens all options and groups by **model producer** (Qwen, Google, Llama, …) via [`resolveModelProducer`](../src/providers/model-producer.ts) — slug from path prefix or regex fallback for flat LM Studio ids, inline SVG logos on headers and rows. Catalogs with more than 12 models get collapsible producer headers (`localStorage` key `minnow-model-producer-collapsed`); smaller catalogs render a flat list. The native `<select>` stays endpoint-optgrouped for screen-reader fallback.
- **Chat:** Main turns use [`streamCompletionTurn`](../src/tools/loop.ts) → `POST /api/generations` + `GET .../stream`. Headless callers use `postChatCompletions()` → same generations API with `persist: false`. Streaming SSE; when tools enabled, request includes `tools` + `tool_choice: 'auto'` from `getEnabledToolDefinitionsForMode(chat.modeId)`. Reasoning-capable models may emit `delta.reasoning` / `delta.reasoning_content` when the LM Studio developer option is enabled; the client surfaces those separately from assistant prose.
- **Settings UI:** There is no drawer-level “active provider” switch; pick the model (with provider) in the **top bar**. Full registry CRUD stays under **Settings → Providers**. [`resolveProvider`](../src/providers/store.ts) (alias `getActiveProvider`) picks an explicit `providerId` when set, else the **first enabled** provider in `GET /api/providers` order — it does **not** read `config.json` `activeProviderId` for routing (that field remains on disk for backward compatibility). Vite-only mode still uses [`serverUrl()`](../src/ui/status.ts) (defaults to `http://localhost:1234` when `#serverUrl` is absent).

## Backend-owned generations (Phase 1)

Server buffers upstream chat/completions streams so clients can attach, detach, and cancel without re-hitting the provider. Wired in [`server.js`](../server.js) after provider middleware.

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/generations` | POST | `{ providerId, body, persist? }` → `{ generationId }` (201); starts upstream pump |
| `/api/generations/:id/stream` | GET | SSE replay + live chunks; `event: end` sentinel when terminal |
| `/api/generations/:id/cancel` | POST | `{ ok: true }`; aborts upstream |
| `/api/generations/:id` | GET | Debug: `status`, `totalBytes`, `startedAt`, `finishedAt`, `errorMessage` |

| Module | Role |
|--------|------|
| [`server/generations/store.js`](../server/generations/store.js) | In-memory `Map`; 16 MiB cap; eviction 30s (default) or 5 min (`persist: true`) |
| [`server/generations/upstream.js`](../server/generations/upstream.js) | Fire-and-forget `fetch` POST to provider chat path; idle + max duration from `config.json` → `chat` (Settings → Tools → **Generation timeouts**; defaults 25 min idle / 60 min max) via [`server/generations/timeouts.js`](../server/generations/timeouts.js) |
| [`server/generations/routes.js`](../server/generations/routes.js) | Vite middleware |
| [`server/research/search.js`](../server/research/search.js) | Deep Research: `searchStructured()` provider chain + disk cache; `loadSearchSettings()` (`search.json` + `tools.json` fallback) |
| [`server/research/cache.js`](../server/research/cache.js) | Deep Research: `getSearch` / `setSearch` / `getPage` / `setPage` under `~/.minnow/research/cache/` (2h TTL) |
| [`server/research/fetch-prep.js`](../server/research/fetch-prep.js) | Deep Research: `prepareResearchFetchUrl()` — SSRF guard before page fetch (Phase 3 extractor) |
| [`src/lib/assert-public-url.mjs`](../src/lib/assert-public-url.mjs) | Rejects private/loopback/link-local/metadata IPs and DNS-rebind targets for research fetch |
| [`server/research/strip-thinking.js`](../server/research/strip-thinking.js) | Deep Research: strip `<think>` / prompt-echo from LLM output; `isLowQuality` marker filter; `parseStopDecision` (YES/NO after strip) |
| [`server/research/llm.js`](../server/research/llm.js) | Deep Research: `llmCall()` non-streaming completion via `getProviderRuntime`; timeout + one transient retry; `llmCallDeps` test hook |
| [`server/research/prompts.js`](../server/research/prompts.js) | Deep Research: verbatim Odysseus prompts + `currentDateContext()` |
| [`server/research/json-parse.js`](../server/research/json-parse.js) | Deep Research: `parseJsonArray` / `parseJsonObject` / `stripCodeBlock` LLM JSON repair |
| [`server/research/extractor.js`](../server/research/extractor.js) | Deep Research: `fetchAndExtract()` — SSRF-gated fetch, page cache, extractor LLM |
| [`server/research/engine.js`](../server/research/engine.js) | Deep Research: `DeepResearcher` IterResearch loop; `engineDeps` test hook |
| [`server/research/store.js`](../server/research/store.js) | Deep Research Phase 4: task registry, SSE progress buffer, `~/.minnow/research/<id>.json` persistence, cooperative cancel, `continueFrom`, source/findings extraction |
| [`server/research/routes.js`](../server/research/routes.js) | Deep Research Phase 4: `createResearchMiddleware()` — `/api/research/*` (start, stream, status, cancel, result, report HTML, library, detail, archive, delete) |
| [`server/research/index.js`](../server/research/index.js) | Deep Research: public barrel exports |
| [`server/research/visual-report.js`](../server/research/visual-report.js) | Deep Research Phase 5: `generateVisualReport()` — markdown → standalone editorial HTML (Odysseus CSS verbatim); `marked` GFM + `isomorphic-dompurify` sanitize; TOC/stats/sources/export script; text-only v1 (no OG hero/section images — Phase 5b) |

**Semantics:** Subscriber `req` `close` only removes that SSE client — upstream keeps running. `addSubscriber` registers before replay; per-subscriber outbound queues handle `res.write` backpressure with a single `drain` listener (never re-write a chunk that already returned `false`, which duplicated SSE bytes and spammed `MaxListenersExceededWarning`). Process `exit` calls `deleteGenerationsForProviderShutdown()` (cancel all). Status flow: `pending` → `streaming` → `complete` \| `error` \| `cancelled`.

**Tests:** [`test/api/generations.test.mjs`](../test/api/generations.test.mjs) — lifecycle, dual replay+tail, mid-stream disconnect (sequential re-subscribe), cancel. Plan: [`documentation/plans/Build out/backend-owned-generations.md`](plans/Build%20out/backend-owned-generations.md).

## Backend-owned generations (Phase 2a — main chat loop)

The tool loop™s `streamCompletionTurn` ([`src/tools/loop.ts`](../src/tools/loop.ts)) uses [`src/api/generations.ts`](../src/api/generations.ts) instead of `postChatCompletions` for main turns:

1. `createGeneration(providerId, body, { persist: true })` → persist `chat.currentGenerationId` immediately via `scheduleSaveSessions()`.
2. `subscribeToGeneration(id, …)` — SSE event framing via [`src/api/sse-parse.ts`](../src/api/sse-parse.ts) (`feedSseEventBuffer` / `parseSseEventBlock`, all glued JSON values per `data:` payload); reuses `extractStreamDelta` / `mergeStreamMeta` from [`src/api/chat.ts`](../src/api/chat.ts); parses terminal `event: end` in the subscribe layer. **Non-streaming** callers (`tryNonStreamingFallback`, [`completeNonStreamingViaGenerations`](../src/providers/fetch-chat.ts), expert greeting/creator via [`provider-port.ts`](../src/chat/titles/provider-port.ts)) read `res.text()` + `parseCompletionResponseBody` — never `Response.json()` on the shim (avoids BUG-016 `ReadableStreamDefaultController` parse errors).
3. Clean end clears `currentGenerationId`; `AbortError` calls `cancelGeneration` then rethrows.

`RunChatTurnOptions.resumeGenerationId` skips POST and only subscribes (boot resume wired in Phase 2b `generation-resume.ts`). Sub-agent, reef, and plain `sendMessage` still use `postChatCompletions` for streaming; non-stream sidecars use `completeNonStreamingViaGenerations`.

| Field | Location |
|-------|----------|
| `Chat.currentGenerationId` | [`src/types.ts`](../src/types.ts) |

## Stop generation (feature 14, Epic C1)

While the **active** chat is streaming (`isActiveChatStreaming()` in [`streaming-state.ts`](../src/chat/streaming-state.ts)), the composer primary button (`#sendBtn`) uses `data-mode="stop"` (class `send-btn--stop`); the textarea stays enabled. **Empty composer + primary click** or the stop affordance calls **`stopGeneration()`** → **`cancelGeneration`** + **`chatFetchAbort.abort()`**. **Non-empty composer + Enter/Send** **steers**: text is stored on **`Chat.pendingSteerMessage`** (last write wins) and injected at the **next tool-loop boundary** in **`runChatTurn`** without aborting the in-flight stream ([`steer-message.ts`](../src/chat/steer-message.ts)). Consumed steer rows are normal **`user`** history entries with **`steer: true`** and a **Steered** chip ([`steer-affordance.ts`](../src/ui/steer-affordance.ts)). Queued steer shows **`composer-steer-queued-hint`**. Stop clears pending steer. When another chat is streaming in the background, the active chat keeps **Send** and shows a composer hint (`composer-stream-hint.ts`: “Reply in progress in …” + **Go to chat**); steer is only available when the active chat is the streaming chat.

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
| Stop API | [`src/chat/stop-generation.ts`](../src/chat/stop-generation.ts) — `cancelGeneration` + local abort |
| Composer toggle | [`src/ui/composer-send.ts`](../src/ui/composer-send.ts), [`src/styles/input.css`](../src/styles/input.css) |
| Interrupt / steer | [`src/chat/steer-message.ts`](../src/chat/steer-message.ts), `Chat.pendingSteerMessage`, consume in [`loop.ts`](../src/tools/loop.ts) |
| Steered chip | [`src/ui/steer-affordance.ts`](../src/ui/steer-affordance.ts), `.msg--steered` in [`messages.css`](../src/styles/messages.css) |
| Tool-loop abort | [`src/tools/loop.ts`](../src/tools/loop.ts) — partial assistant in `history` with `stopped: true`, cooperative skip of remaining tools (`Stopped by user.`), `cancelAllForParentTurn` on abort |
| Stopped chip | [`src/ui/stopped-affordance.ts`](../src/ui/stopped-affordance.ts), `.msg--stopped` in [`messages.css`](../src/styles/messages.css) |
| History flag | `AssistantMessage.stopped?: boolean` in [`src/types.ts`](../src/types.ts); reload paints chip when set |

**Tests:** `test/chat/stop-generation.test.mts`, `test/chat/finalize-stopped-turn.test.mts`, `test/chat/generation-resume.test.mts`, `test/ui/composer-send.test.mjs`, `test/chat/steer-message.test.mts`, `test/chat/steer-loop-boundary.test.mts`, `test/ui/composer-steer.test.mjs`. Verification: [`documentation/plans/verification/feature-14.md`](plans/verification/feature-14.md), [`feature-05-interrupt-steer.md`](plans/verification/feature-05-interrupt-steer.md).

## Message actions (Epic C2 — features 15–17)

Cursor-style **⋮ menu** on each history-backed user/assistant row (not on in-flight streaming shells).

| Action | Target | Behavior |
|--------|--------|----------|
| **Copy** | User / assistant | User rows: full persisted `content` from `data-history-content` on `.msg-bubble` (includes `<file>` bodies); assistant/tool: bubble text |
| **Edit** | User | Truncate after row, composer prefilled (skill `[skill: id]` footer stripped), next send updates row + `resendFromIndex` |
| **Regenerate from here** | User | Inclusive truncate → `resendFromIndex` (no duplicate user row) |
| **Remake** | Assistant / tool group | Resend from preceding user message |
| **Delete message** | Any logical turn | Exclusive truncate (atomic assistant + `tool` rows); confirm when multiple rows removed |

| Concern | Location |
|---------|----------|
| Truncate + tail normalize | `src/chat/history-truncate-core.ts`, `src/chat/history-truncate.ts` |
| Resend orchestration | `src/chat/resend-from-index.ts` → `runChatTurn({ pushUser: false })` in `src/tools/loop.ts` |
| Menu UI | `src/ui/message-actions.ts`, `src/styles/message-actions.css` |
| Render indices | `data-history-index`, `data-turn-kind` on `.msg` / tool cards in `renderChatFromHistory` |
| Skill footer parse | `src/skills/history-content.ts` |

**Guards:** All mutating actions blocked while `streaming` (same pattern as `clearChat`). Works with C1 stop: stop first, then regenerate. **v1:** No undo stack; resend does not re-hydrate attachment chips (history placeholders only). `chat.terminalHistory` is not truncated on delete (follow-up).

**Tests:** `test/chat/history-truncate.test.mts`, `test/chat/resend-from-index.test.mts`, `test/ui/message-actions.test.mjs`. Verification: [`documentation/plans/verification/feature-15-16-17.md`](plans/verification/feature-15-16-17.md).

## Message rendering

- **User:** [`renderUserMessageBubble`](../src/ui/user-message-bubble.ts) — prose in `.user-msg-text`, attachments as `.msg-attach-chip` (file bodies not shown inline). Plain text-only messages behave as before. Image chips show thumbnails on the send turn when `dataUrl` is still available; reopening older image placeholders shows the filename only.
- **Assistant:** **marked** + **DOMPurify** + **highlight.js**; streaming debounced ~100 ms.
- **Reasoning / “thinking”** (LM Studio **App Settings → Developer**: separate `reasoning_content` and/or `choices.delta.reasoning` for compatible models such as DeepSeek R1 / gpt-oss):
  - **Live stream phases** ([`stream-status.ts`](../src/ui/stream-status.ts), wired from [`messages.ts`](../src/ui/messages.ts), [`loop.ts`](../src/tools/loop.ts), [`chat.ts`](../src/api/chat.ts)): `generating` → optional `thinking` (first reasoning delta) → `generating` again after `endReasoningPhase()` until prose → `prose`. A `.stream-status` row (sibling **before** the hidden prose bubble) shows **Generating response…** or **Thinking…** with animated dots; `role="status"`, `aria-live="polite"`, `aria-busy` until prose. Hidden after [`revealAssistantProseBubble`](../src/ui/messages.ts) or removed with [`removeOrphanStreamingRow`](../src/ui/messages.ts) when the turn ends with tools only / no visible prose. Respects `prefers-reduced-motion` (static dots).
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
| **`npm run electron:dev`** | `vite` + Electron (`MINNOW_ELECTRON=1`, `MINNOW_ELECTRON_DEV=1`) | Yes (via Vite on :5173) | Desktop shell with HMR; does not auto-open a system browser tab |
| **`npm run electron:prod`** | `electron/dist/main.js` + in-process Connect/`sirv` server ([`electron/server-host.ts`](../electron/server-host.ts), MIN-111) | Yes (in-process) | Packaged-style run after `npm run build` |
| **`npm run electron:build`** | `tsc -p electron/tsconfig.json` → `electron/dist/` | N/A | Compile main/preload only |
| **`npm run package`** | `npm run build` + `electron:build` + `electron-builder` (Windows NSIS) | Yes (in-process, packaged) | Installer under `release/pkg/` (e.g. `Minnow-Setup-1.0.0.exe`); `package.json` `"main"` → `electron/dist/main.js` |
| **`npm run package:dir`** | Same build steps + `electron-builder --dir` | Yes (in-process) | Unpacked app in `release/pkg/win-unpacked/` — faster smoke test without NSIS |
| **`npm run package:clean`** | `scripts/clean-release.mjs` | N/A | Kills `Minnow.exe` / `electron.exe` and removes `release/pkg/win-unpacked` when not locked |

**Windows packaging (MIN-113):** `electron-builder` config lives in [`package.json`](../package.json) `"build"` — output dir `release/pkg/`; bundles `dist/**`, `electron/dist/**`, `server/**`, skills manifest script, and `skills-lock.json`; unpacks `node_modules/@lydell/node-pty/**` for PTY; copies `documentation/` as `extraResources`. App id `org.grimmedia.minnow`. NSIS artifact: `Minnow-Setup-<version>.exe`. Icon: [`build/icon.ico`](../build/icon.ico) (≥256×256). If packaging fails with *app.asar is being used by another process*, run `npm run package:clean`, close any `Minnow.exe` from a prior unpack, and retry; [`scripts/electron-builder-run.mjs`](../scripts/electron-builder-run.mjs) can fall back to `release/pkg-<timestamp>/` when the default folder stays locked.

**Production code-split (MIN-20):** [`main.ts`](../src/main.ts) lazy-loads [`settings-page.ts`](../src/ui/settings-page.ts) (CSS co-located) and [`init-file-panel.ts`](../src/ui/init-file-panel.ts) (file tree + CodeMirror viewer). Shared types live in [`settings-page-types.ts`](../src/ui/settings-page-types.ts); tree refresh from main/workspace uses [`file-tree-refresh-bridge.ts`](../src/ui/file-tree-refresh-bridge.ts) registered at file-panel init. Typical `npm run build` main JS chunk ~1.83 MB (gzip ~573 KB); lazy chunks include `settings-page` (~73 KB), `file-viewer` (~319 KB), `init-file-panel` (~17 KB).

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

[`src/main.ts`](../src/main.ts) calls `scheduleMarkAppReady()` from [`src/boot/app-ready.ts`](../src/boot/app-ready.ts) as soon as the module evaluates: **dev** dismisses the loader on the next animation frame (Vite-injected `<style>` tags from CSS imports; do not wait on Google Fonts `<link>` tags from `fonts.css`). **Production** waits only for same-origin bundle `<link rel="stylesheet">` tags (cached sheets count as ready), then adds `html.app-ready` to hide `#app-loader`. A 4s safety timeout still dismisses the loader if CSS never arrives. `initApp()` runs on `DOMContentLoaded` or immediately if the document is already parsed — **not** on `window.load` (that event often fires before deferred modules run, which left the loader stuck). Full-page routes (`settings`, `benchmark`, `research`, `global-bugs`, `experts`) ship `display: none` in eager [`global.css`](../src/styles/global.css) so they stay hidden until their lazy `*-page.css` chunks load during `initApp()` dynamic imports.

Order in `initApp()`:

1. `await detectConfigServer()` → `await runMigrationIfNeeded()` if server mode.
2. `await loadToolConfigFromStorage()` — read `tools.json` (or `minnow.tools`) **before** prompt/session UI so permission state is never stale on first paint; overlapping calls share one in-flight promise and the loader always resolves (falls back to `defaultToolConfig()` on unexpected errors, so Node tests never see a rejected load).
3. `await initPromptSystem()` — built-in prompts + user registry from `/api/prompts/registry`.
4. `await initWorkAgentSystem()` — work agents from glob + `/api/work-agents` overrides.
5. `await loadSessionsFromStorage()`; `fillSystemPromptPresetSelect()` + `await loadSystemPromptSettings()`.
6. `fillToolsSection()` + `registerToolHandlers()`; `initAttachments()`; `initModeSelector()`; `initWorkAgentDevUi()`.
7. `await detectLocalServer()` → `loadToolConfigIntoDrawer()` (server-required rows depend on ping).
8. `applySidebarVisuals()` + `renderSidebar()`.
9. `await fetchModels()` → `syncModelSelectForActiveChat()`, `renderChatFromHistory()`, `renderStatsForChat()`, `renderSidebar()` again.

## Hardening (production edge cases)

- Sidebar rows: no nested buttons; keyboard Enter/Space to switch chats.
- Overlays: Escape closes drawer / mobile sidebar (`dismissOpenLayers`).
- `parseServerBaseUrl()` before LM Studio fetch; `AbortController` on model list and chat.
- Send requires model, temperature 0–2, max tokens ┴ 1; while streaming the send button is Stop (enabled) and the textarea stays editable.
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
| [`documentation/plans/Build out/feature-15-agent-activity-view.md`](plans/Build%20out/feature-15-agent-activity-view.md) | Feature #15: global agent activity panel (shipped) |
| [`documentation/plans/electron-wrapper.md`](plans/electron-wrapper.md) | Electron desktop app + WebContentsView preview (Linear MIN-109–114) |

