import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { ManagedServerSummary } from '../../src/servers/client.ts';

const MOCK_SERVERS: ManagedServerSummary[] = [
  {
    id: 'searxng',
    label: 'SearXNG',
    description: 'Local privacy-focused metasearch for Deep Research and web search.',
    kind: 'python-venv',
    healthPath: '/healthz',
    enabled: true,
    autoStart: true,
    port: 8899,
    defaultPort: 8899,
    installed: true,
    version: 'e964708c0',
    running: true,
    phase: 'running',
    job: null,
  },
];

describe('settings servers section', () => {
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;

    document.body.innerHTML = `<div id="settingsServersBody" class="settings-section-body"></div>`;

    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/servers') {
        return {
          ok: true,
          json: async () => ({ servers: MOCK_SERVERS }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const { setLocalServerAvailable } = await import('../../src/tools/config.ts');
    setLocalServerAvailable(true);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.innerHTML = '';
  });

  test('renderServersSettingsSection lists SearXNG row and running status', async () => {
    const mount = document.getElementById('settingsServersBody');
    assert.ok(mount);

    const { renderServersSettingsSection } = await import(
      '../../src/ui/settings-servers-section.ts'
    );
    await renderServersSettingsSection(mount);

    const list = document.getElementById('settingsManagedServerList');
    assert.ok(list);
    const row = list.querySelector<HTMLElement>('[data-server-id="searxng"]');
    assert.ok(row);
    assert.match(row.textContent ?? '', /SearXNG/);
    assert.match(row.textContent ?? '', /Running on http:\/\/127\.0\.0\.1:8899/);

    const stopBtn = row.querySelector<HTMLButtonElement>('[data-server-stop="searxng"]');
    assert.ok(stopBtn);
    assert.equal(
      row.querySelector('[data-server-install="searxng"]'),
      null,
    );
  });
});
