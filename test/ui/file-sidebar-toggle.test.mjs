import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

import { ICON_CHEVRON_RIGHT, ICON_FILE_TREE } from '../../src/constants.ts';

const { applyFileSidebarVisuals } = await import('../../src/ui/file-layout.ts');
const {
  DEFAULT_FILE_PANEL_STATE,
  resetFilePanelStateForTests,
  setFilePanelState,
} = await import('../../src/state/file-panel.ts');

const CHEVRON_RIGHT_PATH = 'M9 18l6-6-6-6';
const FILE_TREE_PATH = 'M14 2H6a2';

function stubMatchMedia(matches) {
  const orig = globalThis.matchMedia;
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: (query) => ({
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  return orig;
}

function setupFileSidebarDom() {
  const window = new Window();
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
  let origMatchMedia;

  beforeEach(() => {
    resetFilePanelStateForTests();
    setupFileSidebarDom();
  });

  afterEach(() => {
    if (origMatchMedia !== undefined) {
      Object.defineProperty(globalThis, 'matchMedia', {
        configurable: true,
        value: origMatchMedia,
      });
    }
  });

  test('desktop expanded shows right chevron', () => {
    origMatchMedia = stubMatchMedia(false);
    setFilePanelState({ ...DEFAULT_FILE_PANEL_STATE, fileSidebarCollapsed: false });

    applyFileSidebarVisuals();

    const btn = document.getElementById('btnFileSidebarCollapse');
    assert.ok(btn.innerHTML.includes(CHEVRON_RIGHT_PATH));
    assert.equal(btn.innerHTML, ICON_CHEVRON_RIGHT);
    assert.equal(btn.getAttribute('aria-label'), 'Collapse file tree');
  });

  test('desktop collapsed shows file tree icon', () => {
    origMatchMedia = stubMatchMedia(false);
    setFilePanelState({ ...DEFAULT_FILE_PANEL_STATE, fileSidebarCollapsed: true });

    applyFileSidebarVisuals();

    const btn = document.getElementById('btnFileSidebarCollapse');
    assert.ok(btn.innerHTML.includes(FILE_TREE_PATH));
    assert.equal(btn.innerHTML, ICON_FILE_TREE);
    assert.equal(btn.getAttribute('aria-label'), 'Expand file tree');
  });

  test('mobile overlay open shows right chevron', () => {
    origMatchMedia = stubMatchMedia(true);
    const side = document.getElementById('fileSidebar');
    side.classList.add('mobile-open');

    applyFileSidebarVisuals();

    const btn = document.getElementById('btnFileSidebarCollapse');
    assert.ok(btn.innerHTML.includes(CHEVRON_RIGHT_PATH));
    assert.equal(btn.innerHTML, ICON_CHEVRON_RIGHT);
    assert.equal(btn.getAttribute('aria-label'), 'Close file tree');
  });

  test('mobile overlay closed shows file tree icon', () => {
    origMatchMedia = stubMatchMedia(true);

    applyFileSidebarVisuals();

    const btn = document.getElementById('btnFileSidebarCollapse');
    assert.ok(btn.innerHTML.includes(FILE_TREE_PATH));
    assert.equal(btn.innerHTML, ICON_FILE_TREE);
    assert.equal(btn.getAttribute('aria-label'), 'Open file tree');
  });
});
