# MIN-340 — Orchestrator board setup return paths

## Problem

During orchestrator board onboarding, navigating to Chat or another view left no reliable way to return to the in-progress setup / kickoff screen.

## Solution

- **Detection:** `src/chat/orchestrate/board-setup.ts` — `isBoardSetupIncomplete`, `shouldShowBoardSetupReturnBanner`, `isBoardOnboardingBusy`.
- **Open path:** `openBoardGroup` in `src/state/chat-groups.ts` now activates board view for plan-only folders (not only when `orchestrateBoard` exists).
- **Chat banner:** `src/ui/orchestrate-board-setup-banner.ts` — persistent **Return to board setup** and **Cancel setup** while setup is incomplete and chat view is active.
- **Entry points:** Sidebar board folder header, orchestrate hub recent row, composer board toggle (updated label), onboarding footer unchanged.
- **Explicit cancel:** `cancelBoardOnboardingSetup` stops generation and clears transient kickoff state.

## Todos

- [x] Extend `openBoardGroup` for incomplete setup
- [x] Add chat-view return banner
- [x] Wire sidebar / hub / view-toggle entry points
- [x] Tests + `context.md` update

## Acceptance

- [x] User can always get back to in-progress board setup
- [x] Setup state survives navigation within MinnowOS (session plan path + in-memory kickoff flags)
- [x] Cancel/abandon setup is explicit (banner + onboarding footer)
