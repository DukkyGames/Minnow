import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { activateBranch, createRun, finalizeRun } from '../../src/state/runs-store.ts';
import {
  getActiveChat,
  setSessionStateForTests,
  switchActiveChat,
} from '../../src/state/sessions.ts';
import type { Chat, TurnSnapshot } from '../../src/types.ts';

function setupDom(): void {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  document.body.innerHTML = '<main id="chatArea"></main>';
}

function baseSnapshot(forkHistoryIndex: number): TurnSnapshot {
  return {
    forkHistoryIndex,
    userContent: 'hello',
    skillId: null,
    providerId: 'lm-studio-local',
    modelId: 'model-a',
    temperature: 0.7,
    maxTokens: 4096,
    modeId: 'build',
    workAgentId: null,
    workAgentAuto: true,
    composedSystemPrompt: 'You are helpful.',
    enabledToolNames: ['read_file'],
    maxToolTurns: 25,
    historyPrefixHash: 'abc123',
  };
}

function makeBranchedChat(id: string): Chat {
  const chat: Chat = {
    id,
    name: 'Branched',
    workspacePath: '/project',
    modelId: 'model-a',
    history: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'reply B' },
    ],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    lastMessageAt: 1,
    runs: [],
  };

  const snap = baseSnapshot(0);
  const runA = createRun(chat, snap);
  finalizeRun(chat, runA.runId, {
    status: 'completed',
    outputHistoryStart: 1,
    outputHistoryEnd: 1,
    outputMessages: [{ role: 'assistant', content: 'reply A' }],
  });

  const runB = createRun(chat, { ...snap, modelId: 'model-b' });
  finalizeRun(chat, runB.runId, {
    status: 'completed',
    outputHistoryStart: 1,
    outputHistoryEnd: 1,
    outputMessages: [{ role: 'assistant', content: 'reply B' }],
  });

  return chat;
}

describe('branch switch session target', { concurrency: false }, () => {
  test('switchActiveChat after activateBranch keeps the branched chat active', async () => {
    setupDom();
    const branched = makeBranchedChat('chat-branched');
    const other: Chat = {
      id: 'chat-other',
      name: 'Other',
      workspacePath: '/project',
      modelId: 'model-a',
      history: [{ role: 'user', content: 'other' }],
      lastStats: null,
      modelInfo: {},
      updatedAt: 1,
      lastMessageAt: 1,
    };

    setSessionStateForTests({
      version: 2,
      activeId: other.id,
      sidebarCollapsed: false,
      lastActiveChatIdByWorkspace: {},
      chats: [branched, other],
      chatGroups: [],
      activeBoardGroupId: null,
    });

    const ok = activateBranch(branched, 0, branched.runs![0]!.branchId);
    assert.equal(ok, true);
    assert.equal((branched.history[1] as { content: string }).content, 'reply A');

    const switched = await switchActiveChat(branched.id);
    assert.ok(switched);
    assert.equal(getActiveChat().id, branched.id);
  });
});
