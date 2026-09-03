# Code view-bar switching snaps back

## Problem

Switching Overview / Dev servers / Code map / Super Plan / Orchestrate works when you enter from chat. Switching between those views, or opening one from an Orchestrate board, flashes the new view then returns to the previous one (or does nothing).

## Root causes

1. **Split source of truth.** Overview and Dev servers are hash routes (`#/app/code/overview`, `#/app/code/dev-server`). Super Plan, Orchestrate hub, and Code map are overlays that never update the hash. Opening Super Plan from Overview leaves `#/app/code/overview` in the URL, so the next router/app-host sync reopens Overview.
2. **Incomplete `closeCompeting` lists.** Each view closes a different subset of the others. Overview does not close Super Plan. Dev servers does not close Super Plan. Several paths call `closeOrchestrateHub()` (restores chat, and can schedule an async board paint) instead of `teardownOrchestrateHub()`.
3. **Board refresh punches through overlays.** `isBoardDomRefreshBlockedByOverlay` treats an active kanban as "not blocked" unless Overview is open. Dev servers, Super Plan, hub, and Code map get overwritten by `renderBoardView`.
4. **`parseOsHash` ignores `#/app/code/chat`.** The `chat` segment falls through to `pendingCodeSection`, so a leftover `overview` pending can revive Overview.

## Decisions

- Keep press-again-to-leave (toggle back to chat).
- Park board `viewMode` while a stage view is open so leaving the view can restore the kanban. Do not let the kanban paint while the overlay is mounted.
- Give Super Plan, Orchestrate, and Code map first-class hashes so the router and the view bar share one source of truth.

## Todos

- [x] Extend `CodeSectionId` and router parse/hash/navigate helpers
- [x] Add `closeOtherCodeStageViews` + `isCodeStageOverlayMounted`
- [x] Block board DOM refresh when any stage overlay is mounted
- [x] Wire view-bar buttons and app-host through hashes; teardown without restoring chat
- [x] Regression tests for parse, overlay block, and view-to-view switch
- [x] Update `documentation/context.md`
