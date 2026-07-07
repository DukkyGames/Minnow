/**
 * MIN-244: Changing the shell dropdown spawns a new PTY tab and saves the default.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { resetTerminalMetaCache } from '../../src/config/terminal-meta.ts';
import {
  AGENT_TAB_ID,
  detachAllTerminalTabs,
  initTerminalTabs,
} from '../../src/ui/terminal-tabs.ts';
import { setLocalServerAvailableForTests } from '../../src/tools/config.ts';

const PTY_TAB_ID = '11111111-1111-1111-1111-111111111111';
const NEW_SESSION_ID = '22222222-2222-2222-2222-222222222222';

let prevFetch: typeof fetch | undefined;
let putBodies: unknown[] = [];

/** Stub config, shell profiles, and PTY session creation. */
function installFetchMock(): void {
  prevFetch = globalThis.fetch;
  putBodies = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (url.includes('/api/terminal/shell-profiles')) {
      return Response.json({
        profiles: [
          {
            id: 'powershell',
            label: 'PowerShell',
            shell: 'powershell.exe',
            args: [],
            platform: 'win32',
          },
          {
            id: 'bash',
            label: 'bash',
            shell: '/bin/bash',
            args: [],
            platform: 'linux',
          },
        ],
        ptyAvailable: true,
      });
    }

    if (url.includes('/api/terminal/session') && method === 'POST') {
      return Response.json({
        sessionId: NEW_SESSION_ID,
        shell: '/bin/bash',
        shellProfileId: 'bash',
        cwd: '/workspace',
        cols: 80,
        rows: 24,
      });
    }

    if (url.includes('/api/config/meta') && method === 'GET') {
      return Response.json({
        terminal: {
          open: true,
          heightPx: 240,
          tabs: [
            {
              id: PTY_TAB_ID,
              shellProfileId: 'powershell',
              title: 'PowerShell',
              order: 0,
            },
          ],
          activeTabId: PTY_TAB_ID,
          defaultShellProfileId: 'powershell',
        },
      });
    }

    if (url.includes('/api/config/meta') && method === 'PUT') {
      putBodies.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true });
    }

    return new Response('not found', { status: 404 });
  };
}

function installWebSocketMock(): void {
  class MockWebSocket {
    static OPEN = 1;
    readyState = MockWebSocket.OPEN;
    url: string;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      queueMicrotask(() => this.onopen?.());
    }

    close(): void {
      this.readyState = 3;
      this.onclose?.();
    }

    send(): void {}
  }

  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
}

function restoreFetchMock(): void {
  if (prevFetch) {
    globalThis.fetch = prevFetch;
    prevFetch = undefined;
  }
}

function setupDom(): void {
  const window = new Window();
  globalThis.window = window as unknown as Window & typeof globalThis.window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  document.body.innerHTML = `
    <div id="terminalXtermHost"></div>
    <div id="terminalTabBar"></div>
    <select id="terminalShellSelect"></select>
  `;
}

function countPtyTabs(tabBar: HTMLElement): number {
  return tabBar.querySelectorAll(
  '.terminal-tab-list .terminal-tab:not(.terminal-tab--agent):not(.terminal-tab--dev-server)',
  ).length;
}

describe('terminal shell dropdown change (MIN-244)', () => {
  beforeEach(() => {
    resetTerminalMetaCache();
    installFetchMock();
    installWebSocketMock();
    setLocalServerAvailableForTests(true);
    setupDom();
  });

  afterEach(async () => {
    await detachAllTerminalTabs();
    resetTerminalMetaCache();
    setLocalServerAvailableForTests(false);
    restoreFetchMock();
  });

  test('changing shell spawns a new tab, preserves the old tab, and saves default', async () => {
    const tabBar = document.getElementById('terminalTabBar')!;
    const shellSelect = document.getElementById(
      'terminalShellSelect',
    ) as HTMLSelectElement;
    const xtermHost = document.getElementById('terminalXtermHost')!;

    const { initTerminalXterm } = await import('../../src/ui/terminal-xterm.ts');
    initTerminalXterm(xtermHost);

    await initTerminalTabs(tabBar, shellSelect);

    assert.equal(countPtyTabs(tabBar), 1, 'starts with one restored PTY tab');
    const initialTab = tabBar.querySelector(
      `.terminal-tab[data-tab-id="${PTY_TAB_ID}"]`,
    );
    assert.ok(initialTab, 'initial PTY tab is present');

    shellSelect.value = 'bash';
    shellSelect.dispatchEvent(
      new (globalThis.window as Window).Event('change', { bubbles: true }),
    );

    // Allow async save + addTab to complete.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(countPtyTabs(tabBar), 2, 'shell change adds a second PTY tab');
    assert.ok(
      tabBar.querySelector(`.terminal-tab[data-tab-id="${PTY_TAB_ID}"]`),
      'previous PTY tab remains until closed',
    );

    const savedDefault = putBodies.find(
      (body) =>
        typeof body === 'object' &&
        body !== null &&
        'terminal' in body &&
        (body as { terminal: { defaultShellProfileId?: string } }).terminal
          .defaultShellProfileId === 'bash',
    );
    assert.ok(savedDefault, 'default shell profile is persisted');

    const activeTab = tabBar.querySelector(
      '.terminal-tab[aria-selected="true"]',
    ) as HTMLButtonElement | null;
    assert.ok(activeTab, 'a tab is active after shell change');
    assert.notEqual(activeTab?.dataset.tabId, AGENT_TAB_ID);
    assert.notEqual(activeTab?.dataset.tabId, PTY_TAB_ID);
  });
});
