/**
 * Load/Unload button spinner while a model action is in flight.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('model load/unload button UI', () => {
  test('renders spinner markup while busy', async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const doc = win.document;
    doc.body.innerHTML = `<button id="btn" class="model-action-btn" type="button">Load</button>`;

    const {
      beginModelLoadUnload,
      endModelLoadUnload,
      getModelLoadUnloadPhase,
      isModelLoadUnloadBusy,
      setModelLoadUnloadButtonBusy,
      setModelLoadUnloadButtonIdle,
    } = await import('../../src/ui/model-load-unload-button.ts');

    const btn = doc.getElementById('btn') as HTMLButtonElement;

    const prevDocument = globalThis.document;
    const prevWindow = globalThis.window;
    (globalThis as { document: Document }).document = doc as unknown as Document;
    (globalThis as { window: Window }).window = win as unknown as Window & typeof globalThis.window;

    try {
      beginModelLoadUnload('load');
      assert.equal(isModelLoadUnloadBusy(), true);
      setModelLoadUnloadButtonBusy(btn, getModelLoadUnloadPhase());
      assert.equal(btn.classList.contains('is-busy'), true);
      assert.ok(btn.querySelector('.model-load-unload-spinner'));
      assert.match(btn.textContent ?? '', /Loading/);

      endModelLoadUnload();
      setModelLoadUnloadButtonIdle(btn, false, true);
      assert.equal(btn.classList.contains('is-busy'), false);
      assert.equal(btn.textContent, 'Load');
    } finally {
      (globalThis as { document: Document }).document = prevDocument;
      (globalThis as { window: Window }).window = prevWindow;
    }
  });
});
