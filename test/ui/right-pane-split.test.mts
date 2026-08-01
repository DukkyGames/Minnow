import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  getFilePanelState,
  patchFilePanelState,
  resetFilePanelStateForTests,
} from '../../src/state/file-panel.ts';
import {
  applyRightPaneSplitDom,
  closeRightPaneSplit,
  collapseEmptySlots,
  enableRightPaneSplit,
  focusPaneSlot,
  isRightPaneSplitActive,
  splitRightPane,
} from '../../src/ui/right-pane-split.ts';
import {
  getSlotPaneTabs,
  registerPreviewTabOpened,
  registerViewerTabOpened,
  slotOwningViewerPath,
  unregisterViewerTab,
} from '../../src/ui/right-pane-slot-tabs.ts';
import {
  getActiveViewerTabPath,
  resetViewerTabStoreForTests,
  restoreWorkspaceViewerTabs,
} from '../../src/ui/file-viewer-tab-store.ts';
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

/** Seed the viewer tab store + panel state as if these files were open in one pane. */
function seedOpenFiles(paths: string[], active: string | null): void {
  restoreWorkspaceViewerTabs(paths, active);
  patchFilePanelState({
    rightPaneMode: 'viewer',
    viewerOpen: true,
    openViewerTabs: paths,
    activeViewerTab: active,
  });
}

describe('right-pane split', () => {
  beforeEach(async () => {
    resetInstancesForTests();
    resetFilePanelStateForTests();
    resetViewerTabStoreForTests();
    launchInstance('code');
    await setupDom();
  });

  afterEach(() => {
    resetInstancesForTests();
    resetFilePanelStateForTests();
    resetViewerTabStoreForTests();
  });

  test('enableRightPaneSplit sets split mode and shows resizer', () => {
    seedOpenFiles(['src/a.ts'], 'src/a.ts');
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

  test('splitting a lone tab keeps it in the primary and opens an empty second group', () => {
    seedOpenFiles(['src/a.ts'], 'src/a.ts');
    splitRightPane();

    const split = getFilePanelState().rightPaneSplit;
    assert.deepEqual(split.primaryTabs.viewerPaths, ['src/a.ts']);
    assert.deepEqual(split.secondaryTabs.viewerPaths, []);
    assert.equal(split.primary.kind, 'viewer');
    assert.equal(split.secondary.kind, 'none');
    assert.equal(split.focusedSlot, 'secondary');
  });

  test('splitting with several tabs moves only the active one to the second group', () => {
    seedOpenFiles(['src/a.ts', 'src/b.ts'], 'src/b.ts');
    splitRightPane();

    const split = getFilePanelState().rightPaneSplit;
    assert.deepEqual(split.primaryTabs.viewerPaths, ['src/a.ts']);
    assert.deepEqual(split.secondaryTabs.viewerPaths, ['src/b.ts']);
    assert.equal(split.primaryTabs.activeViewerPath, 'src/a.ts');
    assert.equal(split.secondaryTabs.activeViewerPath, 'src/b.ts');
  });

  test('a file opened while the second group is focused lands there only', () => {
    seedOpenFiles(['src/a.ts'], 'src/a.ts');
    enableRightPaneSplit();
    assert.equal(getFilePanelState().rightPaneSplit.focusedSlot, 'secondary');

    registerViewerTabOpened('src/new.ts');

    const split = getFilePanelState().rightPaneSplit;
    assert.deepEqual(split.secondaryTabs.viewerPaths, ['src/new.ts']);
    assert.deepEqual(split.primaryTabs.viewerPaths, ['src/a.ts']);
    // The primary pane keeps rendering its own file, not the newly opened one.
    assert.deepEqual(split.primary, { kind: 'viewer', tabPath: 'src/a.ts' });
    assert.deepEqual(split.secondary, { kind: 'viewer', tabPath: 'src/new.ts' });
  });

  test('re-opening a file owned by the other group reveals it there instead of duplicating', () => {
    seedOpenFiles(['src/a.ts', 'src/b.ts'], 'src/b.ts');
    splitRightPane();
    // src/a.ts is in primary, src/b.ts in secondary, focus on secondary.

    const slot = registerViewerTabOpened('src/a.ts');

    assert.equal(slot, 'primary');
    assert.deepEqual(getSlotPaneTabs('primary').viewerPaths, ['src/a.ts']);
    assert.deepEqual(getSlotPaneTabs('secondary').viewerPaths, ['src/b.ts']);
  });

  test('moving a tab across groups never leaves it in both', () => {
    seedOpenFiles(['src/a.ts', 'src/b.ts'], 'src/b.ts');
    enableRightPaneSplit();

    registerViewerTabOpened('src/a.ts', 'secondary');

    assert.equal(slotOwningViewerPath('src/a.ts'), 'secondary');
    assert.deepEqual(getSlotPaneTabs('primary').viewerPaths, ['src/b.ts']);
    assert.deepEqual(getSlotPaneTabs('secondary').viewerPaths, ['src/a.ts']);
  });

  test('focusing a group points the global active tab at that group', () => {
    seedOpenFiles(['src/a.ts', 'src/b.ts'], 'src/b.ts');
    splitRightPane();
    assert.equal(getActiveViewerTabPath(), 'src/b.ts');

    focusPaneSlot('primary');
    assert.equal(getActiveViewerTabPath(), 'src/a.ts');

    focusPaneSlot('secondary');
    assert.equal(getActiveViewerTabPath(), 'src/b.ts');
  });

  test('a browser tab opened in the second group leaves the primary slot alone', () => {
    seedOpenFiles(['src/a.ts'], 'src/a.ts');
    patchFilePanelState({
      previewTabs: [
        { id: 'tab-1', source: { kind: 'url', url: 'http://a' } },
        { id: 'tab-2', source: { kind: 'url', url: 'http://b' } },
      ],
      activePreviewTab: 'tab-1',
    });
    enableRightPaneSplit();

    registerPreviewTabOpened('tab-2', 'secondary');

    const split = getFilePanelState().rightPaneSplit;
    assert.deepEqual(split.primary, { kind: 'viewer', tabPath: 'src/a.ts' });
    assert.deepEqual(split.secondary, { kind: 'preview', tabId: 'tab-2' });

    applyRightPaneSplitDom();
    assert.equal(document.getElementById('fileViewerPane')?.classList.contains('hidden'), false);
    assert.equal(document.getElementById('previewPane')?.classList.contains('hidden'), true);
    assert.equal(
      document.getElementById('previewPaneSecondary')?.classList.contains('hidden'),
      false,
    );
  });

  test('closing the split folds the second group tabs back into the primary', () => {
    seedOpenFiles(['src/a.ts', 'src/b.ts'], 'src/b.ts');
    splitRightPane();
    assert.deepEqual(getSlotPaneTabs('secondary').viewerPaths, ['src/b.ts']);

    closeRightPaneSplit();

    const split = getFilePanelState().rightPaneSplit;
    assert.equal(split.enabled, false);
    assert.deepEqual(split.primaryTabs.viewerPaths, ['src/a.ts', 'src/b.ts']);
    assert.deepEqual(split.secondaryTabs.viewerPaths, []);
    assert.equal(getFilePanelState().rightPaneMode, 'viewer');
  });

  test('closing the last tab of a group collapses the split', () => {
    seedOpenFiles(['src/a.ts', 'src/b.ts'], 'src/b.ts');
    splitRightPane();

    unregisterViewerTab('src/b.ts');
    collapseEmptySlots();

    assert.equal(getFilePanelState().rightPaneSplit.enabled, false);
    assert.equal(isRightPaneSplitActive(), false);
  });
});
