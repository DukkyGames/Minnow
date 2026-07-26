/**
 * Issues board-complete → review status helper (MIN-261 Phase 3).
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { markIssuesReviewForBoardComplete } from '../../src/chat/issues/board-review.ts';
import {
  addIssue,
  findIssueById,
  setIssuesNowForTests,
  setIssuesStateForTests,
  updateIssue,
} from '../../src/state/issues-store.ts';

const FIXED_NOW = 1710000003000;

describe('markIssuesReviewForBoardComplete', () => {
  beforeEach(() => {
    setIssuesNowForTests(() => FIXED_NOW);
    setIssuesStateForTests({ version: 1, nextId: 1, issues: [] });
  });

  test('matches by boardChatId and moves to review', () => {
    const issue = addIssue({ title: 'Boarded', workspacePath: '/w' });
    updateIssue(issue.id, {
      status: 'in_progress',
      boardChatId: 'planner-chat-1',
      planPath: 'documentation/plans/issues/ISS-1.md',
    });
    const updated = markIssuesReviewForBoardComplete({
      plannerChatId: 'planner-chat-1',
    });
    assert.deepEqual(updated, [issue.id]);
    assert.equal(findIssueById(issue.id)?.status, 'review');
  });

  test('matches by planPath when boardChatId differs', () => {
    const issue = addIssue({ title: 'Planned', workspacePath: '/w' });
    updateIssue(issue.id, {
      status: 'in_progress',
      planPath: 'documentation/plans/issues/ISS-1.md',
    });
    const updated = markIssuesReviewForBoardComplete({
      planPath: 'documentation/plans/issues/ISS-1.md',
    });
    assert.deepEqual(updated, [issue.id]);
    assert.equal(findIssueById(issue.id)?.status, 'review');
  });

  test('skips done / canceled / already review', () => {
    const done = addIssue({ title: 'Done', workspacePath: '/w' });
    updateIssue(done.id, {
      status: 'done',
      boardChatId: 'p1',
      planPath: 'documentation/plans/issues/ISS-1.md',
    });
    const canceled = addIssue({ title: 'Canceled', workspacePath: '/w' });
    updateIssue(canceled.id, {
      status: 'canceled',
      boardChatId: 'p1',
    });
    const already = addIssue({ title: 'Review', workspacePath: '/w' });
    updateIssue(already.id, {
      status: 'review',
      boardChatId: 'p1',
    });
    const updated = markIssuesReviewForBoardComplete({ plannerChatId: 'p1' });
    assert.deepEqual(updated, []);
  });
});
