/**
 * Reproduce impeccable multi-step slash picker flow.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Window } from 'happy-dom';

const { refreshSkillCatalog } = await import('../../src/skills/client.ts');
const { listSlashPickerRows } = await import('../../src/chat/slash-commands/picker-catalog.ts');
const {
  initComposerSlashPicker,
  isSkillPickerOpen,
  handleSkillPickerKeydown,
  getPickerAppliedSkillId,
} = await import('../../src/ui/skill-picker.ts');

function mountComposer(): HTMLTextAreaElement {
  const wrap = document.createElement('div');
  wrap.className = 'input-wrap';
  const input = document.createElement('textarea');
  input.id = 'impeccablePickerInput';
  wrap.appendChild(input);
  document.body.appendChild(wrap);
  return input;
}

describe('skill-picker impeccable options', () => {
  it('opens sub-options after selecting impeccable and completes insertion', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.window = window as unknown as Window & typeof globalThis;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Event = window.Event;
    globalThis.KeyboardEvent = window.KeyboardEvent;

    await refreshSkillCatalog();

    const input = mountComposer();
    initComposerSlashPicker(input);

    input.focus();
    input.value = '/imp';
    input.setSelectionRange(4, 4);
    input.dispatchEvent(new Event('input', { bubbles: true }));

    assert.equal(isSkillPickerOpen(), true);

    const rows = listSlashPickerRows('imp');
    const idx = rows.findIndex((row) => row.kind === 'skill' && row.skill.id === 'impeccable');
    assert.ok(idx >= 0, 'impeccable row should be listed');

    for (let i = 0; i < idx; i++) {
      assert.equal(
        handleSkillPickerKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
        true,
      );
    }

    let enterError: unknown;
    let enterHandled = false;
    try {
      enterHandled = handleSkillPickerKeydown(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    } catch (err) {
      enterError = err;
    }
    assert.equal(enterError, undefined, `Enter on impeccable threw: ${enterError}`);
    assert.equal(enterHandled, true);
    assert.equal(isSkillPickerOpen(), true, 'options step should keep picker open');
    assert.match(input.value, /^\/impeccable /);

    assert.equal(
      handleSkillPickerKeydown(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
      true,
    );

    assert.equal(isSkillPickerOpen(), false);
    assert.match(input.value, /^\/impeccable \w+ /);
    assert.equal(getPickerAppliedSkillId(input), 'impeccable');
  });

  it('opens sub-command list when the full skill token is typed', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.window = window as unknown as Window & typeof globalThis;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Event = window.Event;
    globalThis.KeyboardEvent = window.KeyboardEvent;

    await refreshSkillCatalog();

    const input = mountComposer();
    initComposerSlashPicker(input);

    input.focus();
    input.value = '/impeccable';
    input.setSelectionRange(11, 11);
    input.dispatchEvent(new Event('input', { bubbles: true }));

    assert.equal(isSkillPickerOpen(), true);
    assert.match(input.value, /^\/impeccable/);
  });
});
