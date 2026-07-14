/**
 * deriveTodoPanelView display helper (MIN-273).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createEmptyChatObject } from '../../src/state/sessions.ts';
import { setChatTodos } from '../../src/state/sessions.ts';
import { deriveTodoPanelView } from '../../src/ui/todo-panel.ts';

describe('deriveTodoPanelView', () => {
  test('hidden when chat has no todos', () => {
    const chat = createEmptyChatObject('m1');
    const view = deriveTodoPanelView(chat);
    assert.equal(view.hidden, true);
    assert.equal(view.items.length, 0);
  });

  test('expanded while work remains', () => {
    const chat = createEmptyChatObject('m1');
    setChatTodos(chat, [
      { text: 'Done', status: 'completed' },
      { text: 'Now', status: 'in_progress' },
      { text: 'Later', status: 'pending' },
    ]);
    const view = deriveTodoPanelView(chat);
    assert.equal(view.hidden, false);
    assert.equal(view.defaultCollapsed, false);
    assert.equal(view.progressLabel, '1/3');
    assert.equal(view.items[1]?.marker, 'in_progress');
  });

  test('collapsed label when all complete', () => {
    const chat = createEmptyChatObject('m1');
    setChatTodos(chat, [
      { text: 'A', status: 'completed' },
      { text: 'B', status: 'completed' },
    ]);
    const view = deriveTodoPanelView(chat);
    assert.equal(view.defaultCollapsed, true);
    assert.equal(view.progressLabel, '2/2 ✓');
    assert.equal(view.progressRatio, 1);
  });
});
