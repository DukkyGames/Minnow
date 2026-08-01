import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

describe('buildThinkingBudgetFieldInputs', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('row layout uses settings-row and no Off placeholder', async () => {
    const { buildThinkingBudgetFieldInputs } = await import(
      '../../src/ui/settings-thinking-budget-fields.ts'
    );
    const fields = buildThinkingBudgetFieldInputs(null, {
      layout: 'row',
      label: 'Thinking budget',
      description: 'Cap tokens.',
    });
    assert.ok(fields.root.classList.contains('settings-row'));
    const input = fields.root.querySelector('input');
    assert.ok(input);
    assert.equal(input.placeholder, '');
    assert.equal(input.disabled, false);
    fields.setDisabled(true);
    assert.equal(input.disabled, true);
    assert.ok(fields.root.classList.contains('is-disabled'));
  });

  test('stack layout keeps inherit placeholder by default', async () => {
    const { buildThinkingBudgetFieldInputs } = await import(
      '../../src/ui/settings-thinking-budget-fields.ts'
    );
    const fields = buildThinkingBudgetFieldInputs(null);
    const input = fields.root.querySelector('input');
    assert.ok(input);
    assert.equal(input.placeholder, 'Inherit');
  });
});
