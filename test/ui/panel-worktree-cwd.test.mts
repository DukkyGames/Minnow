import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  normalizePanelCwdAfterWorktreeListChange,
  resolveKnownWorktreePath,
  resolvePanelBrowseCwd,
} from '../../src/ui/panel-worktree-cwd.ts';
import { setWorkspaceFromServer } from '../../src/state/workspace.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const WS = 'C:/repo';
const WT_A = 'C:/repo/.worktrees/feature-a';

describe('panel worktree cwd helpers', () => {
  test('resolveKnownWorktreePath prefers an exact match', () => {
    const worktrees = [
      { path: WS, branch: 'main' },
      { path: WT_A, branch: 'feature-a' },
    ];
    assert.equal(resolveKnownWorktreePath(worktrees, WT_A, WS), WT_A);
  });

  test('resolveKnownWorktreePath falls back to the workspace root', () => {
    const worktrees = [
      { path: WS, branch: 'main' },
      { path: WT_A, branch: 'feature-a' },
    ];
    assert.equal(
      resolveKnownWorktreePath(worktrees, 'C:/repo/.worktrees/removed', WS),
      WS,
    );
  });

  test('normalizePanelCwdAfterWorktreeListChange clears a removed worktree', () => {
    const worktrees = [{ path: WS, branch: 'main' }];
    assert.equal(
      normalizePanelCwdAfterWorktreeListChange(WT_A, worktrees, WS),
      undefined,
    );
  });

  test('normalizePanelCwdAfterWorktreeListChange keeps a still-present worktree', () => {
    const worktrees = [
      { path: WS, branch: 'main' },
      { path: WT_A, branch: 'feature-a' },
    ];
    assert.equal(
      normalizePanelCwdAfterWorktreeListChange(WT_A, worktrees, WS),
      WT_A,
    );
  });
});

describe('panel browse cwd follows board state (MIN-619)', () => {
  // Slot paths must include a `worktrees` segment — otherwise
  // `integrationWorktreePathFromSlotPath` will not treat them as board slots.
  const WT_INTEGRATION = 'C:/repo/.minnow/worktrees/minnow-abc/board-1/integration';
  const WT_TASK = 'C:/repo/.minnow/worktrees/minnow-abc/board-1/task-a';

  function makePlanner(): Chat {
    return {
      id: 'planner-1',
      name: 'planner',
      workspacePath: WS,
      modelId: 'm1',
      modeId: 'orchestrate',
      boardGroupId: 'grp-1',
      history: [],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
    };
  }

  function makeGroup(): ChatGroup {
    return {
      id: 'grp-1',
      name: 'board',
      workspacePath: WS,
      viewMode: 'board',
      plannerChatId: 'planner-1',
      orchestrateBoard: {
        planPath: 'documentation/plans/x.md',
        tasks: [{ id: 't1', worktreePath: WT_TASK }],
        waves: [],
        startedAt: 1,
        lastUpdatedAt: 1,
        isolationMode: 'per-task',
        integrationBranch: 'minnow/board/grp-1/integration',
      },
    } as unknown as ChatGroup;
  }

  test('planner falls back to the workspace until board state is committed', () => {
    setWorkspaceFromServer({ path: WS, label: 'repo', isDefault: false });
    const planner = makePlanner();
    const group = makeGroup();

    // What `switchChat` used to see: board view not yet activated.
    assert.equal(
      resolvePanelBrowseCwd({ chat: planner, groups: [group], chats: [planner] }),
      WS,
    );
  });

  test('planner resolves the integration worktree once board state is active', () => {
    setWorkspaceFromServer({ path: WS, label: 'repo', isDefault: false });
    const planner = makePlanner();
    const group = makeGroup();

    assert.equal(
      resolvePanelBrowseCwd({
        chat: planner,
        groups: [group],
        activeBoardGroup: group,
        chats: [planner],
      }),
      WT_INTEGRATION,
    );
  });
});
