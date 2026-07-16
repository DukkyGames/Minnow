/**
 * MIN-340: board setup incomplete detection and return paths.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

import {
  boardSetupStatusLabel,
  getIncompleteBoardSetupGroup,
  isBoardOnboardingBusy,
  isBoardSetupIncomplete,
  shouldShowBoardSetupReturnBanner,
} from '../../../src/chat/orchestrate/board-setup.ts';
import { createEmptyChatObject, setSessionStateForTests, sessionState } from '../../../src/state/sessions.ts';
import { getOrCreateBoardGroup } from '../../../src/state/chat-groups.ts';
import {
  resetBoardOnboardingTransientState,
  setBoardKickoffInProgress,
  setBoardOnboardingGitSetupActive,
} from '../../../src/ui/orchestrate-board-onboarding-state.ts';
import {
  BOARD_ONBOARDING_QUESTIONS_ID,
  resolveBoardOnboardingQuestionHost,
} from '../../../src/ui/orchestrate-board-onboarding-questions.ts';

const PLAN_PATH = 'documentation/plans/fixture.md';

describe('board setup helpers (MIN-340)', () => {
  afterEach(() => {
    resetBoardOnboardingTransientState();
    setSessionStateForTests(null);
  });

  test('isBoardSetupIncomplete is true when plan exists without board store', () => {
    const chat = createEmptyChatObject('');
    chat.modeId = 'orchestrate';
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
      groups: [],
    });
    const group = getOrCreateBoardGroup(chat);
    group.orchestratePlanPath = PLAN_PATH;
    assert.equal(isBoardSetupIncomplete(group), true);
    assert.equal(boardSetupStatusLabel(group), 'Setup');
  });

  test('isBoardSetupIncomplete is false after board store exists', () => {
    const chat = createEmptyChatObject('');
    chat.modeId = 'orchestrate';
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
      groups: [],
    });
    const group = getOrCreateBoardGroup(chat);
    group.orchestratePlanPath = PLAN_PATH;
    group.orchestrateBoard = {
      planPath: PLAN_PATH,
      tasks: [],
      waves: [{ id: 'W1', status: 'planned' }],
      startedAt: 1,
      lastUpdatedAt: 1,
    };
    assert.equal(isBoardSetupIncomplete(group), false);
  });

  test('shouldShowBoardSetupReturnBanner when chat view and setup incomplete', () => {
    const chat = createEmptyChatObject('');
    chat.id = '11111111-1111-1111-1111-111111111111';
    chat.modeId = 'orchestrate';
    chat.boardGroupId = 'grp-setup';
    const group = {
      id: 'grp-setup',
      name: 'Board',
      workspacePath: '',
      collapsed: false,
      order: 0,
      createdAt: 1,
      plannerChatId: chat.id,
      orchestratePlanPath: PLAN_PATH,
      viewMode: 'chat' as const,
    };
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
      groups: [group],
    });
    assert.equal(shouldShowBoardSetupReturnBanner(chat), true);
    group.viewMode = 'board';
    assert.equal(shouldShowBoardSetupReturnBanner(chat), false);
  });

  test('isBoardOnboardingBusy tracks kickoff state', () => {
    assert.equal(isBoardOnboardingBusy(), false);
    setBoardKickoffInProgress(true);
    assert.equal(isBoardOnboardingBusy(), true);
    setBoardKickoffInProgress(false);
  });

  test('getIncompleteBoardSetupGroup resolves linked folder', () => {
    const chat = createEmptyChatObject('');
    chat.modeId = 'orchestrate';
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
      groups: [],
    });
    const group = getOrCreateBoardGroup(chat);
    group.orchestratePlanPath = PLAN_PATH;
    assert.equal(getIncompleteBoardSetupGroup(chat)?.id, group.id);
  });

  test('resolveBoardOnboardingQuestionHost exposes ask_question slot during git setup', async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const chat = createEmptyChatObject('');
    chat.id = '88888888-8888-8888-8888-888888888888';
    chat.modeId = 'orchestrate';
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
      groups: [],
    });
    const group = getOrCreateBoardGroup(chat);
    group.orchestratePlanPath = PLAN_PATH;
    group.viewMode = 'board';
    sessionState.activeBoardGroupId = group.id;

    document.body.innerHTML = `
      <select id="boardOnboardingPlanSelect"></select>
      <div id="${BOARD_ONBOARDING_QUESTIONS_ID}" class="board-onboarding__questions" hidden></div>
    `;

    assert.equal(resolveBoardOnboardingQuestionHost(chat.id), null);

    setBoardOnboardingGitSetupActive(true);
    const host = resolveBoardOnboardingQuestionHost(chat.id);
    assert.ok(host, 'git-setup should expose board onboarding questions host');
    assert.equal(host.id, BOARD_ONBOARDING_QUESTIONS_ID);
    assert.equal(host.hidden, false);

    setBoardOnboardingGitSetupActive(false);
    window.close();
  });
});
