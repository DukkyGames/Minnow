/**
 * New-issue workspace picker options when Issues scope is "all workspaces".
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildNewIssueWorkspaceOptions } from '../../src/ui/issues-new-workspace-field';
import { resetWorkspaceStateForTests, setWorkspaceFromServer } from '../../src/state/workspace';

describe('buildNewIssueWorkspaceOptions', () => {
  test('lists Scratch first, then recent workspaces, deduped', () => {
    resetWorkspaceStateForTests();
    setWorkspaceFromServer({
      path: '/home/dev/alpha',
      label: 'alpha',
      isDefault: false,
    });

    const options = buildNewIssueWorkspaceOptions({
      scratchPath: '/home/dev/.minnow/workspace',
      sandbox: {
        path: '/home/dev/.minnow/workspace',
        label: 'Scratch',
        exists: true,
        isCurrent: false,
      },
      recent: [
        {
          path: '/home/dev/beta',
          label: 'beta',
          exists: true,
          isCurrent: false,
        },
        {
          path: '/home/dev/alpha',
          label: 'alpha',
          exists: true,
          isCurrent: true,
        },
      ],
    });

    assert.deepEqual(
      options.map((o) => o.label),
      ['Scratch', 'beta', 'alpha'],
    );
    assert.equal(options[0].path, '/home/dev/.minnow/workspace');
  });

  test('skips recent folders that no longer exist', () => {
    resetWorkspaceStateForTests();
    setWorkspaceFromServer({
      path: '/home/dev/alpha',
      label: 'alpha',
      isDefault: false,
    });

    const options = buildNewIssueWorkspaceOptions({
      recent: [
        {
          path: '/gone/repo',
          label: 'gone',
          exists: false,
          isCurrent: false,
        },
      ],
    });

    assert.deepEqual(options.map((o) => o.label), ['alpha']);
  });
});
