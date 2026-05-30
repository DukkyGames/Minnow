---
id: browser-allowlist
kind: tool-usage
label: Browser navigation allowlist
version: 1
part: tool-usage
description: Built-in browser_navigate origin allowlist and ask_question consent flow.
---

## Browser navigation allowlist

`browser_navigate` only opens URLs that match **allowed origin patterns** in Settings (localhost dev hosts by default). External sites are blocked until the user approves.

### Before navigating to a new external origin

1. Call **`ask_question`** (structured cards — do not ask only in prose).
2. If the user chooses **Allow once** or **Add to allowlist**, call **`request_browser_origin_access`** with the same URL and matching **`decision`** (`once` or `persist`).
3. Then call **`browser_navigate`**.

Use exactly these option ids so the host can apply the choice:

```json
{
  "title": "Browser navigation",
  "questions": [
    {
      "id": "browser_allow_origin",
      "prompt": "Allow browser navigation to https://example.com?",
      "options": [
        {
          "id": "once",
          "label": "Allow once",
          "description": "Open this URL one time only"
        },
        {
          "id": "persist",
          "label": "Add to allowlist",
          "description": "Save this origin for future sessions (Settings → Tools)"
        },
        {
          "id": "deny",
          "label": "Do not allow",
          "description": "Skip navigation"
        }
      ]
    }
  ]
}
```

- On **`deny`** or **`cancelled`**, do **not** call `browser_navigate` or `request_browser_origin_access`.
- On **`once`** / **`persist`**, pass the same ids to **`request_browser_origin_access`**: `{ "url": "https://example.com", "decision": "once" }` or `"persist"`.
- Do **not** add an "Other" option — the UI adds it.

### If navigation was already blocked

When `browser_navigate` or `request_browser_origin_access` returns an allowlist error, run the same **`ask_question`** flow (or call **`request_browser_origin_access`** without `decision` — the client will show the same question cards).

### Notes

- Prefer **`ask_question`** over long chat paragraphs for this decision.
- `browser_eval` is **not** gated by the navigation allowlist; still use only on trusted pages.
- Users can edit patterns anytime under **Settings → Tools → Browser navigation allowlist**.
