/**
 * Shared Orchestrate plan <select> population (auto-select single plan for board onboarding).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { createEmptyChatObject, setSessionStateForTests } = await import(
  '../../src/state/sessions.ts'
);
const { populateOrchestratePlanSelect } = await import(
  '../../src/ui/orchestrate-plan-picker.ts'
);

describe('orchestrate-plan-picker', () => {
  afterEach(() => {
    setSessionStateForTests(null);
  });

  test('autoSelectSingle persists the only plan when chat has no saved path', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const chat = createEmptyChatObject('');
    chat.id = '11111111-1111-1111-1111-111111111111';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const sel = document.createElement('select');
    const hint = document.createElement('p');

    const onlyPath = 'documentation/plans/single-plan.md';
    await populateOrchestratePlanSelect(sel, hint, chat, {
      autoSelectSingle: true,
      discoverPlans: async () => ({ plans: [onlyPath] }),
    });

    assert.equal(chat.orchestratePlanPath, onlyPath);
    assert.equal(sel.value, onlyPath);
  });

  test('autoSelectSingle does not override an existing saved plan', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const saved = 'documentation/plans/keep-me.md';
    const chat = createEmptyChatObject('');
    chat.id = '22222222-2222-2222-2222-222222222222';
    chat.orchestratePlanPath = saved;
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const sel = document.createElement('select');
    const hint = document.createElement('p');

    await populateOrchestratePlanSelect(sel, hint, chat, {
      autoSelectSingle: true,
      discoverPlans: async () => ({
        plans: ['documentation/plans/other.md'],
      }),
    });

    assert.equal(chat.orchestratePlanPath, saved);
    assert.equal(sel.value, saved);
  });
});
