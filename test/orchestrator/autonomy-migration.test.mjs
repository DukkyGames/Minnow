/**
 * P4-F — leftover session boards and Autopilot settings fold onto
 * status + concurrency. Inbound fixtures still use the retired key names so
 * the migrator is proven against real persisted blobs.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  foldAutopilotDefaultStatus,
  foldLeftoverBoardAutonomy,
  stripStaleAutopilotKeys,
} from '../../src/lib/leftover-autonomy.mjs';
import { mergeConfigMeta, validateSessionState } from '../../server/config/validators.js';

const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/reload-persist.md';

function hydrateBoard(raw) {
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
        name: 'Board',
        workspacePath: '/tmp/ws',
        collapsed: false,
        order: 0,
        createdAt: 1,
        plannerChatId: PLANNER_ID,
        orchestratePlanPath: PLAN_PATH,
        orchestrateBoard: {
          planPath: PLAN_PATH,
          startedAt: 1,
          lastUpdatedAt: 2,
          tasks: [
            {
              id: 'W1-A',
              title: 'Task',
              wave: 'W1',
              category: 'build',
              status: 'planned',
            },
          ],
          waves: [{ id: 'W1', status: 'planned' }],
          ...raw,
        },
      },
    ],
  });
  return out.groups[0].orchestrateBoard;
}

describe('leftover board autonomy fold', () => {
  it('maps sequential auto-run onto Running at N=1', () => {
    const board = {};
    foldLeftoverBoardAutonomy(board, {
      executionMode: 'sequential',
      autoRunning: true,
    });
    assert.equal(board.status, 'running');
    assert.equal(board.maxConcurrentTasks, 1);
  });

  it('maps AFK onto Running', () => {
    const board = {};
    foldLeftoverBoardAutonomy(board, {
      executionMode: 'afk',
      handsOff: true,
      autoRunning: true,
    });
    assert.equal(board.status, 'running');
  });

  it('maps userStopped onto Stopped', () => {
    const board = {};
    foldLeftoverBoardAutonomy(board, {
      autoRunning: true,
      userStopped: true,
    });
    assert.equal(board.status, 'stopped');
  });

  it('maps Manual onto Stopped at N=1', () => {
    const board = {};
    foldLeftoverBoardAutonomy(board, { executionMode: 'manual' });
    assert.equal(board.status, 'stopped');
    assert.equal(board.maxConcurrentTasks, 1);
  });

  it('does not copy stale keys through session hydrate', () => {
    const board = hydrateBoard({
      executionMode: 'afk',
      autoRunning: true,
      handsOff: true,
      pendingAfk: true,
      userStopped: false,
      systemPaused: false,
    });
    assert.equal(board.status, 'running');
    assert.equal(board.executionMode, undefined);
    assert.equal(board.handsOff, undefined);
    assert.equal(board.autoRunning, undefined);
    assert.equal(board.pendingAfk, undefined);
    assert.equal(board.userStopped, undefined);
    assert.equal(board.systemPaused, undefined);
  });
});

describe('Autopilot settings autonomy fold', () => {
  it('maps stored AFK / hands-off onto Running', () => {
    assert.equal(foldAutopilotDefaultStatus({ defaultHandsOff: true }), 'running');
    assert.equal(foldAutopilotDefaultStatus({ defaultExecutionMode: 'afk' }), 'running');
    assert.equal(foldAutopilotDefaultStatus({ defaultExecutionMode: 'auto' }), 'running');
    assert.equal(foldAutopilotDefaultStatus({ defaultExecutionMode: 'sequential' }), 'running');
  });

  it('maps Manual onto Stopped', () => {
    assert.equal(foldAutopilotDefaultStatus({ defaultExecutionMode: 'manual' }), 'stopped');
    assert.equal(foldAutopilotDefaultStatus({ defaultHandsOff: false }), 'stopped');
  });

  it('prefers an already-migrated defaultStatus', () => {
    assert.equal(
      foldAutopilotDefaultStatus({ defaultStatus: 'stopped', defaultHandsOff: true }),
      'stopped',
    );
  });

  it('strips stale keys and persist Running from a stored AFK block', () => {
    const merged = mergeConfigMeta(
      { autopilot: { defaultHandsOff: true, maxConcurrentTasks: 4 } },
      { autopilot: {} },
    );
    assert.equal(merged.autopilot.defaultStatus, 'running');
    assert.equal(merged.autopilot.maxConcurrentTasks, 4);
    assert.equal(merged.autopilot.defaultHandsOff, undefined);
    assert.equal(merged.autopilot.defaultExecutionMode, undefined);
  });

  it('stripStaleAutopilotKeys removes inbound leftovers', () => {
    const block = {
      defaultStatus: 'running',
      defaultHandsOff: true,
      defaultExecutionMode: 'afk',
    };
    stripStaleAutopilotKeys(block);
    assert.equal(block.defaultStatus, 'running');
    assert.equal(Object.hasOwn(block, 'defaultHandsOff'), false);
    assert.equal(Object.hasOwn(block, 'defaultExecutionMode'), false);
  });
});
