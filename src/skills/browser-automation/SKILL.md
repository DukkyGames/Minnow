---
name: browser-automation
description: >-
  Drive Chrome via CDP for login flows, SPAs, and screenshots. Use when fetch tools
  are insufficient or the user mentions browser automation.
disable-model-invocation: true
---

# Browser automation (CDP)

Use **CDP browser tools** when you need a real Chrome tab: authenticated pages, dynamic JS, or visual verification.

## When to use CDP vs fetch tools

| Need | Tool |
|------|------|
| Public HTML, no login | `fetch_web_content` (browser executor) |
| Login, SPA, CORS-blocked | `browser_navigate` + `browser_snapshot` |
| Visual proof | `browser_screenshot` |

## Workflow

1. `browser_list` — confirm Chrome is on `--remote-debugging-port` (default `9222`).
2. For **new external origins**, call **`ask_question`** first (options `once`, `persist`, `deny`), then **`request_browser_origin_access`** with `{ url, decision: "once"|"persist" }`, then **`browser_navigate`**.
3. If navigation was blocked, repeat the **`ask_question`** flow or call **`request_browser_origin_access`** without `decision` (shows the same question cards).
4. `browser_snapshot` — get `[uid]` markers for elements.
5. `browser_click` / `browser_fill` — act on uids from the latest snapshot.
6. `browser_screenshot` — PNG appears inline in chat.

Set `MINNOW_BROWSER_URL` or pass `browser_url` on each call. Enable tools under **Settings → Browser (CDP)**.

Troubleshooting: [opencode-browser](https://github.com/different-ai/opencode-browser).
