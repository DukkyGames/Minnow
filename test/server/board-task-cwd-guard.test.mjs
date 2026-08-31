/**
 * board-task-cwd-guard — worktree default cwd and absolute-cd guard (MIN-286 Part 9).
 *
 * Tests the pure guard logic in server/tools/cwd-guard.js and the chat-context
 * resolver in server/workspace/chat-cwd.js (injecting minimal session state).
 * Also covers the SQLite hot path when injectedState is omitted.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { closeSessionsDb } from '../../server/config/sessions-db.js';
import { writeWholeSessionState } from '../../server/config/sessions-repo.js';
import { validateSessionState } from '../../server/config/validators.js';
import { guardCdOutsideWorktree } from '../../server/tools/cwd-guard.js';
import { resolveChatContext } from '../../server/workspace/chat-cwd.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';

const CHAT_ID = '22222222-2222-2222-2222-222222222222';
const GROUP_ID = 'grp_22222222-2222-2222-2222-222222222222';
const TASK_ID = 'W1-B';
const WORKTREE = 'C:/worktrees/board-b/task-W1-B';

function baseState(overrides = {}) {
  return {
    version: 5,
    activeId: CHAT_ID,
    sidebarCollapsed: false,
    chats: [],
    groups: [],
    ...overrides,
  };
}

// ── resolveChatContext ──────────────────────────────────────────────────────

describe('resolveChatContext', () => {
  it('returns worktreeRoot and groupId from chat.worktreeRoot', async () => {
    const state = baseState({
      chats: [
        {
          id: CHAT_ID,
          name: 'Task chat',
          modelId: '',
          modeId: 'build',
          history: [],
          updatedAt: 1,
          worktreeRoot: WORKTREE,
          boardGroupId: GROUP_ID,
        },
      ],
    });
    const ctx = await resolveChatContext(CHAT_ID, state);
    assert.equal(ctx.worktreeRoot, WORKTREE);
    assert.equal(ctx.groupId, GROUP_ID);
  });

  it('falls back to task.worktreePath when chat.worktreeRoot absent', async () => {
    const state = baseState({
      chats: [
        {
          id: CHAT_ID,
          name: 'Task chat',
          modelId: '',
          modeId: 'build',
          history: [],
          updatedAt: 1,
          boardGroupId: GROUP_ID,
          boardTaskId: TASK_ID,
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
          orchestrateBoard: {
            planPath: 'plan.md',
            status: 'running',
            tasks: [
              {
                id: TASK_ID,
                title: 'Task B',
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
    });
    const ctx = await resolveChatContext(CHAT_ID, state);
    assert.equal(ctx.worktreeRoot, WORKTREE);
    assert.equal(ctx.groupId, GROUP_ID);
  });

  it('returns undefined for unknown chatId', async () => {
    const state = baseState({ chats: [] });
    const ctx = await resolveChatContext('unknown-id', state);
    assert.equal(ctx.worktreeRoot, undefined);
    assert.equal(ctx.groupId, undefined);
  });
});

describe('resolveChatContext (SQLite hot path)', () => {
  let homeDir;
  let savedHome;
  let savedStore;

  before(() => {
    savedHome = process.env.MINNOW_HOME;
    savedStore = process.env.MINNOW_SESSIONS_STORE;
    delete process.env.MINNOW_SESSIONS_STORE;
    homeDir = setTestHome(process.env, `minnow-chat-ctx-db-${Date.now()}`);
  });

  after(() => {
    closeSessionsDb();
    if (savedHome === undefined) delete process.env.MINNOW_HOME;
    else process.env.MINNOW_HOME = savedHome;
    if (savedStore === undefined) delete process.env.MINNOW_SESSIONS_STORE;
    else process.env.MINNOW_SESSIONS_STORE = savedStore;
    return rmTestHome(homeDir);
  });

  it('returns worktreeRoot and groupId from SQLite without injectedState', async () => {
    const state = validateSessionState(
      baseState({
        chats: [
          {
            id: CHAT_ID,
            name: 'Task chat',
            modelId: '',
            modeId: 'build',
            history: [],
            updatedAt: 1,
            worktreeRoot: WORKTREE,
            boardGroupId: GROUP_ID,
          },
        ],
      }),
    );
    writeWholeSessionState(state);

    const ctx = await resolveChatContext(CHAT_ID);
    assert.equal(ctx.worktreeRoot, WORKTREE);
    assert.equal(ctx.groupId, GROUP_ID);
  });
});

// ── guardCdOutsideWorktree ──────────────────────────────────────────────────

describe('guardCdOutsideWorktree', () => {
  const TREE = 'C:/worktrees/board-b/task-W1-B';

  it('redirects a leading absolute Windows cd outside the worktree', () => {
    const result = guardCdOutsideWorktree('cd C:/some/other/path && npm install', TREE);
    assert.equal(result.redirected, true);
    assert.ok(result.command.startsWith(`cd "${TREE}"`), `got: ${result.command}`);
    assert.ok(result.command.includes('npm install'), `got: ${result.command}`);
  });

  it('redirects a leading absolute Unix cd outside the worktree', () => {
    const result = guardCdOutsideWorktree('cd /usr/local/bin', TREE);
    assert.equal(result.redirected, true);
    assert.equal(result.command, `cd "${TREE}"`);
  });

  it('does NOT redirect a cd that stays inside the worktree', () => {
    const result = guardCdOutsideWorktree(`cd ${TREE}/subdir`, TREE);
    assert.equal(result.redirected, false);
    assert.ok(result.command.includes(`${TREE}/subdir`));
  });

  it('does NOT redirect relative cd', () => {
    const result = guardCdOutsideWorktree('cd src && ls', TREE);
    assert.equal(result.redirected, false);
  });

  it('does NOT redirect a non-cd command', () => {
    const result = guardCdOutsideWorktree('npm ci', TREE);
    assert.equal(result.redirected, false);
  });

  // Known limitation — document as such.
  it('does NOT catch mid-command absolute cd (known limitation)', () => {
    // chained `npm ci && cd /abs/path && run tests` escapes isolation;
    // only leading-cd is caught.
    const result = guardCdOutsideWorktree('npm ci && cd /absolute/escape && ls', TREE);
    assert.equal(result.redirected, false,
      'mid-command absolute cd is a known limitation — not caught by the guard');
  });

  it('handles command that is only a bare absolute cd', () => {
    const result = guardCdOutsideWorktree('  cd   C:\\outside\\path  ', TREE);
    assert.equal(result.redirected, true);
    assert.equal(result.command.trim(), `cd "${TREE}"`);
  });
});
