/**
 * Board header badge: deriveBoardHeaderStatus + isUserStoppedChat.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/fixture-plan.md';

const { createEmptyChatObject } = await import('../../src/state/sessions.ts');
const { initBoard, updateTask } = await import('../../src/state/orchestrate-board-store.ts');
const {
  deriveBoardHeaderStatus,
  isUserStoppedChat,
} = await import('../../src/ui/orchestrate-board.ts');

function makeGroup() {
  return {
    id: GROUP_ID,
    name: 'Fixture Board',
    workspacePath: '',
    collapsed: false,
    order: 0,
    createdAt: 1,
  };
}

function makeOrchestrateChat() {
  const chat = createEmptyChatObject('');
  chat.id = CHAT_ID;
  chat.modeId = 'orchestrate';
  chat.orchestratePlanPath = PLAN_PATH;
  return chat;
}

describe('deriveBoardHeaderStatus', () => {
  test('complete when all tasks are complete', () => {
    const chat = makeOrchestrateChat();
    const group = makeGroup();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    updateTask(group, 'W1-A', { status: 'complete' });
    const status = deriveBoardHeaderStatus(group.orchestrateBoard, false, 0, false);
    assert.deepEqual(status, { variant: 'complete', label: 'Complete' });
  });

  test('ready for fresh board with only planned tasks', () => {
    const chat = makeOrchestrateChat();
    const group = makeGroup();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    const status = deriveBoardHeaderStatus(group.orchestrateBoard, false, 0, false);
    assert.equal(status.variant, 'ready');
  });
});

describe('isUserStoppedChat', () => {
  test('false for new chat', () => {
    const chat = makeOrchestrateChat();
    assert.equal(isUserStoppedChat(chat), false);
  });
});
