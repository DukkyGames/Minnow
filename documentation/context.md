# SpeedChat — project context

User-facing setup and quick start: [`README.md`](../README.md).

Implementation plan and sub-agent breakdown: [`documentation/plans/tool-usage-subagent-steps.md`](plans/tool-usage-subagent-steps.md).

**To-fix roadmap:** Ordered steps in [`documentation/plans/to-fix-step-order.md`](plans/to-fix-step-order.md) (backlog line numbers match [`documentation/plans/to-fix.md`](plans/to-fix.md)). Per-step **implementation build plans** (with tests and todos): [`documentation/plans/Build out/`](plans/Build%20out/) (`step-01` … `step-20`). **Persistence contract (Step 02+):** `~/.speedchat/sessions/state.json` — single session blob, not per-chat files. **Tests (Step 02+):** `npm test` → `node --test`.

## What it is

SpeedChat is a **Vite + TypeScript** single-page web client for **LM Studio** (local OpenAI-compatible API). UI markup lives in [`index.html`](../index.html); styles and logic are modular under [`src/`](../src/). Production output is emitted to [`dist/`](../dist/) via `npm run build`.

**LM Studio tools + attachments:** The default send path runs an OpenAI-style **tool loop** (`sendMessageWithTools` in [`src/tools/loop.ts`](../src/tools/loop.ts)). **32** built-in tools are defined in [`src/tools/definitions.ts`](../src/tools/definitions.ts); **23** execute on the Node side via **`npm start`** (`server.js` → `POST /api/tools`). **9** run in the browser. File **attachments** (images, text/code, PDF) use the composer paperclip and multimodal API payloads when a **VLM** model is selected.

## Repository layout (Vite)

```
SpeedChat/
├── index.html              # Vite shell: markup + <script type="module" src="/src/main.ts">
├── server.js               # Dev server: Vite + /api/tools (npm start)
├── package.json
├── tsconfig.json
├── vite.config.ts          # base: './', outDir: dist
├── public/                 # Copied verbatim to dist/ (not bundled)
│   ├── manifest.json       # PWA manifest (start_url: ./)
│   ├── sw.js               # Service worker (cache: speedchat-v5)
│   └── icons/              # icon-192.png, icon-512.png
├── src/
│   ├── main.ts             # Entry: CSS imports, window handlers, initApp()
│   ├── types.ts            # Messages, ApiMessage, ToolCall, ContentPart
│   ├── constants.ts        # STORAGE_KEY, PRESET_STORAGE_KEY
│   ├── app-state.ts        # streaming flags, modelCache, abort controllers
│   ├── state/sessions.ts   # localStorage chat sessions
│   ├── api/models.ts       # fetchModels, modelCache, resolveModelInfo
│   ├── api/reasoning.ts    # extractReasoningDelta, splitThinkingSegments (LM Studio)
│   ├── api/chat.ts         # SSE/stream helpers, mergeToolCallDelta, sendMessagePlain
│   ├── chat/messaging.ts   # sendMessage → sendMessageWithTools
│   ├── ui/                 # sidebar, settings, stats, messages, stream-status, tool-messages, thought-bubbles, …
│   ├── tools/
│   │   ├── definitions.ts      # 32-tool catalog (OpenAI function schemas)
│   │   ├── config.ts           # speedchat.tools localStorage
│   │   ├── browser-executor.ts # 9 browser-native handlers
│   │   ├── client.ts           # ping, executeTool router, enabled defs
│   │   └── loop.ts             # buildApiMessages, sendMessageWithTools
│   ├── attachments/
│   │   ├── types.ts
│   │   ├── store.ts        # pending list, preview chips, initAttachments()
│   │   └── reader.ts       # processFile — image, text, PDF
│   ├── markdown/renderer.ts
│   └── styles/
│       ├── fonts.css tokens.css global.css topbar.css sidebar.css
│       ├── messages.css input.css settings.css stats.css responsive.css
│       └── thoughts.css    # live thought bubbles + Thoughts panel
├── dist/                   # Production build (gitignored)
└── documentation/
```

## localStorage keys

| Key | Module | Purpose |
|-----|--------|---------|
| `speedchat-sessions-v1` | `src/constants.ts` → `src/state/sessions.ts` | Multi-chat sessions: `version`, `activeId`, `sidebarCollapsed`, `chats[]` with `history`, `modelId`, `lastStats`, … |
| `speedchat.systemPrompt` | `PRESET_STORAGE_KEY` in `src/constants.ts` | System prompt preset + textarea content |
| `speedchat.tools` | `TOOL_CONFIG_STORAGE_KEY` in `src/tools/config.ts` | Tool toggles + `keys.braveApiKey` |

