/**
 * Load/Unload button spinner while a model action is in flight.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('model load/unload button UI', () => {
  test('keeps spinner visible when fetchModels clears the select', async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const doc = win.document;
    doc.body.innerHTML = `
      <button id="btnModelLoadUnload" class="model-action-btn" type="button">Load</button>
      <select id="modelSelect">
        <option value="lm-studio-local\u001fqwen3" data-supports-load-unload="1">Qwen3</option>
      </select>
    `;

    const prevDocument = globalThis.document;
    const prevWindow = globalThis.window;
    (globalThis as { document: Document }).document = doc as unknown as Document;
    (globalThis as { window: Window }).window = win as unknown as Window & typeof globalThis.window;

    try {
      const { beginModelLoadUnload, endModelLoadUnload } = await import(
        '../../src/ui/model-load-unload-button.ts'
      );
      const { syncModelLoadUnloadButtonElement } = await import('../../src/api/models.ts');

      const btn = doc.getElementById('btnModelLoadUnload') as HTMLButtonElement;
      const sel = doc.getElementById('modelSelect') as HTMLSelectElement;
      sel.value = 'lm-studio-local\u001fqwen3';

      beginModelLoadUnload('load');
      syncModelLoadUnloadButtonElement(btn);
      assert.equal(btn.classList.contains('is-busy'), true);
      assert.ok(btn.querySelector('.model-load-unload-spinner'));

      // fetchModels() temporarily replaces options while refresh runs.
      sel.innerHTML = '<option value="">Loading models…</option>';
      syncModelLoadUnloadButtonElement(btn);
      assert.equal(btn.hidden, false);
      assert.equal(btn.classList.contains('is-busy'), true);
      assert.ok(btn.querySelector('.model-load-unload-spinner'));
      assert.match(btn.textContent ?? '', /Loading/);

      endModelLoadUnload();
      syncModelLoadUnloadButtonElement(btn);
      assert.equal(btn.classList.contains('is-busy'), false);
      assert.equal(btn.textContent, 'Load');
    } finally {
      (globalThis as { document: Document }).document = prevDocument;
      (globalThis as { window: Window }).window = prevWindow;
    }
  });
});
