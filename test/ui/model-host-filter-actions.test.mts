/**
 * Model host filter bar: refresh + load/unload icon actions, search, local load filter.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('model host filter actions', () => {
  test('mountModelHostFilterBar renders filter segments and action icons', async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const doc = win.document;
    doc.body.innerHTML = `
      <select id="modelSelect">
        <option value="lmstudio::qwen/qwen2.5-7b" data-supports-load-unload="1">Qwen 2.5 7B</option>
      </select>
      <div id="host"></div>
    `;

    const prevDocument = globalThis.document;
    const prevWindow = globalThis.window;
    (globalThis as { document: Document }).document = doc as unknown as Document;
    (globalThis as { window: Window }).window = win as unknown as Window & typeof globalThis.window;

    try {
      const { mountModelHostFilterBar } = await import('../../src/ui/model-select-picker.ts');
      const host = doc.getElementById('host') as HTMLDivElement;

      mountModelHostFilterBar(host, { onFilterChange: () => {} }, 'test-filter');

      const segments = host.querySelectorAll('.model-host-filter-segment');
      assert.equal(segments.length, 3);

      const search = host.querySelector('.model-host-filter-search');
      assert.ok(search);
      assert.equal(search?.getAttribute('aria-label'), 'Search models');

      const libraryToggle = host.querySelector('.model-host-filter-library-toggle');
      assert.ok(libraryToggle);
      assert.equal(libraryToggle?.getAttribute('aria-label'), 'My Models only');
      assert.ok(libraryToggle?.querySelector('.minnow-glyph'));

      const loadedToggle = host.querySelector('.model-host-filter-loaded-toggle');
      assert.ok(loadedToggle);
      assert.ok(loadedToggle?.hasAttribute('hidden'));

      const refreshBtn = host.querySelector('.model-host-filter-action--refresh');
      const loadUnloadBtn = host.querySelector('.model-host-filter-action--load-unload');
      assert.ok(refreshBtn);
      assert.ok(loadUnloadBtn);
      assert.ok(refreshBtn?.querySelector('.icon-svg'));
      assert.ok(loadUnloadBtn?.querySelector('.icon-svg'));
    } finally {
      (globalThis as { document: Document }).document = prevDocument;
      (globalThis as { window: Window }).window = prevWindow;
    }
  });

  test('renderModelSelectMenuRows filters by search and local load state', async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const doc = win.document;
    doc.body.innerHTML = `
      <select id="modelSelect">
        <option value="lmstudio::qwen/qwen2.5-7b" data-provider-host="local">Qwen 2.5 7B</option>
        <option value="lmstudio::llama/llama-3-8b" data-provider-host="local">Llama 3 8B</option>
        <option value="openai::gpt-4o" data-provider-host="cloud">GPT-4o</option>
      </select>
      <ul id="menu" class="model-select-menu"></ul>
    `;

    const prevDocument = globalThis.document;
    const prevWindow = globalThis.window;
    (globalThis as { document: Document }).document = doc as unknown as Document;
    (globalThis as { window: Window }).window = win as unknown as Window & typeof globalThis.window;

    try {
      const { modelCache } = await import('../../src/app-state.ts');
      const {
        renderModelSelectMenuRows,
        setModelHostFilter,
        setModelLocalLoadFilter,
        setModelLibraryFilter,
        setModelSearchQuery,
        clearModelSearchQuery,
      } = await import('../../src/ui/model-select-picker.ts');

      modelCache.clear();
      modelCache.set('lmstudio::qwen/qwen2.5-7b', { id: 'qwen/qwen2.5-7b', state: 'loaded' });
      modelCache.set('lmstudio::llama/llama-3-8b', { id: 'llama/llama-3-8b', state: 'unloaded' });

      const sel = doc.getElementById('modelSelect') as HTMLSelectElement;
      const menu = doc.getElementById('menu') as HTMLUListElement;

      setModelHostFilter('all');
      setModelLocalLoadFilter('all');
      setModelLibraryFilter('all');
      clearModelSearchQuery();
      renderModelSelectMenuRows(menu, sel);
      assert.equal(menu.querySelectorAll('.model-select-option').length, 3);

      setModelSearchQuery('llama');
      renderModelSelectMenuRows(menu, sel);
      assert.equal(menu.querySelectorAll('.model-select-option').length, 1);
      assert.equal(
        menu.querySelector('.model-select-option-label')?.textContent,
        'Llama 3 8B',
      );

      setModelSearchQuery('');
      setModelHostFilter('local');
      setModelLocalLoadFilter('loaded');
      renderModelSelectMenuRows(menu, sel);
      assert.equal(menu.querySelectorAll('.model-select-option').length, 1);
      assert.equal(
        menu.querySelector('.model-select-option-label')?.textContent,
        'Qwen 2.5 7B',
      );

      setModelLocalLoadFilter('all');
      renderModelSelectMenuRows(menu, sel);
      assert.equal(menu.querySelectorAll('.model-select-option').length, 2);

      doc.getElementById('modelSelect')!.insertAdjacentHTML(
        'beforeend',
        '<option value="minnow-library::gguf:abc" data-provider-id="minnow-library" data-provider-host="local">Local GGUF</option>',
      );
      setModelLibraryFilter('library');
      renderModelSelectMenuRows(menu, sel);
      assert.equal(menu.querySelectorAll('.model-select-option').length, 1);
      assert.equal(
        menu.querySelector('.model-select-option-label')?.textContent,
        'Local GGUF',
      );

      clearModelSearchQuery();
      setModelHostFilter('all');
      setModelLocalLoadFilter('all');
      setModelLibraryFilter('all');
    } finally {
      (globalThis as { document: Document }).document = prevDocument;
      (globalThis as { window: Window }).window = prevWindow;
    }
  });

  test('syncModelLoadUnloadIconButtonElement toggles load vs unload icon', async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const doc = win.document;
    doc.body.innerHTML = `
      <select id="modelSelect">
        <option value="lmstudio::qwen/qwen2.5-7b" data-supports-load-unload="1" selected>Qwen</option>
      </select>
      <button type="button" class="model-host-filter-action--load-unload"></button>
    `;

    const prevDocument = globalThis.document;
    const prevWindow = globalThis.window;
    (globalThis as { document: Document }).document = doc as unknown as Document;
    (globalThis as { window: Window }).window = win as unknown as Window & typeof globalThis.window;

    try {
      const { syncModelLoadUnloadIconButtonElement } = await import('../../src/api/models.ts');
      const btn = doc.querySelector('.model-host-filter-action--load-unload') as HTMLButtonElement;

      syncModelLoadUnloadIconButtonElement(btn);
      assert.equal(btn.getAttribute('aria-label'), 'Load model');
      assert.ok(btn.querySelector('.icon-svg.fi-rr-download'));
    } finally {
      (globalThis as { document: Document }).document = prevDocument;
      (globalThis as { window: Window }).window = prevWindow;
    }
  });
});
