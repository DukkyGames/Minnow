import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resetWorkspaceStateForTests } from '../../src/state/workspace.ts';
import { setSessionStateForTests, createEmptyChatObject } from '../../src/state/sessions.ts';

const FINANCE_WS = '/home/user/finance-app';
const CURRENT_WS = '/home/user/minnow';

function stubCodeAppDom(doc: Document): void {
  const statsIds = [
    'stripTPS',
    'stripTTFT',
    'stripGen',
    'stripTotal',
    'stripCost',
    'barPrompt',
    'barCompletion',
    'cntPrompt',
    'cntCompletion',
    'iArch',
    'iQuant',
    'iCtx',
    'iStop',
    'statsStrip',
    'statsExpandBtn',
    'statsExpandPreview',
  ];
  doc.body.innerHTML = `
      <header class="topbar">
        <select id="modelSelect"><option value="test::model-a" selected>model-a</option></select>
        <input id="temperature" value="0.7" />
        <input id="maxTokens" value="4096" />
        <textarea id="systemPrompt"></textarea>
      </header>
      <main id="chatArea"></main>
      <div id="mainColumn"></div>
      <ul id="chatList"></ul>
      <textarea id="msgInput"></textarea>
      <button type="button" id="sendBtn"></button>
    `;
  for (const id of statsIds) {
    if (!doc.getElementById(id)) {
      doc.body.appendChild(Object.assign(doc.createElement('div'), { id }));
    }
  }
}

describe('applyCodeLaunchOptions', () => {
  beforeEach(async () => {
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
    g.localStorage = win.localStorage;

    stubCodeAppDom(win.document);

    let workspacePath = CURRENT_WS;
    g.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.includes('/api/workspace') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { path: string };
        workspacePath = body.path;
        return {
          ok: true,
          json: async () => ({
            path: workspacePath,
            label: workspacePath.split('/').pop(),
            isDefault: false,
          }),
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
      path: CURRENT_WS,
      label: 'minnow',
      isDefault: false,
    });

    setSessionStateForTests({
      version: 5,
      activeId: 'chat-existing',
      sidebarCollapsed: false,
      lastActiveChatIdByWorkspace: {},
      lastActiveChatIdByApp: {},
      chats: [
        {
          ...createEmptyChatObject('model-a'),
          id: 'chat-existing',
          name: 'Existing',
          workspacePath: CURRENT_WS,
          modeId: 'build',
        },
      ],
    });

    const { resetInstancesForTests } = await import('../../src/os/instances.ts');
    resetInstancesForTests();
  });

  afterEach(() => {
    setSessionStateForTests(null);
    resetWorkspaceStateForTests();
  });

  test('switches workspace without sending for navigation-only launch', async () => {
    const { applyCodeLaunchOptions } = await import('../../src/os/code-launch.ts');

    await applyCodeLaunchOptions({
      workspacePath: FINANCE_WS,
      autoRun: false,
    });

    const { getWorkspacePath } = await import('../../src/state/workspace.ts');
    assert.equal(getWorkspacePath(), FINANCE_WS);

    const input = document.getElementById('msgInput') as HTMLTextAreaElement;
    assert.equal(input.value, '');
  });

  test('switches workspace, creates debug chat, and fills composer', async () => {
    const { applyCodeLaunchOptions } = await import('../../src/os/code-launch.ts');
    await applyCodeLaunchOptions({
      seed: 'Find bugs in the finance app',
      modeId: 'debug',
      workspacePath: FINANCE_WS,
      autoRun: true,
    });

    const { getWorkspacePath } = await import('../../src/state/workspace.ts');
    assert.equal(getWorkspacePath(), FINANCE_WS);

    const { getActiveChat } = await import('../../src/state/sessions.ts');
    const chat = getActiveChat();
    assert.equal(chat.modeId, 'debug');
    assert.notEqual(chat.id, 'chat-existing');

    const input = document.getElementById('msgInput') as HTMLTextAreaElement;
    const inComposer = input.value;
    const inHistory = chat.history.some(
      (m) => m.role === 'user' && m.content === 'Find bugs in the finance app',
    );
    assert.ok(
      inComposer === 'Find bugs in the finance app' || inHistory,
      'seed should remain in composer or chat history after send attempt',
    );
  });
});
