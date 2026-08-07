/**
 * Per-chat model picker keyboard shortcut (Mod+M).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createEmptyChatObject,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import {
  resetDesktopStateForTests,
  setDesktopStateForTests,
} from '../helpers/legacy-desktop-state.ts';

describe('composer model select shortcut', () => {
  test('Mod+M opens the per-chat model picker on the active composer', async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const doc = win.document;
    doc.body.innerHTML = `
      <select id="modelSelect">
        <option value="qwen/qwen2.5-7b">Qwen 2.5 7B</option>
      </select>
      <div id="desktopComposerModelAnchor"></div>
      <span id="modelSelectTriggerText">Qwen 2.5 7B</span>
      <textarea id="desktopInput"></textarea>
    `;

    const prevDocument = globalThis.document;
    const prevWindow = globalThis.window;
    const prevRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    };
    (globalThis as { document: Document }).document = doc as unknown as Document;
    (globalThis as { window: Window }).window = win as unknown as Window & typeof globalThis.window;

    const chat = createEmptyChatObject('qwen/qwen2.5-7b');
    setSessionStateForTests({ chats: [chat], activeId: chat.id });
    setDesktopStateForTests('chatActive');

    try {
      const {
        initComposerModelTriggers,
        openActiveChatModelSelect,
        closeComposerModelMenu,
      } = await import('../../src/ui/composer-model-trigger.ts');

      initComposerModelTriggers();

      const opened = openActiveChatModelSelect();
      assert.equal(opened, true);

      const menu = doc.querySelector('.composer-model-menu');
      assert.ok(menu);
      assert.equal(menu?.classList.contains('hidden'), false);

      const search = menu?.querySelector('.model-host-filter-search') as HTMLInputElement | null;
      assert.equal(doc.activeElement, search);

      closeComposerModelMenu();
    } finally {
      globalThis.requestAnimationFrame = prevRaf;
      resetDesktopStateForTests();
      setSessionStateForTests(null);
      (globalThis as { document: Document }).document = prevDocument;
      (globalThis as { window: Window }).window = prevWindow;
    }
  });
});
