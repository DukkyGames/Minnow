# Issues embed in Code app

## Goal

Opening **Issues** from the Code app sidebar should show the tracker inside the Code window’s `#chatArea`. Opening Issues from the desktop (dock, app switcher, hash `#/app/issues`) keeps the existing fullscreen Issues app.

## Decisions

- [x] Embed location: replace `#chatArea` (same family as Code overview / Code map)
- [x] Entry point for embed: Code sidebar `btnAllBugs` only
- [x] Desktop / dock / menubar / `#/app/issues`: unchanged fullscreen launch
- [x] Close: sidebar toggle, header Back control, Escape
- [x] Pattern: reparent `#issuesView` (preserve wired DOM ids), restore to `#osAppsLayer` on teardown

## Todos

- [x] Embed open/close + sidebar toggle in `src/ui/issues-page.ts`
- [x] Main-column overlay classes + chat-paint teardown
- [x] Competing overlays (overview / code map / orchestrate hub) close Issues embed
- [x] `closeAllAppPages` restores embedded Issues to apps layer
- [x] CSS for embedded layout + hide composer chrome
- [x] Override `.mn-os-app-layer:not(.is-active)` while embedded (blank panel fix)
- [x] Skip `#/app/issues/...` hash updates while embedded so detail stays in Code
- [x] Unit tests (`test/ui/issues-embed-in-code.test.mts`)
- [x] Update `documentation/context.md`

## Interaction

1. In Code, click sidebar Issues → `#issuesView` mounts in `#chatArea`; composer/stats hidden.
2. Click again, Back, or Escape → Issues returns to apps layer; prior chat restores.
3. Dock / Desktop launch still `launchApp('issues')` fullscreen.
4. If Issues was embedded and a fullscreen Issues launch happens, teardown embed first so the layer can activate normally.
