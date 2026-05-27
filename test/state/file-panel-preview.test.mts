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
});
