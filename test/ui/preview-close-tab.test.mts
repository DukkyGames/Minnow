import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  getFilePanelState,
  patchFilePanelState,
  resetFilePanelStateForTests,
} from '../../src/state/file-panel.ts';
import {
  listPreviewTabs,
  openPreviewTab,
  resetPreviewTabStoreForTests,
} from '../../src/ui/preview-tab-store.ts';

function setupPreviewDom(): void {
  document.body.innerHTML = `
    <div id="workspaceSplit" class="workspace-split">
      <div class="main-column"></div>
      <div id="splitResizer" class="split-resizer"></div>
      <div id="rightPaneColumn" class="right-pane-column">
        <header id="unifiedTabBar"><div id="unifiedTabs"></div></header>
        <section id="fileViewerPane" class="file-viewer-pane hidden"></section>
        <section id="previewPane" class="preview-pane">
          <div id="previewBody"></div>
        </section>
      </div>
    </div>
    <aside id="fileSidebar">
      <button id="btnPreviewToggle" type="button"></button>
    </aside>
  `;
}

describe('closePreviewTabUi', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
      requestAnimationFrame: typeof requestAnimationFrame;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    g.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as typeof requestAnimationFrame;
    win.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof window.matchMedia;

    resetFilePanelStateForTests();
    resetPreviewTabStoreForTests();
    setupPreviewDom();
    patchFilePanelState({ rightPaneMode: 'preview', viewerOpen: true });
  });

  afterEach(() => {
    resetFilePanelStateForTests();
    resetPreviewTabStoreForTests();
  });

  test('closing the last preview tab removes it and collapses the right split', async () => {
    const tab = openPreviewTab({ kind: 'url', url: 'https://example.com' });
    assert.ok(tab);

    const { closePreviewTabUi } = await import('../../src/ui/preview-panel.ts');
    await closePreviewTabUi(tab.id);

    assert.equal(listPreviewTabs().length, 0);
    assert.equal(getFilePanelState().rightPaneMode, null);
    assert.equal(getFilePanelState().viewerOpen, false);
    assert.equal(document.getElementById('rightPaneColumn')?.classList.contains('hidden'), true);
    assert.equal(document.getElementById('previewPane')?.classList.contains('hidden'), true);
  });
});
