# Token-based 8-theme system

**Status:** Implemented (2026-05-23).

## Summary

Replaced binary `light` / `dark` OKLCH themes with **8 palette themes** (4 families × 2 modes), **22 `--mn-*` core tokens** per theme, Settings theme picker with system follow, FOUC-safe boot, and full `--mn-*` rename across stylesheets, reef widgets, and prompts.

## Families

| Family | Label | Accent character |
|--------|-------|------------------|
| `sage` | Slate · Sage | Muted sage green |
| `amber` | Stone · Amber | Warm amber |
| `cyan` | Midnight · Cyan | Soft cyan |
| `coral` | Graphite · Coral | Warm coral |

## Storage keys

- `minnow.theme` — `ThemeId` when not following system
- `minnow.theme.followSystem` — `'1'` when following OS
- `minnow.theme.family` — family while follow-system is on

## Implementation map

| Area | Files |
|------|--------|
| Registry + persistence | `src/theme.ts` |
| DOM + hljs/xterm | `src/ui/theme.ts` |
| Tokens | `src/styles/tokens.css` (generated via `scripts/generate-tokens-css.mjs`) |
| FOUC | `index.html` inline script + critical CSS |
| Settings UI | `src/ui/settings-theme.ts`, `src/styles/settings-page.css` |
| Transitions | `src/styles/theme-transitions.css` |
| Reef | `src/chat/reef/theme-forward.ts`, `src/chat/reef/widgets/*.md` |
| Tests | `test/theme.test.mts`, `test/theme-contrast.test.mts`, `test/chat/reef/theme-forward.test.mts` |

## Verification

```bash
node --import tsx --test test/theme.test.mts test/theme-contrast.test.mts test/chat/reef/theme-forward.test.mts
npm start
```

Manual: Settings → General — all families × modes; follow system; hard refresh; reef widget recolor on theme change.

## Design source

`Minnow — Color Scheme Exploration.pdf` and `Minnow Color Scheme.html` (palette values in `palettes.jsx`).
