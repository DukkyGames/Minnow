/**
 * LLM escalation path (timeout → user card decision).
 */

import assert from 'node:assert/strict';
import { describe, test, afterEach } from 'node:test';
import { Window } from 'happy-dom';
import type { Chat, OrchestrateBoardState } from '../../src/types.ts';
import { runLlmEscalationJudgement } from '../../src/agents/supervisor/escalation.ts';
import { getSupervisorChatState, resetSupervisorStateForTests } from '../../src/agents/supervisor/state.ts';

describe('runLlmEscalationJudgement', () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: Window }).window;
    delete (globalThis as unknown as { document?: Document }).document;
  });

  test('timeout maps to escalate_user', async () => {
    resetSupervisorStateForTests();
    const win = new Window({ url: 'http://localhost/' });
    (globalThis as unknown as { window: Window }).window = win as unknown as Window & typeof globalThis;
    (globalThis as unknown as { document: Document }).document = win.document;

    const chat = { id: 'c', modelId: 'm', providerId: 'p' } as Chat;
    const board: OrchestrateBoardState = {
      planPath: 'p.md',
      tasks: [],
      waves: [{ id: 'W1', status: 'planned' }],
      startedAt: 1,
      lastUpdatedAt: 2,
    };
    const sup = getSupervisorChatState(chat.id);
    sup.lastReport = { phase: 'x', nextAction: 'y', activeTasks: [], blockedTasks: [] };

    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('network');
    }) as typeof fetch;
    try {
      const d = await runLlmEscalationJudgement(chat, board, sup);
      assert.equal(d?.action, 'escalate_user');
    } finally {
      globalThis.fetch = original;
      win.happyDOM.close();
    }
  });
});
