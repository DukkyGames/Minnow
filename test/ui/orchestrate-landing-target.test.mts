/**
 * Phase 3.4: entering Orchestrator returns to the board the user was inside,
 * falling back to a running board and only then to the hub.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { resolveOrchestrateLandingTarget } from '../../src/ui/orchestrate-hub.ts';
import { initBoard } from '../../src/state/orchestrate-board-store.ts';
import { getOrCreateBoardGroup } from '../../src/state/chat-groups.ts';
import {
  createEmptyChatObject,
  sessionState,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import {
  resetWorkspaceStateForTests,
  setWorkspaceFromServer,
} from '../../src/state/workspace.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const WORKSPACE = '/tmp/orchestrate-landing-test';

function makePlanner(planPath: string): Chat {
  const chat = createEmptyChatObject('m1');
  chat.workspacePath = WORKSPACE;
  chat.modeId = 'orchestrate';
  chat.orchestratePlanPath = planPath;
  return chat;
}

/** Seed a session with N board folders; returns them in creation order. */
function seedBoards(count: number): ChatGroup[] {
  const planners = Array.from({ length: count }, (_, i) =>
    makePlanner(`documentation/plans/plan-${i}.md`),
  );
  setSessionStateForTests({
    version: 5,
    activeId: planners[0]!.id,
    sidebarCollapsed: false,
    groups: [],
    chats: planners,
  });

  return planners.map((planner, i) => {
    const group = getOrCreateBoardGroup(planner);
    initBoard(group, planner, {
      planPath: `documentation/plans/plan-${i}.md`,
      tasks: [{ id: 't1', title: 'One', wave: 1, category: 'code' }],
      waves: [{ id: 'W1' }],
    });
    return group;
  });
}

describe('resolveOrchestrateLandingTarget (Phase 3.4)', () => {
  beforeEach(() => {
    setWorkspaceFromServer({ path: WORKSPACE, label: 'landing', isDefault: false });
  });

  afterEach(() => {
    setSessionStateForTests(null);
    resetWorkspaceStateForTests();
  });

  test('returns null with no boards, so the hub stays the destination', () => {
    setSessionStateForTests({
      version: 5,
      activeId: '',
      sidebarCollapsed: false,
      groups: [],
      chats: [],
    });
    assert.equal(resolveOrchestrateLandingTarget(), null);
  });

  test('resumes the last board the user was inside', () => {
    const [first, second] = seedBoards(2);
    sessionState!.lastBoardGroupId = second!.id;

    assert.equal(resolveOrchestrateLandingTarget()?.id, second!.id);
    assert.notEqual(resolveOrchestrateLandingTarget()?.id, first!.id);
  });

  test('ignores a last-board pointer at a group that no longer exists', () => {
    seedBoards(1);
    sessionState!.lastBoardGroupId = 'grp_deleted';
    // No board is running, so there is nothing else to fall back to.
    assert.equal(resolveOrchestrateLandingTarget(), null);
  });

  test('falls back to a running board when there is no last board', () => {
    const [first, second] = seedBoards(2);
    delete sessionState!.lastBoardGroupId;
    second!.orchestrateBoard!.autoRunning = true;

    assert.equal(
      resolveOrchestrateLandingTarget()?.id,
      second!.id,
      'a board still doing work is the one worth returning to',
    );
    assert.ok(first);
  });

  test('a stopped board alone is not a landing target', () => {
    seedBoards(1);
    delete sessionState!.lastBoardGroupId;
    assert.equal(resolveOrchestrateLandingTarget(), null);
  });
});
