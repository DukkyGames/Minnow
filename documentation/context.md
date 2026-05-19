# SpeedChat — project context

## What it is

SpeedChat is a **Vite + TypeScript** single-page web client for **LM Studio** (local OpenAI-compatible API). UI markup lives in [`index.html`](../index.html); styles and logic are modular under [`src/`](../src/). Production output is emitted to [`dist/`](../dist/) via `npm run build`.

## Repository layout (Vite)

```
SpeedChat/
├── index.html              # Vite shell: markup + <script type="module" src="/src/main.ts">
├── package.json
├── tsconfig.json
├── vite.config.ts          # base: './', outDir: dist
├── public/                 # Copied verbatim to dist/ (not bundled)
│   ├── manifest.json       # PWA manifest (start_url: ./)
│   ├── sw.js               # Service worker (cache: speedchat-v5)
│   └── icons/              # icon-192.png, icon-512.png
├── src/
│   ├── main.ts             # Entry: CSS imports, window handlers, initApp()
│   ├── types.ts
│   ├── constants.ts
│   ├── app-state.ts        # streaming flags, modelCache, abort controllers
│   ├── state/sessions.ts   # localStorage chat sessions
│   ├── api/models.ts       # fetchModels, modelCache re-export, resolveModelInfo
│   ├── api/chat.ts         # sendMessage, SSE/stream helpers, non-streaming fallback
│   ├── chat/messaging.ts   # Re-exports sendMessage from api/chat
│   ├── ui/                 # sidebar, settings, stats, messages, layout, status, …
│   ├── markdown/renderer.ts
│   └── styles/             # tokens, global, topbar, sidebar, …
├── dist/                   # Production build (gitignored)
└── documentation/
```

## Multi-chat sessions

The app supports **multiple chat sessions** with a **collapsible left sidebar** listing each chat. Sessions are persisted in the browser via **`localStorage`**.

### Storage key and shape

- **Key:** `speedchat-sessions-v1`
- **JSON shape:**
  - `version` — currently `1` (reserved for future migrations).
  - `activeId` — id of the chat shown in the main column.
  - `sidebarCollapsed` — desktop narrow-rail mode when `true`.
  - `chats` — array of chat objects, each with:
    - `id` — stable string (UUID when available).
    - `name` — display title; starts as `New chat`, then auto-titled from the first user message (truncated), or user-renamed via the pencil control in the sidebar.
    - `modelId` — last model id used with this chat (synced with the top bar model `<select>` when that chat is active).
    - `history` — ordered messages for the API/UI: `user` entries are `{ role, content }`; `assistant` entries may also include `stats` and `usage` so per-message chips can be rebuilt when reopening a chat.
    - `lastStats` — flat snapshot of the last completed assistant turn (TPS, TTFT, generation time, token counts, stop reason) for the sidebar row and the bottom stats strip.
    - `modelInfo` — merged arch / quant / context metadata for the stats strip when restoring a chat.
    - `updatedAt` — ms timestamp for ordering and pruning.

Chats can be **deleted** from the sidebar (trash control on each row). A browser **confirm** runs first. Deleting the active chat switches to the most recently updated remaining chat; deleting the last chat creates a new empty session so the app always has at least one chat.

### Limits and errors

- At most **50** chats are kept; oldest by `updatedAt` are dropped on save (the active chat is never removed).
- If `localStorage` throws **QuotaExceededError**, the status pill shows a short error hint.

### Layout

- Below the top bar, **`.app-body`** is a flex row: **`.chat-sidebar`** (session list) and **`.main-column`** (messages, input, stats strip).
- **Desktop:** the header **◀ / ▶** button toggles `sidebarCollapsed` (wide panel vs narrow rail with `+` only).
- **Mobile (≤640px):** the sidebar is a **fixed overlay** with safe-area padding; the dimmed **`.sidebar-backdrop`** closes it on tap. The top bar menu button toggles open/closed. The in-sidebar collapse control is hidden on phone (overlay only).
- **Compact (≤600px):** top bar hides the wordmark, tightens model/status space, stacks settings drawer numeric fields, uses **16px** message input (avoids iOS zoom), and collapses the stats strip to a **Metrics** summary row (tap to expand `.stats-strip.is-expanded`).
- **Narrow (≤380px):** top bar hides duplicate **New chat** and **Refresh models** to free space for the model picker.
- **Tablet (641–899px):** session sidebar is **200px** when expanded.
- **Touch:** rename/delete on session rows use **44×44px** targets; hover styles apply only when `(hover: hover) and (pointer: fine)`.
- **Layout height:** `100dvh` on `html`/`body` for mobile browser chrome; horizontal/bottom safe areas on input bar, drawer, and mobile sidebar.
- **Stats icons:** the bottom stats strip uses small inline SVGs per metric (zap = TPS, play = TTFT, clock = generation time, layers = total tokens), tinted to match the metric color class. Per-message chips under assistant replies are text-only (no icons).

### Other persisted settings

System prompt preset and textarea content use a separate key: `speedchat.systemPrompt` (see `PRESET_STORAGE_KEY` in `src/constants.ts`). Server URL, temperature, and max tokens remain in the DOM / settings drawer and are not part of the session blob unless changed elsewhere later.

