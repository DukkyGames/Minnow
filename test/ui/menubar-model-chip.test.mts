/**
 * Menubar default-model chip: hover expand + label sync.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createEmptyChatObject,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';

describe('menubar model chip', () => {
  test('syncComposerModelTriggers splits model and provider on menubar expand', async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const doc = win.document;
    doc.body.innerHTML = `
      <select id="modelSelect">
        <option value="lmstudio\u001fqwen2.5-7b">Qwen 2.5 7B — LM Studio</option>
      </select>
      <div id="osMenubarModelChip"></div>
      <span id="modelSelectTriggerText">Qwen 2.5 7B — LM Studio</span>
    `;

    const prevDocument = globalThis.document;
    const prevWindow = globalThis.window;
    (globalThis as { document: Document }).document = doc as unknown as Document;
    (globalThis as { window: Window }).window = win as unknown as Window & typeof globalThis.window;

    const chat = createEmptyChatObject('lmstudio\u001fqwen2.5-7b');
    setSessionStateForTests({ chats: [chat], activeId: chat.id });

    try {
      const { initMenubarModelChip } = await import('../../src/os/menubar-model-chip.ts');
      const { syncComposerModelTriggers } = await import(
        '../../src/ui/composer-model-trigger.ts'
      );

      const sel = doc.getElementById('modelSelect') as HTMLSelectElement;
      sel.value = 'lmstudio\u001fqwen2.5-7b';

      initMenubarModelChip(doc.getElementById('osMenubarModelChip')!);
      syncComposerModelTriggers();

      const label = doc.querySelector('.mn-os-mb-model-label');
      const provider = doc.querySelector('.mn-os-mb-model-provider');
      assert.equal(label?.textContent, 'Qwen 2.5 7B');
      assert.equal(provider?.textContent, 'LM Studio');
      assert.equal(provider?.hidden, false);

      const chip = doc.querySelector('.mn-os-mb-model-chip') as HTMLElement;
      chip.classList.add('is-expanded');
      const expand = doc.querySelector('.mn-os-mb-model-expand') as HTMLElement;
      assert.ok(expand);
      assert.equal(expand.getAttribute('aria-hidden'), 'true');
    } finally {
      setSessionStateForTests(null);
      (globalThis as { document: Document }).document = prevDocument;
      (globalThis as { window: Window }).window = prevWindow;
    }
  });

  test('pointerenter expands menubar chip label', async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const doc = win.document;
    doc.body.innerHTML = `
      <select id="modelSelect">
        <option value="qwen/qwen2.5-7b">Qwen 2.5 7B</option>
      </select>
      <div id="osMenubarModelChip"></div>
      <span id="modelSelectTriggerText">Qwen 2.5 7B</span>
    `;

    const prevDocument = globalThis.document;
    const prevWindow = globalThis.window;
    (globalThis as { document: Document }).document = doc as unknown as Document;
    (globalThis as { window: Window }).window = win as unknown as Window & typeof globalThis.window;

    const chat = createEmptyChatObject('qwen/qwen2.5-7b');
    setSessionStateForTests({ chats: [chat], activeId: chat.id });

    try {
      const { initMenubarModelChip } = await import('../../src/os/menubar-model-chip.ts');
      initMenubarModelChip(doc.getElementById('osMenubarModelChip')!);

      const chip = doc.querySelector('.mn-os-mb-model-chip') as HTMLElement;
      chip.dispatchEvent(new win.Event('pointerenter', { bubbles: true }));
      assert.ok(chip.classList.contains('is-expanded'));
      const expand = doc.querySelector('.mn-os-mb-model-expand') as HTMLElement;
      assert.ok(expand.classList.contains('is-expanded'));
      assert.equal(expand.getAttribute('aria-hidden'), 'false');
      assert.ok(expand.style.left);
    } finally {
      setSessionStateForTests(null);
      (globalThis as { document: Document }).document = prevDocument;
      (globalThis as { window: Window }).window = prevWindow;
    }
  });
});
