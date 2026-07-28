/**
 * Host filter bar resolves load/unload against per-chat model in composer menus.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createEmptyChatObject,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';

describe('model host filter load/unload context', () => {
  test('composer resolver uses active chat model, not global default', async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const doc = win.document;
    doc.body.innerHTML = `
      <select id="modelSelect">
        <option value="cloud/opencode">OpenCode Go</option>
        <option value="lmstudio/qwen">Qwen 2.5 7B — LM Studio</option>
      </select>
      <div id="panel"></div>
    `;

    const prevDocument = globalThis.document;
    const prevWindow = globalThis.window;
    (globalThis as { document: Document }).document = doc as unknown as Document;
    (globalThis as { window: Window }).window = win as unknown as Window & typeof globalThis.window;

    const chat = createEmptyChatObject('lmstudio/qwen');
    chat.providerId = 'lmstudio';
    chat.modelId = 'qwen';
    setSessionStateForTests({ chats: [chat], activeId: chat.id });

    try {
      const sel = doc.getElementById('modelSelect') as HTMLSelectElement;
      sel.value = 'cloud/opencode';

      const { resolveModelSelectValueForChat } = await import(
        '../../src/lib/model-select-key.ts'
      );
      const { mountModelHostFilterBar } = await import(
        '../../src/ui/model-select-picker.ts'
      );
      const { resolveModelHostFilterLoadUnloadValue } = await import(
        '../../src/ui/model-host-filter-context.ts'
      );
      const { syncModelLoadUnloadIconButtonElement } = await import(
        '../../src/api/models.ts'
      );
      const { setStorageModeForTests } = await import(
        '../../src/config/storage-mode.ts'
      );

      setStorageModeForTests('server');

      const panel = doc.getElementById('panel')!;
      mountModelHostFilterBar(panel, {
        onFilterChange: () => {},
        resolveLoadUnloadValue: () =>
          resolveModelSelectValueForChat(chat, [...sel.options].map((o) => o.value)),
      });

      const bar = panel.querySelector('.model-select-host-filter') as HTMLDivElement;
      const loadBtn = panel.querySelector(
        '.model-host-filter-action--load-unload',
      ) as HTMLButtonElement;
      assert.ok(loadBtn);

      const resolved = resolveModelHostFilterLoadUnloadValue(bar);
      assert.equal(resolved, 'lmstudio/qwen');

      sel.options[1].setAttribute('data-supports-load-unload', '1');
      syncModelLoadUnloadIconButtonElement(loadBtn);
      assert.equal(loadBtn.hidden, false);
    } finally {
      setSessionStateForTests(null);
      (globalThis as { document: Document }).document = prevDocument;
      (globalThis as { window: Window }).window = prevWindow;
    }
  });
});
