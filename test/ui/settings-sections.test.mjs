import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

describe('settings-sections', () => {
  test('exports refreshSettingsSection for settings page wiring', async () => {
    const mod = await import('../../src/ui/settings-sections.ts');
    assert.equal(typeof mod.refreshSettingsSection, 'function');
  });

  test("refreshSettingsSection('servers') renders managed server list", async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;

    document.body.innerHTML = `
      <div id="settingsServersBody" class="settings-section-body"></div>
    `;

    const mockServers = [
      {
        id: 'searxng',
        label: 'SearXNG',
        description: 'Local metasearch',
        kind: 'python-venv',
        healthPath: '/healthz',
        enabled: false,
        autoStart: true,
        port: 8899,
        defaultPort: 8899,
        installed: true,
        version: 'e964708c0',
        running: false,
        phase: 'stopped',
        job: null,
      },
    ];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === '/api/servers') {
        return {
          ok: true,
          json: async () => ({ servers: mockServers }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const { setLocalServerAvailable } = await import('../../src/tools/config.ts');
    setLocalServerAvailable(true);

    const { refreshSettingsSection } = await import('../../src/ui/settings-sections.ts');
    await refreshSettingsSection('servers');

    const list = document.getElementById('settingsManagedServerList');
    assert.ok(list);
    const row = list.querySelector('[data-server-id="searxng"]');
    assert.ok(row);
    assert.match(row.textContent ?? '', /SearXNG/);

    globalThis.fetch = originalFetch;
    document.body.innerHTML = '';
  });
});
