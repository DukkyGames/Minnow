/**
 * Model combobox menu: load-state dots per row (feature 12–13 / custom picker).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('syncModelSelectPicker', () => {
  test('renders load dots in menu from model cache', async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const doc = win.document;
    doc.body.innerHTML = `
      <div class="model-select-inner">
        <span class="model-state-dot model-load-dot" id="modelStateDot"></span>
        <select id="modelSelect" class="model-select-native">
          <option value="a/model-a" title="a/model-a — loaded">Model A · Q4</option>
          <option value="b/model-b" title="b/model-b — not loaded">Model B</option>
        </select>
        <button type="button" id="modelSelectTrigger"><span id="modelSelectTriggerText"></span></button>
        <ul id="modelSelectMenu" class="model-select-menu hidden" role="listbox"></ul>
      </div>
    `;

    const prevDocument = globalThis.document;
    const prevWindow = globalThis.window;
    (globalThis as { document: Document }).document = doc as unknown as Document;
    (globalThis as { window: Window }).window = win as unknown as Window & typeof globalThis.window;

    try {
      const { modelCache } = await import('../../src/app-state.ts');
      const { syncModelSelectPicker } = await import('../../src/ui/model-select-picker.ts');

      modelCache.clear();
      modelCache.set('a/model-a', { id: 'a/model-a', state: 'loaded' });
      modelCache.set('b/model-b', { id: 'b/model-b', state: 'not loaded' });

      const sel = doc.getElementById('modelSelect') as HTMLSelectElement;
      sel.value = 'a/model-a';

      syncModelSelectPicker();

      const menu = doc.getElementById('modelSelectMenu');
      const items = menu?.querySelectorAll('.model-select-option');
      assert.equal(items?.length, 2);

      const loadedDot = items?.[0]?.querySelector('.model-load-dot') as HTMLElement;
      const unloadedDot = items?.[1]?.querySelector('.model-load-dot') as HTMLElement;
      assert.equal(loadedDot?.dataset.loadState, 'loaded');
      assert.equal(unloadedDot?.dataset.loadState, 'unloaded');

      const triggerText = doc.getElementById('modelSelectTriggerText');
      assert.equal(triggerText?.textContent, 'Model A · Q4');
    } finally {
      (globalThis as { document: Document }).document = prevDocument;
      (globalThis as { window: Window }).window = prevWindow;
    }
  });
});
