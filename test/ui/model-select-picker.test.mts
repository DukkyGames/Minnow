/**
 * Model combobox menu: load-state dots per row (feature 12–13 / custom picker).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const modelSelectCss = readFileSync(join(root, 'src/styles/model-select.css'), 'utf8');
const topbarCss = readFileSync(join(root, 'src/styles/topbar.css'), 'utf8');

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
      assert.equal(triggerText?.getAttribute('title'), 'a/model-a — loaded');

      const firstRow = items?.[0] as HTMLElement | undefined;
      const secondRow = items?.[1] as HTMLElement | undefined;
      assert.equal(firstRow?.getAttribute('title'), 'a/model-a — loaded');
      assert.equal(secondRow?.getAttribute('title'), 'b/model-b — not loaded');
      assert.equal(
        firstRow?.querySelector('.model-select-option-label')?.getAttribute('title'),
        'a/model-a — loaded',
      );
    } finally {
      (globalThis as { document: Document }).document = prevDocument;
      (globalThis as { window: Window }).window = prevWindow;
    }
  });

  test('renders capability badges when model cache has capabilities', async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const doc = win.document;
    doc.body.innerHTML = `
      <div class="model-select-inner">
        <select id="modelSelect" class="model-select-native">
          <option value="vision/model">Vision Model</option>
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
      modelCache.set('vision/model', {
        id: 'vision/model',
        type: 'vlm',
        state: 'loaded',
        capabilities: {
          vision: true,
          tools: true,
          streaming: true,
          grammar: null,
          reasoning: null,
          contextLength: 32768,
          loadState: 'loaded',
        },
      });

      syncModelSelectPicker();
      const badges = doc.querySelectorAll('.model-cap-badge');
      assert.ok(badges.length >= 2);
      const texts = [...badges].map((el) => el.textContent);
      assert.ok(texts.includes('Tools'));
      assert.ok(texts.includes('Vision'));
    } finally {
      (globalThis as { document: Document }).document = prevDocument;
      (globalThis as { window: Window }).window = prevWindow;
    }
  });

  test('falls back to canonical model id for tooltips when option title is missing', async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const doc = win.document;
    doc.body.innerHTML = `
      <div class="model-select-inner">
        <select id="modelSelect" class="model-select-native">
          <option value="vendor/long-model-id">Short label</option>
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
      const { syncModelSelectPicker } = await import('../../src/ui/model-select-picker.ts');
      const sel = doc.getElementById('modelSelect') as HTMLSelectElement;
      sel.value = 'vendor/long-model-id';
      syncModelSelectPicker();

      const row = doc.querySelector('.model-select-option') as HTMLElement | null;
      const triggerText = doc.getElementById('modelSelectTriggerText');
      assert.equal(row?.getAttribute('title'), 'vendor/long-model-id');
      assert.equal(triggerText?.getAttribute('title'), 'vendor/long-model-id');
    } finally {
      (globalThis as { document: Document }).document = prevDocument;
      (globalThis as { window: Window }).window = prevWindow;
    }
  });

  test('menu rows keep full optionText for long labels (BUG-017)', async () => {
    const longLabel =
      'Qwen3.6 35B A3b · Q4_K_M · extended context variant name';
    const { Window } = await import('happy-dom');
    const win = new Window();
    const doc = win.document;
    doc.body.innerHTML = `
      <div class="model-select-inner">
        <select id="modelSelect" class="model-select-native">
          <option value="qwen/qwen3.6-35b-a3b" title="qwen/qwen3.6-35b-a3b — loaded">${longLabel}</option>
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
      const { syncModelSelectPicker } = await import('../../src/ui/model-select-picker.ts');
      const sel = doc.getElementById('modelSelect') as HTMLSelectElement;
      sel.value = 'qwen/qwen3.6-35b-a3b';
      syncModelSelectPicker();

      const menuLabel = doc.querySelector('.model-select-option-label');
      assert.equal(menuLabel?.textContent, longLabel);
      assert.doesNotMatch(menuLabel?.textContent ?? '', /…/);

      const triggerText = doc.getElementById('modelSelectTriggerText');
      assert.equal(triggerText?.textContent, longLabel);
      assert.equal(triggerText?.getAttribute('title'), 'qwen/qwen3.6-35b-a3b — loaded');
    } finally {
      (globalThis as { document: Document }).document = prevDocument;
      (globalThis as { window: Window }).window = prevWindow;
    }
  });
});

describe('model picker truncation CSS (BUG-017)', () => {
  test('menu option labels avoid ellipsis clipping', () => {
    const block = modelSelectCss.match(/\.model-select-option-label\s*\{[^}]+\}/s);
    assert.ok(block, 'expected .model-select-option-label rule');
    assert.doesNotMatch(block[0], /text-overflow:\s*ellipsis/);
    assert.match(block[0], /overflow:\s*visible/);
  });

  test('menu can grow to max-content with a viewport cap', () => {
    const block = modelSelectCss.match(/\.model-select-menu\s*\{[^}]+\}/s);
    assert.ok(block, 'expected .model-select-menu rule');
    assert.match(block[0], /width:\s*max-content/);
    assert.match(block[0], /max-width:\s*min\(90vw,\s*32rem\)/);
  });

  test('closed trigger keeps ellipsis; model-wrap width increased', () => {
    const triggerBlock = modelSelectCss.match(/\.model-select-trigger-text\s*\{[^}]+\}/s);
    assert.ok(triggerBlock, 'expected .model-select-trigger-text rule');
    assert.match(triggerBlock[0], /text-overflow:\s*ellipsis/);

    const wrapBlock = topbarCss.match(/\.model-wrap\s*\{[^}]+\}/s);
    assert.ok(wrapBlock, 'expected .model-wrap rule');
    assert.match(wrapBlock[0], /max-width:\s*420px/);
  });
});
