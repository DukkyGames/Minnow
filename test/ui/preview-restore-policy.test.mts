import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  openDesktopWorkspaceTab,
  resetDesktopWorkspacePanelForTests,
} from '../../src/os/desktop-workspace-state.ts';
import { launchInstance, resetInstancesForTests } from '../../src/os/instances.ts';
import {
  DEFAULT_FILE_PANEL_STATE,
  getFilePanelState,
  patchFilePanelState,
  resetFilePanelStateForTests,
  setFilePanelState,
} from '../../src/state/file-panel.ts';
import {
  clampPersistedFilePanelForActiveSurface,
  isCodeAppForeground,
  setCodeHashOverrideForTests,
  shouldAutoRestorePreviewPanel,
  shouldAutoRestoreViewerSplitOnBoot,
  shouldAutoRevealPreviewOnNavigation,
} from '../../src/ui/preview-restore-policy.ts';

describe('preview restore policy (MIN-342)', () => {
  beforeEach(() => {
    resetFilePanelStateForTests();
    resetInstancesForTests();
    resetDesktopWorkspacePanelForTests();
    setCodeHashOverrideForTests(null);
  });

  afterEach(() => {
    resetFilePanelStateForTests();
    resetInstancesForTests();
    resetDesktopWorkspacePanelForTests();
    setCodeHashOverrideForTests(null);
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

  test('does not auto-reveal preview on navigation when Code collapsed the split', () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: null,
      viewerOpen: false,
      previewTabs: [{ id: 'tab-1', source: { kind: 'url', url: 'http://localhost:3000' } }],
      activePreviewTab: 'tab-1',
      previewSource: { kind: 'url', url: 'http://localhost:3000' },
    });
    launchInstance('code');
    assert.equal(shouldAutoRevealPreviewOnNavigation(), false);
  });

  test('allows auto-reveal on navigation when preview mode is active', () => {
    patchFilePanelState({ rightPaneMode: 'preview', viewerOpen: true });
    assert.equal(shouldAutoRevealPreviewOnNavigation(), true);
  });

  test('clampPersistedFilePanelForActiveSurface clears stale preview on Code foreground (MIN-434)', () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
      previewSource: { kind: 'url', url: 'http://localhost:3000' },
      previewTabs: [{ id: 'tab-1', source: { kind: 'url', url: 'http://localhost:3000' } }],
      activePreviewTab: 'tab-1',
    });
    launchInstance('code');
    assert.equal(isCodeAppForeground(), true);

    clampPersistedFilePanelForActiveSurface();

    const state = getFilePanelState();
    assert.equal(state.rightPaneMode, null);
    assert.equal(state.viewerOpen, false);
    assert.equal(state.previewSource?.kind, 'url');
    assert.equal(state.previewTabs.length, 1);
  });

  test('clampPersistedFilePanelForActiveSurface clears preview on Code boot hash before foreground', () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
      previewSource: { kind: 'url', url: 'http://localhost:3000' },
    });
    // Simulate Code boot hash before the OS router foregrounds the app.
    setCodeHashOverrideForTests('#/app/code/chat');
    assert.equal(isCodeAppForeground(), false);
    clampPersistedFilePanelForActiveSurface();
    assert.equal(getFilePanelState().rightPaneMode, null);
    assert.equal(getFilePanelState().viewerOpen, false);
    assert.equal(getFilePanelState().previewSource?.kind, 'url');
  });

  test('clampPersistedFilePanelForActiveSurface keeps desktop browser drawer restore', () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
      previewSource: { kind: 'url', url: 'https://example.com' },
    });
    setCodeHashOverrideForTests('#/desktop');
    openDesktopWorkspaceTab('browser');
    clampPersistedFilePanelForActiveSurface();
    assert.equal(getFilePanelState().rightPaneMode, 'preview');
  });
});
