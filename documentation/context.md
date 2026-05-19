# SpeedChat — project context

## What it is

SpeedChat is a static single-page web client for **LM Studio** (local OpenAI-compatible API). The entire UI and client logic live in [`index.html`](../index.html): HTML, CSS, and JavaScript. There is no build step.

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
- **Mobile (≤640px):** the sidebar is a **fixed overlay**; the dimmed **`.sidebar-backdrop`** closes it on tap. The top bar menu button toggles open/closed.
- **Mobile stats (≤599px):** the stats strip shows a collapsed summary (TPS + total tokens); tap **Stats** to expand the full instrument panel (`.stats-strip.is-expanded`).

### Other persisted settings

System prompt preset and textarea content use a separate key: `speedchat.systemPrompt` (see `PRESET_STORAGE_KEY` in `index.html`). Server URL, temperature, and max tokens remain in the DOM / settings drawer and are not part of the session blob unless changed elsewhere later.

## Service worker

[`sw.js`](../sw.js) caches shell assets for offline/PWA use. The cache name is versioned (e.g. `speedchat-v2`) so bumps invalidate old caches.

## Design context

Product and visual direction live in [`PRODUCT.md`](../PRODUCT.md) and [`DESIGN.md`](../DESIGN.md). The UI uses OKLCH tokens, inline SVG icon buttons, a semantic `<header>` top bar, `<main>` chat area, settings drawer with `role="dialog"` and focus trap, and a collapsible stats strip on narrow viewports.

## API usage

- **Models:** `GET {serverUrl}/api/v0/models`
- **Chat:** `POST {serverUrl}/api/v0/chat/completions` with streaming SSE; optional non-streaming fallback if the stream yields no text.

## Files

| File | Role |
|------|------|
| [`index.html`](../index.html) | Full app: UI, presets, sessions, LM Studio client |
| [`sw.js`](../sw.js) | PWA cache |
| [`manifest.json`](../manifest.json) | Web app manifest |
| [`documentation/context.md`](context.md) | This document |
