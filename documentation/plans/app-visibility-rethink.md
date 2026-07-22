# App visibility rethink

## Confirmed brief

- **Surfaces:** Settings → Apps and onboarding Choose your apps (shared picker).
- **Pattern:** Keep selectable cards, quieter. No Selected/Always on badges. No accent wash when enabled.
- **Core:** Collapse to one line (Chat, Models, Brain, Settings).
- **Off state:** Stay in grid, dimmed.
- **Bulk:** Enable all / Disable all for optional apps.
- **Copy:** Trim repeated leads and descriptions.
- **Fidelity:** Production rethink (not polish-only).

## Todos

- [x] Confirm direction with user
- [x] Rewrite `app-picker-ui` + CSS
- [x] Wire Settings + onboarding
- [x] Update tests + docs
- [x] Skip onboarding Email/Calendar steps when those apps are disabled

## Design notes

- Color strategy: Restrained (neutral on/off; accent only for focus).
- Scene: settings bench at desk; calm instrument chrome, not launcher marketing.
- Anchors: system Settings lists, Raycast preference rows (density), Minnow flat borders.
