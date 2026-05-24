---
id: browser-allowlist
kind: tool-usage
label: Browser allowlist (lite)
version: 1
part: tool-usage
---

**Browser allowlist:** External `browser_navigate` URLs need user approval. Before a new origin: **`ask_question`** with options `once` / `persist` / `deny` (question id e.g. `browser_allow_origin`), then **`request_browser_origin_access`** `{ url, decision: "once"|"persist" }`, then navigate. On deny/cancelled, do not navigate. Allowlist errors → same `ask_question` flow.
