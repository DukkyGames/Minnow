import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

const appState = await import('../../src/app-state.ts');
const { setSessionStateForTests, createEmptyChatObject, EXPERT_LAB_CHAT_ID } =
  await import('../../src/state/sessions.ts');
const {
  getStreamingChatId,
  isActiveChatStreaming,
  isChatStreaming,
  isBackgroundStreamBlockingSend,
  isStreamDomVisible,
} = await import('../../src/chat/streaming-state.ts');
const { BOARD_ONBOARDING_KICKOFF_MESSAGE } = await import(
  '../../src/ui/orchestrate-board-kickoff.ts'
);

function seedTwoChats(activeId) {
  const a = createEmptyChatObject('');
  a.id = 'chat-a';
  a.name = 'Chat A';
  const b = createEmptyChatObject('');
  b.id = 'chat-b';
  b.name = 'Chat B';
  setSessionStateForTests({
    version: 2,
    activeId,
    sidebarCollapsed: false,
    chats: [a, b],
  });
  return { a, b };
}

describe('streaming-state helpers', () => {
  afterEach(() => {
    appState.setStreaming(false);
    appState.setExpertLabPageOpen(false);
    setSessionStateForTests(null);
  });

  test('getStreamingChatId is null when idle', () => {
    seedTwoChats('chat-a');
    assert.equal(getStreamingChatId(), null);
    assert.equal(isChatStreaming('chat-a'), false);
    assert.equal(isActiveChatStreaming(), false);
  });

  test('isChatStreaming tracks streamingChatId', () => {
    seedTwoChats('chat-b');
    appState.setStreaming(true, 'chat-a');
    assert.equal(getStreamingChatId(), 'chat-a');
    assert.equal(isChatStreaming('chat-a'), true);
    assert.equal(isChatStreaming('chat-b'), false);
    assert.equal(isActiveChatStreaming(), false);
  });

  test('isActiveChatStreaming when active matches stream', () => {
    seedTwoChats('chat-a');
    appState.setStreaming(true, 'chat-a');
    assert.equal(isActiveChatStreaming(), true);
    assert.equal(isStreamDomVisible('chat-a'), true);
    assert.equal(isStreamDomVisible('chat-b'), false);
  });

  test('isStreamDomVisible false for build task chat during full board view', () => {
    const planner = createEmptyChatObject('');
    planner.id = 'chat-planner';
    planner.modeId = 'orchestrate';
    planner.orchestratePlanPath = 'documentation/plans/x.md';
    const task = createEmptyChatObject('');
    task.id = 'chat-task';
    task.modeId = 'build';
    task.boardGroupId = 'grp-board-task';
    const group = {
      id: 'grp-board-task',
      name: 'Board',
      workspacePath: planner.workspacePath || '',
      collapsed: false,
      order: 0,
      createdAt: 1,
      viewMode: 'board',
      plannerChatId: planner.id,
      orchestrateBoard: { planPath: planner.orchestratePlanPath, tasks: [], waves: [] },
    };
    planner.boardGroupId = group.id;
    setSessionStateForTests({
      version: 5,
      activeId: task.id,
      activeBoardGroupId: group.id,
      sidebarCollapsed: false,
      chats: [planner, task],
      groups: [group],
    });
    appState.setStreaming(true, task.id);
    assert.equal(isStreamDomVisible(task.id), false);
  });

  test('isStreamDomVisible true during orchestrate board init split', () => {
    const chat = createEmptyChatObject('');
    chat.id = 'chat-orchestrate-split';
    chat.modeId = 'orchestrate';
    chat.orchestratePlanPath = 'documentation/plans/x.md';
    chat.history.push({ role: 'user', content: BOARD_ONBOARDING_KICKOFF_MESSAGE });
    const group = {
      id: 'grp-stream-state',
      name: 'Board',
      workspacePath: chat.workspacePath || '',
      collapsed: false,
      order: 0,
      createdAt: 1,
      viewMode: 'board',
      plannerChatId: chat.id,
    };
    chat.boardGroupId = group.id;
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      activeBoardGroupId: group.id,
      sidebarCollapsed: false,
      chats: [chat],
      groups: [group],
    });
    appState.setStreaming(true, chat.id);
    assert.equal(isStreamDomVisible(chat.id), true);
  });

  test('isBackgroundStreamBlockingSend allows concurrent sends', () => {
    seedTwoChats('chat-b');
    appState.setStreaming(true, 'chat-a');
    assert.equal(isBackgroundStreamBlockingSend(), false);
    assert.equal(isActiveChatStreaming(), false);
  });

  test('expert thread streams in chat shell when Experts hub is closed', () => {
    const lab = createEmptyChatObject('');
    lab.id = EXPERT_LAB_CHAT_ID;
    lab.kind = 'expert-lab';
    setSessionStateForTests({
      version: 2,
      activeId: EXPERT_LAB_CHAT_ID,
      sidebarCollapsed: false,
      chats: [lab],
    });
    appState.setExpertLabPageOpen(true);
    appState.setStreaming(true, EXPERT_LAB_CHAT_ID);
    assert.equal(isStreamDomVisible(EXPERT_LAB_CHAT_ID), false);
    appState.setExpertLabPageOpen(false);
    assert.equal(isStreamDomVisible(EXPERT_LAB_CHAT_ID), true);
  });
});
