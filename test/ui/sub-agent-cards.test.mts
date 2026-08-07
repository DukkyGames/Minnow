import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { resetInstancesForTests } from '../../src/os/instances.ts';
import {
  resetDesktopStateForTests,
  setDesktopStateForTests,
  isDesktopChatActive,
} from '../helpers/legacy-desktop-state.ts';
import {
  initOsPageBridge,
  resetOsPageBridgeForTests,
} from '../../src/os/page-bridge.ts';

const { upsertSubAgentCardForRun, clearSubAgentCardDomRegistry } = await import(
  '../../src/ui/sub-agent-cards.ts',
);
const { openSubAgentDrawer, closeSubAgentDrawer } = await import(
  '../../src/ui/sub-agent-drawer.ts',
);
const { setSessionStateForTests, createEmptyChatObject, getActiveChat } = await import(
  '../../src/state/sessions.ts',
);
const { renderHub, teardownHub } = await import('../../src/ui/hub.ts');

function setupCodeDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  document.body.innerHTML = `
    <div id="mainColumn">
      <div id="chatArea"></div>
      <div class="input-bar">
        <textarea id="msgInput"></textarea>
        <div id="modeSelector"></div>
      </div>
    </div>
  `;
  return window;
}

function setupDesktopDom(win: Window) {
  const polyfillRaf = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof requestAnimationFrame;
  globalThis.requestAnimationFrame = polyfillRaf;
  const g = win as unknown as Window & typeof globalThis;
  g.requestAnimationFrame = polyfillRaf;
  win.document.body.innerHTML = `
    <div id="osDesktopLayer" class="mn-os-desktop-layer is-chat-active">
      <div class="mn-os-desktop-chat">
        <div class="mn-os-chat-transcript">
          <div id="desktopChatCol" class="mn-os-chat-col"></div>
        </div>
      </div>
    </div>
    <main id="chatView" class="chat-app-page is-open"></main>
    <textarea id="msgInput"></textarea>
    <textarea id="desktopInput"></textarea>
    <button id="sendBtn"></button>
    <button id="desktopSendBtn"></button>
  `;
}

const sampleRun = (chatId: string) => ({
  runId: '22222222-2222-2222-2222-222222222222',
  type: 'explore',
  task: 'List files under src/',
  status: 'running' as const,
  parentChatId: chatId,
  parentToolCallId: null,
  parentTurnId: 'turn-1',
  summary: '',
  error: null,
  startedAt: '2026-05-20T12:00:00.000Z',
  endedAt: null,
  toolTurns: 0,
  cancelled: false,
  messages: [],
  liveNestedToolCalls: 1,
});

