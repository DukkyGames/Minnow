/**
 * Desktop workspace mount sync — file tree listing root scoping.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { resetDesktopWorkspacePathCache } from '../../src/lib/desktop-workspace.ts';
import {
  getFileTreeListingWorkspaceRoot,
  resetFileTreeListingRootForTests,
  setFileTreeListingWorkspaceRoot,
} from '../../src/ui/file-tree-listing-root.ts';
import {
  resetChromePopoverRegistryForTests,
  resetPreviewGuestVisibilityForTests,
} from '../../src/ui/preview-electron-visibility.ts';
import { resetInstancesForTests } from '../../src/os/instances.ts';
import { resetDesktopStateForTests } from '../../src/os/desktop-state.ts';
import {
  openDesktopWorkspaceTab,
  resetDesktopWorkspacePanelForTests,
} from '../../src/os/desktop-workspace-state.ts';
import {
  isDesktopWorkspaceHostingActive,
  resetDesktopWorkspaceMountsForTests,
  syncDesktopWorkspaceMounts,
} from '../../src/os/desktop-workspace-mounts.ts';
import {
  resetFilePanelStateForTests,
} from '../../src/state/file-panel.ts';
import {
  resetWorkspaceStateForTests,
  setWorkspaceFromServer,
} from '../../src/state/workspace.ts';

const CODE_WS = 'C:/projects/minnow';
const DESKTOP_WS = 'C:/Users/me/.minnow/workspace';

function setupDom(win: Window): void {
  win.document.body.innerHTML = `
    <div id="workspaceSplit">
      <aside id="fileSidebar">
        <button id="btnFileSidebarCollapse" type="button"></button>
        <div id="fileSidebarFilesView"></div>
      </aside>
      <div id="splitResizer" class="hidden"></div>
      <div id="rightPaneColumn" class="hidden">
        <section id="previewPane" class="hidden"></section>
        <section id="fileViewerPane" class="hidden"></section>
      </div>
    </div>
    <div id="desktopFileTreeMount"></div>
    <div id="desktopPreviewMount"></div>
    <div id="desktopFileViewerMount"></div>
  `;
}

describe('syncDesktopWorkspaceMounts listing root', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalFetch = globalThis.fetch;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalResizeObserver = globalThis.ResizeObserver;
  let happyDomWindow: Window | null = null;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const win = new Window();
    happyDomWindow = win;
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
      fetch: typeof fetch;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    g.requestAnimationFrame = (cb: FrameRequestCallback) =>
      win.setTimeout(() => cb(win.performance.now()), 0) as unknown as number;
    g.cancelAnimationFrame = (id: number) => {
      win.clearTimeout(id);
    };
    g.fetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/api/desktop-workspace')) {
        return {
          ok: true,
          json: async () => ({ ok: true, path: DESKTOP_WS, fileCount: 0 }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof fetch;
    setupDom(win);
    win.localStorage.clear();
    resetFilePanelStateForTests();
    setWorkspaceFromServer({ path: CODE_WS, label: 'minnow', isDefault: false });
    setFileTreeListingWorkspaceRoot(CODE_WS);
    resetDesktopWorkspacePathCache();
    resetInstancesForTests();
    resetDesktopStateForTests();
    resetDesktopWorkspacePanelForTests();
    resetDesktopWorkspaceMountsForTests();
  });

  afterEach(() => {
    resetPreviewGuestVisibilityForTests();
    resetChromePopoverRegistryForTests();
    happyDomWindow?.close();
    happyDomWindow = null;
    resetWorkspaceStateForTests();
    resetFilePanelStateForTests();
    resetFileTreeListingRootForTests();
    resetDesktopWorkspaceMountsForTests();
    resetDesktopWorkspacePanelForTests();
    resetDesktopWorkspacePathCache();
    resetInstancesForTests();
    resetDesktopStateForTests();
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'document', {
      value: originalDocument,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'HTMLElement', {
      value: originalHTMLElement,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'fetch', {
      value: originalFetch,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      value: originalRequestAnimationFrame ?? ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      value: originalCancelAnimationFrame ?? (() => {}),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'ResizeObserver', {
      value: originalResizeObserver,
      configurable: true,
      writable: true,
    });
  });

  test('scopes file tree to desktop workspace when desktop is foreground', async () => {
    openDesktopWorkspaceTab('files');
    await syncDesktopWorkspaceMounts();
    assert.equal(getFileTreeListingWorkspaceRoot(), DESKTOP_WS);
  });

  test('restores code workspace listing root when Code is foreground', async () => {
    openDesktopWorkspaceTab('files');
    await syncDesktopWorkspaceMounts();
    assert.equal(getFileTreeListingWorkspaceRoot(), DESKTOP_WS);

    const { launchInstance } = await import('../../src/os/instances.ts');
    launchInstance('code');
    await syncDesktopWorkspaceMounts();
    assert.equal(getFileTreeListingWorkspaceRoot(), CODE_WS);
  });

  test('isDesktopWorkspaceHostingActive on desktop idle (not only chatActive)', async () => {
    const { getDesktopState } = await import('../../src/os/desktop-state.ts');
    assert.equal(getDesktopState(), 'idle');
    assert.equal(isDesktopWorkspaceHostingActive(), true);
  });

  test('isDesktopWorkspaceHostingActive false when Code is foreground', async () => {
    const { launchInstance } = await import('../../src/os/instances.ts');
    launchInstance('code');
    assert.equal(isDesktopWorkspaceHostingActive(), false);
  });

  test('Code foreground keeps fileSidebarFilesView visible after desktop round-trip', async () => {
    openDesktopWorkspaceTab('files');
    await syncDesktopWorkspaceMounts();

    const filesView = document.getElementById('fileSidebarFilesView');
    assert.ok(filesView);
    assert.equal(filesView.classList.contains('hidden'), false);

    const { launchInstance } = await import('../../src/os/instances.ts');
    launchInstance('code');
    await syncDesktopWorkspaceMounts();

    assert.equal(filesView.classList.contains('hidden'), false);
    assert.equal(filesView.parentElement?.id, 'fileSidebar');
  });

  test('first Code sync does not hide fileSidebarFilesView', async () => {
    const { launchInstance } = await import('../../src/os/instances.ts');
    launchInstance('code');

    const filesView = document.getElementById('fileSidebarFilesView');
    assert.ok(filesView);
    assert.equal(filesView.classList.contains('hidden'), false);

    await syncDesktopWorkspaceMounts();
    assert.equal(filesView.classList.contains('hidden'), false);
  });

  test('desktop hosting closes active right pane split before reparent', async () => {
    const { patchFilePanelState, getFilePanelState } = await import('../../src/state/file-panel.ts');
    patchFilePanelState({
      rightPaneMode: 'split',
      viewerOpen: true,
      rightPaneSplit: {
        enabled: true,
        ratio: 0.5,
        focusedSlot: 'primary',
        primary: { kind: 'viewer', tabPath: 'src/a.ts' },
        secondary: { kind: 'viewer', tabPath: 'src/b.ts' },
      },
    });

    openDesktopWorkspaceTab('viewer');
    await syncDesktopWorkspaceMounts();

    const state = getFilePanelState();
    assert.equal(state.rightPaneSplit.enabled, false);
    assert.equal(state.rightPaneMode, 'viewer');
    assert.equal(document.getElementById('fileViewerPane')?.parentElement?.id, 'desktopFileViewerMount');
  });

  test('desktop hosting keeps sandbox listing root scoped on sync', async () => {
    openDesktopWorkspaceTab('files');
    await syncDesktopWorkspaceMounts();
    const desktopRoot = getFileTreeListingWorkspaceRoot();
    assert.ok(desktopRoot);
    assert.notEqual(desktopRoot, CODE_WS);
    assert.equal(isDesktopWorkspaceHostingActive(), true);
  });

  test('Code entry hides preview after desktop browser drawer stripped .hidden (MIN-342)', async () => {
    openDesktopWorkspaceTab('browser');
    await syncDesktopWorkspaceMounts();

    const preview = document.getElementById('previewPane');
    assert.ok(preview);
    assert.equal(preview.classList.contains('hidden'), false);
    assert.equal(preview.parentElement?.id, 'desktopPreviewMount');

    const { launchInstance } = await import('../../src/os/instances.ts');
    launchInstance('code');
    await syncDesktopWorkspaceMounts();

    assert.equal(preview.parentElement?.id, 'rightPaneColumn');
    assert.equal(preview.classList.contains('hidden'), true);
    assert.equal(document.getElementById('rightPaneColumn')?.classList.contains('hidden'), true);
  });

  test('Code entry hides preview when persisted rightPaneMode is preview (MIN-342)', async () => {
    const { patchFilePanelState } = await import('../../src/state/file-panel.ts');
    patchFilePanelState({
      rightPaneMode: 'preview',
      viewerOpen: true,
      previewSource: { kind: 'url', url: 'http://localhost:3000' },
    });

    const { launchInstance } = await import('../../src/os/instances.ts');
    launchInstance('code');
    await syncDesktopWorkspaceMounts();

    const preview = document.getElementById('previewPane');
    assert.ok(preview);
    assert.equal(preview.classList.contains('hidden'), true);
    assert.equal(document.getElementById('rightPaneColumn')?.classList.contains('hidden'), true);
  });

  test('stale desktop sync cannot remount preview while Code is foreground', async () => {
    openDesktopWorkspaceTab('browser');
    const desktopSync = syncDesktopWorkspaceMounts();

    const { launchInstance } = await import('../../src/os/instances.ts');
    launchInstance('code');
    await syncDesktopWorkspaceMounts();
    await desktopSync;

    const preview = document.getElementById('previewPane');
    assert.ok(preview);
    assert.equal(preview.parentElement?.id, 'rightPaneColumn');
    assert.equal(preview.classList.contains('hidden'), true);
    assert.equal(document.getElementById('desktopPreviewMount')?.classList.contains('is-active'), false);
  });

  test('stale desktop sync cannot pin listing root while Code is foreground', async () => {
    openDesktopWorkspaceTab('files');
    const desktopSync = syncDesktopWorkspaceMounts();

    const { launchInstance } = await import('../../src/os/instances.ts');
    launchInstance('code');
    await syncDesktopWorkspaceMounts();
    await desktopSync;

    assert.equal(getFileTreeListingWorkspaceRoot(), CODE_WS);
  });
});
