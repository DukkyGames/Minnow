import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { LibraryModel } from '../../src/models/library.ts';
import type { HardwareSnapshot } from '../../src/models/types.ts';

function ggufModel(overrides: Partial<LibraryModel> = {}): LibraryModel {
  return {
    id: 'gguf:test/model:weights/model-Q4_K_M.gguf',
    name: 'model-Q4_K_M',
    repoId: 'test/model',
    publisher: 'test',
    producerSlug: 'meta',
    producerName: 'Meta',
    producerLogoId: 'meta',
    format: 'GGUF',
    quant: 'Q4_K_M',
    arch: 'llama',
    domain: 'chat',
    paramsB: 7,
    contextLength: 8192,
    capabilities: ['vision', 'reasoning'],
    sizeBytes: 4_000_000_000,
    path: '/tmp/model-Q4_K_M.gguf',
    fileName: 'model-Q4_K_M.gguf',
    source: 'downloaded',
    servable: true,
    incomplete: false,
    isMoe: false,
    ...overrides,
  };
}

function cudaHardware(): HardwareSnapshot {
  return {
    os: 'Windows',
    platform: 'win32',
    arch: 'x64',
    cpuName: 'test-cpu',
    cpuCores: 8,
    totalRamGb: 64,
    availableRamGb: 31,
    hasGpu: true,
    gpuName: 'Test GPU',
    gpuVramGb: 24,
    gpuCount: 1,
    gpus: [{ index: 0, name: 'Test GPU', vramGb: 24 }],
    gpuGroups: [{ name: 'Test GPU', vramEach: 24, count: 1, indices: [0], vramTotal: 24 }],
    homogeneous: true,
    backend: 'cuda',
    unifiedMemory: false,
    detectedAt: 1_700_000_000_000,
  };
}

describe('models inspector tab layout', () => {
  let fetchMock: typeof fetch;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window({ width: 1440, height: 900 });
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.localStorage = window.localStorage;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    };

    fetchMock = async () =>
      new Response(JSON.stringify({ ok: true, prefs: {}, byLibraryId: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    globalThis.fetch = fetchMock as typeof fetch;

    document.body.innerHTML = `
      <main id="modelsView" class="models-page is-workbench">
        <aside id="modelsInspector" class="models-inspector"></aside>
      </main>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('keeps footer mount and stable tab switching structure', async () => {
    const { initInspector, showModelInInspector } = await import('../../src/ui/models/inspector.ts');
    const { getModelsState } = await import('../../src/ui/models/store.ts');

    const model = ggufModel();
    getModelsState().library = [model];
    getModelsState().hardware = cudaHardware();
    initInspector();

    const host = document.getElementById('modelsInspector')!;
    const tabs = ['info', 'load', 'inference'] as const;

    for (const tab of tabs) {
      showModelInInspector(model.id, tab);
      assert.ok(host.querySelector('.models-inspector__footer'), `${tab} tab keeps footer mount`);
      assert.ok(host.querySelector('.models-inspector__body'), `${tab} tab keeps scroll body`);
      assert.equal(
        host.querySelectorAll('[role="tab"][aria-selected="true"]').length,
        1,
        `${tab} tab exposes one selected tab`,
      );
    }
  });
});