Server URL, temperature, and max tokens live in the settings drawer DOM (not in the session blob).

### `speedchat.tools` shape

```json
{
  "enabled": {
    "get_datetime": true,
    "calculate": true,
    "web_search": true,
    "wikipedia_search": true,
    "read_file": false
  },
  "keys": {
    "braveApiKey": ""
  }
}
```

- **Defaults:** `get_datetime`, `calculate`, `web_search`, `wikipedia_search` **on**; every other catalog id **off** (`defaultToolConfig()` in [`src/tools/config.ts`](../src/tools/config.ts)).
- **UI:** Settings drawer **Tools** section — `fillToolsSection()`, `registerToolHandlers()` (delegated `change` on `#toolsList` → `onToolToggle(id)` from [`src/tools/config.ts`](../src/tools/config.ts)), `loadToolConfigIntoDrawer()` ([`src/ui/settings.ts`](../src/ui/settings.ts)).
- **Server gating:** Rows with `data-server-required` dim/disable when `detectLocalServer()` fails (no `npm start` ping). `getEnabledToolDefinitions()` omits server tools from the LM Studio request when the flag is false.
- **Offline UX:** Static Tools hint in [`index.html`](../index.html) (`tools-section-hint`: server tools need `npm start`). When ping fails, `#toolsServerBanner` is shown (“Server tools need npm start (not npm run dev).”), `refreshServerToolDisabledState()` dims server rows, disables checkboxes, and sets `title` on each. `onToolToggle` reverts enabling a server tool while offline and calls `setStatus('err', …)` with “Start with npm start to use file/git tools.”

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

The app supports **multiple chat sessions** with a **collapsible left sidebar**. See **`speedchat-sessions-v1`** above.

- At most **50** chats; oldest by `updatedAt` pruned on save (active chat never removed).
- **QuotaExceededError** → status pill hint.
- Delete chat: confirm dialog; deleting active chat switches to latest other or creates a new empty session.

### Layout (summary)

- **Desktop:** header toggle collapses sidebar (wide vs narrow rail).
- **Mobile (≤640px):** sidebar overlay + backdrop; safe-area padding.
- **Compact (≤600px):** 16px input (iOS zoom), collapsible stats strip.
- **Attachments:** `#fileInput`, `#attachBtn`, `#attachPreview` row above the composer ([`input.css`](../src/styles/input.css), [`initAttachments()`](../src/attachments/store.ts)). Composer column gap **10px**; input row gap **10px**; preview strip **2px** bottom margin when visible. Chips clear from `#attachPreview` only after a **successful** send (same `completedNormally` gate as `clearAttachments()` in the tool loop).
- **Top bar:** **New chat** only via sidebar (`chat-new-wide` / `chat-new-compact`). `#btnNewChatTop` removed. `#btnSidebarToggle` (class `topbar-sidebar-toggle`) is **mobile-only** (hidden ≥641px); desktop uses `#btnSidebarCollapse` on the sidebar rail.

## Dev server architecture (`server.js`)

Use **`npm start`** for the full stack. **`npm run dev`** is Vite-only (no tool API).

```text
Browser (same origin :5173)
    │
    ├─► GET  /api/tools/ping     → { ok: true }
    ├─► POST /api/tools          → { result: "<string>" }   body: { name, args }
    │
    ├─► LM Studio (localhost, not proxied) — models + chat/completions
    │
    └─► Vite SPA (index.html, /src/*, hashed assets)
```

`node server.js` uses Vite’s programmatic API (`createServer` + [`vite.config.ts`](../vite.config.ts)), registers **`configureServer`** middleware **before** the SPA handler, listens on **`PORT`** (default **5173**), logs the URL, and opens the default browser (`start` / `open` / `xdg-open`).

| Route | Method | Response |
|-------|--------|----------|
| `/api/tools/ping` | GET | `{ "ok": true }` |
| `/api/tools` | POST | `{ "name", "args" }` → `{ "result": "<string>" }` |

