/**
 * Global bugs aggregation from bugs/state.json.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  collectGlobalBugs,
  countOpenGlobalBugs,
} from '../../src/state/global-bugs.ts';
import {
  addBug,
  setBugsStateForTests,
  updateBug,
} from '../../src/state/bug-board-store.ts';

const FIXED_NOW = 1710000000000;

describe('global-bugs', () => {
  beforeEach(() => {
    setBugsStateForTests({ version: 1, bugs: [] });
  });

  test('collectGlobalBugs filters by workspace and hides complete', () => {
    addBug(
      {
        title: 'b1',
        description: '',
        severity: 'medium',
        workspacePath: '/workspace/proj',
      },
      'b1',
    );
    addBug(
      {
        title: 'b2',
        description: '',
        severity: 'medium',
        workspacePath: '/workspace/proj',
      },
      'b2',
    );
    updateBugComplete('b2');

    addBug(
      {
        title: 'b3',
        description: '',
        severity: 'medium',
        workspacePath: '/other',
      },
      'b3',
    );

    const current = collectGlobalBugs({
      scope: 'current_workspace',
      workspacePath: '/workspace/proj',
      hideComplete: true,
    });
    assert.equal(current.length, 1);
    assert.equal(current[0]?.bug.id, 'b1');

    const all = collectGlobalBugs({
      scope: 'all',
      hideComplete: true,
    });
    assert.equal(all.length, 2);
  });

  test('countOpenGlobalBugs excludes complete', () => {
    addBug(
      {
        title: 'b1',
        description: '',
        severity: 'medium',
        workspacePath: '',
      },
      'b1',
    );
    addBug(
      {
        title: 'b2',
        description: '',
        severity: 'medium',
        workspacePath: '',
      },
      'b2',
    );
    updateBugComplete('b2');

    assert.equal(countOpenGlobalBugs({ scope: 'all', workspacePath: '' }), 1);
  });
});

function updateBugComplete(bugId: string): void {
  updateBug(bugId, { column: 'complete' });
}
