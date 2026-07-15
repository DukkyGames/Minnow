# MIN-342: Code app browser panel open state

## Problem

Opening the **Code** app sometimes showed the browser preview panel already expanded with a stale or broken URL (orphan `localhost` routes, blank Electron guest, incorrect layout).

## Behavior (shipped)

| Event | Browser panel | File viewer | `previewSource` / `openViewerTabs` |
|-------|---------------|-------------|-------------------------------------|
| **Code app entry** (dock, launcher, `#/app/code`) | **Closed** | **Closed** | Preserved |
| **App boot** with persisted open split | Closed unless matching desktop drawer tab is open | Same | Preserved |
| **Desktop browser drawer** open on reload | Restored | Closed | Loaded |
| **Desktop file-preview drawer** open on reload | Closed | Restored | Loaded |
| **`#btnPreviewToggle` / explicit open** | Opens with last `previewSource` | Closed | Unchanged |
| **Open file from tree** | Closed | Opens | Unchanged |
| **`#btnPreviewClose` / close** | Closed | — | `previewSource` cleared |

## Root cause

Desktop workspace mounts call `classList.remove('hidden')` when reparenting `#previewPane` / `#fileViewerPane` into the drawer. Early fixes re-applied a **captured** `.hidden` flag, but re-capturing after a drawer mount stored `hidden=false`, so Code entry restored the browser open. Overlapping async `syncDesktopWorkspaceMounts` runs could also remount the preview to the desktop host while Code was foreground (Electron guest overlay). `reconcileRightSplitDomWithState()` also did nothing when `rightPaneMode` was `null`.

## Implementation

- [`src/ui/preview-restore-policy.ts`](../../src/ui/preview-restore-policy.ts) — `shouldAutoRestorePreviewPanel()` + `shouldAutoRestoreViewerSplitOnBoot()` gate boot restore.
- [`src/ui/file-layout.ts`](../../src/ui/file-layout.ts) — `hideAllRightSplitPanesDom()`, `resetRightSplitForCodeEntry()`, reconcile hides both panes when split is closed.
- [`src/ui/preview-panel.ts`](../../src/ui/preview-panel.ts) — `collapsePreviewPanelKeepingSource()` resets both panes + clears Electron guest.
- [`src/os/desktop-workspace-mounts.ts`](../../src/os/desktop-workspace-mounts.ts) — `restoreToCode()` sets preview/viewer `.hidden` from `filePanel.rightPaneMode`; sync generation token drops stale desktop remounts; Code foreground collapses on surface switch.
- [`src/os/page-bridge.ts`](../../src/os/page-bridge.ts) — `osOnAppOpen('code')` collapses right split.

Legacy non-OS mode (`isOsShellEnabled() === false`) still auto-restores an open preview on full page reload.

## Verification

1. Open Code → toggle browser → load `http://localhost:3000` → open a file in viewer on desktop drawer → reopen Code → **both panels closed**; toggle browser / open file restores prior state.
2. Reload with `#/app/code` while `filePanel.rightPaneMode` was `preview` or `viewer` → **both panels closed**.
3. Desktop: open Browser drawer → reload `#/desktop` → browser **restores**. Open File preview drawer → reload → viewer **restores**.

Tests: `test/ui/preview-restore-policy.test.mts`, `test/ui/file-layout-right-split.test.mts`, `test/os/desktop-workspace-mounts.test.mts` (Code entry hide + stale sync)
