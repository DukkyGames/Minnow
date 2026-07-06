# MIN-342: Code app browser panel open state

## Problem

Opening the **Code** app sometimes showed the browser preview panel already expanded with a stale or broken URL (orphan `localhost` routes, blank Electron guest, incorrect layout).

## Behavior (shipped)

| Event | Browser panel | `previewSource` |
|-------|---------------|-----------------|
| **Code app entry** (dock, launcher, `#/app/code`) | **Closed** | Preserved |
| **App boot** with persisted `rightPaneMode: 'preview'` | Closed unless desktop browser drawer is open | Preserved |
| **Desktop browser drawer** open on reload | Restored (same as before MIN-288) | Loaded |
| **`#btnPreviewToggle` / explicit open** | Opens with last `previewSource` | Unchanged |
| **`#btnPreviewClose` / close** | Closed | Cleared |

## Implementation

- [`src/ui/preview-restore-policy.ts`](../../src/ui/preview-restore-policy.ts) — `shouldAutoRestorePreviewPanel()` gates boot restore.
- [`src/ui/preview-panel.ts`](../../src/ui/preview-panel.ts) — `collapsePreviewPanelKeepingSource()` hides DOM + clears Electron guest without wiping `previewSource`.
- [`src/ui/file-layout.ts`](../../src/ui/file-layout.ts) — `hidePreviewSplitKeepSource()` persists closed split without nulling `previewSource`.
- [`src/os/page-bridge.ts`](../../src/os/page-bridge.ts) — `osOnAppOpen('code')` collapses preview instead of `resyncOpenPreviewPanelFromState()`.

Legacy non-OS mode (`isOsShellEnabled() === false`) still auto-restores an open preview on full page reload.

## Verification

1. Open Code → toggle browser → load `http://localhost:3000` → switch to desktop → reopen Code → panel is **closed**; toggle browser → URL is restored.
2. Reload with `#/app/code` while `filePanel.rightPaneMode` was `preview` → panel starts **closed**.
3. Desktop: open Browser drawer → reload `#/desktop` → drawer + preview **restore**.

Tests: `test/ui/preview-restore-policy.test.mts`
