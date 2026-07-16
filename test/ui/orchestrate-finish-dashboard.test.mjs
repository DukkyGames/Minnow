/**
 * MIN-456: finish dashboard git action — hide commit after landing, align clear worktrees.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import { Window } from 'happy-dom';

mock.module('dompurify', {
  defaultExport: {
    sanitize: (html) => html,
  },
});

const { createEmptyChatObject } = await import('../../src/state/sessions.ts');
const { setLocalServerAvailableForTests } = await import('../../src/tools/config.ts');
const {
  renderFinishDashboard,
  clearFinishDashboardStateForTests,
} = await import('../../src/ui/orchestrate-finish-dashboard.ts');

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';

function makeGroup(overrides = {}) {
  return {
    id: GROUP_ID,
    name: 'Fixture Board',
    workspacePath: '',
    collapsed: false,
    order: 0,
    createdAt: 1,
    orchestrateBoard: {
      planPath: 'documentation/plans/fixture-plan.md',
      startedAt: 1,
      lastUpdatedAt: 1,
      waves: [{ id: 'W1', status: 'complete' }],
      tasks: [
        {
          id: 'W1-A',
          title: 'Task A',
          wave: 'W1',
          category: 'build',
          status: 'complete',
        },
      ],
      integrationBranch: 'minnow/board/fixture/integration',
      finalTest: { status: 'passed' },
      finishReport: '## Summary\n\nDone.',
      ...overrides,
    },
  };
}

function makePlannerChat() {
  const chat = createEmptyChatObject('');
  chat.id = CHAT_ID;
  chat.modeId = 'orchestrate';
  chat.orchestratePlanPath = 'documentation/plans/fixture-plan.md';
  return chat;
}

function mockWorktreeFetch(alreadyLanded = false) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/api/worktree')) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.op === 'workspace_landing_stats') {
        return new Response(
          JSON.stringify({
            ok: true,
            additions: 1,
            deletions: 0,
            fileCount: 1,
            hasRemote: false,
            hasGh: false,
            alreadyLanded,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }
    return originalFetch(input, init);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function readGitAction(actions) {
  return actions.querySelector('[data-board-git-action]');
}

function setupDom(window) {
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
}

describe('orchestrate finish dashboard git action (MIN-456)', () => {
  let restoreFetch = () => {};

  afterEach(() => {
    restoreFetch();
    setLocalServerAvailableForTests(false);
    clearFinishDashboardStateForTests();
  });

  test('shows commit action before integration lands in workspace', async () => {
    setupDom(new Window());
    setLocalServerAvailableForTests(true);
    restoreFetch = mockWorktreeFetch(false);

    const group = makeGroup();
    const plannerChat = makePlannerChat();
    const root = renderFinishDashboard(group, plannerChat, group.orchestrateBoard);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const actions = root.querySelector('.board-finish-dashboard__actions');

    const gitAction = readGitAction(actions);
    assert.ok(gitAction);
    assert.equal(gitAction.dataset.boardGitAction, 'commit');
    assert.ok(gitAction.classList.contains('board-finish-dashboard__git-action'));
    assert.ok(gitAction.querySelector('.board-finish-dashboard__commit-primary'));
  });

  test('shows clear worktrees instead of commit when integration already landed', async () => {
    setupDom(new Window());
    setLocalServerAvailableForTests(true);
    restoreFetch = mockWorktreeFetch(true);

    const group = makeGroup({ integrationLandedAt: 1710000000000 });
    const plannerChat = makePlannerChat();
    const root = renderFinishDashboard(group, plannerChat, group.orchestrateBoard);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const actions = root.querySelector('.board-finish-dashboard__actions');

    const gitAction = readGitAction(actions);
    assert.ok(gitAction);
    assert.equal(gitAction.dataset.boardGitAction, 'clear');
    assert.equal(gitAction.textContent, 'Clear worktrees');
    assert.ok(gitAction.classList.contains('board-finish-dashboard__git-action'));
    assert.equal(actions.querySelector('.board-finish-dashboard__commit-split'), null);
  });

  test('shows cleared label after worktrees are removed', async () => {
    setupDom(new Window());
    setLocalServerAvailableForTests(true);
    restoreFetch = mockWorktreeFetch(true);

    const group = makeGroup({
      integrationLandedAt: 1710000000000,
      worktreesClearedAt: 1710003600000,
    });
    const plannerChat = makePlannerChat();
    const root = renderFinishDashboard(group, plannerChat, group.orchestrateBoard);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const actions = root.querySelector('.board-finish-dashboard__actions');

    const gitAction = readGitAction(actions);
    assert.ok(gitAction);
    assert.equal(gitAction.dataset.boardGitAction, 'cleared');
    assert.equal(gitAction.textContent, 'Worktrees cleared');
    assert.ok(gitAction.classList.contains('board-finish-dashboard__git-action'));
  });

  test('detects already-landed integration from git stats and swaps to clear worktrees', async () => {
    setupDom(new Window());
    setLocalServerAvailableForTests(true);
    restoreFetch = mockWorktreeFetch(true);

    const group = makeGroup();
    const plannerChat = makePlannerChat();
    const root = renderFinishDashboard(group, plannerChat, group.orchestrateBoard);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const actions = root.querySelector('.board-finish-dashboard__actions');

    const gitAction = readGitAction(actions);
    assert.ok(gitAction);
    assert.equal(gitAction.dataset.boardGitAction, 'clear');
    assert.equal(typeof group.orchestrateBoard.integrationLandedAt, 'number');
  });
});
