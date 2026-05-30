---
name: browser-automation
description: >-
  Drive the built-in Minnow preview browser for login flows, SPAs, and screenshots.
  Use when fetch tools are insufficient or the user mentions browser automation.
disable-model-invocation: true
---

# Browser automation (built-in preview)

Use **`browser_*` tools** when you need a real page in the **Minnow desktop shell** (Electron preview panel): authenticated pages, dynamic JS, or visual verification. External Chrome CDP is **not** used.

## When to use preview browser vs fetch tools

| Need | Tool |
|------|------|
| Public HTML, no login | `fetch_web_content` (browser executor) |
| Login, SPA, CORS-blocked | `browser_navigate` + `browser_snapshot` |
| Visual proof | `browser_screenshot` |

## Workflow

1. Run **`npm run electron:dev`** or the packaged app (tools are hidden in a plain browser tab).
2. `browser_list` — confirm the preview panel URL/title.
3. For **new external origins**, call **`ask_question`** first (options `once`, `persist`, `deny`), then **`request_browser_origin_access`** with `{ url, decision: "once"|"persist" }`, then **`browser_navigate`** (opens the preview panel).
4. `browser_snapshot` — get `[uid]` markers for elements.
5. `browser_click` / `browser_fill` — act on uids from the latest snapshot.
6. `browser_screenshot` — PNG appears inline in chat.

Enable tools under **Settings → Tools → Built-in browser automation** and allowlisted origins.
