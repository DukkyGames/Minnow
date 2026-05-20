/**
 * pendingTurn shape validation and snapshot builder.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildPendingSnapshot,
  ensurePendingTurn,
  isUserStoppedPendingCheckpoint,
} from '../../src/state/pending-turn-shape.ts';
import type { Chat } from '../../src/types.ts';

const FIXED_STARTED = 1710000000000;

const CHAT_ID = '22222222-2222-2222-2222-222222222222';

function minimalChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: CHAT_ID,
    name: 'T',
    workspacePath: '',
    modelId: 'm',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: FIXED_STARTED,
    ...overrides,
  };
}

describe('isUserStoppedPendingCheckpoint', () => {
  test('false when no pendingTurn', () => {
    assert.equal(isUserStoppedPendingCheckpoint(minimalChat()), false);
  });

  test('false when pendingTurn is not user-stopped', () => {
    const chat = minimalChat({
      pendingTurn: {
        role: 'assistant',
        content: 'partial',
        startedAt: FIXED_STARTED,
      },
    });
    assert.equal(isUserStoppedPendingCheckpoint(chat), false);
  });

  test('true when pendingTurn has stopped: true', () => {
    const chat = minimalChat({
      pendingTurn: {
        role: 'assistant',
        content: 'x',
        startedAt: FIXED_STARTED,
        stopped: true,
      },
    });
    assert.equal(isUserStoppedPendingCheckpoint(chat), true);
  });
});

describe('ensurePendingTurn', () => {
  test('strips invalid role', () => {
    const out = ensurePendingTurn({
      role: 'user',
      content: 'hi',
      startedAt: FIXED_STARTED,
    });
    assert.equal(out, undefined);
  });

  test('requires startedAt', () => {
    const out = ensurePendingTurn({
      role: 'assistant',
      content: 'partial',
    });
    assert.equal(out, undefined);
  });

  test('round-trips valid checkpoint', () => {
    const raw = {
      role: 'assistant',
      content: 'Hello partial',
      thinking: ['reason A'],
      startedAt: FIXED_STARTED,
      modelId: 'model-a',
      phase: 'streaming',
      stopped: true,
    };
    const snap = ensurePendingTurn(raw);
    assert.ok(snap);
    assert.equal(snap!.content, 'Hello partial');
    assert.deepEqual(snap!.thinking, ['reason A']);
    assert.equal(snap!.stopped, true);
  });
});

describe('buildPendingSnapshot', () => {
  test('builds assistant checkpoint fixture', () => {
    const snap = buildPendingSnapshot({
      content: 'Streamed text',
      thinking: ['thought one'],
      startedAt: FIXED_STARTED,
      modelId: 'lm',
      phase: 'thinking',
      toolRound: 1,
    });
    assert.equal(snap.role, 'assistant');
    assert.equal(snap.content, 'Streamed text');
    assert.equal(snap.toolRound, 1);
    assert.equal(snap.phase, 'thinking');
  });
});
