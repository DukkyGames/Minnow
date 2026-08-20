import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { LlamaRuntimeStatus } from '../../src/models/api-client.ts';
import type { ManagedServerSummary } from '../../src/servers/client.ts';

const SEARXNG: ManagedServerSummary = {
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
};

const MLX_UNSUPPORTED: ManagedServerSummary = {
  id: 'mlx-lm',
  label: 'MLX',
  description: 'Metal-native inference for MLX weights on Apple Silicon (mlx-lm).',
  kind: 'python-venv',
  healthPath: '/v1/models',
  enabled: false,
  autoStart: false,
  port: 8087,
  defaultPort: 8087,
  installed: false,
  running: false,
  phase: 'pending',
  job: null,
  supported: false,
  installable: false,
  reason:
    'MLX runs only on Apple Silicon Macs (macOS 13 or later). Use GGUF weights with llama.cpp on this machine.',
};

const LLAMA_CPP: ManagedServerSummary = {
  id: 'llama-cpp',
  label: 'llama.cpp',
  description: 'Local GGUF inference runtime (llama-server).',
  kind: 'native-binary',
  healthPath: '/health',
  enabled: false,
  autoStart: false,
  port: 8085,
  defaultPort: 8085,
  installed: true,
  running: false,
  phase: 'stopped',
  job: null,
};

const UPGRADE_RUNTIME: LlamaRuntimeStatus = {
  path: 'C:\\Users\\dukky\\.minnow\\models-runtime\\llama-cpp\\llama-server.exe',
  source: 'managed',
  variant: 'cpu',
  version: 'b9628',
  pinnedVersion: 'b10448',
  installedVersion: 'b9628',
  upgradeAvailable: true,
  assetNames: [],
  installedAt: '2020-01-01T00:00:00.000Z',
  installable: true,
  gpuCapable: false,
  preferredVariant: 'cpu',
  installableVariants: ['cpu'],
};

describe('settings servers section', () => {
  let originalFetch: typeof fetch;
  /** Catalog payload for GET /api/servers — swapped per test. */
  let mockServers: ManagedServerSummary[] = [SEARXNG];
  let mockLlamaRuntime: LlamaRuntimeStatus = UPGRADE_RUNTIME;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;

    document.body.innerHTML = `<div id="settingsServersBody" class="settings-section-body"></div>`;

    mockServers = [SEARXNG];
    mockLlamaRuntime = UPGRADE_RUNTIME;

    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/servers') {
        return {
          ok: true,
          json: async () => ({ servers: mockServers }),
        } as Response;
      }
      if (url === '/api/models/llama-runtime') {
        return {
          ok: true,
          json: async () => mockLlamaRuntime,
        } as Response;
      }
      if (url === '/api/models/serve') {
        return {
          ok: true,
          json: async () => ({ serves: [] }),
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
    assert.match(row.textContent ?? '', /Running/);
    assert.match(row.textContent ?? '', /http:\/\/127\.0\.0\.1:8899/);

    const stopBtn = row.querySelector<HTMLButtonElement>('[data-server-stop="searxng"]');
    assert.ok(stopBtn);
    assert.equal(
      row.querySelector('[data-server-install="searxng"]'),
      null,
    );
  });

  test('hides MLX Install when installable is false and shows the reason', async () => {
    mockServers = [MLX_UNSUPPORTED];
    const mount = document.getElementById('settingsServersBody');
    assert.ok(mount);

    const { renderServersSettingsSection } = await import(
      '../../src/ui/settings-servers-section.ts'
    );
    await renderServersSettingsSection(mount);

    const row = document.querySelector<HTMLElement>('[data-server-id="mlx-lm"]');
    assert.ok(row);
    assert.equal(row.querySelector('[data-server-install="mlx-lm"]'), null);
    const reason = row.querySelector('[data-server-install-reason="mlx-lm"]');
    assert.ok(reason);
    assert.match(reason.textContent ?? '', /Apple Silicon/);
  });

  test('relabels llama.cpp Reinstall as Upgrade when upgradeAvailable', async () => {
    mockServers = [LLAMA_CPP];
    const mount = document.getElementById('settingsServersBody');
    assert.ok(mount);

    const { renderServersSettingsSection } = await import(
      '../../src/ui/settings-servers-section.ts'
    );
    await renderServersSettingsSection(mount);

    const row = document.querySelector<HTMLElement>('[data-server-id="llama-cpp"]');
    assert.ok(row);
    // refreshRuntime is started without awaiting from createLlamaCppServerRow.
    const deadline = Date.now() + 1000;
    let installBtn = row.querySelector<HTMLButtonElement>('[data-llama-install="llama-cpp"]');
    while (Date.now() < deadline && installBtn?.textContent !== 'Upgrade') {
      await new Promise((r) => setTimeout(r, 10));
      installBtn = row.querySelector<HTMLButtonElement>('[data-llama-install="llama-cpp"]');
    }
    assert.ok(installBtn);
    assert.equal(installBtn.textContent, 'Upgrade');
    const hint = row.querySelector('[data-llama-upgrade-hint="llama-cpp"]');
    assert.ok(hint);
    assert.match(hint.textContent ?? '', /b9628/);
    assert.match(hint.textContent ?? '', /b10448/);
    assert.equal(hint.classList.contains('hidden'), false);
  });
});
