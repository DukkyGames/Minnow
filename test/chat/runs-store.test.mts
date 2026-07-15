import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  activateBranch,
  createRun,
  finalizeRun,
  listRunsAtFork,
  listSelectableBranchesAtFork,
  pruneSupersededRunsAfterTruncate,
} from '../../src/state/runs-store.ts';
import type { Chat, TurnSnapshot } from '../../src/types.ts';

const FIXED_RUN = '11111111-1111-1111-1111-111111111101';
const FIXED_BRANCH_A = '22222222-2222-2222-2222-222222222201';
const FIXED_BRANCH_B = '33333333-3333-3333-3333-333333333301';

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

function makeChat(): Chat {
  return {
    id: 'chat-1',
    name: 'Test',
    workspacePath: '',
    modelId: 'model-a',
    history: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'reply A' },
    ],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    lastMessageAt: 1,
    runs: [],
  };
}

describe('runs-store', () => {
  test('createRun supersedes prior run at same fork', () => {
    const chat = makeChat();
    const snap = baseSnapshot(0);
    const first = createRun(chat, snap);
    first.runId = FIXED_RUN;
    first.branchId = FIXED_BRANCH_A;
    finalizeRun(chat, first.runId, {
      status: 'completed',
      outputHistoryStart: 1,
      outputHistoryEnd: 1,
      outputMessages: [{ role: 'assistant', content: 'reply A' }],
    });

    const second = createRun(chat, { ...snap, modelId: 'model-b' });

    assert.equal(first.status, 'superseded');
    assert.equal(listRunsAtFork(chat, 0).length, 2);
    assert.equal(chat.activeBranchByFork?.['0'], second.branchId);
  });

  test('activateBranch swaps suffix from stored outputMessages', () => {
    const chat = makeChat();
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

    chat.history = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'reply B' },
    ];

    const ok = activateBranch(chat, 0, runA.branchId);
    assert.equal(ok, true);
    assert.equal(chat.history[1].role, 'assistant');
    assert.equal((chat.history[1] as { content: string }).content, 'reply A');
    assert.equal(chat.activeBranchByFork?.['0'], runA.branchId);
  });

  test('pruneSupersededRunsAfterTruncate marks runs past cut', () => {
    const chat = makeChat();
    const snap = baseSnapshot(0);
    const run = createRun(chat, snap);
    finalizeRun(chat, run.runId, {
      status: 'completed',
      outputHistoryStart: 1,
      outputHistoryEnd: 1,
      outputMessages: [{ role: 'assistant', content: 'reply A' }],
    });
    chat.history = [{ role: 'user', content: 'hello' }];
    pruneSupersededRunsAfterTruncate(chat, 0);
    assert.equal(run.status, 'superseded');
    assert.equal(listSelectableBranchesAtFork(chat, 0).length, 0);
  });

  test('finalizeRun stores errorMessage on failed runs', () => {
    const chat = makeChat();
    const snap = baseSnapshot(0);
    const run = createRun(chat, snap);
    finalizeRun(chat, run.runId, {
      status: 'failed',
      errorMessage: 'Could not complete this reply: Model not loaded',
    });
    assert.equal(run.status, 'failed');
    assert.equal(run.errorMessage, 'Could not complete this reply: Model not loaded');
  });
});
