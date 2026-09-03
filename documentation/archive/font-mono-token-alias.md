# Fix undefined `--mn-font-mono` CSS token

## Problem

`--mn-font-mono` is referenced in 13 stylesheets but never defined. Appearance fonts write `--font-mono` on `documentElement` (`src/appearance/fonts.ts`); `tokens.css` also defines `--font-mono`. Rules with a fallback stack ignore the user font; rules with no fallback inherit the UI face.

## Approach

Replace every `--mn-font-mono` reference under `src/styles/` with `--font-mono`. Drop now-redundant inline fallbacks (`'JetBrains Mono'`, `ui-monospace`, nested `var(--font-mono, …)`) because `:root` already defines the stack.

## Todos

- [x] Replace `--mn-font-mono` with `--font-mono` in all `src/styles/` files; drop inline fallbacks
- [x] Confirm zero remaining `--mn-font-mono` references in the repo
- [x] Document the typography tokens in `documentation/context.md` (and design-system tokens note if needed)
- [x] Add a regression test that stylesheets do not use the undefined alias
- [x] Verify: Vite is serving the rewritten CSS; happy-dom computed styles on palette / menu / context-usage / change-strip / keyboard-help / settings / onboarding follow `documentElement --font-mono` after the same write Settings → Fonts performs. This session has no browser automation for the Electron Settings UI.
