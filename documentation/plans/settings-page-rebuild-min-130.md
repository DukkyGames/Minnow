# Settings Page Rebuild (MIN-130)

Implementation plan for the settings IA rebuild, field catalog, search/filter, and chat deep-links.

## Todos

- [x] Phase 0: `settings-catalog.ts`, category types, `createSettingsField`
- [x] Phase 1: 7-category sidebar, stacked area panels, legacy hash routing
- [x] Phase 2 (partial): Group/entity search keys for general, memory, rules, agents
- [x] Phase 3: Catalog in search index, live in-page filter, CSS
- [x] Phase 4: `launch_minnow_app` `settings_query` + `settingsSearchKey` deep-link
- [ ] Phase 2 (remaining): Wrap all render-module controls with `createSettingsField` + catalog keys

## Architecture

- **Categories** (sidebar): 7 merged groups in `SETTINGS_CATEGORIES`
- **Areas** (render units): existing `SettingsSectionId` sections stacked inside category panels
- **Field catalog**: `SETTINGS_FIELD_CATALOG` in `src/ui/settings-catalog.ts` — single source for search, filter, chat navigation
- **Legacy routes**: `#/settings/<area>` still works via `categoryForArea()`

## Key files

| File | Role |
|------|------|
| `src/ui/settings-catalog.ts` | Field catalog + category helpers |
| `src/ui/settings-page.ts` | Category routing + `navigateToSettingsField` |
| `src/ui/settings-filter.ts` | Live in-page dim/hide + sidebar match counts |
| `src/ui/settings-search-index.ts` | Registry + catalog union index |
| `src/tools/os-launch-tool.ts` | Chat `settings_query` resolution |
