# MIN-434: Opening chat opens blank browser

## Problem

Opening or switching chats in the Code app sometimes surfaced a blank in-app browser panel (Electron `WebContentsView` at `about:blank`).

## Root cause

Race between Code entry collapse (MIN-342) and async `loadFilePanelPrefs()`, plus two follow-up holes:

1. `osOnAppOpen('code')` collapsed the right split and cleared the guest to `about:blank` (while **keeping** `previewSource`).
2. `initFilePanel()` later loaded persisted `filePanel.rightPaneMode: 'preview'` from config — sometimes **before** the OS router marked Code as foreground, so the first clamp was a no-op.
3. Opening/switching a chat (or layout reconcile) made the preview pane visible again.
4. Stale `onLoading(false)` called `showPreviewHost()` for a blank guest **when a source still existed**.
5. `clearPreviewGuest()` incorrectly used `preview.tabs.close`, destroying the Electron tab instead of blanking it — later reactivation showed an empty guest.

## Fix

### Pass 1
- [`clampPersistedFilePanelForActiveSurface()`](../src/ui/preview-restore-policy.ts) — run after `loadFilePanelPrefs()`; clears open-split flags on Code while preserving `previewSource` / tab lists.
- [`onPreviewGuestLoadSettled()`](../src/ui/preview-panel.ts) — skip `showPreviewHost()` when the split is closed.

### Pass 2 (chat switch still blank)
- Clamp also treats a **Code boot hash** as Code surface (`isCodeSurfacePendingOrForeground`) so prefs cannot resurrect the split before the router runs.
- Re-clamp + collapse on every `osOnAppOpen('code')`.
- `onPreviewGuestLoadSettled` hides blank guests that still have a persisted **source** (collapse clear); intentional empty "New tab" (no source) may still show.
- `clearPreviewGuest` only loads `about:blank` / `preview.clear` — never `tabs.close`.
- `switchChat` → [`suppressStaleBlankPreviewOnChatSwitch()`](../src/ui/preview-panel.ts) collapses a blank+source preview that raced open again.

## Todos

- [x] Clamp persisted split after `loadFilePanelPrefs`
- [x] Guard `onLoading(false)` / guest settle against blank resurrection
- [x] Clamp on Code hash before router foreground
- [x] Stop `clearPreviewGuest` from closing Electron tabs
- [x] Suppress stale blank preview on chat switch
- [x] Tests for clamp + Code boot hash
- [x] Update `documentation/context.md`

## Verification

1. Persist `filePanel.rightPaneMode = preview` with a localhost URL → open Code → open/switch chats from overview or sidebar → **no blank browser panel**.
2. Desktop browser drawer restore on reload still works.
3. Explicit `#btnPreviewToggle` still reopens the last URL.
4. Preview **New tab** (empty) still opens blank chrome when the user asks for it.

Tests: `test/ui/preview-restore-policy.test.mts` (MIN-434 clamp cases).
