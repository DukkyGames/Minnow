import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { launchInstance, resetInstancesForTests } from '../../src/os/instances.ts';
import { setSessionStateForTests, createEmptyChatObject } from '../../src/state/sessions.ts';

describe('isStreamDomVisible without desktop surface', () => {
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
    `;
    resetInstancesForTests();
    setSessionStateForTests({
      version: 5,
      activeId: 'code-chat',
      sidebarCollapsed: false,
      lastActiveChatIdByWorkspace: {},
      lastActiveChatIdByApp: {},
      chats: [
        {
          ...createEmptyChatObject('model-a'),
          id: 'code-chat',
          name: 'Code chat',
          workspacePath: '/home/user/.minnow/workspace',
          modeId: 'general',
        },
      ],
    });
  });

  afterEach(() => {
    setSessionStateForTests(null);
    resetInstancesForTests();
  });

  test('board chrome suppresses stream DOM until Code is foreground', async () => {
    const { isStreamDomVisible } = await import('../../src/chat/streaming-state.ts');
    assert.equal(isStreamDomVisible('code-chat'), false);
    launchInstance('code');
    assert.equal(isStreamDomVisible('code-chat'), false);
  });
});
