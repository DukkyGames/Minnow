import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  openDesktopWorkspaceTab,
  resetDesktopWorkspacePanelForTests,
} from '../../src/os/desktop-workspace-state.ts';
import { launchInstance, resetInstancesForTests } from '../../src/os/instances.ts';
import {
  DEFAULT_FILE_PANEL_STATE,
  patchFilePanelState,
  resetFilePanelStateForTests,
  setFilePanelState,
} from '../../src/state/file-panel.ts';
import {
  isCodeAppForeground,
  shouldAutoRestorePreviewPanel,
  shouldAutoRestoreViewerSplitOnBoot,
} from '../../src/ui/preview-restore-policy.ts';

describe('preview restore policy (MIN-342)', () => {
  beforeEach(() => {
    resetFilePanelStateForTests();
    resetInstancesForTests();
    resetDesktopWorkspacePanelForTests();
  });

  afterEach(() => {
    resetFilePanelStateForTests();
    resetInstancesForTests();
    resetDesktopWorkspacePanelForTests();
  });

  test('does not auto-restore preview when Code is foreground', () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
      previewSource: { kind: 'url', url: 'http://localhost:3000' },
    });
    launchInstance('code');
    assert.equal(isCodeAppForeground(), true);
    assert.equal(shouldAutoRestorePreviewPanel(), false);
  });

  test('auto-restores preview when desktop browser drawer is open', () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
      previewSource: { kind: 'url', url: 'https://example.com' },
    });
    openDesktopWorkspaceTab('browser');
    assert.equal(shouldAutoRestorePreviewPanel(), true);
  });

  test('does not auto-restore when preview mode is closed', () => {
    patchFilePanelState({ rightPaneMode: null });
    assert.equal(shouldAutoRestorePreviewPanel(), false);
  });

  test('does not auto-restore stale preview on desktop without browser drawer', () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
      previewSource: { kind: 'url', url: 'http://localhost:5173' },
    });
    assert.equal(shouldAutoRestorePreviewPanel(), false);
  });

  test('does not auto-restore viewer tabs when Code is foreground', () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'viewer',
      viewerOpen: true,
      openViewerTabs: ['src/index.ts'],
      activeViewerTab: 'src/index.ts',
    });
    launchInstance('code');
    assert.equal(shouldAutoRestoreViewerSplitOnBoot(), false);
  });

  test('auto-restores viewer when desktop file-preview drawer is open', () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'viewer',
      viewerOpen: true,
      openViewerTabs: ['src/a.ts'],
      activeViewerTab: 'src/a.ts',
    });
    openDesktopWorkspaceTab('viewer');
    assert.equal(shouldAutoRestoreViewerSplitOnBoot(), true);
  });
});
