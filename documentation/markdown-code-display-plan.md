# Markdown and code snippet rendering — implementation archive

This document records what was implemented for assistant message formatting in SpeedChat. The authoritative source for behavior is [`context.md`](context.md) and [`index.html`](../index.html).

## Goals

- Render assistant replies as **GFM markdown** (bold, lists, links, tables, etc.).
- Render **fenced code blocks** with **syntax highlighting** and readable monospace layout.
- Keep **user** messages as **plain text**.
- **Sanitize** model-produced HTML with **DOMPurify** before injection.
- **Debounce** (~100 ms) markdown updates during **SSE streaming**; final render when the stream completes.

## Dependencies (CDN, no build)

Loaded in `index.html` before the app script:

- `marked` — markdown → HTML
- `dompurify` — sanitize HTML
- `highlight.js` + `github.min.css` theme — fenced block highlighting

## Key functions (in `index.html`)

| Function | Role |
|----------|------|
| `setAssistantBubbleContent(bubble, markdown, { streaming, streamCursor })` | Parse → sanitize → `innerHTML` → `hljs.highlightElement` on `pre code`; re-attach streaming cursor when needed |
| `scheduleAssistantBubbleRender(bubble, markdown, streamCursor)` | Trailing debounce timer for stream updates |
| `cancelAssistantBubbleRenderDebounce()` | Clears pending timer before final render or errors |

## CSS

- `.msg-bubble--md` on assistant bubbles: normal white-space flow, prose spacing, inline `code` styling, `pre` shell with horizontal scroll and optional `data-lang` label via `::before`.

## Security and fallbacks

- If CDN libraries fail to load, assistant content falls back to **plain text**.
- Assistant **errors** remove `.msg-bubble--md` and use `textContent` with danger color.

## Optional follow-ups

- Vendor minified libraries under `vendor/` and bump `sw.js` cache version for offline-first installs without a prior CDN fetch.
- Optional “copy code” control on `pre` hover.
