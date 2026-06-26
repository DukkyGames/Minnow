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
    group.orchestrateBoard.finalTest = { status: 'passed' };
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

  test('merging label when task is merging and no task chats are running', () => {
    const chat = makeOrchestrateChat();
    const group = makeGroup();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'B', wave: 'W1', category: 'build' },
      ],
      waves: [{ id: 'W1' }],
    });
    updateTask(group, 'W1-A', { status: 'complete' });
    updateTask(group, 'W1-B', { status: 'merging' });
    const status = deriveBoardHeaderStatus(group.orchestrateBoard, false, 0, false);
    assert.deepEqual(status, { variant: 'active', label: 'Merging' });
  });

  test('active (not paused) when only task is merging with no running chats', () => {
    const chat = makeOrchestrateChat();
    const group = makeGroup();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    updateTask(group, 'W1-A', { status: 'merging' });
    const status = deriveBoardHeaderStatus(group.orchestrateBoard, false, 0, false);
    assert.deepEqual(status, { variant: 'active', label: 'Merging' });
    assert.notEqual(status.variant, 'paused');
  });

  test('active label when merging task still has a running task chat', () => {
    const chat = makeOrchestrateChat();
    const group = makeGroup();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    updateTask(group, 'W1-A', { status: 'merging', chatId: CHAT_ID });
    const status = deriveBoardHeaderStatus(group.orchestrateBoard, false, 1, false);
    assert.deepEqual(status, { variant: 'active', label: 'Active' });
  });

  test('merging counts as in-flight so blocked is not shown while merge is pending', () => {
    const chat = makeOrchestrateChat();
    const group = makeGroup();
    initBoard(group, chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'B', wave: 'W1', category: 'build' },
      ],
      waves: [{ id: 'W1' }],
    });
    updateTask(group, 'W1-A', { status: 'blocked' });
    updateTask(group, 'W1-B', { status: 'merging' });
    const status = deriveBoardHeaderStatus(group.orchestrateBoard, false, 0, false);
    assert.deepEqual(status, { variant: 'active', label: 'Merging' });
  });
});

describe('isUserStoppedChat', () => {
  test('false for new chat', () => {
    const chat = makeOrchestrateChat();
    assert.equal(isUserStoppedChat(chat), false);
  });
});
