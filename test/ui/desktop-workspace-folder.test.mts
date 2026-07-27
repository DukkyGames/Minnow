import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetDesktopWorkspacePathCache } from '../../src/lib/desktop-workspace.ts';
import {
  refreshDesktopWorkspaceFolderUi,
  resetDesktopWorkspaceSwitchForTests,
} from '../../src/ui/desktop-workspace-folder.ts';
import { setSessionStateForTests, createEmptyChatObject } from '../../src/state/sessions.ts';

const DESKTOP_WS = '/home/user/.minnow/workspace';
const PROJECT_WS = '/home/user/myproject';

describe('desktop-workspace-folder', () => {
  beforeEach(async () => {
    resetDesktopWorkspaceSwitchForTests();
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

    win.document.body.innerHTML = `
      <span id="desktopWorkspaceDrawerPath"></span>
      <button type="button" id="btnDesktopWorkspaceFolder"></button>
      <select id="desktopWorkspaceSelect"></select>
      <div id="desktopChatCol"></div>
      <div id="desktopChatSessionList"></div>
    `;

    const { resetDesktopWorkspacePathCache: resetCache } = await import(
      '../../src/lib/desktop-workspace.ts'
    );
    resetCache();

    const { setDesktopWorkspacePath } = await import('../../src/lib/desktop-workspace.ts');
    // Prime cache via mocked fetch in apply test; label helper uses cache only here.
    const mod = await import('../../src/lib/desktop-workspace.ts');
    void mod;
  });

  afterEach(() => {
    setSessionStateForTests(null);
    resetDesktopWorkspaceSwitchForTests();
  });

  test('refreshDesktopWorkspaceFolderUi updates path label and button', async () => {
    const { fetchDesktopWorkspaceInfo } = await import('../../src/lib/desktop-workspace.ts');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/desktop-workspace')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            path: PROJECT_WS,
            label: 'myproject',
            fileCount: 1,
          }),
        } as Response;
      }
      return originalFetch(url);
    }) as typeof fetch;

    await fetchDesktopWorkspaceInfo();
    refreshDesktopWorkspaceFolderUi();

    const pathEl = document.getElementById('desktopWorkspaceDrawerPath');
    assert.equal(pathEl?.textContent, PROJECT_WS);
    assert.equal(pathEl?.title, PROJECT_WS);

    const btn = document.getElementById('btnDesktopWorkspaceFolder');
    assert.match(btn?.getAttribute('aria-label') ?? '', /myproject/);

    globalThis.fetch = originalFetch;
    resetDesktopWorkspacePathCache();
  });

  test('alignDesktopWorkspaceToChat ignores Code workspace chats', async () => {
    const { fetchDesktopWorkspaceInfo } = await import('../../src/lib/desktop-workspace.ts');
    const originalFetch = globalThis.fetch;
    let putCount = 0;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.includes('/api/desktop-workspace') && init?.method === 'PUT') {
        putCount += 1;
      }
      if (path.includes('/api/desktop-workspace')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            path: DESKTOP_WS,
            label: 'workspace',
            fileCount: 0,
          }),
        } as Response;
      }
      return originalFetch(url, init);
    }) as typeof fetch;

    await fetchDesktopWorkspaceInfo();
    const { alignDesktopWorkspaceToChat } = await import('../../src/ui/desktop-workspace-folder.ts');
    const codeChat = {
      ...createEmptyChatObject('model-a'),
      id: 'code-chat',
      workspacePath: PROJECT_WS,
      modeId: 'build',
    };
    const moved = await alignDesktopWorkspaceToChat(codeChat);
    assert.equal(moved, false);
    assert.equal(putCount, 0);

    globalThis.fetch = originalFetch;
    resetDesktopWorkspacePathCache();
  });

  test('activateDesktopAssistantChatForApp restores remembered chat for workspace', async () => {
    setSessionStateForTests({
      version: 5,
      activeId: 'old-chat',
      sidebarCollapsed: false,
      lastActiveChatIdByWorkspace: { [PROJECT_WS]: 'project-chat' },
      lastActiveChatIdByApp: { desktop: 'project-chat' },
      chats: [
        {
          ...createEmptyChatObject('model-a'),
          id: 'old-chat',
          name: 'Sandbox chat',
          workspacePath: DESKTOP_WS,
          modeId: 'desktop',
          appScope: 'desktop' as const,
          history: [{ role: 'user', content: 'sandbox' }],
        },
        {
          ...createEmptyChatObject('model-a'),
          id: 'project-chat',
          name: 'Project chat',
          workspacePath: PROJECT_WS,
          modeId: 'desktop',
          appScope: 'desktop' as const,
          history: [{ role: 'user', content: 'project work' }],
        },
      ],
    });

    const { activateDesktopAssistantChatForApp, getActiveChat } = await import(
      '../../src/state/sessions.ts'
    );
    activateDesktopAssistantChatForApp(PROJECT_WS);
    assert.equal(getActiveChat().id, 'project-chat');
  });

  test('onDesktopWorkspaceChanged switches to per-folder remembered desktop chat', async () => {
    setSessionStateForTests({
      version: 5,
      activeId: 'sandbox-chat',
      sidebarCollapsed: false,
      lastActiveChatIdByWorkspace: {
        [DESKTOP_WS]: 'sandbox-chat',
        [PROJECT_WS]: 'project-chat',
      },
      lastActiveChatIdByApp: { desktop: 'sandbox-chat' },
      chats: [
        {
          ...createEmptyChatObject('model-a'),
          id: 'sandbox-chat',
          name: 'Sandbox chat',
          workspacePath: DESKTOP_WS,
          modeId: 'desktop',
          appScope: 'desktop' as const,
          history: [{ role: 'user', content: 'sandbox' }],
        },
        {
          ...createEmptyChatObject('model-a'),
          id: 'project-chat',
          name: 'Project chat',
          workspacePath: PROJECT_WS,
          modeId: 'desktop',
          appScope: 'desktop' as const,
          history: [{ role: 'user', content: 'project work' }],
        },
      ],
    });

    const { onDesktopWorkspaceChanged, getActiveChat } = await import('../../src/state/sessions.ts');
    await onDesktopWorkspaceChanged(PROJECT_WS, DESKTOP_WS);
    assert.equal(getActiveChat().id, 'project-chat');
  });
});
