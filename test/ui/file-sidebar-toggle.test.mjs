import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { applyFileSidebarVisuals } = await import('../../src/ui/file-layout.ts');
const {
  DEFAULT_FILE_PANEL_STATE,
  resetFilePanelStateForTests,
  setFilePanelState,
} = await import('../../src/state/file-panel.ts');

const CHEVRON_RIGHT_CLASS = 'fi-rr-angle-small-right';
const FILE_TREE_CLASS = 'fi-rr-document';

function stubMatchMedia(win, matches) {
  const stub = (query) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  const origGlobal = globalThis.matchMedia;
  const origWindow = win.matchMedia;
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: stub });
  win.matchMedia = stub;
  return { origGlobal, origWindow, win };
}

function setupFileSidebarDom() {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;

  document.body.innerHTML = `
    <aside id="fileSidebar" class="file-sidebar">
      <button type="button" id="btnFileSidebarCollapse" class="file-sidebar-toggle"></button>
    </aside>
    <div id="workspaceSplit" class="workspace-split"></div>
  `;
}

describe('file sidebar toggle icons', { concurrency: false }, () => {
  let matchMediaRestore;
  let origWindow;

  beforeEach(() => {
    origWindow = globalThis.window;
    resetFilePanelStateForTests();
    setupFileSidebarDom();
  });

  afterEach(() => {
    globalThis.window = origWindow;
    if (matchMediaRestore) {
      Object.defineProperty(globalThis, 'matchMedia', {
        configurable: true,
        value: matchMediaRestore.origGlobal,
      });
      matchMediaRestore.win.matchMedia = matchMediaRestore.origWindow;
      matchMediaRestore = undefined;
    }
  });

  test('desktop expanded shows right chevron', () => {
    matchMediaRestore = stubMatchMedia(globalThis.window, false);
    setFilePanelState({ ...DEFAULT_FILE_PANEL_STATE, fileSidebarCollapsed: false });

    applyFileSidebarVisuals();

    const btn = document.getElementById('btnFileSidebarCollapse');
    assert.ok(btn.innerHTML.includes(CHEVRON_RIGHT_CLASS));
    assert.equal(btn.getAttribute('aria-label'), 'Collapse file tree');
  });

  test('desktop collapsed shows file tree icon', () => {
    matchMediaRestore = stubMatchMedia(globalThis.window, false);
    setFilePanelState({ ...DEFAULT_FILE_PANEL_STATE, fileSidebarCollapsed: true });

    applyFileSidebarVisuals();

    const btn = document.getElementById('btnFileSidebarCollapse');
    assert.ok(btn.innerHTML.includes(FILE_TREE_CLASS));
    assert.equal(btn.getAttribute('aria-label'), 'Expand file tree');
  });

  test('mobile overlay open shows right chevron', () => {
    matchMediaRestore = stubMatchMedia(globalThis.window, true);
    const side = document.getElementById('fileSidebar');
    side.classList.add('mobile-open');

    applyFileSidebarVisuals();

    const btn = document.getElementById('btnFileSidebarCollapse');
    assert.ok(btn.innerHTML.includes(CHEVRON_RIGHT_CLASS));
    assert.equal(btn.getAttribute('aria-label'), 'Close file tree');
  });

  test('mobile overlay closed shows file tree icon', () => {
    matchMediaRestore = stubMatchMedia(globalThis.window, true);

    applyFileSidebarVisuals();

    const btn = document.getElementById('btnFileSidebarCollapse');
    assert.ok(btn.innerHTML.includes(FILE_TREE_CLASS));
    assert.equal(btn.getAttribute('aria-label'), 'Open file tree');
  });
});
