/**
 * Global bugs aggregation across chats.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  collectGlobalBugs,
  countOpenGlobalBugs,
} from '../../src/state/global-bugs.ts';
import type { Chat } from '../../src/types.ts';

function chatWithBugs(
  id: string,
  workspacePath: string,
  bugs: Array<{ id: string; column: 'reported' | 'complete' }>,
): Chat {
  const now = 1710000000000;
  return {
    id,
    name: `Chat ${id}`,
    workspacePath,
    modelId: 'm',
    modeId: 'debug',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: now,
    bugBoard: {
      bugs: bugs.map((b, i) => ({
        id: b.id,
        title: b.id,
        description: '',
        severity: 'medium' as const,
        column: b.column,
        createdAt: now + i,
        updatedAt: now + i * 1000,
      })),
      startedAt: now,
      lastUpdatedAt: now,
    },
  };
}

describe('global-bugs', () => {
  test('collectGlobalBugs filters by workspace and hides complete', () => {
    const chats = [
      chatWithBugs('a', '/workspace/proj', [
        { id: 'b1', column: 'reported' },
        { id: 'b2', column: 'complete' },
      ]),
      chatWithBugs('b', '/other', [{ id: 'b3', column: 'reported' }]),
    ];

    const current = collectGlobalBugs(chats, {
      scope: 'current_workspace',
      workspacePath: '/workspace/proj',
      hideComplete: true,
    });
    assert.equal(current.length, 1);
    assert.equal(current[0]?.bug.id, 'b1');

    const all = collectGlobalBugs(chats, {
      scope: 'all',
      hideComplete: true,
    });
    assert.equal(all.length, 2);
  });

  test('countOpenGlobalBugs excludes complete', () => {
    const chats = [
      chatWithBugs('a', '', [
        { id: 'b1', column: 'reported' },
        { id: 'b2', column: 'complete' },
      ]),
    ];
    assert.equal(
      countOpenGlobalBugs(chats, { scope: 'all', workspacePath: '' }),
      1,
    );
  });
});
