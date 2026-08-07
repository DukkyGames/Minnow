/**
 * MIN-576: tool workspace resolution must not follow desktop chat state while
 * Code owns the foreground — a Code chat writes into the top-bar workspace.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { launchInstance, resetInstancesForTests } from '../../src/os/instances.ts';
import {
  resetDesktopStateForTests,
  setDesktopStateForTests,
} from '../../src/os/desktop-state.ts';
import {
  initOsPageBridge,
  resetOsPageBridgeForTests,
} from '../../src/os/page-bridge.ts';
import { resetDesktopWorkspacePathCache } from '../../src/lib/desktop-workspace.ts';
import { setSessionStateForTests, createEmptyChatObject } from '../../src/state/sessions.ts';

const DESKTOP_WS = '/home/user/.minnow/workspace';
const PROJECT_WS = '/home/user/myproject';

/** Prime the desktop workspace path cache so resolution has a concrete path to pick. */
async function primeDesktopWorkspace(): Promise<() => void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/desktop-workspace')) {
      return {
        ok: true,
        json: async () => ({ ok: true, path: DESKTOP_WS, label: 'workspace', fileCount: 0 }),
      } as Response;
    }
    return originalFetch(url);
  }) as typeof fetch;
  const { fetchDesktopWorkspaceInfo } = await import('../../src/lib/desktop-workspace.ts');
  await fetchDesktopWorkspaceInfo();
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe('resolveToolWorkspaceRoot', () => {
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
    win.document.body.innerHTML = '<div id="osDesktopLayer"></div><main id="chatView"></main>';
    resetInstancesForTests();
    resetDesktopStateForTests();
    resetOsPageBridgeForTests();
    initOsPageBridge();
    resetDesktopWorkspacePathCache();
  });

  afterEach(() => {
    setSessionStateForTests(null);
    resetDesktopStateForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
    resetDesktopWorkspacePathCache();
  });

  test('a Code chat does not inherit the desktop workspace while desktop chat stays active', async () => {
    setSessionStateForTests({
      version: 5,
      activeId: 'code-chat',
      sidebarCollapsed: false,
      chats: [
        {
          ...createEmptyChatObject('model-a'),
          id: 'code-chat',
          name: 'Code chat',
          workspacePath: PROJECT_WS,
          modeId: 'general',
        },
      ],
    });

    // Desktop chat was used earlier, then Code went fullscreen.
    setDesktopStateForTests('chatActive');
    launchInstance('code');

    const restoreFetch = await primeDesktopWorkspace();
    try {
      const { resolveToolWorkspaceRoot } = await import('../../src/tools/client.ts');
      const { getCachedDesktopWorkspacePath } = await import(
        '../../src/lib/desktop-workspace.ts'
      );
      // Guard the guard: the desktop path is resolvable, so undefined below is
      // the foreground check firing, not a failed lookup.
      assert.equal(getCachedDesktopWorkspacePath(), DESKTOP_WS);
      assert.equal(await resolveToolWorkspaceRoot({ chatId: 'code-chat' }), undefined);
    } finally {
      restoreFetch();
    }
  });

  test('a desktop-foreground chat still resolves to the desktop workspace', async () => {
    setSessionStateForTests({
      version: 5,
      activeId: 'sandbox-chat',
      sidebarCollapsed: false,
      chats: [
        {
          ...createEmptyChatObject('model-a'),
          id: 'sandbox-chat',
          name: 'Sandbox chat',
          workspacePath: '',
          modeId: 'general',
        },
      ],
    });

    setDesktopStateForTests('chatActive');

    const restoreFetch = await primeDesktopWorkspace();
    try {
      const { resolveToolWorkspaceRoot } = await import('../../src/tools/client.ts');
      assert.equal(await resolveToolWorkspaceRoot({ chatId: 'sandbox-chat' }), DESKTOP_WS);
    } finally {
      restoreFetch();
    }
  });

  test('a desktop chat resolves to its own bound folder, not the top-bar workspace', async () => {
    setSessionStateForTests({
      version: 5,
      activeId: 'desktop-chat',
      sidebarCollapsed: false,
      chats: [
        {
          ...createEmptyChatObject('model-a'),
          id: 'desktop-chat',
          name: 'Desktop chat',
          workspacePath: PROJECT_WS,
          modeId: 'desktop',
        },
      ],
    });

    const { resolveToolWorkspaceRoot } = await import('../../src/tools/client.ts');
    assert.equal(await resolveToolWorkspaceRoot({ chatId: 'desktop-chat' }), PROJECT_WS);
    assert.notEqual(PROJECT_WS, DESKTOP_WS);
  });
});
