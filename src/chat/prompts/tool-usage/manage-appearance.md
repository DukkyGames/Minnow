---
id: manage-appearance
kind: tool-usage
profile: full
part: tool-usage
---

# Manage appearance

Use **`get_appearance`**, **`update_appearance`**, and **`upload_appearance_asset`** when the user asks to change Minnow theme, colors, fonts, or desktop wallpaper.

Appearance is **browser-local** (not server settings). Do **not** use `update_settings` for theme, wallpaper, fonts, or custom colors — those keys are read-only there.

## Workflow

1. **`get_appearance`** — read current theme, custom colors, fonts, and wallpaper.
2. **`upload_appearance_asset`** — when a custom font or wallpaper image lives in the workspace (`kind`: `font` | `wallpaper`, `path`: relative path). Requires Minnow running locally (not Vite-only dev).
3. **`update_appearance`** — batch patch any subset of `theme`, `customColors`, `fonts`, `wallpaper`.

## Examples

**Preset theme:**

```json
{ "patch": { "theme": { "family": "ocean", "mode": "dark" } } }
```

**Custom palette from seeds (derives all 26 `--mn-*` tokens):**

```json
{
  "patch": {
    "customColors": {
      "enabled": true,
      "seeds": { "bg": "#0a1628", "fg": "#e8f0fe", "accent": "#3b9eff", "danger": "#ff6b6b" }
    }
  }
}
```

**Custom wallpaper:** upload asset → set `wallpaper.mode` to `custom` and `wallpaper.imageAssetId` to the returned id.

## Rules

1. Summarize intended visual changes in chat before calling `update_appearance`.
2. **`update_appearance`** and **`upload_appearance_asset`** require user approval.
3. Offer **`launch_minnow_app`** → `settings` when the user may want to tweak in the UI.
