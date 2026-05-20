import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';
import { Window } from 'happy-dom';

const { applyFileSidebarVisuals } = await import('../../src/ui/file-layout.ts');
const {
  collapseStatsPanelForSplit,
  initStatsStrip,
  isStatsStripOpen,
  setStatsStripOpen,
  syncStatsStripLayoutForViewer,
  toggleStatsStrip,
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
    <button type="button" id="btnStats" aria-expanded="false"></button>
    <div id="workspaceSplit" class="workspace-split">
      <div class="main-column" id="mainColumn">
        <div class="stats-strip is-collapsed" id="statsStrip">
          <button type="button" id="statsExpandBtn" aria-expanded="false"></button>
          <span id="statsExpandPreview"></span>
          <div class="stats-panel" id="statsPanel"></div>
          <span id="stripTPS">—</span>
          <span id="stripTotal">—</span>
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

  test('setStatsStripOpen toggles is-collapsed and btnStats aria-expanded', () => {
    setupSplitDom();
    setStatsStripOpen(true);
    assert.equal(document.getElementById('statsStrip').classList.contains('is-collapsed'), false);
    assert.equal(document.getElementById('btnStats').getAttribute('aria-expanded'), 'true');
    setStatsStripOpen(false);
    assert.equal(document.getElementById('statsStrip').classList.contains('is-collapsed'), true);
    assert.equal(document.getElementById('btnStats').getAttribute('aria-expanded'), 'false');
  });

  test('toggleStatsStrip flips open state', () => {
    setupSplitDom();
    assert.equal(isStatsStripOpen(), false);
    toggleStatsStrip();
    assert.equal(isStatsStripOpen(), true);
    toggleStatsStrip();
    assert.equal(isStatsStripOpen(), false);
  });

  test('initStatsStrip restores open preference from localStorage', () => {
    setupSplitDom();
    const store = new Map([['minnow.statsStripOpen', '1']]);
    globalThis.localStorage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => {
        store.set(key, String(value));
      },
      removeItem: (key) => {
        store.delete(key);
      },
    };
    initStatsStrip();
    assert.equal(isStatsStripOpen(), true);
    delete globalThis.localStorage;
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
