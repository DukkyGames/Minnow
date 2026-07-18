import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetInstancesForTests } from '../../src/os/instances.ts';
import {
  resetDesktopStateForTests,
  setDesktopStateForTests,
} from '../../src/os/desktop-state.ts';
import { setSessionStateForTests, createEmptyChatObject } from '../../src/state/sessions.ts';

describe('isStreamDomVisible desktop surface', () => {
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
    win.document.body.innerHTML = `
      <main id="chatArea" class="main-column--board-view"></main>
      <div id="orchestrateHub"></div>
      <div id="desktopChatCol"></div>
    `;
    resetInstancesForTests();
    resetDesktopStateForTests();
    setDesktopStateForTests('chatActive');
    setSessionStateForTests({
      version: 5,
      activeId: 'desktop-chat',
      sidebarCollapsed: false,
      lastActiveChatIdByWorkspace: {},
      lastActiveChatIdByApp: {},
      chats: [
        {
          ...createEmptyChatObject('model-a'),
          id: 'desktop-chat',
          name: 'Desktop',
          workspacePath: '/home/user/.minnow/workspace',
          modeId: 'desktop',
        },
      ],
    });
  });

  afterEach(() => {
    setSessionStateForTests(null);
    resetDesktopStateForTests();
    resetInstancesForTests();
  });

  test('stream DOM stays visible on desktop even when Code board chrome is mounted', async () => {
    const { isStreamDomVisible } = await import('../../src/chat/streaming-state.ts');
    assert.equal(isStreamDomVisible('desktop-chat'), true);
  });
});
