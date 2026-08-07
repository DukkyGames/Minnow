/**
 * MIN-457: overlays that must hide the Electron preview guest while open.
 */

import assert from 'node:assert/strict';
import { describe, test, beforeEach, afterEach } from 'node:test';
import {
  createEmptyChatObject,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import {
  isChromePopoverOpen,
  resetChromePopoverRegistryForTests,
} from '../../src/ui/preview-electron-visibility.ts';

describe('preview chrome popover panels (MIN-457)', () => {
  let win: import('happy-dom').Window;
  const prevDocument = globalThis.document;
  const prevWindow = globalThis.window;
  const prevRaf = globalThis.requestAnimationFrame;

  beforeEach(async () => {
    resetChromePopoverRegistryForTests();
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as typeof requestAnimationFrame;

    const { Window } = await import('happy-dom');
    win = new Window();
    (globalThis as { document: Document }).document = win.document as unknown as Document;
    (globalThis as { window: Window }).window = win as unknown as Window & typeof globalThis.window;
  });

  afterEach(async () => {
    resetChromePopoverRegistryForTests();
    setSessionStateForTests(null);
    try {
      const { setAgentActivityPanelOpen } = await import('../../src/ui/agent-activity-panel.ts');
      setAgentActivityPanelOpen(false);
    } catch {
      /* ignore */
    }
    try {
      const { closeModelSelectMenu } = await import('../../src/ui/model-select-picker.ts');
      closeModelSelectMenu();
    } catch {
      /* ignore */
    }
    try {
      const { closeComposerModelMenu } = await import('../../src/ui/composer-model-trigger.ts');
      closeComposerModelMenu();
    } catch {
      /* ignore */
    }
    globalThis.requestAnimationFrame = prevRaf;
    (globalThis as { document: Document }).document = prevDocument;
    (globalThis as { window: Window }).window = prevWindow;
  });

  test('agent activity panel registers chrome popover while open', async () => {
    const { setAgentActivityPanelOpen } = await import('../../src/ui/agent-activity-panel.ts');

    assert.equal(isChromePopoverOpen(), false);
    setAgentActivityPanelOpen(true);
    assert.equal(isChromePopoverOpen(), true);
    setAgentActivityPanelOpen(false);
    assert.equal(isChromePopoverOpen(), false);
  });

  test('top-bar model select registers chrome popover while menu is open', async () => {
    win.document.body.innerHTML = `
      <div class="model-select-inner">
        <select id="modelSelect"><option value="p/m">m</option></select>
        <button type="button" id="modelSelectTrigger"><span id="modelSelectTriggerText"></span></button>
        <ul id="modelSelectMenu" class="model-select-menu hidden"></ul>
      </div>
    `;
    const { initModelSelectPicker, closeModelSelectMenu } = await import(
      '../../src/ui/model-select-picker.ts'
    );

    initModelSelectPicker();
    const trigger = win.document.getElementById('modelSelectTrigger') as HTMLButtonElement;
    assert.ok(trigger);

    assert.equal(isChromePopoverOpen(), false);
    trigger.click();
    assert.equal(isChromePopoverOpen(), true);
    closeModelSelectMenu();
    assert.equal(isChromePopoverOpen(), false);
  });

  test('composer model menu registers chrome popover while open', async () => {
    win.document.body.innerHTML = `
      <select id="modelSelect"><option value="qwen/qwen2.5-7b">Qwen 2.5 7B</option></select>
      <div id="codeComposerModelAnchor"></div>
    `;
    const chat = createEmptyChatObject('qwen/qwen2.5-7b');
    setSessionStateForTests({ chats: [chat], activeId: chat.id });

    const { mountComposerModelTrigger, closeComposerModelMenu } = await import(
      '../../src/ui/composer-model-trigger.ts'
    );

    mountComposerModelTrigger(win.document.getElementById('codeComposerModelAnchor')!, 'code');
    const trigger = win.document.querySelector('.composer-model-trigger') as HTMLButtonElement;
    assert.ok(trigger);

    assert.equal(isChromePopoverOpen(), false);
    trigger.click();
    assert.equal(isChromePopoverOpen(), true);
    closeComposerModelMenu();
    assert.equal(isChromePopoverOpen(), false);
  });
});