- **CORS:** `*` for local dev; **OPTIONS** → 204.
- **Path guard:** `resolveSafePath()` — paths under `process.cwd()` unless `TOOLS_ALLOW_ALL_PATHS=1`.
- **Errors:** Handlers return **strings**; failures use `Error: …` prefix (not thrown to the client).
- **Browser-only tools on POST:** Names not in `SERVER_TOOL_HANDLERS` (e.g. `get_datetime`, `calculate`, `web_search`) return `Not implemented: {name}`. Expected — the client runs them via [`executeBrowserTool`](../src/tools/browser-executor.ts); only mistaken direct POSTs hit the stub.
- **Timeouts:** `execute_command`, `run_javascript`, `run_python` — **30s**.

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

## Built-in tools (32)

Catalog: [`BUILT_IN_TOOLS`](../src/tools/definitions.ts) — **9** `serverRequired: false` (browser), **23** `serverRequired: true` (Node). Function `name` in each schema matches `executeBrowserTool` / `executeServerTool`.

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
- **`executeTool(name, args)`** — browser executor or `POST /api/tools`; merges saved `braveApiKey` into `web_search`.
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

[`public/sw.js`](../public/sw.js) → `dist/sw.js`. Cache **`speedchat-v5`**.

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

## API usage (LM Studio)

- **Models:** `GET {serverUrl}/api/v0/models`
- **Chat:** `POST {serverUrl}/api/v0/chat/completions` — streaming SSE; optional non-streaming fallback; when tools enabled, request includes `tools` + `tool_choice: 'auto'` from `getEnabledToolDefinitions()`. Reasoning-capable models may emit `delta.reasoning` / `delta.reasoning_content` when the LM Studio developer option is enabled; the client surfaces those separately from assistant prose.

## Message rendering

- **User:** plain `textContent` (includes literal markdown if typed).
- **Assistant:** **marked** + **DOMPurify** + **highlight.js**; streaming debounced ~100 ms.
- **Reasoning / “thinking”** (LM Studio **App Settings → Developer**: separate `reasoning_content` and/or `choices.delta.reasoning` for compatible models such as DeepSeek R1 / gpt-oss):
  - **Live stream phases** ([`stream-status.ts`](../src/ui/stream-status.ts), wired from [`messages.ts`](../src/ui/messages.ts), [`loop.ts`](../src/tools/loop.ts), [`chat.ts`](../src/api/chat.ts)): `generating` → optional `thinking` (first reasoning delta) → `generating` again after `endReasoningPhase()` until prose → `prose`. A `.stream-status` row (sibling **before** the hidden prose bubble) shows **Generating response…** or **Thinking…** with animated dots; `role="status"`, `aria-live="polite"`, `aria-busy` until prose. Hidden after [`revealAssistantProseBubble`](../src/ui/messages.ts). Respects `prefers-reduced-motion` (static dots).
  - **Live thought bubbles:** [`ThoughtBubbleController`](../src/ui/thought-bubbles.ts) shows one dashed **thought** bubble above the streaming assistant bubble; text appears with a typewriter effect; paragraph breaks (`\n\n`) start a new thought (previous bubble fades out). When the model streams normal **`content`**, the live stage is torn down.
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

Order in [`src/main.ts`](../src/main.ts) `initApp()`:

1. `loadSessionsFromStorage()`; `fillSystemPromptPresetSelect()` + `loadSystemPromptSettings()`.
2. `fillToolsSection()` + `registerToolHandlers()`.
3. `initAttachments()` — file picker and `#attachPreview` strip.
4. `await detectLocalServer()` → `loadToolConfigIntoDrawer()`.
5. `applySidebarVisuals()` + `renderSidebar()`.
6. `await fetchModels()` → `syncModelSelectForActiveChat()`, `renderChatFromHistory()`, `renderStatsForChat()`, `renderSidebar()` again.

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
| [`src/tools/definitions.ts`](../src/tools/definitions.ts) | 32-tool catalog |
| [`src/tools/config.ts`](../src/tools/config.ts) | `speedchat.tools` |
| [`src/tools/client.ts`](../src/tools/client.ts) | Router + server detection |
| [`src/tools/loop.ts`](../src/tools/loop.ts) | Tool loop + `buildApiMessages` |
| [`src/attachments/reader.ts`](../src/attachments/reader.ts) | File processing + PDF POST |
| [`public/sw.js`](../public/sw.js) | PWA service worker |
| [`documentation/context.md`](context.md) | This document |
| [`documentation/plans/tool-usage-subagent-steps.md`](plans/tool-usage-subagent-steps.md) | Sub-agent implementation plan |
