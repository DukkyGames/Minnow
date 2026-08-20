import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  getFilePanelState,
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

  test('repairRightPaneDomStructure moves primary panes from column into rightPaneSlotPrimary', async () => {
    const { repairRightPaneDomStructure } = await import('../../src/ui/file-layout.ts');
    const column = document.getElementById('rightPaneColumn')!;
    const primarySlot = document.createElement('div');
    primarySlot.id = 'rightPaneSlotPrimary';
    column.prepend(primarySlot);
    const viewer = document.getElementById('fileViewerPane')!;
    const preview = document.getElementById('previewPane')!;
    column.appendChild(viewer);
    column.appendChild(preview);

    assert.equal(repairRightPaneDomStructure(), true);
    assert.equal(viewer.parentElement, primarySlot);
    assert.equal(preview.parentElement, primarySlot);
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

  test('hideViewerSplit skipPreviewFallback keeps browser open when preview is active', async () => {
    const { hideViewerSplit } = await import('../../src/ui/file-layout.ts');
    patchFilePanelState({
      rightPaneMode: 'preview',
      viewerOpen: true,
      previewTabs: [{ id: 'tab-1', source: { kind: 'url', url: 'http://localhost:3000' } }],
      activePreviewTab: 'tab-1',
    });
    document.getElementById('rightPaneColumn')?.classList.remove('hidden');
    document.getElementById('previewPane')?.classList.remove('hidden');
    document.getElementById('fileViewerPane')?.classList.remove('hidden');

    hideViewerSplit({ skipPreviewFallback: true });

    assert.equal(getFilePanelState().rightPaneMode, 'preview');
    assert.equal(document.getElementById('previewPane')?.classList.contains('hidden'), false);
    assert.equal(document.getElementById('rightPaneColumn')?.classList.contains('hidden'), false);
    assert.equal(document.getElementById('fileViewerPane')?.classList.contains('hidden'), true);
  });

  test('hideViewerSplit skipPreviewFallback keeps split closed when preview tabs exist', async () => {
    const { hideViewerSplit } = await import('../../src/ui/file-layout.ts');
    patchFilePanelState({
      rightPaneMode: 'viewer',
      viewerOpen: true,
      previewTabs: [{ id: 'tab-1', source: { kind: 'url', url: 'http://localhost:3000' } }],
      activePreviewTab: 'tab-1',
    });
    document.getElementById('rightPaneColumn')?.classList.remove('hidden');
    document.getElementById('fileViewerPane')?.classList.remove('hidden');

    hideViewerSplit({ skipPreviewFallback: true });

    assert.equal(getFilePanelState().rightPaneMode, null);
    assert.equal(document.getElementById('previewPane')?.classList.contains('hidden'), true);
    assert.equal(document.getElementById('rightPaneColumn')?.classList.contains('hidden'), true);
  });

  test('showViewerSplit reveals the file pane even when a preview tab remains open', async () => {
    const { showViewerSplit } = await import('../../src/ui/file-layout.ts');
    const column = document.getElementById('rightPaneColumn')!;
    const primarySlot = document.createElement('div');
    primarySlot.id = 'rightPaneSlotPrimary';
    const viewer = document.getElementById('fileViewerPane')!;
    const preview = document.getElementById('previewPane')!;
    primarySlot.appendChild(viewer);
    primarySlot.appendChild(preview);
    column.prepend(primarySlot);

    patchFilePanelState({
      rightPaneMode: 'preview',
      viewerOpen: true,
      openViewerTabs: ['src/a.ts'],
      activeViewerTab: 'src/a.ts',
      previewTabs: [{ id: 'tab-1', source: { kind: 'url', url: 'http://localhost:3000' } }],
      activePreviewTab: 'tab-1',
    });
    column.classList.remove('hidden');
    preview.classList.remove('hidden');
    viewer.classList.add('hidden');

    showViewerSplit();

    assert.equal(getFilePanelState().rightPaneMode, 'viewer');
    assert.equal(viewer.classList.contains('hidden'), false);
    assert.equal(preview.classList.contains('hidden'), true);
  });

  test('hideViewerSplit still falls back to preview when user closes last viewer tab', async () => {
    const { hideViewerSplit } = await import('../../src/ui/file-layout.ts');
    patchFilePanelState({
      rightPaneMode: 'viewer',
      viewerOpen: true,
      previewTabs: [{ id: 'tab-1', source: { kind: 'url', url: 'http://localhost:3000' } }],
      activePreviewTab: 'tab-1',
    });

    hideViewerSplit();

    assert.equal(getFilePanelState().rightPaneMode, 'preview');
    assert.equal(document.getElementById('previewPane')?.classList.contains('hidden'), false);
  });
});
