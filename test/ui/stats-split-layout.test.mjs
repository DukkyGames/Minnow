import assert from 'node:assert/strict';
import { afterEach, describe, test, beforeEach } from 'node:test';
import { Window } from 'happy-dom';
import {
  installHappyDomGlobals,
  seedMinimalSession,
  teardownHappyDomAsync,
} from '../os/dom-helpers.mts';

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
const { setSessionStateForTests } = await import('../../src/state/sessions.ts');

/** @type {import('happy-dom').Window | undefined} */
let win;

function setupSplitDom() {
  win = new Window();
  installHappyDomGlobals(win);
  document.body.innerHTML = `
    <button type="button" id="btnStats" aria-expanded="false"></button>
    <aside id="fileSidebar">
      <button type="button" id="btnFileSidebarCollapse"></button>
    </aside>
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
      <div id="splitResizer" class="split-resizer hidden"></div>
      <section id="fileViewerPane" class="file-viewer-pane hidden"></section>
      <section id="previewPane" class="preview-pane hidden"></section>
    </div>
  `;
}

describe('stats split layout', { concurrency: false }, () => {
  beforeEach(() => {
    resetFilePanelStateForTests();
    seedMinimalSession();
  });

  afterEach(async () => {
    setSessionStateForTests(null);
    if (win) {
      await teardownHappyDomAsync(win);
      win = undefined;
    }
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
    globalThis.localStorage = win.localStorage;
    win.localStorage.setItem('minnow.statsStripOpen', '1');
    initStatsStrip();
    assert.equal(isStatsStripOpen(), true);
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
