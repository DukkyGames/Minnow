import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetWorkspaceStateForTests } from '../../src/state/workspace.ts';
import { setSessionStateForTests, createEmptyChatObject } from '../../src/state/sessions.ts';

const DESKTOP_WS = '/home/user/.minnow/workspace';
const CODE_WS = '/home/user/minnow';

function stubSharedDom(doc: Document): void {
  doc.body.innerHTML = `
    <div id="desktopChatCol"></div>
    <div id="desktopChatSessionList"></div>
    <aside class="mn-os-chat-rail is-collapsed"></aside>
    <textarea id="desktopInput"></textarea>
    <button type="button" id="desktopSendBtn"></button>
    <div id="fileSidebar"><div id="fileSidebarFilesView"></div></div>
    <div id="desktopFileTreeMount"></div>
    <div id="desktopPreviewMount"></div>
    <div id="desktopFileViewerMount"></div>
    <section id="previewPane" class="hidden"></section>
    <section id="fileViewerPane" class="hidden"></section>
    <main id="chatArea"></main>
  `;
}

describe('restoreDesktopSessionOnForeground', () => {
  beforeEach(async () => {
    const { resetDesktopWorkspacePathCache } = await import('../../src/lib/desktop-workspace.ts');
    resetDesktopWorkspacePathCache();
    const { Window } = await import('happy-dom');
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
    stubSharedDom(win.document);

    let workspacePath = CODE_WS;
    g.fetch = (async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes('/api/desktop-workspace')) {
        return {
          ok: true,
          json: async () => ({ ok: true, path: DESKTOP_WS, fileCount: 0 }),
        } as Response;
      }
      if (path.includes('/api/workspace')) {
        return {
          ok: true,
          json: async () => ({
            path: workspacePath,
            label: workspacePath.split('/').pop(),
            isDefault: false,
          }),
        } as Response;
      }
      return { ok: false, status: 503, json: async () => ({ error: 'offline' }) } as Response;
    }) as typeof fetch;

    resetWorkspaceStateForTests();
    const { setWorkspaceFromServer } = await import('../../src/state/workspace.ts');
    setWorkspaceFromServer({
      path: CODE_WS,
      label: 'minnow',
      isDefault: false,
    });

    const { resetInstancesForTests } = await import('../../src/os/instances.ts');
    const { setDesktopStateForTests } = await import('../../src/os/desktop-state.ts');
    resetInstancesForTests();
    setDesktopStateForTests('chatActive');
  });

  afterEach(() => {
    setSessionStateForTests(null);
    resetWorkspaceStateForTests();
  });

  test('switches off orchestrator chat for desktop workspace', async () => {
    setSessionStateForTests({
      version: 5,
      activeId: 'orchestrator-chat',
      sidebarCollapsed: false,
      lastActiveChatIdByWorkspace: { [CODE_WS]: 'orchestrator-chat' },
      lastActiveChatIdByApp: { desktop: 'desktop-chat' },
      chats: [
        {
          ...createEmptyChatObject('model-a'),
          id: 'orchestrator-chat',
          name: 'Orchestrator',
          workspacePath: CODE_WS,
          modeId: 'orchestrate',
          history: [{ role: 'user', content: 'Run the board' }],
        },
        {
          ...createEmptyChatObject('model-a'),
          id: 'desktop-chat',
          name: 'Desktop hello',
          workspacePath: DESKTOP_WS,
          modeId: 'desktop',
          appScope: 'desktop' as const,
          history: [
            { role: 'user', content: 'Hello desktop' },
            { role: 'assistant', content: 'Hi from desktop' },
          ],
        },
      ],
    });

    const { activateDesktopAssistantChatForApp, getActiveChat } = await import(
      '../../src/state/sessions.ts'
    );
    activateDesktopAssistantChatForApp(DESKTOP_WS);
    assert.equal(getActiveChat().id, 'desktop-chat');
    assert.match(getActiveChat().history[1]?.content ?? '', /Hi from desktop/);
  });

  test('keeps expert chat active when workspace is not the desktop sandbox', async () => {
    setSessionStateForTests({
      version: 5,
      activeId: 'expert-chat',
      sidebarCollapsed: false,
      lastActiveChatIdByWorkspace: { [CODE_WS]: 'orchestrator-chat' },
      lastActiveChatIdByApp: { desktop: 'desktop-chat' },
      chats: [
        {
          ...createEmptyChatObject('model-a'),
          id: 'expert-chat',
          kind: 'expert',
          expertId: 'software-engineer',
          expertSelection: { mode: 'manual', expertId: 'software-engineer' },
          name: 'Expert thread',
          workspacePath: CODE_WS,
          modeId: 'general',
          history: [{ role: 'assistant', content: 'Expert hello' }],
        },
        {
          ...createEmptyChatObject('model-a'),
          id: 'desktop-chat',
          name: 'Desktop hello',
          workspacePath: DESKTOP_WS,
          modeId: 'desktop',
          appScope: 'desktop' as const,
          history: [{ role: 'user', content: 'Hello desktop' }],
        },
      ],
    });

    const { restoreDesktopSessionOnForeground } = await import('../../src/os/desktop-launch.ts');
    const { getActiveChat } = await import('../../src/state/sessions.ts');

    assert.equal(getActiveChat().kind, 'expert', 'fixture must be an expert thread');
    try {
      await restoreDesktopSessionOnForeground();
    } catch (err) {
      // happy-dom lacks a full DOMPurify implementation; the guard runs before render.
      assert.match(String(err), /DOMPurify|sanitize/);
    }
    assert.equal(getActiveChat().id, 'expert-chat', 'restore must not switch away from expert chat');
  });
});
