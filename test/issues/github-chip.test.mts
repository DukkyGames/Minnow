/**
 * Linked GitHub row: identity + Open (not an <a>) + optional Sync. No checkbox.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

import type { IssueCard, IssueGithubLink } from '../../src/types.ts';

const SYNCED_AT = 1_700_000_000_000;

function issue(partial: Partial<IssueCard> = {}): IssueCard {
  return {
    id: 'MIN-1',
    type: 'task',
    title: 'Local title',
    description: 'Local body',
    status: 'todo',
    priority: 'none',
    labels: [],
    workspacePath: '/w',
    createdAt: 0,
    updatedAt: SYNCED_AT,
    github: {
      number: 5,
      url: 'https://github.com/acme/app/issues/5',
      syncedAt: SYNCED_AT,
      localUpdatedAt: SYNCED_AT,
    } satisfies IssueGithubLink,
    ...partial,
  } as IssueCard;
}

let domWindow: Window | null = null;

describe('buildGithubIssueChip', () => {
  beforeEach(() => {
    const window = new Window({ url: 'http://localhost/' });
    domWindow = window;
    globalThis.window = window as unknown as Window & typeof globalThis.window;
    globalThis.document = window.document;
  });

  afterEach(() => {
    domWindow?.close();
    domWindow = null;
  });

  test('shows #n · synced, Open as a button, and no checkbox or <a>', async () => {
    const { buildGithubIssueChip } = await import('../../src/ui/issues-github-section.ts');
    const host = document.createElement('div');
    const row = buildGithubIssueChip(issue(), {
      canSync: true,
      conflictHost: host,
      onChanged: () => {},
    });
    assert.match(row.textContent ?? '', /#5/);
    assert.match(row.textContent ?? '', /synced/);
    assert.equal(row.querySelector('a'), null);
    assert.equal(row.querySelector('input'), null);
    const open = [...row.querySelectorAll('button')].find((btn) => btn.textContent === 'Open');
    assert.ok(open);
    assert.match(open.getAttribute('aria-label') ?? '', /browser/);
    const sync = [...row.querySelectorAll('button')].find((btn) => btn.textContent === 'Sync');
    assert.ok(sync);
  });

  test('hides Sync when the mode cannot contact GitHub', async () => {
    const { buildGithubIssueChip } = await import('../../src/ui/issues-github-section.ts');
    const host = document.createElement('div');
    const row = buildGithubIssueChip(issue(), {
      canSync: false,
      conflictHost: host,
      onChanged: () => {},
    });
    const labels = [...row.querySelectorAll('button')].map((btn) => btn.textContent);
    assert.deepEqual(labels, ['Open']);
  });

  test('marks Needs push when the card moved locally', async () => {
    const { buildGithubIssueChip } = await import('../../src/ui/issues-github-section.ts');
    const host = document.createElement('div');
    const row = buildGithubIssueChip(issue({ updatedAt: SYNCED_AT + 10 }), {
      canSync: true,
      conflictHost: host,
      onChanged: () => {},
    });
    assert.match(row.textContent ?? '', /Needs push/);
    assert.ok(row.querySelector('.is-needs-push'));
  });
});
