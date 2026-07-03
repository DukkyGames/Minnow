import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetDesktopWorkspacePathCache } from '../../src/lib/desktop-workspace.ts';
import { resetAppHostForTests } from '../../src/os/app-host.ts';
import { resetInstancesForTests } from '../../src/os/instances.ts';
import { resetDesktopStateForTests } from '../../src/os/desktop-state.ts';
import { resetDesktopChatRailForTests } from '../../src/ui/desktop-chat-rail.ts';
import { resetOsPageBridgeForTests } from '../../src/os/page-bridge.ts';
import {
  collapseDesktopWorkspacePanel,
  openDesktopWorkspaceTab,
  resetDesktopWorkspacePanelForTests,
} from '../../src/os/desktop-workspace-state.ts';
import {
  resetDesktopWorkspaceMountsForTests,
  syncDesktopWorkspaceMounts,
} from '../../src/os/desktop-workspace-mounts.ts';
import {
  resetDesktopWorkspaceRailForTests,
} from '../../src/os/desktop-workspace-rail.ts';
import { resetDesktopWorkspaceRailResizeForTests } from '../../src/os/desktop-workspace-rail-resize.ts';
import { initOsRouter, resetOsRouterForTests } from '../../src/os/router.ts';
import { renderDesktop } from '../../src/os/desktop.ts';

function setupDesktopDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <div id="osStage">
      <div id="osDesktopLayer" class="mn-os-desktop-layer"></div>
      <div id="osAppsLayer"></div>
    </div>
    <div id="workspaceSplit">
      <aside id="fileSidebar"><div id="fileSidebarFilesView"></div></aside>
      <section id="previewPane" class="hidden"></section>
      <section id="fileViewerPane" class="hidden"></section>
    </div>
  `;
}

describe('desktop workspace rail', () => {
  let cleanupDesktop: (() => void) | undefined;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
      localStorage: Storage;
      fetch: typeof fetch;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    g.HTMLButtonElement = win.HTMLButtonElement;
    g.localStorage = win.localStorage;
    g.requestAnimationFrame = (cb: FrameRequestCallback) =>
      win.setTimeout(() => cb(win.performance.now()), 0) as unknown as number;
    g.getComputedStyle = win.getComputedStyle.bind(win);
    win.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof window.matchMedia;
    g.fetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/api/desktop-workspace')) {
        return {
          ok: true,
          json: async () => ({ ok: true, path: '/home/user/.minnow/workspace', fileCount: 1 }),
        } as Response;
      }
      if (url.includes('/api/chats-workspace')) {
        return {
          ok: true,
          json: async () => ({ ok: true, path: '/home/user/.minnow/chats', fileCount: 0 }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof fetch;
    setupDesktopDom(win);
    resetDesktopWorkspacePathCache();
    win.location.hash = '#/desktop';
    resetInstancesForTests();
    resetDesktopStateForTests();
    resetDesktopChatRailForTests();
    resetDesktopWorkspacePanelForTests();
    resetDesktopWorkspaceMountsForTests();
    resetDesktopWorkspaceRailForTests();
    resetDesktopWorkspaceRailResizeForTests();
    resetOsRouterForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
    const layer = document.getElementById('osDesktopLayer')!;
    cleanupDesktop = renderDesktop(layer);
    initOsRouter();
  });

  afterEach(() => {
    cleanupDesktop?.();
    cleanupDesktop = undefined;
    resetDesktopWorkspacePanelForTests();
    resetDesktopWorkspaceMountsForTests();
    resetDesktopWorkspaceRailForTests();
    resetDesktopWorkspaceRailResizeForTests();
    resetOsRouterForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
  });

  test('renders three right-edge workspace tabs', () => {
    assert.ok(document.getElementById('btnDesktopWorkspaceFiles'));
    assert.ok(document.getElementById('btnDesktopWorkspaceBrowser'));
    assert.ok(document.getElementById('btnDesktopWorkspaceViewer'));
    assert.ok(document.getElementById('desktopFileTreeMount'));
  });

  test('openDesktopWorkspaceTab expands drawer with matching mount', async () => {
    openDesktopWorkspaceTab('files');
    await syncDesktopWorkspaceMounts();
    const rail = document.querySelector('.mn-os-workspace-rail');
    assert.ok(rail?.classList.contains('is-expanded'));
    const filesMount = document.getElementById('desktopFileTreeMount');
    assert.ok(filesMount?.classList.contains('is-active'));
  });

  test('collapseDesktopWorkspacePanel hides drawer', () => {
    openDesktopWorkspaceTab('browser');
    collapseDesktopWorkspacePanel();
    const rail = document.querySelector('.mn-os-workspace-rail');
    assert.ok(rail?.classList.contains('is-collapsed'));
    assert.equal(rail?.classList.contains('is-expanded'), false);
  });

  test('drawer header segments switch between workspace panels', async () => {
    openDesktopWorkspaceTab('files');
    await syncDesktopWorkspaceMounts();
    const viewerSegment = document.querySelector<HTMLButtonElement>(
      '.mn-os-workspace-rail-drawer-segment[data-workspace-tab="viewer"]',
    );
    assert.ok(viewerSegment);
    viewerSegment.click();
    await syncDesktopWorkspaceMounts();
    const viewerMount = document.getElementById('desktopFileViewerMount');
    assert.ok(viewerMount?.classList.contains('is-active'));
    const filesMount = document.getElementById('desktopFileTreeMount');
    assert.equal(filesMount?.classList.contains('is-active'), false);
    assert.ok(viewerSegment.classList.contains('is-active'));
    const rail = document.querySelector('.mn-os-workspace-rail');
    assert.ok(rail?.classList.contains('is-expanded'));
  });
});
