import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  patchFilePanelState,
  resetFilePanelStateForTests,
} from '../../src/state/file-panel.ts';
import {
  applyFileSidebarVisuals,
  reconcileRightSplitDomWithState,
} from '../../src/ui/file-layout.ts';

function setupSplitDom(): void {
  document.body.innerHTML = `
    <div id="workspaceSplit" class="workspace-split">
      <div class="main-column"></div>
      <div id="splitResizer" class="split-resizer"></div>
      <div id="rightPaneColumn" class="right-pane-column">
        <section id="fileViewerPane" class="file-viewer-pane"></section>
        <section id="previewPane" class="preview-pane"></section>
      </div>
    </div>
    <aside id="fileSidebar">
      <button id="btnFileSidebarCollapse" type="button"></button>
      <button id="btnPreviewToggle" type="button"></button>
    </aside>
  `;
}

describe('file-layout right split reconcile (MIN-342)', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
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
    setupSplitDom();
  });

  afterEach(() => {
    resetFilePanelStateForTests();
  });

  test('hides both panes when rightPaneMode is null (desktop reparent bleed)', () => {
    document.getElementById('rightPaneColumn')?.classList.remove('hidden');
    document.getElementById('fileViewerPane')?.classList.remove('hidden');
    document.getElementById('previewPane')?.classList.remove('hidden');
    document.getElementById('splitResizer')?.classList.remove('hidden');
    patchFilePanelState({ rightPaneMode: null, viewerOpen: false });

    reconcileRightSplitDomWithState();

    assert.equal(document.getElementById('rightPaneColumn')?.classList.contains('hidden'), true);
    assert.equal(document.getElementById('fileViewerPane')?.classList.contains('hidden'), true);
    assert.equal(document.getElementById('previewPane')?.classList.contains('hidden'), true);
    assert.equal(document.getElementById('splitResizer')?.classList.contains('hidden'), true);
    assert.equal(document.getElementById('workspaceSplit')?.classList.contains('viewer-open'), false);
  });

  test('applyFileSidebarVisuals keeps split closed after reset', () => {
    document.getElementById('previewPane')?.classList.remove('hidden');
    patchFilePanelState({ rightPaneMode: null, viewerOpen: false });

    applyFileSidebarVisuals();

    assert.equal(document.getElementById('previewPane')?.classList.contains('hidden'), true);
    assert.equal(document.getElementById('workspaceSplit')?.classList.contains('viewer-open'), false);
  });

  test('repairRightPaneDomStructure moves panes from workspaceSplit into rightPaneColumn', async () => {
    const { repairRightPaneDomStructure } = await import('../../src/ui/file-layout.ts');
    const split = document.getElementById('workspaceSplit')!;
    const column = document.getElementById('rightPaneColumn')!;
    const viewer = document.getElementById('fileViewerPane')!;
    const preview = document.getElementById('previewPane')!;
    split.appendChild(viewer);
    split.appendChild(preview);

    assert.equal(repairRightPaneDomStructure(), true);
    assert.equal(viewer.parentElement, column);
    assert.equal(preview.parentElement, column);
  });
});
