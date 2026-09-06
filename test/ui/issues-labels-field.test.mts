/**
 * List labels field: one row, max three chips, caret overflow, + add (no dashed placeholder).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

import { ISSUES_COMPAT_VERSION, ISSUES_SCHEMA_VERSION } from '../../src/types.ts';
import type { IssueCard } from '../../src/types.ts';

const { setIssuesStateForTests } = await import('../../src/state/issues-store.ts');
const { createIssuesLabelsField, closeIssuesLabelsSuggestionsMenu } = await import(
  '../../src/ui/issues-labels-field.ts'
);

const FIXED_NOW = 1_710_000_000_000;

let domWindow: Window | null = null;

function setupDom(): void {
  const window = new Window({ url: 'http://localhost/' });
  domWindow = window;
  globalThis.window = window as unknown as Window & typeof globalThis.window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLButtonElement = window.HTMLButtonElement;
  globalThis.HTMLInputElement = window.HTMLInputElement;
  globalThis.HTMLUListElement = window.HTMLUListElement;
  globalThis.Node = window.Node;
  globalThis.Element = window.Element;
}

function seedIssue(labels: string[]): IssueCard {
  const issue: IssueCard = {
    id: 'MIN-9',
    type: 'task',
    title: 'Keyboard shortcuts',
    description: '',
    status: 'todo',
    priority: 'none',
    labels,
    workspacePath: '/workspace',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    source: 'user',
  };
  setIssuesStateForTests({
    version: ISSUES_COMPAT_VERSION,
    schemaRevision: ISSUES_SCHEMA_VERSION,
    nextId: 10,
    issues: [issue],
    workspaces: {},
  });
  return issue;
}

describe('issues labels field', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(() => {
    closeIssuesLabelsSuggestionsMenu();
    setIssuesStateForTests(null);
    domWindow?.happyDOM.close();
    domWindow = null;
  });

  test('row variant shows three chips, a caret for overflow, and + with no inline input', () => {
    const issue = seedIssue(['AUTH', 'CLERK', 'ONBOARDING', 'SETUP', 'API']);
    const field = createIssuesLabelsField({
      issueId: issue.id,
      labels: issue.labels,
      variant: 'row',
      onChange: () => {},
    });
    document.body.appendChild(field);

    const chips = [...field.querySelectorAll('.issues-label-chip')];
    assert.equal(chips.length, 3);
    assert.deepEqual(
      chips.map((chip) => chip.querySelector('.issues-label-chip__text')?.textContent),
      ['AUTH', 'CLERK', 'ONBOARDING'],
    );
    assert.equal(field.querySelector('.issues-labels-field__more')?.getAttribute('aria-label'), '2 more labels');
    assert.ok(field.querySelector('.issues-labels-field__more .issues-labels-field__more-icon'));
    assert.ok(field.querySelector('.issues-labels-field__add'));
    assert.equal(field.querySelector(':scope > .issues-labels-field__input'), null);
    assert.ok(chips[0]?.getAttribute('data-swatch'));
  });

  test('caret opens a popover with the remaining labels', () => {
    const issue = seedIssue(['AUTH', 'CLERK', 'ONBOARDING', 'SETUP', 'API']);
    const field = createIssuesLabelsField({
      issueId: issue.id,
      labels: issue.labels,
      variant: 'row',
      onChange: () => {},
    });
    document.body.appendChild(field);
    const more = field.querySelector('.issues-labels-field__more');
    assert.ok(more instanceof globalThis.HTMLButtonElement);
    more.click();
    const overflow = document.querySelector('.issues-labels-overflow');
    assert.ok(overflow);
    assert.deepEqual(
      [...overflow.querySelectorAll('.issues-label-chip__text')].map((node) => node.textContent),
      ['SETUP', 'API'],
    );
  });

  test('detail variant shows every label', () => {
    const issue = seedIssue(['AUTH', 'CLERK', 'ONBOARDING', 'SETUP']);
    const field = createIssuesLabelsField({
      issueId: issue.id,
      labels: issue.labels,
      variant: 'detail',
      onChange: () => {},
    });
    assert.equal(field.querySelectorAll('.issues-label-chip').length, 4);
    assert.equal(field.querySelector('.issues-labels-field__more'), null);
  });
});
