# MIN-434: Opening chat opens blank browser

## Problem

Opening a chat in the Code app sometimes surfaced a blank in-app browser panel (Electron `WebContentsView` at `about:blank`).

## Root cause

Race between Code entry collapse (MIN-342) and async `loadFilePanelPrefs()`:

1. `osOnAppOpen('code')` collapsed the right split and cleared the guest to `about:blank`.
2. `initFilePanel()` later loaded persisted `filePanel.rightPaneMode: 'preview'` from config.
3. Opening a chat (or layout reconcile) made the preview pane visible again.
4. The stale `onLoading(false)` handler called `showPreviewHost()` for the blank guest.

## Fix

- [`clampPersistedFilePanelForActiveSurface()`](../src/ui/preview-restore-policy.ts) — run after `loadFilePanelPrefs()`; clears open-split flags that must not auto-restore on Code while preserving `previewSource` / tab lists.
- [`onPreviewGuestLoadSettled()`](../src/ui/preview-panel.ts) — only shows the native guest when `rightPaneMode === 'preview'` and the tab has a real source or non-blank URL.

## Verification

1. Persist `filePanel.rightPaneMode = preview` with a localhost URL → open Code → open a chat from overview or sidebar → **no blank browser panel**.
2. Desktop browser drawer restore on reload still works.
3. Explicit `#btnPreviewToggle` still reopens the last URL.

Tests: `test/ui/preview-restore-policy.test.mts` (MIN-434 clamp cases).
