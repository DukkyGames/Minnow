/**
 * MIN-659: git name popover auto-fixes invalid branch/worktree names.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals, teardownHappyDomAsync } from '../os/dom-helpers.mts';
import {
  closeGitPanelNamePopover,
  openGitPanelNamePopover,
  openGitRefNamePopover,
} from '../../src/ui/git-panel-name-popover.ts';

describe('git-panel-name-popover slug preview (MIN-659)', () => {
  let win: InstanceType<typeof Window>;

  beforeEach(() => {
    win = new Window();
    installHappyDomGlobals(win);
    const anchor = win.document.createElement('button');
    anchor.id = 'anchor';
    win.document.body.appendChild(anchor);
  });

  afterEach(async () => {
    closeGitPanelNamePopover();
    await teardownHappyDomAsync(win);
  });

  test('defaults to a title slug and previews Test Worktree as test-worktree', () => {
    const submitted: string[] = [];
    const anchor = win.document.getElementById('anchor') as HTMLButtonElement;
    openGitRefNamePopover({
      anchor,
      title: 'New worktree',
      kind: 'worktree',
      defaultTitle: 'Fix login bug',
      defaultPath: '/tmp/opaque-chat-id',
      reserved: ['main'],
      onSubmit: (name) => {
        submitted.push(name);
      },
    });

    const input = win.document.querySelector(
      '.git-panel-name-popover__input',
    ) as HTMLInputElement;
    const preview = win.document.querySelector(
      '.git-panel-name-popover__preview',
    ) as HTMLElement;
    assert.equal(input.value, 'fix-login-bug');
    assert.equal(preview.hidden, true);

    input.value = 'Test Worktree';
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    assert.equal(preview.hidden, false);
    assert.equal(preview.textContent, 'Will use test-worktree');

    const create = [...win.document.querySelectorAll('button')].find(
      (btn) => btn.textContent === 'Create',
    );
    create?.click();
    assert.deepEqual(submitted, ['test-worktree']);
  });

  test('illegal-only input submits the worktree fallback instead of erroring', () => {
    const submitted: string[] = [];
    const anchor = win.document.getElementById('anchor') as HTMLButtonElement;
    openGitRefNamePopover({
      anchor,
      title: 'Add worktree',
      kind: 'worktree',
      onSubmit: (name) => {
        submitted.push(name);
      },
    });

    const input = win.document.querySelector(
      '.git-panel-name-popover__input',
    ) as HTMLInputElement;
    input.value = '***';
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    const preview = win.document.querySelector(
      '.git-panel-name-popover__preview',
    ) as HTMLElement;
    assert.equal(preview.textContent, 'Will use worktree');

    const create = [...win.document.querySelectorAll('button')].find(
      (btn) => btn.textContent === 'Create',
    );
    create?.click();
    assert.deepEqual(submitted, ['worktree']);
  });

  test('stash-style popover without normalize still requires a non-empty name', () => {
    const submitted: string[] = [];
    const anchor = win.document.getElementById('anchor') as HTMLButtonElement;
    openGitPanelNamePopover({
      anchor,
      title: 'Stash changes',
      label: 'Description',
      onSubmit: (name) => {
        submitted.push(name);
      },
    });

    const create = [...win.document.querySelectorAll('button')].find(
      (btn) => btn.textContent === 'Create',
    );
    create?.click();
    assert.deepEqual(submitted, []);
    assert.ok(win.document.querySelector('.git-panel-name-popover'));
  });
});
