/**
 * pendingTurn shape validation and snapshot builder.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildPendingSnapshot,
  ensurePendingTurn,
} from '../../src/state/pending-turn-shape.ts';

const FIXED_STARTED = 1710000000000;

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
