/**
 * V2 Boards create form: plan dropdown, not a free-text path.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals } from '../os/dom-helpers.mts';
import { fillBoardsPlanSelect, mountBoardsAskPane, mountCreateForm } from '../../src/orchestrator/boards-view.ts';
import { PlanParseFailure } from '../../src/orchestrator/client.ts';
import {
  createEmptyChatObject,
  sessionState,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';

let activeWindow: Window | undefined;

function setupDom(): HTMLElement {
  activeWindow?.close();
  const win = new Window();
  activeWindow = win;
  installHappyDomGlobals(win);
  const pane = document.createElement('div');
  document.body.appendChild(pane);
  return pane;
}

afterEach(() => {
  document.body.innerHTML = '';
  activeWindow?.close();
  activeWindow = undefined;
  setSessionStateForTests(null);
});

describe('fillBoardsPlanSelect', () => {
  test('lists workspace plans as options with short labels', async () => {
    setupDom();
    const sel = document.createElement('select');
    const hint = document.createElement('p');

    await fillBoardsPlanSelect(sel, hint, {
      discoverPlans: async () => ({
        plans: [
          'documentation/plans/alpha.md',
          'documentation/plans/beta.md',
        ],
      }),
    });

    const values = [...sel.options].map((o) => o.value);
    const labels = [...sel.options].map((o) => o.textContent);
    assert.deepEqual(values, ['', 'documentation/plans/alpha.md', 'documentation/plans/beta.md']);
    assert.deepEqual(labels, ['Select plan…', 'alpha.md', 'beta.md']);
    assert.equal(sel.value, '');
    assert.equal(hint.classList.contains('hidden'), true);
  });

  test('auto-selects the only plan', async () => {
    setupDom();
    const sel = document.createElement('select');
    const hint = document.createElement('p');
    const only = 'documentation/plans/single.md';

    await fillBoardsPlanSelect(sel, hint, {
      discoverPlans: async () => ({ plans: [only] }),
    });

    assert.equal(sel.value, only);
  });

  test('shows a hint when the workspace has no plans', async () => {
    setupDom();
    const sel = document.createElement('select');
    const hint = document.createElement('p');

    await fillBoardsPlanSelect(sel, hint, {
      discoverPlans: async () => ({ plans: [] }),
    });

    assert.equal(hint.classList.contains('hidden'), false);
    assert.match(hint.textContent ?? '', /No plans yet/);
  });
});

describe('mountCreateForm', () => {
  test('renders a plan <select> rather than a text path field', async () => {
    const pane = setupDom();
    await mountCreateForm(pane, {
      discoverPlans: async () => ({
        plans: ['documentation/plans/alpha.md', 'documentation/plans/beta.md'],
      }),
      onCreated: () => {},
      onCancel: () => {},
    });

    const select = pane.querySelector<HTMLSelectElement>('select.ov2-create__input');
    const textPath = pane.querySelector('input[placeholder*="documentation/plans"]');
    assert.ok(select, 'expected a plan dropdown');
    assert.equal(textPath, null);
    assert.equal(select.options.length, 3);
    assert.equal(select.required, true);
  });

  test('Create is disabled until a plan is chosen, then POSTs that path', async () => {
    const pane = setupDom();
    const posted: string[] = [];
    await mountCreateForm(pane, {
      discoverPlans: async () => ({
        plans: ['documentation/plans/alpha.md', 'documentation/plans/beta.md'],
      }),
      createBoard: async (planPath) => {
        posted.push(planPath);
        return { boardId: 'alpha' };
      },
      onCreated: () => {},
      onCancel: () => {},
    });

    const form = pane.querySelector('form.ov2-create');
    const select = pane.querySelector<HTMLSelectElement>('select.ov2-create__input');
    const submit = pane.querySelector<HTMLButtonElement>('button[type="submit"]');
    assert.ok(form && select && submit);
    assert.equal(submit.disabled, true);

    select.value = 'documentation/plans/beta.md';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(submit.disabled, false);

    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(posted, ['documentation/plans/beta.md']);
  });

  test('Create does not add a chat row to the session', async () => {
    const pane = setupDom();
    const existing = createEmptyChatObject('m1');
    existing.modeId = 'build';
    setSessionStateForTests({
      version: 5,
      activeId: existing.id,
      sidebarCollapsed: false,
      groups: [],
      chats: [existing],
    });
    const chatsBefore = sessionState?.chats.length ?? 0;
    assert.ok(chatsBefore > 0, 'fixture chat must be in session before Create');

    await mountCreateForm(pane, {
      discoverPlans: async () => ({
        plans: ['documentation/plans/alpha.md'],
      }),
      createBoard: async () => ({ boardId: 'alpha' }),
      onCreated: () => {},
      onCancel: () => {},
    });

    const form = pane.querySelector('form.ov2-create');
    const select = pane.querySelector<HTMLSelectElement>('select.ov2-create__input');
    assert.ok(form && select);
    select.value = 'documentation/plans/alpha.md';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(sessionState?.chats.length, chatsBefore);
    setSessionStateForTests(null);
  });
});

describe('mountBoardsAskPane', () => {
  test('renders the hub plan picker and Open board, not the blank empty state', async () => {
    const pane = setupDom();
    await mountBoardsAskPane(pane, {
      discoverPlans: async () => ({
        plans: ['documentation/plans/alpha.md', 'documentation/plans/beta.md'],
      }),
      onCreated: () => {},
    });

    assert.equal(pane.querySelector('.ov2-blank__title')?.textContent, undefined);
    assert.equal(pane.querySelector('.ob-ask__title')?.textContent, 'Boards & plans');
    const select = pane.querySelector<HTMLSelectElement>('#orchestrateHubPlanSelect');
    const start = pane.querySelector<HTMLButtonElement>('#orchestrateHubStartBoard');
    assert.ok(select);
    assert.ok(start);
    assert.equal(start.textContent, 'Open board');
    assert.equal(select.options.length, 3);
    assert.equal(start.disabled, true);
  });

  test('Open board POSTs the selected plan and does not add a chat row', async () => {
    const pane = setupDom();
    const existing = createEmptyChatObject('m1');
    existing.modeId = 'build';
    setSessionStateForTests({
      version: 5,
      activeId: existing.id,
      sidebarCollapsed: false,
      groups: [],
      chats: [existing],
    });
    const posted: string[] = [];
    const created: string[] = [];

    await mountBoardsAskPane(pane, {
      discoverPlans: async () => ({
        plans: ['documentation/plans/alpha.md', 'documentation/plans/beta.md'],
      }),
      createBoard: async (planPath) => {
        posted.push(planPath);
        return { boardId: 'beta' };
      },
      onCreated: (boardId) => {
        created.push(boardId);
      },
    });

    const select = pane.querySelector<HTMLSelectElement>('#orchestrateHubPlanSelect');
    const start = pane.querySelector<HTMLButtonElement>('#orchestrateHubStartBoard');
    assert.ok(select && start);
    select.value = 'documentation/plans/beta.md';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(start.disabled, false);

    const chatsBefore = sessionState?.chats.length ?? 0;
    start.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(posted, ['documentation/plans/beta.md']);
    assert.deepEqual(created, ['beta']);
    assert.equal(sessionState?.chats.length, chatsBefore);
    setSessionStateForTests(null);
  });

  test('shows parse errors in the pane when the plan is refused', async () => {
    const pane = setupDom();
    await mountBoardsAskPane(pane, {
      discoverPlans: async () => ({
        plans: ['documentation/plans/alpha.md'],
      }),
      createBoard: async () => {
        throw new PlanParseFailure('the plan does not parse', [
          {
            line: 12,
            column: 1,
            message: 'missing Touches',
            hint: 'Add a Touches list',
          },
        ]);
      },
      onCreated: () => {},
    });

    const select = pane.querySelector<HTMLSelectElement>('#orchestrateHubPlanSelect');
    const start = pane.querySelector<HTMLButtonElement>('#orchestrateHubStartBoard');
    assert.ok(select && start);
    select.value = 'documentation/plans/alpha.md';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    start.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.match(pane.querySelector('.ov2-create__parse-title')?.textContent ?? '', /does not parse/);
    assert.match(pane.querySelector('.ov2-create__parse-loc')?.textContent ?? '', /12:1/);
    assert.match(pane.querySelector('.ov2-create__parse-msg')?.textContent ?? '', /missing Touches/);
  });
});
