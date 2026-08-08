# Accessibility and keyboard-first audit

Contributor checklist for keyboard operability, focus management, screen-reader behavior, and contrast coverage across Minnow apps. Product reference: [`../context.md`](../context.md) (Accessibility section). User-facing shortcut list: [`../manual/reference/keyboard-shortcuts.md`](../manual/reference/keyboard-shortcuts.md). Regression guard: `npm run test:a11y` (includes `test/theme-contrast.test.mts`).

## Global help surface

Press **`?`** (when not typing in a text field) to open the shell keyboard shortcuts overlay. Lists shell, chat, code, orchestrate board, and email bindings. Email also exposes a mail-specific sheet with **`?`** while the mail app is focused.

## Per-app keyboard checklist

| App | Core flow (keyboard-only) | Notes |
|-----|---------------------------|-------|
| **Desktop / app rail** | Tab through menubar and app rail tiles; Enter launches apps | Ctrl+Tab cycles workspaces picker and recent apps |
| **Chat** | Tab to composer; type message; Enter send; `/` skills; model picker Arrow keys | Streaming uses throttled `aria-live` (no token spam) |
| **Code** | File tree arrows; editor Tab/Escape; Ctrl/Cmd+K Quick Edit | Terminal: focus with tab; Ctrl/Cmd+C copies selection |
| **Research** | Tab through hub controls; Enter starts run | Progress uses `aria-live="polite"` |
| **Models** | Tab filters and model rows; Enter selects | |
| **Brain** | Tab form fields; Enter save | |
| **Issues** | List keyboard nav; context menu | |
| **Scheduler** | Tab job fields; Enter save | |
| **Settings** | Finder search; Tab sections; Escape closes drawer | Drawer traps focus |
| **Orchestrate board** | Tab cards and header; Arrow grid nav; Enter open task | Exec mode segments: Arrow keys |
| **Email** | j/k list; e archive; c compose; `?` mail shortcuts | See `email-keyboard.ts` |
| **Calendar** (hidden) | Grid Tab/arrow; Enter open day | Release-gated |
| **Compare / Bench / Experts** (hidden) | Tab primary actions | Release-gated |

## Focus management

- **Floating windows:** focus returns to the element before the window stack when the last window closes.
- **Modals:** app dialog, git help, tool approval, question cards, and keyboard help trap Tab and restore focus on close.
- **Window frames:** do not steal focus from editable controls inside the window body (MIN-179).

## Screen reader smoke (NVDA on Windows)

1. Desktop: dock tile names announced; window cycle announces focused window title.
2. Chat stream: "Generating…" / "Thinking…" once; prose throttled (~3s); "Response complete" at end.
3. Composer mode picker and model listbox: role/listbox + arrow navigation.
4. Tool approval: digit shortcuts documented in strip; buttons labeled.

## Contrast (WCAG AA)

`test/theme-contrast.test.mts` checks all 16 palette themes: `--mn-fg` on `--mn-bg` / `--mn-surface-1`, muted text, accent ink, and light-mode syntax highlights (MIN-243 folded into suite).

## Automated regression

```bash
npm run test:a11y
npm run impeccable:detect   # static anti-patterns incl. a11y heuristics
```

## Known long tail (file as issues)

- Full axe-core DOM pass per app route in Electron (CI browser harness).
- Calendar month grid roving tabindex audit.
- Compare/Bench hidden apps: dedicated keyboard maps when released.
- Live NVDA verification scripts (manual, not CI).
