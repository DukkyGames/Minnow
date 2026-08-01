import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  getFilePanelState,
  patchFilePanelState,
  resetFilePanelStateForTests,
} from '../../src/state/file-panel.ts';
import {
  applyRightPaneSplitDom,
  enableRightPaneSplit,
  isRightPaneSplitActive,
} from '../../src/ui/right-pane-split.ts';
import { launchInstance, resetInstancesForTests } from '../../src/os/instances.ts';

async function setupDom(): Promise<void> {
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

  document.body.innerHTML = `
    <div id="rightPaneColumn" class="right-pane-column"></div>
    <div id="rightPaneSplit" class="right-pane-split">
      <div id="rightPaneSlotPrimary" class="right-pane-slot" data-pane-slot="primary">
        <section id="fileViewerPane" class="file-viewer-pane hidden"></section>
        <section id="previewPane" class="preview-pane hidden"></section>
      </div>
      <div id="rightPaneSplitResizer" class="right-pane-split-resizer hidden"></div>
      <div id="rightPaneSlotSecondary" class="right-pane-slot hidden" data-pane-slot="secondary">
        <section id="fileViewerPaneSecondary" class="file-viewer-pane hidden"></section>
        <section id="previewPaneSecondary" class="preview-pane hidden"></section>
      </div>
    </div>
    <div id="fileViewerHostSecondary"></div>
    <div id="previewBody" style="width: 100px; height: 100px"></div>
    <div id="previewBodySecondary" style="width: 100px; height: 100px"></div>
  `;
  document.documentElement.dataset.osApp = 'code';
  const appBody = document.createElement('div');
  appBody.id = 'appBody';
  document.body.appendChild(appBody);
}

describe('right-pane split', () => {
  beforeEach(async () => {
    resetInstancesForTests();
    resetFilePanelStateForTests();
    launchInstance('code');
    await setupDom();
  });

  afterEach(() => {
    resetInstancesForTests();
    resetFilePanelStateForTests();
  });

  test('enableRightPaneSplit sets split mode and shows resizer', () => {
    patchFilePanelState({
      rightPaneMode: 'viewer',
      viewerOpen: true,
      openViewerTabs: ['src/a.ts'],
      activeViewerTab: 'src/a.ts',
    });
    enableRightPaneSplit();
    assert.equal(isRightPaneSplitActive(), true);
    assert.equal(getFilePanelState().rightPaneMode, 'split');
    applyRightPaneSplitDom();
    assert.equal(
      document.getElementById('rightPaneSplit')?.classList.contains('is-active'),
      true,
    );
    assert.equal(
      document.getElementById('rightPaneSplitResizer')?.classList.contains('hidden'),
      false,
    );
  });

  test('showPreviewSplit updates focused slot without hiding the other slot', async () => {
    patchFilePanelState({
      rightPaneMode: 'split',
      viewerOpen: true,
      previewTabs: [
        { id: 'tab-1', source: { kind: 'url', url: 'http://a' } },
        { id: 'tab-2', source: { kind: 'url', url: 'http://b' } },
      ],
      activePreviewTab: 'tab-1',
      openViewerTabs: ['src/a.ts'],
      activeViewerTab: 'src/a.ts',
      rightPaneSplit: {
        enabled: true,
        ratio: 0.5,
        focusedSlot: 'secondary',
        primary: { kind: 'viewer', tabPath: 'src/a.ts' },
        secondary: { kind: 'preview', tabId: 'tab-1' },
        primaryTabs: {
          viewerPaths: ['src/a.ts'],
          activeViewerPath: 'src/a.ts',
          previewIds: [],
          activePreviewId: null,
          surface: 'viewer',
        },
        secondaryTabs: {
          viewerPaths: [],
          activeViewerPath: null,
          previewIds: ['tab-1'],
          activePreviewId: 'tab-1',
          surface: 'preview',
        },
      },
    });
    const { showPreviewSplit } = await import('../../src/ui/file-layout.ts');
    showPreviewSplit({ tabId: 'tab-2' });
    const state = getFilePanelState();
    assert.equal(state.rightPaneSplit.primary.kind, 'viewer');
    assert.equal(state.rightPaneSplit.secondary.kind, 'preview');
    assert.equal(state.rightPaneSplit.secondary.tabId, 'tab-2');
    applyRightPaneSplitDom();
    assert.equal(document.getElementById('fileViewerPane')?.classList.contains('hidden'), false);
    assert.equal(document.getElementById('previewPane')?.classList.contains('hidden'), true);
    assert.equal(
      document.getElementById('previewPaneSecondary')?.classList.contains('hidden'),
      false,
    );
  });
});
