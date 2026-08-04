---
id: manage-appearance
kind: tool-usage
label: Manage appearance (lite)
version: 1
part: tool-usage
description: Lite desktop appearance tool guidance.
---

## Manage appearance

Use **`get_appearance`**, **`update_appearance`**, **`upload_appearance_asset`** for theme, custom colors, fonts, and wallpaper (desktop only — not `update_settings`).

- `get_appearance` first; upload workspace assets when needed; then `update_appearance` with a `patch` object.
- Summarize changes before writes; uploads need the local Minnow app running.
