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
import { resetInstancesForTests } from '../../src/os/instances.ts';
import { resetDesktopStateForTests } from '../../src/os/desktop-state.ts';
import {
  openDesktopWorkspaceTab,
  resetDesktopWorkspacePanelForTests,
} from '../../src/os/desktop-workspace-state.ts';
import {
  resetDesktopWorkspaceMountsForTests,
  syncDesktopWorkspaceMounts,
} from '../../src/os/desktop-workspace-mounts.ts';
import {
  resetWorkspaceStateForTests,
  setWorkspaceFromServer,
} from '../../src/state/workspace.ts';

const CODE_WS = 'C:/projects/minnow';
const DESKTOP_WS = 'C:/Users/me/.minnow/workspace';

function setupDom(win: Window): void {
  win.document.body.innerHTML = `
    <div id="workspaceSplit">
      <aside id="fileSidebar"><div id="fileSidebarFilesView"></div></aside>
      <section id="previewPane" class="hidden"></section>
      <section id="fileViewerPane" class="hidden"></section>
    </div>
  `;
}

describe('syncDesktopWorkspaceMounts listing root', () => {
  beforeEach(() => {
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
      fetch: typeof fetch;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
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
    setWorkspaceFromServer({ path: CODE_WS, label: 'minnow', isDefault: false });
    setFileTreeListingWorkspaceRoot(CODE_WS);
    resetDesktopWorkspacePathCache();
    resetInstancesForTests();
    resetDesktopStateForTests();
    resetDesktopWorkspacePanelForTests();
    resetDesktopWorkspaceMountsForTests();
  });

  afterEach(() => {
    resetWorkspaceStateForTests();
    resetFileTreeListingRootForTests();
    resetDesktopWorkspaceMountsForTests();
    resetDesktopWorkspacePanelForTests();
    resetDesktopWorkspacePathCache();
    resetInstancesForTests();
    resetDesktopStateForTests();
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
});
