---
name: google-fonts-appearance-catalog
overview: Expand Settings → Appearance font pickers with a large Google Fonts catalog, lazy-load only the currently selected UI and mono families, and drop Geist (jsDelivr).
todos:
  - id: catalog
    content: "Single catalog of 30+ UI and 20+ mono Google Fonts; drop Geist; keep System + JetBrains default look"
    status: completed
  - id: lazy
    content: "Inject Google Fonts CSS2 stylesheet for the active pair only; remove boot-time @import of all webfonts"
    status: completed
  - id: settings
    content: "Settings dropdowns (optgroups), specimen, offline hint"
    status: completed
  - id: tests-docs
    content: "Tests, context.md, DESIGN.md, settings/manual, css-map"
    status: completed
isProject: true
---

# Google Fonts catalog in Appearance

**Date:** 2026-09-03
**Goal:** Settings → Appearance → Fonts offers a large Google Fonts catalog for UI and monospace, loading only the two families in use.
**Granularity:** medium

## Agreed context

- **Goal / outcomes:** More typeface choice in the existing UI font and mono font dropdowns. Geist Sans / Geist Mono are removed (they were Fontsource via jsDelivr, not Google Fonts). Ligature coding fonts (Fira Code, JetBrains Mono, Cascadia Code) stay in the mono list.
- **Users & platforms:** Desktop Settings → Appearance, plus `update_appearance` preset ids. Same `--font-ui` / `--font-mono` consumers as today.
- **MVP vs later:** Curated large catalog (30+ UI, 20+ mono), not the entire Google Fonts directory and not a type-any-family search box.
- **Constraints:** Do not preload the catalog at boot (performance review already flagged the JetBrains `@import`). Unknown stored ids (`geist`, `geist-mono`) fall back to the existing System defaults. Default first-run look stays System UI + JetBrains-first System mono.
- **Non-goals:** Self-hosting the catalog, a searchable font marketplace, serif/display/handwriting UI faces, changing `--font-ui` / `--font-mono` token names.

## Success checks

- [ ] UI picker has **≥ 31** presets (System + 30 Google Sans families).
- [ ] Mono picker has **≥ 21** presets (System + 20 Google Mono families, including Fira Code).
- [ ] Geist ids are gone; leftover localStorage values parse as System.
- [ ] Boot CSS does not `@import` Google Fonts or jsDelivr Fontsource. A single `fonts.googleapis.com/css2` stylesheet is injected for the **selected** UI + mono pair (JetBrains still loads when System mono is selected, matching today's default stack).
- [ ] `npx tsc --noEmit` and `test/appearance/fonts.test.mts` pass.

## Architecture / key files

| File | Role | Action |
|------|------|--------|
| `src/appearance/font-catalog.ts` | Preset ids, labels, Google family + weights | CREATE |
| `src/appearance/types.ts` | Re-export preset unions | MODIFY |
| `src/appearance/fonts.ts` | Stacks, CSS vars, lazy stylesheet inject | MODIFY |
| `src/ui/settings-appearance-fonts.ts` | Dropdowns + specimen | MODIFY |
| `src/styles/font-presets.css`, `src/styles/fonts.css` | Boot webfont `@import`s | DELETE |
| `src/main.ts` | Stop importing those sheets | MODIFY |
| `test/appearance/fonts.test.mts` | Catalog size, URL, geist fallback, inject | MODIFY |
| `documentation/context.md`, `DESIGN.md`, manual / css-map | Shipped behavior | MODIFY |

## Loading

`applyAppearanceFonts` already runs at theme init. After writing `--font-ui` / `--font-mono`, it upserts `<link id="minnow-google-fonts" rel="stylesheet">` with a CSS2 URL for the active Google families (`display=swap`, weights 400/500/600 where the family has them). System UI requests nothing. Removing a webfont selection removes the link (or shrinks the URL). `applyAppearanceFonts` must **not** emit font listeners (MIN-262 recursion).

Offline: stacks keep OS fallbacks. Upload fonts are unchanged (IndexedDB).
