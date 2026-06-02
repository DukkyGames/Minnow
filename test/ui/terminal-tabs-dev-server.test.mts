/**
 * Dev server terminal tab: fixed tab order and tab-id helpers.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { resetTerminalMetaCache } from '../../src/config/terminal-meta.ts';
import {
  AGENT_TAB_ID,
  DEV_SERVER_TAB_ID,
  detachAllTerminalTabs,
  initTerminalTabs,
  isDevServerTabId,
} from '../../src/ui/terminal-tabs.ts';

const PTY_TAB_ID = '11111111-1111-1111-1111-111111111111';

let prevFetch: typeof fetch | undefined;

/** Stub config + shell-profile fetches for initTerminalTabs. */
function installFetchMock(): void {
  prevFetch = globalThis.fetch;
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
        ],
        ptyAvailable: true,
      });
    }

    if (url.includes('/api/config/meta') && method === 'GET') {
      return Response.json({
        terminal: {
          open: false,
          heightPx: 240,
          tabs: [
            {
              id: PTY_TAB_ID,
              shellProfileId: 'powershell',
              title: 'PowerShell',
              order: 0,
            },
          ],
          activeTabId: AGENT_TAB_ID,
          defaultShellProfileId: 'powershell',
        },
      });
    }

    if (url.includes('/api/config/meta') && method === 'PUT') {
      return Response.json({ ok: true });
    }

    return new Response('not found', { status: 404 });
  };
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

  document.body.innerHTML = `
    <div id="terminalTabBar"></div>
    <select id="terminalShellSelect"></select>
  `;
}

describe('terminal-tabs dev server', () => {
  beforeEach(() => {
    resetTerminalMetaCache();
    installFetchMock();
    setupDom();
  });

  afterEach(async () => {
    await detachAllTerminalTabs();
    resetTerminalMetaCache();
    restoreFetchMock();
  });

  test('isDevServerTabId matches DEV_SERVER_TAB_ID', () => {
    assert.equal(isDevServerTabId(DEV_SERVER_TAB_ID), true);
    assert.equal(isDevServerTabId(AGENT_TAB_ID), false);
    assert.equal(isDevServerTabId(PTY_TAB_ID), false);
    assert.equal(isDevServerTabId(''), false);
  });

  test('renderTabBar lists Agent before Dev server', async () => {
    const tabBar = document.getElementById('terminalTabBar')!;
    const shellSelect = document.getElementById(
      'terminalShellSelect',
    ) as HTMLSelectElement;

    await initTerminalTabs(tabBar, shellSelect);

    const tabs = tabBar.querySelectorAll('.terminal-tab-list [role="tab"]');
    assert.ok(tabs.length >= 2, 'expected fixed Agent + Dev server tabs');

    const agentTab = tabs[0] as HTMLButtonElement;
    const devServerTab = tabs[1] as HTMLButtonElement;

    assert.equal(agentTab.dataset.tabId, AGENT_TAB_ID);
    assert.equal(agentTab.textContent, 'Agent');
    assert.equal(devServerTab.dataset.tabId, DEV_SERVER_TAB_ID);
    assert.equal(devServerTab.textContent, 'Dev server');
  });
});
