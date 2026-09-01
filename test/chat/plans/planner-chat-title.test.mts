/**
 * Orchestrator planner chat sidebar title helpers.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isManagedOrchestratorPlannerTitle,
  orchestratorPlannerChatTitle,
  planBasenameForTitle,
  syncOrchestratorPlannerChatTitle,
} from '../../../src/chat/plans/planner-chat-title.ts';
import {
  createEmptyChatObject,
  sessionState,
  setSessionStateForTests,
} from '../../../src/state/sessions.ts';

const WS = 'C:\\workspace\\demo';
const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/demo-plan.md';

describe('planner-chat-title', () => {
  test('planBasenameForTitle strips directory and .md extension', () => {
    assert.equal(planBasenameForTitle(PLAN_PATH), 'demo-plan');
    assert.equal(planBasenameForTitle('nested/plans/My-Plan.MD'), 'My-Plan');
  });

  test('orchestratorPlannerChatTitle formats with and without plan path', () => {
    assert.equal(orchestratorPlannerChatTitle(PLAN_PATH), 'Orchestrator - demo-plan');
    assert.equal(orchestratorPlannerChatTitle(), 'Orchestrator');
    assert.equal(orchestratorPlannerChatTitle(''), 'Orchestrator');
  });

  test('isManagedOrchestratorPlannerTitle detects placeholder and managed names', () => {
    assert.equal(isManagedOrchestratorPlannerTitle('New chat'), true);
    assert.equal(isManagedOrchestratorPlannerTitle('Orchestrator'), true);
    assert.equal(isManagedOrchestratorPlannerTitle('Orchestrator - demo-plan'), true);
    assert.equal(isManagedOrchestratorPlannerTitle('Custom board title'), false);
  });

  test('syncOrchestratorPlannerChatTitle sets managed title for orchestrate mode', () => {
    const chat = createEmptyChatObject('', WS);
    chat.id = CHAT_ID;
    chat.modeId = 'orchestrate';
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      groups: [],
      chats: [chat],
    });

    syncOrchestratorPlannerChatTitle(chat, PLAN_PATH);
    assert.equal(chat.name, 'Orchestrator - demo-plan');
    assert.ok(sessionState);
  });

  test('syncOrchestratorPlannerChatTitle preserves custom renames', () => {
    const chat = createEmptyChatObject('', WS);
    chat.id = CHAT_ID;
    chat.modeId = 'orchestrate';
    chat.name = 'My custom planner';
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      groups: [],
      chats: [chat],
    });

    syncOrchestratorPlannerChatTitle(chat, PLAN_PATH);
    assert.equal(chat.name, 'My custom planner');
  });

  test('syncOrchestratorPlannerChatTitle ignores non-orchestrate chats', () => {
    const chat = createEmptyChatObject('', WS);
    chat.id = CHAT_ID;
    chat.modeId = 'build';
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      groups: [],
      chats: [chat],
    });

    syncOrchestratorPlannerChatTitle(chat, PLAN_PATH);
    assert.equal(chat.name, 'New chat');
  });
});
