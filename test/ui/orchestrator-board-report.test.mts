/**
 * V2 finish report pane: replaces the kanban, renders markdown, exposes actions.
 */
import '../tools/install-dom-before-imports.mts';

import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals } from '../os/dom-helpers.mts';
import { derive } from '../../server/orchestrator/core/derive.js';
import type { BoardState } from '../../server/orchestrator/core/types';

mock.module('../../src/ui/sidebar.ts', {
  namedExports: {
    createChatWithMode: () => ({}),
  },
});

mock.module('../../src/state/git-api.ts', {
  namedExports: {
    gitCommit: async () => ({ ok: true }),
    gitPush: async () => ({ ok: true }),
  },
});

mock.module('../../src/state/worktree-service.ts', {
  namedExports: {
    cleanupBoardWorktrees: async () => ({ ok: true, removed: 0 }),
    mergeIntegrationIntoWorkspace: async () => ({ ok: true, merged: true }),
    openWorkspacePr: async () => ({ ok: true, url: 'https://example.test/pr' }),
    workspaceLandingStats: async () => ({
      ok: true,
      fileCount: 3,
      additions: 12,
      deletions: 2,
      hasRemote: false,
      hasGh: false,
      alreadyLanded: false,
    }),
  },
});

mock.module('dompurify', {
  defaultExport: {
    sanitize: (html: string) => html,
  },
});

const {
  renderBoardReport,
  wantsReportScreen,
  canReopenFailed,
  canFixFinal,
  clearBoardReportStateForTests,
  integrationBranchName,
} = await import('../../src/orchestrator/board-report.ts');

let activeWindow: Window | undefined;

function setupDom(): void {
  activeWindow?.close();
  const win = new Window();
  activeWindow = win;
  installHappyDomGlobals(win);
}

afterEach(() => {
  if (activeWindow) document.body.innerHTML = '';
  activeWindow?.close();
  activeWindow = undefined;
  clearBoardReportStateForTests();
});

function finishedBoard(): BoardState {
  return derive([
    {
      v: 1,
      seq: 1,
      type: 'board.created',
      boardId: 'b1',
      planPath: 'documentation/plans/x.md',
      name: 'Example',
      waves: [{ n: 1, name: 'Foundations' }],
      tasks: [
        { id: 'W1-A', title: 'A', wave: 1, dependsOn: [], touches: ['a.ts'] },
        { id: 'W1-B', title: 'B', wave: 1, dependsOn: [], touches: ['b.ts'] },
      ],
    },
    {
      v: 1,
      seq: 2,
      type: 'merge.succeeded',
      taskId: 'W1-A',
      sha: 'abc123abc123',
    },
    {
      v: 1,
      seq: 3,
      type: 'task.abandoned',
      taskId: 'W1-B',
      reason: 'builder-failed-twice',
    },
    {
      v: 1,
      seq: 4,
      type: 'final.test.ended',
      outcome: 'fail',
      runInstructions: 'npx tsc --noEmit',
    },
    {
      v: 1,
      seq: 5,
      type: 'run.finished',
      summary: '1 merged, 1 abandoned, final test fail',
    },
  ]);
}

describe('wantsReportScreen', () => {
  test('is true when finished or user-stopped', () => {
    const done = finishedBoard();
    assert.equal(wantsReportScreen(done), true);
    const stopped = derive([
      {
        v: 1,
        seq: 1,
        type: 'board.created',
        boardId: 'b1',
        planPath: 'p.md',
        tasks: [{ id: 'W1-A', title: 'A', wave: 1, dependsOn: [], touches: ['a.ts'] }],
        waves: [],
      },
      { v: 1, seq: 2, type: 'board.started', concurrency: 2 },
      { v: 1, seq: 3, type: 'board.stopped', reason: 'user' },
    ]);
    assert.equal(wantsReportScreen(stopped), true);
    assert.equal(canReopenFailed(done), true);
    assert.equal(canFixFinal(done), true);
  });
});

describe('renderBoardReport', () => {
  test('renders markdown, journal ledger, and actions instead of a pre dump', () => {
    setupDom();
    const state = finishedBoard();
    const node = renderBoardReport(state, '# Hello report\n\nDone.', false, {
      dismiss: () => {},
      reopen: () => {},
      fixFinal: () => {},
    });
    assert.equal(node.querySelector('pre.ov2-finish__body'), null);
    assert.match(node.textContent ?? '', /Board blocked/);
    assert.match(node.textContent ?? '', /Hello report/);
    assert.match(node.textContent ?? '', /What the journal says/);
    assert.match(node.textContent ?? '', /Rerun 1 failed task/);
    assert.match(node.textContent ?? '', /Back to board/);
    assert.match(node.textContent ?? '', /Start follow-up chat/);
    assert.match(node.textContent ?? '', /npx tsc --noEmit/);
  });

  test('Back to board calls dismiss', () => {
    setupDom();
    let dismissed = 0;
    const node = renderBoardReport(finishedBoard(), 'ok', false, {
      dismiss: () => {
        dismissed += 1;
      },
      reopen: () => {},
      fixFinal: () => {},
    });
    const back = [...node.querySelectorAll('button')].find((b) => b.textContent === 'Back to board');
    assert.ok(back);
    back!.click();
    assert.equal(dismissed, 1);
  });
});

describe('integrationBranchName', () => {
  test('matches the engine worktree formula', () => {
    assert.equal(integrationBranchName('ant-game-build'), 'minnow/board/ant-game-build/integration');
  });
});
