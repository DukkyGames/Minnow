# Fix browser preview overlaying Issues / Orchestrate

## Problem

The native preview `WebContentsView` is a window-level overlay. Agent `browser_navigate` could paint it over Issues and other apps, or float it without Minnow chrome on Orchestrate, because main-process navigate/activate restored `lastBounds` and called `setVisible(true)` while renderer visibility gates were bypassed.

## Product contract

The native preview guest may paint **only** when the Code browser preview panel is open on screen (pane visible, `#previewBody` has layout, Code or desktop browser mount foreground, no wiki / fullscreen app / chrome popover occlusion).

| Surface | Agent `browser_navigate` |
|---|---|
| Code + Orchestrate board | Open the preview panel (chrome + body), then show guest inside it |
| Issues / other non-Code apps | Navigate in the background; **never** show the guest overlay; reveal only when the user returns to Code with the panel open |
| Chrome popovers / wiki / dialogs | Keep existing hide-while-open behavior (`registerChromePopover`) |

## Decision

1. **Main process** — split attach-for-navigation from paint. `showActiveTab` / `PREVIEW_NAVIGATE_AWAIT` / tab activate / loadSource do not call `setVisible(true)` from `lastBounds` when no explicit valid bounds were passed and the instance is not already visible. Renderer `preview.show(bounds)` is the only reveal path. Capture may briefly restore bounds, then re-hides if the instance was not previously visible (`electron/preview-guest-reveal.ts`).
2. **Agent reveal** — `revealPreviewPanelForAgentNavigation` opens the split on Code/Orchestrate and waits for stable `#previewBody` bounds. On Issues / wiki / other apps it updates tab state, calls `preview.hide()`, and does not open the pane. `browserPreviewNavigate` order: reveal → ensure tab → `navigateAndWait` → schedule visibility sync.
3. **Visibility gate** — keep chrome popover / wiki / Design Mode iframe checks. Expand fullscreen overlay ids (Models, Brain, Scheduler, …) and treat active non-Code `.mn-os-app-layer` as occlusion.

## Todos

- [x] Stop preview-host navigate/activate/capture from `setVisible(true)` via stale lastBounds; keep explicit `show(bounds)` as the reveal path
- [x] Fix `applyAgentPreviewNavigation` / `browserPreviewNavigate`: open panel on Code/Orchestrate; silent bg navigate + hide on Issues/other apps; avoid double-load races
- [x] Harden `shouldShowElectronPreviewHost` for non-Code apps without breaking chrome popover / wiki / Design Mode iframe guest hiding
- [x] Add/extend unit tests for auto-reveal, Issues occlusion, Orchestrate panel open, and existing popover regressions
- [x] Update `documentation/context.md` Preview browser contract; write plan to `documentation/plans/`

## Key files

- [`electron/preview-host.ts`](../../electron/preview-host.ts)
- [`electron/preview-guest-reveal.ts`](../../electron/preview-guest-reveal.ts)
- [`src/ui/preview-panel.ts`](../../src/ui/preview-panel.ts)
- [`src/tools/browser-preview-tools.ts`](../../src/tools/browser-preview-tools.ts)
- [`src/ui/preview-electron-visibility.ts`](../../src/ui/preview-electron-visibility.ts)
- [`test/electron/preview-guest-reveal.test.mts`](../../test/electron/preview-guest-reveal.test.mts)
- [`test/ui/preview-electron-visibility.test.mts`](../../test/ui/preview-electron-visibility.test.mts)
- [`test/ui/preview-agent-reveal.test.mts`](../../test/ui/preview-agent-reveal.test.mts)
