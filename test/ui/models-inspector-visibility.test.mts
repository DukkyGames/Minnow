import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

describe('models inspector visibility', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.localStorage = window.localStorage;

    document.body.innerHTML = `
      <main id="modelsView" class="models-page is-inspector-hidden">
        <button id="btnModelsInspector" type="button" aria-expanded="false"></button>
      </main>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('setModelsInspectorOpen reveals the panel and persists preference', async () => {
    const { isModelsInspectorOpen, setModelsInspectorOpen } = await import(
      '../../src/ui/models/inspector-visibility.ts'
    );

    assert.equal(isModelsInspectorOpen(), false);
    setModelsInspectorOpen(true);
    assert.equal(isModelsInspectorOpen(), true);
    assert.equal(document.getElementById('btnModelsInspector')?.getAttribute('aria-expanded'), 'true');
    assert.equal(localStorage.getItem('minnow.models.inspector'), '1');
  });
});

describe('showInspectorTab', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.localStorage = window.localStorage;

    document.body.innerHTML = `
      <main id="modelsView" class="models-page is-inspector-hidden is-workbench">
        <button id="btnModelsInspector" type="button" aria-expanded="false"></button>
        <aside id="modelsInspector"></aside>
      </main>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('opens hidden inspector when switching to load tab', async () => {
    const { isModelsInspectorOpen } = await import('../../src/ui/models/inspector-visibility.ts');
    const { showInspectorTab } = await import('../../src/ui/models/inspector.ts');

    showInspectorTab('load');
    assert.equal(isModelsInspectorOpen(), true);
  });
});
