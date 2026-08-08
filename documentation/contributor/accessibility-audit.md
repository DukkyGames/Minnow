# Accessibility and keyboard-first audit

Contributor checklist for keyboard operability, focus management, screen-reader behavior, and contrast coverage across Minnow apps. Product reference: [`../context.md`](../context.md) (Accessibility section). User-facing shortcut list: [`../manual/reference/keyboard-shortcuts.md`](../manual/reference/keyboard-shortcuts.md). Regression guard: `npm run test:a11y` (includes `test/theme-contrast.test.mts`).

## Global help surface

Press **`?`** (when not typing in a text field) to open the shell keyboard shortcuts overlay. Lists shell, chat, code, and orchestrate board bindings.

## Per-app keyboard checklist

| App | Core flow (keyboard-only) | Notes |
|-----|---------------------------|-------|
| **Shell / app rail** | Tab through menubar and app rail tiles; Enter launches apps | Ctrl+Tab cycles workspaces picker and recent apps |
| **Code chat** | Tab to composer; type message; Enter send; `/` skills; model picker Arrow keys | Streaming uses throttled `aria-live` (no token spam) |
| **Code** | File tree arrows; editor Tab/Escape; Ctrl/Cmd+K Quick Edit | Terminal: focus with tab; Ctrl/Cmd+C copies selection |
| **Research** | Tab through hub controls; Enter starts run | Progress uses `aria-live="polite"` |
| **Models** | Tab filters and model rows; Enter selects | |
| **Brain** | Tab form fields; Enter save | |
| **Issues** | List keyboard nav; context menu | |
| **Scheduler** | Tab job fields; Enter save | |
| **Settings** | Finder search; Tab sections; Escape closes drawer | Drawer traps focus |
| **Orchestrate board** | Tab cards and header; Arrow grid nav; Enter open task | Exec mode segments: Arrow keys |

Release-gated apps are out of scope until their gate flips; audit them in the PR that releases them.

## Focus management

- **Overlays:** Source Control Center, Scheduler's side panel, and the in-app editors return focus to the control that opened them.
- **Modals:** app dialog, git help, tool approval, question cards, and keyboard help trap Tab and restore focus on close.
- **Reparenting:** moving chat, file tree or preview nodes between layouts must not steal focus from an editable control (MIN-179).

## Screen reader smoke (NVDA on Windows)

1. App rail: tile names announced; Ctrl+Tab cycle announces the focused app.
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
- Source Control Center: roving tabindex across the seven-section rail.
- Live NVDA verification scripts (manual, not CI).
