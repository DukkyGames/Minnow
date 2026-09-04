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

/** Captures follow-up navigation so tests can assert close-then-create, no seed. */
const followUpLog: Array<{ kind: string; payload?: unknown }> = [];
let fileTreeRefreshCalls = 0;

mock.module('../../src/ui/sidebar.ts', {
  namedExports: {
    createChatWithMode: (options: unknown) => {
      followUpLog.push({ kind: 'createChatWithMode', payload: options });
      return {};
    },
  },
});

mock.module('../../src/orchestrator/boards-view.ts', {
  namedExports: {
    closeBoardsView: async (options?: unknown) => {
      followUpLog.push({ kind: 'closeBoardsView', payload: options });
    },
  },
});

mock.module('../../src/state/git-api.ts', {
  namedExports: {
    gitCommit: async () => ({ ok: true }),
    gitPush: async () => ({ ok: true }),
  },
});

mock.module('../../src/ui/file-tree-refresh-bridge.ts', {
  namedExports: {
    refreshFileTreeViaBridge: async () => {
      fileTreeRefreshCalls += 1;
    },
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
  buildBoardFollowUpContext,
  startFollowUp,
} = await import('../../src/orchestrator/board-report.ts');
const { getPendingAttachments, clearAttachments } = await import(
  '../../src/attachments/store.ts'
);

let activeWindow: Window | undefined;

function setupDom(): void {
  activeWindow?.close();
  const win = new Window();
  activeWindow = win;
  installHappyDomGlobals(win);
}

afterEach(() => {
  followUpLog.length = 0;
  fileTreeRefreshCalls = 0;
  if (activeWindow) {
    clearAttachments();
    document.body.innerHTML = '';
    activeWindow.close();
    activeWindow = undefined;
  }
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

  test('Commit refreshes the file tree after landing changes', async () => {
    setupDom();
    const node = renderBoardReport(finishedBoard(), 'ok', false, {
      dismiss: () => {},
      reopen: () => {},
      fixFinal: () => {},
    });
    const commit = node.querySelector<HTMLButtonElement>('.ov2-report-screen__commit-primary');
    assert.ok(commit);
    commit!.click();
    for (let i = 0; i < 40 && fileTreeRefreshCalls === 0; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(fileTreeRefreshCalls, 1);
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

describe('buildBoardFollowUpContext', () => {
  test('includes title, plan, every task phase, and report; omits the review prompt', () => {
    const state = finishedBoard();
    const text = buildBoardFollowUpContext(state, '# Hello report\n\nDone.');
    assert.match(text, /Board: Example/);
    assert.match(text, /Board id: b1/);
    assert.match(text, /Plan: documentation\/plans\/x\.md/);
    assert.match(text, /minnow\/board\/b1\/integration/);
    assert.match(text, /Summary: 1 merged, 1 abandoned, final test fail/);
    assert.match(text, /W1-A \[merged\]: A/);
    assert.match(text, /W1-B \[abandoned\]: B/);
    assert.match(text, /Hello report/);
    assert.doesNotMatch(text, /Help me review/);
    assert.doesNotMatch(text, /Merged tasks:/);
  });
});

describe('startFollowUp', () => {
  test('closes Boards, opens General chat without a seed, and queues a title chip', async () => {
    setupDom();
    const input = document.createElement('textarea');
    input.id = 'msgInput';
    document.body.appendChild(input);
    const preview = document.createElement('div');
    preview.id = 'attachPreview';
    document.body.appendChild(preview);

    const state = finishedBoard();
    await startFollowUp(state, '# Hello report\n\nDone.');

    assert.deepEqual(
      followUpLog.map((entry) => entry.kind),
      ['closeBoardsView', 'createChatWithMode'],
    );
    assert.deepEqual(followUpLog[0].payload, { restoreChat: false });
    const createOpts = followUpLog[1].payload as { modeId?: string; initialUserMessage?: string };
    assert.equal(createOpts.modeId, 'general');
    assert.equal('initialUserMessage' in createOpts, false);

    const pending = getPendingAttachments();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].kind, 'text');
    assert.equal(pending[0].name, 'Example');
    assert.match(pending[0].text ?? '', /W1-B \[abandoned\]: B/);
    assert.doesNotMatch(pending[0].text ?? '', /Help me review/);
    assert.equal(document.activeElement, input);
  });

  test('Start follow-up chat does not auto-send', async () => {
    setupDom();
    const node = renderBoardReport(finishedBoard(), 'ok', false, {
      dismiss: () => {},
      reopen: () => {},
      fixFinal: () => {},
    });
    const follow = [...node.querySelectorAll('button')].find(
      (b) => b.textContent === 'Start follow-up chat',
    );
    assert.ok(follow);
    follow!.click();
    for (let i = 0; i < 40 && !followUpLog.some((e) => e.kind === 'createChatWithMode'); i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const create = followUpLog.find((entry) => entry.kind === 'createChatWithMode');
    assert.ok(create);
    const opts = create!.payload as { initialUserMessage?: string };
    assert.equal(opts.initialUserMessage, undefined);
  });
});
