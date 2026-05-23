/**
 * Board header badge: deriveBoardHeaderStatus + isUserStoppedChat (MIN-35).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/fixture-plan.md';

const { createEmptyChatObject } = await import('../../src/state/sessions.ts');
const { initBoard, updateTask } = await import('../../src/state/orchestrate-board-store.ts');
const {
  deriveBoardHeaderStatus,
  isUserStoppedChat,
} = await import('../../src/ui/orchestrate-board.ts');
const {
  markChatStalledForUi,
  resetSupervisorStateForTests,
  shouldShowOrchestrateStallBadge,
} = await import('../../src/agents/supervisor/state.ts');

function makeOrchestrateChat() {
  const chat = createEmptyChatObject({ id: CHAT_ID, modeId: 'orchestrate' });
  chat.orchestratePlanPath = PLAN_PATH;
  return chat;
}

afterEach(() => {
  resetSupervisorStateForTests();
});

describe('deriveBoardHeaderStatus (MIN-35)', () => {
  test('complete plan wins over stale watchdog stall flag', () => {
    const chat = makeOrchestrateChat();
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    updateTask(chat, 'W1-A', { status: 'complete' });
    markChatStalledForUi(CHAT_ID, true);
    const gated = shouldShowOrchestrateStallBadge(CHAT_ID, chat.orchestrateBoard, {
      isStreaming: false,
      activeRunCount: 0,
    });
    assert.equal(gated, false);
    const status = deriveBoardHeaderStatus(
      chat.orchestrateBoard,
      false,
      0,
      false,
      gated,
    );
    assert.deepEqual(status, { variant: 'complete', label: 'Complete' });
  });

  test('idle incomplete board with stale flag still shows stalled when runtime-gated', () => {
    const chat = makeOrchestrateChat();
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [
        { id: 'W1-A', title: 'A', wave: 'W1', category: 'build' },
        { id: 'W1-B', title: 'B', wave: 'W1', category: 'build' },
      ],
      waves: [{ id: 'W1' }],
    });
    updateTask(chat, 'W1-A', { status: 'complete' });
    markChatStalledForUi(CHAT_ID, true);
    const gated = shouldShowOrchestrateStallBadge(CHAT_ID, chat.orchestrateBoard, {
      isStreaming: false,
      activeRunCount: 0,
    });
    assert.equal(gated, true);
    const status = deriveBoardHeaderStatus(
      chat.orchestrateBoard,
      false,
      0,
      false,
      gated,
    );
    assert.deepEqual(status, { variant: 'stalled', label: 'Stalled — Resume' });
  });

  test('stale stall flag hidden while parent streams', () => {
    const chat = makeOrchestrateChat();
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    chat.orchestrateBoard.activeParentTurnId = 'turn-stream';
    markChatStalledForUi(CHAT_ID, true);
    const gated = shouldShowOrchestrateStallBadge(CHAT_ID, chat.orchestrateBoard, {
      isStreaming: true,
      activeRunCount: 0,
    });
    assert.equal(gated, false);
    const status = deriveBoardHeaderStatus(
      chat.orchestrateBoard,
      true,
      0,
      false,
      gated,
    );
    assert.deepEqual(status, { variant: 'running', label: 'Running' });
  });

  test('stopped badge only for latest assistant stop with incomplete work', () => {
    const chat = makeOrchestrateChat();
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    updateTask(chat, 'W1-A', { status: 'in_progress' });
    chat.history.push({ role: 'assistant', content: 'partial', stopped: true });
    assert.equal(isUserStoppedChat(chat), true);
    const status = deriveBoardHeaderStatus(
      chat.orchestrateBoard,
      false,
      0,
      isUserStoppedChat(chat),
      false,
    );
    assert.deepEqual(status, { variant: 'stopped', label: 'Stopped' });
  });

  test('old stopped message does not stick when plan is complete', () => {
    const chat = makeOrchestrateChat();
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    updateTask(chat, 'W1-A', { status: 'complete' });
    chat.history.push({ role: 'assistant', content: 'aborted', stopped: true });
    assert.equal(isUserStoppedChat(chat), false);
    const status = deriveBoardHeaderStatus(
      chat.orchestrateBoard,
      false,
      0,
      isUserStoppedChat(chat),
      false,
    );
    assert.deepEqual(status, { variant: 'complete', label: 'Complete' });
  });

  test('user message after stop clears stopped badge', () => {
    const chat = makeOrchestrateChat();
    initBoard(chat, {
      planPath: PLAN_PATH,
      tasks: [{ id: 'W1-A', title: 'A', wave: 'W1', category: 'build' }],
      waves: [{ id: 'W1' }],
    });
    chat.history.push({ role: 'assistant', content: 'partial', stopped: true });
    chat.history.push({ role: 'user', content: 'continue please' });
    assert.equal(isUserStoppedChat(chat), false);
  });
});
