/**
 * Terminal worktree cwd resolution (MIN-349).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  formatTerminalCwdHeader,
  formatTerminalShellHint,
  getTerminalCwdLabelSuffix,
  isTerminalWorktreeCwd,
  resolveActiveChatTerminalCwd,
  terminalCwdsEqual,
} from '../../src/ui/terminal-worktree-cwd.ts';
import {
  resetWorkspaceStateForTests,
  setWorkspaceFromServer,
} from '../../src/state/workspace.ts';

const MAIN_WS = 'C:/projects/minnow';
const WORKTREE = 'C:/projects/minnow/.minnow/worktrees/task-abc';

afterEach(() => {
  resetWorkspaceStateForTests();
});

describe('resolveActiveChatTerminalCwd', () => {
  test('returns chat worktreeRoot when set', () => {
    setWorkspaceFromServer({ path: MAIN_WS, label: 'minnow', isDefault: false });
    const cwd = resolveActiveChatTerminalCwd(
      { worktreeRoot: WORKTREE },
      undefined,
    );
    assert.equal(cwd, WORKTREE);
  });

  test('falls back to main workspace when no worktree', () => {
    setWorkspaceFromServer({ path: MAIN_WS, label: 'minnow', isDefault: false });
    const cwd = resolveActiveChatTerminalCwd({}, undefined);
    assert.equal(cwd, MAIN_WS);
  });

  test('resolves board task worktreePath', () => {
    setWorkspaceFromServer({ path: MAIN_WS, label: 'minnow', isDefault: false });
    const cwd = resolveActiveChatTerminalCwd(
      { boardGroupId: 'grp-1', boardTaskId: 'W1-A' },
      [
        {
          id: 'grp-1',
          name: 'Board',
          workspacePath: MAIN_WS,
          collapsed: false,
          order: 0,
          createdAt: 1,
          orchestrateBoard: {
            planPath: 'plan.md',
            executionMode: 'auto',
            tasks: [
              {
                id: 'W1-A',
                title: 'Task',
                wave: 'W1',
                category: 'build',
                status: 'in_progress',
                worktreePath: WORKTREE,
              },
            ],
            waves: [{ id: 'W1', status: 'in_progress' }],
            finalTest: { status: 'pending' },
          },
        },
      ],
    );
    assert.equal(cwd, WORKTREE);
  });
});

describe('terminal cwd labels', () => {
  test('worktree suffix uses basename', () => {
    setWorkspaceFromServer({ path: MAIN_WS, label: 'minnow', isDefault: false });
    assert.equal(getTerminalCwdLabelSuffix(WORKTREE), ' · task-abc');
    assert.equal(getTerminalCwdLabelSuffix(MAIN_WS), '');
    assert.equal(isTerminalWorktreeCwd(WORKTREE), true);
    assert.equal(isTerminalWorktreeCwd(MAIN_WS), false);
  });

  test('header labels worktree distinctly', () => {
    setWorkspaceFromServer({ path: MAIN_WS, label: 'minnow', isDefault: false });
    assert.equal(formatTerminalCwdHeader(WORKTREE), 'task-abc (worktree)');
    assert.equal(formatTerminalCwdHeader(MAIN_WS), 'minnow');
  });
});

describe('formatTerminalShellHint', () => {
  test('mentions worktree path when scoped', () => {
    setWorkspaceFromServer({ path: MAIN_WS, label: 'minnow', isDefault: false });
    const hint = formatTerminalShellHint(WORKTREE);
    assert.match(hint, /active chat worktree/);
    assert.match(hint, /task-abc/);
  });

  test('prompts for new tab after chat switch', () => {
    setWorkspaceFromServer({ path: MAIN_WS, label: 'minnow', isDefault: false });
    const hint = formatTerminalShellHint(WORKTREE, {
      chatSwitched: true,
      activeShellDiffers: true,
    });
    assert.match(hint, /open a new terminal tab/);
    assert.match(hint, /task-abc/);
  });
});

describe('terminalCwdsEqual', () => {
  test('normalizes path separators', () => {
    assert.equal(terminalCwdsEqual('a/b/', 'a\\b'), true);
  });
});
