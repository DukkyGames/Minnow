/**
 * Leftover orchestrate board session hydration: status + concurrency (MIN-718).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { validateSessionState } from '../../server/config/validators.js';
import type { ChatGroup } from '../../src/types.ts';

const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/reload-persist.md';
const PLANNER_ID = '11111111-1111-1111-1111-111111111111';

function hydrateWithBoard(raw: Record<string, unknown>): ChatGroup {
  const out = validateSessionState({
    version: 5,
    activeId: PLANNER_ID,
    sidebarCollapsed: false,
    chats: [
      {
        id: PLANNER_ID,
        name: 'Planner',
        workspacePath: '/tmp/ws',
        modelId: 'm1',
        modeId: 'orchestrate',
        history: [],
        updatedAt: 1,
        boardGroupId: GROUP_ID,
      },
    ],
    groups: [
      {
        id: GROUP_ID,
        name: 'Reload board',
        workspacePath: '/tmp/ws',
        collapsed: false,
        order: 0,
        createdAt: 1,
        orchestratePlanPath: PLAN_PATH,
        plannerChatId: PLANNER_ID,
        orchestrateBoard: {
          planPath: PLAN_PATH,
          startedAt: 1,
          lastUpdatedAt: 2,
          tasks: [
            {
              id: 'W1-A',
              title: 'First task',
              wave: 'W1',
              category: 'build',
              status: 'planned',
            },
          ],
          waves: [{ id: 'W1' }],
          ...raw,
        },
      },
    ],
  });
  return out.groups[0] as ChatGroup;
}

describe('leftover orchestrate board hydrate', () => {
  test('sequential auto-run becomes Running at N=1 and drops stale flags', () => {
    const group = hydrateWithBoard({
      executionMode: 'sequential',
      autoRunning: true,
    });
    assert.equal(group.orchestrateBoard?.status, 'running');
    assert.equal(group.orchestrateBoard?.maxConcurrentTasks, 1);
    assert.equal(group.orchestrateBoard?.executionMode, undefined);
    assert.equal(group.orchestrateBoard?.autoRunning, undefined);
  });

  test('legacy AFK becomes Running', () => {
    const group = hydrateWithBoard({ executionMode: 'afk', autoRunning: true });
    assert.equal(group.orchestrateBoard?.status, 'running');
    assert.equal(group.orchestrateBoard?.handsOff, undefined);
  });

  test('userStopped becomes Stopped', () => {
    const group = hydrateWithBoard({ autoRunning: true, userStopped: true });
    assert.equal(group.orchestrateBoard?.status, 'stopped');
    assert.equal(group.orchestrateBoard?.userStopped, undefined);
  });

  test('manual becomes Stopped at N=1', () => {
    const group = hydrateWithBoard({ executionMode: 'manual', autoRunning: true });
    assert.equal(group.orchestrateBoard?.status, 'stopped');
    assert.equal(group.orchestrateBoard?.maxConcurrentTasks, 1);
    assert.equal(group.orchestrateBoard?.autoRunning, undefined);
  });
});
