import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { LibraryModel } from '../../src/models/library.ts';

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
    capabilities: [],
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

describe('models inspector footer', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.localStorage = window.localStorage;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    };

    document.body.innerHTML = `
      <main id="modelsView" class="models-page is-workbench">
        <aside id="modelsInspector"></aside>
      </main>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('shows Load model for a servable GGUF row', async () => {
    const { initInspector, showModelInInspector } = await import('../../src/ui/models/inspector.ts');
    const { getModelsState } = await import('../../src/ui/models/store.ts');

    const model = ggufModel();
    getModelsState().library = [model];
    initInspector();
    showModelInInspector(model.id, 'load');

    const btn = document.querySelector<HTMLButtonElement>(
      '.models-inspector__footer .models-btn--primary',
    );
    assert.ok(btn, 'footer should include a primary Load button');
    assert.equal(btn?.textContent, 'Load model');
  });

  test('shows Eject when the model is already running', async () => {
    const { initInspector, showModelInInspector } = await import('../../src/ui/models/inspector.ts');
    const { getModelsState } = await import('../../src/ui/models/store.ts');

    const model = ggufModel();
    getModelsState().library = [model];
    getModelsState().serves = [
      {
        id: 'serve-1',
        modelPath: model.path!,
        modelLabel: model.name,
        providerId: 'llama-cpp-local',
        baseUrl: 'http://127.0.0.1:8081/v1',
        status: 'running',
        runtime: 'llama-cpp',
      },
    ];
    initInspector();
    showModelInInspector(model.id, 'load');

    const eject = document.querySelector<HTMLButtonElement>(
      '.models-inspector__footer .models-btn--danger',
    );
    assert.ok(eject);
    assert.equal(eject?.textContent, 'Eject');
    assert.equal(
      document.querySelector('.models-inspector__footer .models-btn--primary'),
      null,
    );
  });
});
