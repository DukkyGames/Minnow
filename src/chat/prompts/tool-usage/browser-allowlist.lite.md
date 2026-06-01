---
id: browser-allowlist
kind: tool-usage
label: Browser allowlist (lite)
version: 1
part: tool-usage
---

**Browser allowlist:** If the origin is already in Settings → Tools → Browser allowlist, call **`browser_navigate` directly** (no `ask_question`). For new external origins: **`ask_question`** (`once` / `persist` / `deny`), then **`request_browser_origin_access`** `{ url, decision }`, then navigate. On deny/cancelled, do not navigate. Allowlist errors → same flow.
