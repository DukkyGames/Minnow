/**
 * Built-in saved views seed when the file has none.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  BUILTIN_VIEW_AGENTS,
  BUILTIN_VIEW_MY_OPEN,
  BUILTIN_VIEW_TRIAGE,
  builtInIssueViews,
} from '../../src/issues/saved-views.ts';
import {
  addIssueView,
  deleteIssueView,
  ensureIssueViews,
  listIssueViews,
  setIssuesNowForTests,
  setIssuesStateForTests,
} from '../../src/state/issues-store.ts';

const FIXED_NOW = 1_710_000_005_000;

describe('saved views', () => {
  beforeEach(() => {
    setIssuesNowForTests(() => FIXED_NOW);
    setIssuesStateForTests({ version: 2, nextId: 1, issues: [], workspaces: {} });
  });

  test('built-in catalog is Triage, Assigned to agents, My open', () => {
    const ids = builtInIssueViews().map((view) => view.id);
    assert.deepEqual(ids, [BUILTIN_VIEW_TRIAGE, BUILTIN_VIEW_AGENTS, BUILTIN_VIEW_MY_OPEN]);
  });

  test('ensureIssueViews seeds builtins when views is empty', () => {
    const seeded = ensureIssueViews();
    assert.equal(seeded.length, 3);
    assert.deepEqual(
      listIssueViews().map((view) => view.id),
      [BUILTIN_VIEW_TRIAGE, BUILTIN_VIEW_AGENTS, BUILTIN_VIEW_MY_OPEN],
    );
  });

  test('user views persist and builtins cannot be deleted', () => {
    ensureIssueViews();
    const created = addIssueView({ name: 'Bugs', filters: { type: 'bug' } });
    assert.equal(created.name, 'Bugs');
    assert.equal(deleteIssueView(BUILTIN_VIEW_TRIAGE), false);
    assert.equal(deleteIssueView(created.id), true);
    assert.equal(listIssueViews().some((view) => view.id === created.id), false);
  });
});
