/**
 * Slash skill picker opens on / across Code, Chat app, and desktop composers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Window } from 'happy-dom';

const { setStreaming } = await import('../../src/app-state.ts');
const { refreshSkillCatalog } = await import('../../src/skills/client.ts');
const { listSlashPickerRows } = await import('../../src/chat/slash-commands/picker-catalog.ts');
const {
  __resetSkillPickerForTests,
  handleSkillPickerKeydown,
  initComposerSlashPicker,
  isSkillPickerOpen,
} = await import('../../src/ui/skill-picker.ts');

function mountComposer(id: string, wrapClass: string): HTMLTextAreaElement {
  const wrap = document.createElement('div');
  wrap.className = wrapClass;
  const input = document.createElement('textarea');
  input.id = id;
  wrap.appendChild(input);
  document.body.appendChild(wrap);
  return input;
}

describe('skill-picker', () => {
  it('opens picker when / is typed on each composer surface', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Event = window.Event;

    await refreshSkillCatalog();

    const surfaces = [
      { id: 'msgInput', wrapClass: 'input-wrap' },
      { id: 'chatAppInput', wrapClass: 'chat-app-input' },
      { id: 'desktopInput', wrapClass: 'mn-os-desktop-input-wrap' },
    ] as const;

    for (const { id, wrapClass } of surfaces) {
      mountComposer(id, wrapClass);
    }

    for (const { id, wrapClass } of surfaces) {
      const input = document.getElementById(id) as HTMLTextAreaElement;
      initComposerSlashPicker(input);

      input.focus();
      input.value = '/git';
      input.setSelectionRange(4, 4);
      input.dispatchEvent(new Event('input', { bubbles: true }));

      const picker = document.getElementById('skillPicker');
      assert.ok(picker, `picker element should exist for ${id}`);
      assert.equal(picker?.classList.contains('hidden'), false, `picker visible for ${id}`);
      assert.equal(isSkillPickerOpen(), true, `picker open for ${id}`);
      assert.equal(picker?.parentElement, document.body, `picker mounted on body for ${id}`);
    }
  });

  it('opens picker while another chat is streaming', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Event = window.Event;

    await refreshSkillCatalog();

    const input = mountComposer('streamPickerInput', 'input-wrap');
    initComposerSlashPicker(input);

    setStreaming(true, 'other-chat-id');

    input.focus();
    input.value = '/git';
    input.setSelectionRange(4, 4);
    input.dispatchEvent(new Event('input', { bubbles: true }));

    assert.equal(isSkillPickerOpen(), true, 'picker should open during background stream');

    setStreaming(false, 'other-chat-id');
  });

  it('ArrowDown moves highlight by one row when wired like production composers', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.window = window as unknown as Window & typeof globalThis;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Event = window.Event;
    globalThis.KeyboardEvent = window.KeyboardEvent;

    await refreshSkillCatalog();
    __resetSkillPickerForTests();

    const input = mountComposer('arrowNavInput', 'input-wrap');
    initComposerSlashPicker(input);
    // Code / Chat app / desktop composers call handleSkillPickerKeydown from their keydown handler.
    input.addEventListener('keydown', (e) => {
      handleSkillPickerKeydown(e);
    });

    input.focus();
    input.value = '/';
    input.setSelectionRange(1, 1);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    assert.equal(isSkillPickerOpen(), true);

    const activeIndex = (): number => {
      const items = document.querySelectorAll('.skill-picker__item');
      for (let i = 0; i < items.length; i++) {
        if (items[i].classList.contains('skill-picker__item--active')) return i;
      }
      return -1;
    };

    assert.equal(activeIndex(), 0);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.equal(activeIndex(), 1, 'ArrowDown should advance exactly one row');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.equal(activeIndex(), 2, 'second ArrowDown should advance one more row');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    assert.equal(activeIndex(), 1, 'ArrowUp should move back exactly one row');
  });

  it('lists /goal in the picker when filtering by goal', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Event = window.Event;

    await refreshSkillCatalog();

    const input = mountComposer('goalPickerInput', 'input-wrap');
    initComposerSlashPicker(input);

    input.focus();
    input.value = '/goal';
    input.setSelectionRange(5, 5);
    input.dispatchEvent(new Event('input', { bubbles: true }));

    assert.equal(isSkillPickerOpen(), true);
    const rows = listSlashPickerRows('goal');
    assert.ok(rows.some((row) => row.kind === 'command' && row.command.id === 'goal'));
  });
});
