import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { LoadProgress } from '../../src/ui/models/store.ts';

function sampleLoad(overrides: Partial<LoadProgress> = {}): LoadProgress {
  return {
    serveId: 'serve-load-1',
    modelId: 'gguf:acme/model:weights/model-Q4_K_M.gguf',
    percent: null,
    phase: 'Starting runtime',
    phaseKey: 'spawning',
    etaMs: null,
    bytesTotal: 4_000_000_000,
    startedAt: 1_700_000_000_000,
    error: null,
    ...overrides,
  };
}

describe('models local server loading card', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.localStorage = window.localStorage;

    document.body.innerHTML = `
      <section id="modelsSection-server" class="is-active">
        <div id="modelsServerBody"></div>
      </section>
    `;
  });

  afterEach(async () => {
    const { teardownServerSection } = await import('../../src/ui/models/server-panel.ts');
    const { getModelsState } = await import('../../src/ui/models/store.ts');
    teardownServerSection();
    getModelsState().loads.length = 0;
    document.body.innerHTML = '';
  });

  test('progress ticks keep the same spinner node', async () => {
    const { render } = await import('../../src/ui/models/server-panel.ts');
    const { getModelsState } = await import('../../src/ui/models/store.ts');

    getModelsState().loads = [sampleLoad()];
    render();

    const spinner = document.querySelector('.models-spinner');
    assert.ok(spinner, 'loading chip should include a spinner');
    assert.equal(document.querySelector('.models-loaded__state-label')?.textContent, 'Loading');

    getModelsState().loads[0].percent = 42;
    getModelsState().loads[0].phase = 'Loading weights';
    render();

    assert.equal(document.querySelector('.models-spinner'), spinner);
    assert.equal(document.querySelector('.models-loaded__state-label')?.textContent, 'Loading 42%');
    const fill = document.querySelector('.models-progress__fill') as HTMLElement | null;
    assert.ok(fill);
    assert.equal(fill?.classList.contains('is-indeterminate'), false);
    assert.equal(fill?.style.getPropertyValue('--progress'), '0.42');
    assert.match(document.querySelector('.models-loaded__meta')?.textContent ?? '', /Loading weights/);
  });

  test('a failed load rebuilds the card instead of patching', async () => {
    const { render } = await import('../../src/ui/models/server-panel.ts');
    const { getModelsState } = await import('../../src/ui/models/store.ts');

    getModelsState().loads = [sampleLoad({ percent: 12 })];
    render();
    assert.ok(document.querySelector('.models-spinner'));

    getModelsState().loads[0].error = 'Runtime crashed';
    getModelsState().loads[0].percent = 12;
    render();

    assert.equal(document.querySelector('.models-spinner'), null);
    assert.equal(document.querySelector('.models-loaded__state')?.textContent, 'Failed');
  });
});
