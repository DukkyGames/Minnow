/**
 * Slash skill picker opens on / across Code, Chat app, and desktop composers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Window } from 'happy-dom';

const { refreshSkillCatalog } = await import('../../src/skills/client.ts');
const {
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
});
