import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  DEFAULT_FILE_PANEL_STATE,
  getFilePanelState,
  patchFilePanelState,
  resetFilePanelStateForTests,
  setFilePanelState,
} from '../../src/state/file-panel.ts';

describe('file panel preview state', () => {
  beforeEach(() => {
    resetFilePanelStateForTests();
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({}) }) as Response) as typeof fetch;
  });

  test('patch rightPaneMode preview keeps viewerOpen true', () => {
    patchFilePanelState({ rightPaneMode: 'preview' });
    const state = patchFilePanelState({
      previewSource: { kind: 'workspace', path: 'index.html' },
    });
    assert.equal(state.rightPaneMode, 'preview');
    assert.equal(state.viewerOpen, true);
    assert.equal(state.previewSource?.kind, 'workspace');
  });

  test('patch rightPaneMode null closes split', () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'preview',
      viewerOpen: true,
    });
    const state = patchFilePanelState({ rightPaneMode: null });
    assert.equal(state.rightPaneMode, null);
    assert.equal(state.viewerOpen, false);
  });

  test('legacy viewerOpen migrates to viewer mode', () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      viewerOpen: true,
      rightPaneMode: null,
    });
    const state = getFilePanelState();
    assert.equal(state.rightPaneMode, 'viewer');
    assert.equal(state.viewerOpen, true);
  });

  test('openViewerTabs and activeViewerTab round-trip via setFilePanelState', () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      rightPaneMode: 'viewer',
      viewerOpen: true,
      openViewerTabs: ['src/a.ts', 'src/b.ts'],
      activeViewerTab: 'src/a.ts',
      selectedPath: 'src/a.ts',
    });
    const state = getFilePanelState();
    assert.deepEqual(state.openViewerTabs, ['src/a.ts', 'src/b.ts']);
    assert.equal(state.activeViewerTab, 'src/a.ts');
    assert.equal(state.selectedPath, 'src/a.ts');
  });

  test('patch replaces openViewerTabs array', () => {
    const before = getFilePanelState().openViewerTabs;
    patchFilePanelState({
      openViewerTabs: ['one.ts', 'two.ts'],
      activeViewerTab: 'one.ts',
    });
    const state = getFilePanelState();
    assert.deepEqual(state.openViewerTabs, ['one.ts', 'two.ts']);
    assert.notEqual(state.openViewerTabs, before);
  });
});