describe('sub-agent cards', { concurrency: false }, () => {
  afterEach(() => {
    teardownHub();
    setSessionStateForTests(null);
    resetDesktopStateForTests();
    resetInstancesForTests();
    resetOsPageBridgeForTests();
  });

  test('upsertSubAgentCardForRun mounts a card for the active chat', () => {
    setupCodeDom();
    const chat = createEmptyChatObject('');
    chat.id = 'chat-sub-1';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const el = upsertSubAgentCardForRun(sampleRun(chat.id), chat.id);
    assert.ok(el);
    assert.ok(el.classList.contains('sub-agent-card--active'));
    assert.ok(el.textContent?.includes('Working'));
    assert.ok(el.textContent?.includes('explore'));
    assert.ok(el.textContent?.includes('List files'));
    assert.equal(document.getElementById('chatArea')?.querySelector('.sub-agent-card'), el);

    clearSubAgentCardDomRegistry();
  });

  test('upsertSubAgentCardForRun shows live phase on the badge and subtitle', () => {
    setupCodeDom();
    const chat = createEmptyChatObject('');
    chat.id = 'chat-sub-live';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const el = upsertSubAgentCardForRun(
      {
        ...sampleRun(chat.id),
        livePhase: 'thinking',
        livePartialReasoning: 'Checking routes…',
      },
      chat.id,
    );
    assert.ok(el);
    assert.ok(el.textContent?.includes('Thinking'));
    assert.ok(el.textContent?.includes('Thinking…'));

    clearSubAgentCardDomRegistry();
  });

  test('upsertSubAgentCardForRun skips the Vibe hub empty-chat landing', () => {
    setupCodeDom();
    const chat = createEmptyChatObject('');
    chat.id = 'chat-hub-sub';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderHub(chat);
    const el = upsertSubAgentCardForRun(sampleRun(chat.id), chat.id);
    assert.equal(el, null);
    assert.equal(document.getElementById('chatArea')?.querySelector('.sub-agent-card'), null);

    clearSubAgentCardDomRegistry();
  });

  test('upsertSubAgentCardForRun mounts into #desktopChatCol when desktop chat is active', () => {
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
      Node: typeof Node;
      fetch: typeof fetch;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    g.Node = win.Node;
    setupDesktopDom(win);
    resetInstancesForTests();
    resetDesktopStateForTests();
    resetOsPageBridgeForTests();
    initOsPageBridge();

    g.fetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/api/chats-workspace')) {
        return {
          ok: true,
          json: async () => ({ ok: true, path: '/home/user/.minnow/chats', fileCount: 0 }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof fetch;

    const chat = createEmptyChatObject('model-a');
    chat.id = 'chat-desktop-sub';
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      lastActiveChatIdByWorkspace: {},
      lastActiveChatIdByApp: { chat: chat.id },
      chats: [chat],
    });

    setDesktopStateForTests('chatActive');

    assert.equal(isDesktopChatActive(), true);
    const activeId = getActiveChat().id;

    const el = upsertSubAgentCardForRun(sampleRun(activeId), activeId);
    assert.ok(el);
    const desktopCol = document.getElementById('desktopChatCol');
    assert.ok(desktopCol);
    assert.equal(desktopCol.querySelector('.sub-agent-card'), el);
    assert.equal(document.getElementById('chatArea'), null);

    clearSubAgentCardDomRegistry();
  });

  test('openSubAgentDrawer mounts overlay on desktop chat shell, not #mainColumn', () => {
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
      Node: typeof Node;
      fetch: typeof fetch;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    g.Node = win.Node;
    setupDesktopDom(win);
    resetInstancesForTests();
    resetDesktopStateForTests();
    resetOsPageBridgeForTests();
    initOsPageBridge();

    g.fetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/api/chats-workspace')) {
        return {
          ok: true,
          json: async () => ({ ok: true, path: '/home/user/.minnow/chats', fileCount: 0 }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof fetch;

    const chat = createEmptyChatObject('model-a');
    chat.id = 'chat-desktop-drawer';
    const run = sampleRun(chat.id);
    chat.subAgentRuns = [
      {
        runId: run.runId,
        type: run.type,
        task: run.task,
        status: 'completed',
        parentChatId: chat.id,
        parentToolCallId: null,
        parentTurnId: run.parentTurnId,
        summary: 'Found 12 files under src/.',
        error: null,
        startedAt: run.startedAt,
        endedAt: '2026-05-20T12:05:00.000Z',
        toolTurns: 2,
        cancelled: false,
        messages: [],
      },
    ];
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      lastActiveChatIdByWorkspace: {},
      lastActiveChatIdByApp: { chat: chat.id },
      chats: [chat],
    });

    setDesktopStateForTests('chatActive');

    openSubAgentDrawer(run.runId, chat.id);

    const desktopShell = document.querySelector('.mn-os-desktop-chat');
    assert.ok(desktopShell);
    assert.ok(desktopShell?.querySelector('.sub-agent-overlay'));
    assert.equal(document.getElementById('mainColumn'), null);

    closeSubAgentDrawer();
    clearSubAgentCardDomRegistry();
  });
});
