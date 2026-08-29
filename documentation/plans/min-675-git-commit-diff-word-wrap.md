# MIN-675 — Word wrap for git commit review

**Date:** 2026-08-29  
**Goal:** Long lines in the side-by-side commit / working-tree diff review no longer force horizontal scrolling by default; users can toggle wrap on or off.  
**Granularity:** small

## Todos

- [x] Persist wrap preference (`localStorage`, default **on**)
- [x] Toggle control in commit-diff meta chrome (commit + working-file panels)
- [x] CSS: wrap mode uses `pre-wrap` and drops `min-width: max-content`
- [x] Unit tests for preference + rendered wrap class
- [x] Update `documentation/context.md` and Code manual mention
- [ ] Browser-verify: open a commit/working diff, confirm wrap default + toggle

## Design

1. **Default on** — missing storage key means wrap enabled (same pattern as compare parallel pref).
2. **Toggle** — toolbar button labeled **Wrap** with `aria-pressed`, next to Close in the commit-diff meta bar. Preference survives panel close/reopen.
3. **CSS class** — `sbs-diff--wrap` on the mount host; cells use `white-space: pre-wrap` + `overflow-wrap: anywhere`; grid is `width: 100%` without `min-width: max-content`. Gutters `align-items: start` so line numbers stay top-aligned when a cell wraps.
4. **Scope** — commit review and working-tree file diffs share `git-commit-diff-panel` / `side-by-side-patch-diff`; both get the toggle.

## Out of scope

- Editor word-wrap settings (`editorSettings.wordWrap`) — separate surface.
- Unified (inline) tool-call diffs in chat.