## Service worker

[`public/sw.js`](../public/sw.js) is copied to `dist/sw.js` on build. Cache name **`speedchat-v5`** (bump to invalidate old caches).

| Request | Strategy |
|---------|----------|
| `localhost` / `127.0.0.1` (LM Studio API) | **Not intercepted** |
| Navigation (`mode: navigate`) | **Network-first**, fallback to cached `./index.html` |
| `index.html`, `manifest.json` | **Cache-first** |
| Hashed JS/CSS from Vite | **Network only** (default browser fetch) |

Registration: `navigator.serviceWorker.register('sw.js')` in `src/main.ts`.

## Design context

Product and visual direction live in [`PRODUCT.md`](../PRODUCT.md) and [`DESIGN.md`](../DESIGN.md). Machine-readable tokens also live in [`.impeccable/design.json`](../.impeccable/design.json).

**Current theme (light):** OKLCH near-white `--bg` / `--surface`, graphite `--text`, ink-black `--accent` (logo, send, selection), soft green `--user-bg` for user bubbles, flat assistant bubbles on `--bg` with hairline borders. Semantic green / amber / red only on metrics (stats strip, chips, status dot). JetBrains Mono for instrumentation (loaded via [`src/styles/fonts.css`](../src/styles/fonts.css), imported in `main.ts` — not from a CDN link in `index.html`); system-ui at 14px for UI. No card stacks or gradient chrome; mobile sidebar uses the only routine shadow.

PWA chrome: `theme-color` and `manifest.json` `theme_color` / `background_color` use `#fefefe` (near `--bg`); iOS status bar uses `default` for dark-on-light system chrome. Manifest `start_url` is `./` for relative hosting with `vite.config.ts` `base: './'`.

Structural UI: inline SVG icon buttons, semantic `<header>` top bar, `<main>` chat area, settings drawer with `role="dialog"` and focus trap, collapsible stats strip on narrow viewports.

## Hardening (production edge cases)

- **Sidebar sessions:** Each chat is a `div.chat-item-row` with separate rename/delete buttons (no nested `<button>` elements). Rows support keyboard Enter/Space to switch chats.
- **Overlays:** Settings and mobile sidebar backdrops are `<button type="button">` with labels; **Escape** closes the drawer or mobile chat list (`dismissOpenLayers`).
- **Network:** `parseServerBaseUrl()` validates the LM Studio URL before fetch. Model list and chat requests use `AbortController` so rapid refresh/resend cancels the previous call.
- **Send path:** Requires a selected model, temperature 0–2, and max tokens ≥ 1. Composer and send button disable while streaming (`aria-busy` on send).
- **Rename:** Chat title input is capped at 120 characters.

## Copy and labels (clarify pass)

- **Accessible names:** Model select, message composer, and system prompt fields use `<label>` / `for` (visually hidden where space is tight). Sidebar rename/delete buttons use `aria-label` with the chat title.
- **Settings:** Labels describe LM Studio URL, temperature, max tokens, and prompt presets; short hints explain defaults and preset behavior.
- **Status pill:** Plain-language states (e.g. “Loading models…”, “Cannot reach LM Studio”, “Finish the current reply first”).
- **Empty chat:** “No messages yet” plus guidance to pick a model and confirm LM Studio is running.
- **Destructive actions:** Delete chat and clear messages use confirm dialogs that state what is lost; preset overwrite warns about losing edits.

## API usage

- **Models:** `GET {serverUrl}/api/v0/models`
- **Chat:** `POST {serverUrl}/api/v0/chat/completions` with streaming SSE; optional non-streaming fallback if the stream yields no text.

## Message rendering

- **User** bubbles show **plain text** (`textContent`), including literal markdown if the user types it.
- **Assistant** bubbles render **GitHub-flavored markdown** in the browser: **marked** parses content, **DOMPurify** sanitizes HTML before `innerHTML`, and **highlight.js** (with the `github` theme) colors fenced code blocks. Inline `` `code` `` and prose (lists, bold, links, tables, blockquotes) use `.msg-bubble--md` styles.
- **Streaming:** assistant HTML is **debounced** (~100 ms) while SSE deltas arrive; a final synchronous render runs when the stream finishes. The blinking caret is a `.cursor` span re-appended after each render while streaming.
- **Errors** on the assistant bubble use plain `textContent` again (no markdown) and strip the markdown modifier class so error styling stays predictable.

Dependencies are npm packages (`marked`, `dompurify`, `highlight.js`); the hljs theme is imported in `src/main.ts`.

## Development

- `npm run dev` — Vite dev server with HMR
- `npm run build` — `tsc` then `vite build` → `dist/`
- `npm run preview` — serve production build locally

## Files

| File | Role |
|------|------|
| [`index.html`](../index.html) | Vite HTML shell and static markup |
| [`src/main.ts`](../src/main.ts) | Application entry point |
| [`public/sw.js`](../public/sw.js) | PWA service worker |
| [`public/manifest.json`](../public/manifest.json) | Web app manifest |
| [`documentation/context.md`](context.md) | This document |
