import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { applyFileSidebarVisuals } = await import('../../src/ui/file-layout.ts');
const {
  DEFAULT_FILE_PANEL_STATE,
  resetFilePanelStateForTests,
  setFilePanelState,
} = await import('../../src/state/file-panel.ts');
const {
  isGitSidePanelOpen,
  openGitSidePanel,
  resetGitPanelForTests,
} = await import('../../src/ui/git-panel.ts');

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

function setupDom() {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;

  document.body.innerHTML = `
    <aside id="fileSidebar" class="file-sidebar collapsed" aria-label="Project files">
      <div class="file-sidebar-header">
        <span id="fileSidebarTitle">Files</span>
        <button type="button" id="btnFileSidebarCollapse"></button>
        <button type="button" id="btnGitPanelToggle"></button>
      </div>
      <div id="fileSidebarFilesView" class="file-sidebar-files-view"></div>
      <div id="gitPanelRoot" class="git-panel-root" hidden></div>
    </aside>
    <div id="workspaceSplit" class="workspace-split"></div>
  `;
}

describe('git sidebar from collapsed rail', { concurrency: false }, () => {
  let matchMediaRestore;
  let origWindow;

  beforeEach(() => {
    origWindow = globalThis.window;
    resetFilePanelStateForTests();
    setupDom();
    resetGitPanelForTests();
    matchMediaRestore = stubMatchMedia(globalThis.window, false);
    setFilePanelState({ ...DEFAULT_FILE_PANEL_STATE, fileSidebarCollapsed: true });
    applyFileSidebarVisuals();
  });

  afterEach(() => {
    resetGitPanelForTests();
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

  test('opening source control from collapsed rail survives layout refresh', async () => {
    await openGitSidePanel();

    assert.equal(isGitSidePanelOpen(), true);
    assert.equal(document.getElementById('fileSidebar')?.classList.contains('collapsed'), false);
    assert.equal(document.getElementById('fileSidebar')?.classList.contains('file-sidebar--git'), true);

    applyFileSidebarVisuals();

    assert.equal(isGitSidePanelOpen(), true);
    assert.equal(document.getElementById('fileSidebar')?.classList.contains('file-sidebar--git'), true);
    assert.equal(document.getElementById('fileSidebarFilesView')?.hasAttribute('hidden'), true);
    assert.equal(document.getElementById('gitPanelRoot')?.hasAttribute('hidden'), false);
  });
});
