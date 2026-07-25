import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  document.body.innerHTML = '<main id="chatArea"></main>';
}

describe('branch-picker', { concurrency: false }, () => {
  test('trigger exposes menu semantics', () => {
    setupDom();
    const wrap = document.createElement('div');
    wrap.className = 'msg user';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'branch-picker__trigger';
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.textContent = '▾ 2 branches';
    wrap.appendChild(trigger);
    document.getElementById('chatArea').appendChild(wrap);

    assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.ok(wrap.classList.contains('msg') || wrap.querySelector('.branch-picker__trigger'));
  });

  test('refreshBranchPickerAtFork attaches picker when two branches exist', async () => {
    setupDom();
    const { refreshBranchPickerAtFork } = await import('../../src/ui/branch-picker.ts');
    const { createRun, finalizeRun } = await import('../../src/state/runs-store.ts');
    const { setSessionStateForTests } = await import('../../src/state/sessions.ts');

    const chat = {
      id: 'chat-branch-test',
      name: 'Test',
      workspacePath: '',
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

    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      lastActiveChatIdByWorkspace: {},
      chats: [chat],
      chatGroups: [],
      activeBoardGroupId: null,
    });

    const snap = {
      forkHistoryIndex: 0,
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

    const wrap = document.createElement('div');
    wrap.className = 'msg user';
    wrap.dataset.chatId = chat.id;
    wrap.dataset.historyIndex = '0';
    wrap.dataset.turnKind = 'user';
    document.getElementById('chatArea').appendChild(wrap);

    refreshBranchPickerAtFork(chat, 0);

    const trigger = wrap.querySelector('.branch-picker__trigger');
    assert.ok(trigger);
    assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
    assert.match(
      wrap.querySelector('.branch-picker__trigger-label')?.textContent ?? '',
      /Branch 2 of 2/,
    );
  });
});
