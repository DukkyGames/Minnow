/**
 * Unit tests for top-bar model load state dot (feature 12–13 / Epic A4).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isModelLoaded,
  resolveModelState,
} from '../../src/ui/model-state-dot.ts';
import type { LmModelRecord } from '../../src/types.ts';

describe('isModelLoaded', () => {
  test('returns true only when state is loaded', () => {
    assert.equal(isModelLoaded({ id: 'm1', state: 'loaded' }), true);
    assert.equal(isModelLoaded({ id: 'm2', state: 'not loaded' }), false);
    assert.equal(isModelLoaded({ id: 'm3' }), false);
    assert.equal(isModelLoaded(undefined), false);
  });
});

describe('resolveModelState', () => {
  test('maps record state to loaded, unloaded, or unknown', () => {
    assert.equal(resolveModelState({ id: 'a', state: 'loaded' }), 'loaded');
    assert.equal(resolveModelState({ id: 'b', state: 'not-loaded' }), 'unloaded');
    assert.equal(resolveModelState({ id: 'c' }), 'unloaded');
    assert.equal(resolveModelState(undefined), 'unknown');
    assert.equal(resolveModelState(null), 'unknown');
  });
});

describe('updateModelStateDot DOM wiring', () => {
  test('sets data-model-state and aria-label from cache', async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const doc = win.document;
    doc.body.innerHTML = `
      <div class="model-wrap" data-model-state="unknown">
        <span class="model-state-dot" id="modelStateDot"></span>
        <select id="modelSelect">
          <option value="qwen/qwen3.6-27b">Qwen3.6 27B · Q4_K_M</option>
        </select>
      </div>
    `;

    const prevDocument = globalThis.document;
    const prevWindow = globalThis.window;
    (globalThis as { document: Document }).document = doc as unknown as Document;
    (globalThis as { window: Window }).window = win as unknown as Window & typeof globalThis.window;

    try {
      const { modelCache } = await import('../../src/app-state.ts');
      const { updateModelStateDot } = await import('../../src/ui/model-state-dot.ts');

      modelCache.clear();
      modelCache.set('qwen/qwen3.6-27b', {
        id: 'qwen/qwen3.6-27b',
        state: 'loaded',
      } as LmModelRecord);

      const sel = doc.getElementById('modelSelect') as HTMLSelectElement;
      sel.value = 'qwen/qwen3.6-27b';
      updateModelStateDot();

      const wrap = doc.querySelector('.model-wrap') as HTMLElement;
      assert.equal(wrap.dataset.modelState, 'loaded');
      assert.equal(sel.getAttribute('aria-label'), 'Model: Qwen3.6 27B · Q4_K_M, loaded');

      modelCache.set('qwen/qwen3.6-27b', { id: 'qwen/qwen3.6-27b', state: 'not loaded' });
      updateModelStateDot();
      assert.equal(wrap.dataset.modelState, 'unloaded');
      assert.equal(sel.getAttribute('aria-label'), 'Model: Qwen3.6 27B · Q4_K_M, not loaded');
    } finally {
      (globalThis as { document: Document }).document = prevDocument;
      (globalThis as { window: Window }).window = prevWindow;
    }
  });
});
