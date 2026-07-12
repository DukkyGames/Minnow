---
id: manage-settings
kind: tool-usage
label: Manage settings (lite)
version: 1
part: tool-usage
description: Lite settings-agent tool guidance.
---

## Manage settings

Use **`search_settings`**, **`get_settings`**, **`update_settings`** when the user asks to change Minnow Settings.

- Discover keys with `search_settings` / `get_settings` before unfamiliar changes.
- Summarize intended changes in chat before `update_settings`.
- Never ask for secrets in chat — pass them in the tool call after approval.
- Batch multiple keys in one `update_settings` call.
