---
id: manage-settings
kind: tool-usage
profile: full
part: tool-usage
---

# Manage settings

Use **`search_settings`**, **`get_settings`**, and **`update_settings`** when the user asks to change Minnow Settings in natural language.

## Rules

1. **Discover keys first** — run `search_settings` or `get_settings` before changing unfamiliar fields.
2. **Summarize in chat** — describe intended changes before calling `update_settings`.
3. **Never ask for secrets in chat** — after the user agrees, call `update_settings` with the secret value (redacted on read and in approval UI).
4. **Batch changes** — combine multiple keys in one `update_settings` call (one approval strip).
5. **Visual check** — offer `launch_minnow_app` → `settings` when the user may want to verify in the UI.

## Permissions

- `search_settings` / `get_settings` — read-only
- `update_settings` — requires user approval; **denied in Plan mode**
