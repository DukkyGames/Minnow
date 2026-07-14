/**
 * Settings → Servers llama.cpp row — router policy + runtime controls.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { ManagedServerSummary } from '../../src/servers/client.ts';

const MOCK_SERVERS: ManagedServerSummary[] = [
  {
    id: 'llama-cpp',
    label: 'llama.cpp',
    description: 'Local GGUF inference runtime (llama-server).',
    kind: 'native-binary',
    healthPath: '/health',
    enabled: true,
    autoStart: false,
    port: 8085,
    defaultPort: 8085,
    installed: true,
    version: 'b9628',
    running: false,
    phase: 'stopped',
    job: null,
  },
];

describe('settings servers section llama-cpp', () => {
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
      if (url === '/api/models/llama-runtime') {
        return {
          ok: true,
          json: async () => ({
            path: '/tmp/llama-server',
            source: 'managed',
            variant: 'cpu',
            version: 'b9628',
            latestTag: 'b9999',
            updateAvailable: true,
            canRollback: false,
            previousVersion: null,
            pinnedTag: 'b9628',
            assetNames: [],
            installedAt: '2026-01-01T00:00:00.000Z',
            installable: true,
            gpuCapable: false,
            preferredVariant: 'cpu',
            installableVariants: ['cpu'],
          }),
        } as Response;
      }
      if (url === '/api/models/router') {
        return {
          ok: true,
          json: async () => ({
            router: {
              status: 'stopped',
              port: 8085,
              baseUrl: 'http://127.0.0.1:8085',
              runId: null,
              pid: null,
              startedAt: null,
              modelsMax: 2,
              routerSupported: true,
              error: null,
            },
            loadedModels: { data: [] },
          }),
        } as Response;
      }
      if (url === '/api/models/llama-cpp-config') {
        return {
          ok: true,
          json: async () => ({
            router: { modelsMax: 2, lifecycle: 'on-demand' },
          }),
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

  test('renderServersSettingsSection shows llama-cpp router policy controls', async () => {
    const mount = document.getElementById('settingsServersBody');
    assert.ok(mount);

    const { renderServersSettingsSection } = await import(
      '../../src/ui/settings-servers-section.ts'
    );
    await renderServersSettingsSection(mount);

    await new Promise((r) => setTimeout(r, 50));

    const row = document.querySelector<HTMLElement>('[data-server-id="llama-cpp"]');
    assert.ok(row);
    assert.match(row.textContent ?? '', /llama\.cpp/);
    assert.match(row.textContent ?? '', /Model slots/);
    assert.match(row.textContent ?? '', /Lifecycle/);

    const updateBtn = row.querySelector<HTMLButtonElement>('[data-llama-update="llama-cpp"]');
    assert.ok(updateBtn);
    assert.equal(updateBtn.classList.contains('hidden'), false);

    const modelsMax = row.querySelector<HTMLInputElement>('[data-llama-models-max="llama-cpp"]');
    assert.ok(modelsMax);
    assert.equal(modelsMax.value, '2');
  });
});
