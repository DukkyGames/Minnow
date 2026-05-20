import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';
import { Window } from 'happy-dom';

const { applyFileSidebarVisuals } = await import('../../src/ui/file-layout.ts');
const {
  collapseStatsPanelForSplit,
  syncStatsStripLayoutForViewer,
} = await import('../../src/ui/stats.ts');
const {
  DEFAULT_FILE_PANEL_STATE,
  setFilePanelState,
  resetFilePanelStateForTests,
} = await import('../../src/state/file-panel.ts');

function setupSplitDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  document.body.innerHTML = `
    <div id="workspaceSplit" class="workspace-split">
      <div class="main-column" id="mainColumn">
        <div class="stats-strip" id="statsStrip">
          <button type="button" id="statsExpandBtn" aria-expanded="true"></button>
          <div class="stats-panel" id="statsPanel"></div>
        </div>
      </div>
    </div>
  `;
  return window;
}

describe('stats split layout', { concurrency: false }, () => {
  beforeEach(() => {
    resetFilePanelStateForTests();
  });

  test('collapseStatsPanelForSplit clears is-expanded and aria-expanded', () => {
    setupSplitDom();
    const strip = document.getElementById('statsStrip');
    const btn = document.getElementById('statsExpandBtn');
    strip.classList.add('is-expanded');
    btn.setAttribute('aria-expanded', 'true');

    collapseStatsPanelForSplit();

    assert.equal(strip.classList.contains('is-expanded'), false);
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
  });

  test('syncStatsStripLayoutForViewer collapses when viewer is open', () => {
    setupSplitDom();
    document.getElementById('statsStrip').classList.add('is-expanded');
    syncStatsStripLayoutForViewer(true);
    assert.equal(document.getElementById('statsStrip').classList.contains('is-expanded'), false);
  });

  test('applyFileSidebarVisuals toggles viewer-open and collapses stats', () => {
    setupSplitDom();
    setFilePanelState({ ...DEFAULT_FILE_PANEL_STATE, viewerOpen: true });
    document.getElementById('statsStrip').classList.add('is-expanded');

    applyFileSidebarVisuals();

    const split = document.getElementById('workspaceSplit');
    assert.equal(split.classList.contains('viewer-open'), true);
    assert.equal(document.getElementById('statsStrip').classList.contains('is-expanded'), false);
    assert.equal(document.getElementById('statsExpandBtn').getAttribute('aria-expanded'), 'false');
  });

  test('applyFileSidebarVisuals removes viewer-open when split closes', () => {
    setupSplitDom();
    setFilePanelState({ ...DEFAULT_FILE_PANEL_STATE, viewerOpen: true });
    applyFileSidebarVisuals();
    setFilePanelState({ ...DEFAULT_FILE_PANEL_STATE, viewerOpen: false });
    applyFileSidebarVisuals();

    assert.equal(document.getElementById('workspaceSplit').classList.contains('viewer-open'), false);
  });
});
