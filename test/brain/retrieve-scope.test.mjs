/**
 * Workspace-scoped brain retrieval filter.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { scopePagesToWorkspace } from '../../server/brain/retrieve.js';

const GLOBAL_A = { path: 'facts/note-a.md', id: '11111111-1111-1111-1111-111111111111' };
const GLOBAL_B = { path: 'edgeflight/overview.md', id: '22222222-2222-2222-2222-222222222222' };
const WS_A_PAGE = {
  path: 'workspaces/project-a/notes.md',
  id: '33333333-3333-3333-3333-333333333333',
};
const WS_B_PAGE = {
  path: 'workspaces/project-b/notes.md',
  id: '44444444-4444-4444-4444-444444444444',
};

const ALL_PAGES = [GLOBAL_A, GLOBAL_B, WS_A_PAGE, WS_B_PAGE];

describe('scopePagesToWorkspace', () => {
  test('returns all global pages plus matching workspace subtree', () => {
    const scoped = scopePagesToWorkspace(ALL_PAGES, 'project-a');
    const paths = scoped.map((p) => p.path).sort();
    assert.deepEqual(paths, [
      'edgeflight/overview.md',
      'facts/note-a.md',
      'workspaces/project-a/notes.md',
    ]);
  });

  test('excludes other workspace pages for a different key', () => {
    const scoped = scopePagesToWorkspace(ALL_PAGES, 'project-b');
    const paths = scoped.map((p) => p.path).sort();
    assert.deepEqual(paths, [
      'edgeflight/overview.md',
      'facts/note-a.md',
      'workspaces/project-b/notes.md',
    ]);
    assert.ok(!paths.includes('workspaces/project-a/notes.md'));
  });

  test('excludes all workspace pages when workspaceKey is empty', () => {
    const scoped = scopePagesToWorkspace(ALL_PAGES, '');
    const paths = scoped.map((p) => p.path).sort();
    assert.deepEqual(paths, ['edgeflight/overview.md', 'facts/note-a.md']);
  });
});
