/**
 * Blind compare session store — randomization, redaction, double-vote guard.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import {
  activateSlotGeneration,
  createSession,
  getSession,
  getSessionPublic,
  listHistory,
  recordVote,
  resetCompareHistoryForTests,
  resetCompareStoreForTests,
} from '../../server/compare/store.js';

let tempHome = '';

before(async () => {
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-compare-'));
  process.env.MINNOW_HOME = tempHome;
  resetMinnowHomeCache();
  resetCompareStoreForTests();
  await resetCompareHistoryForTests();
});

after(async () => {
  resetCompareStoreForTests();
  delete process.env.MINNOW_HOME;
  resetMinnowHomeCache();
  await fs.rm(tempHome, { recursive: true, force: true });
});

describe('compare blind session store', () => {
  test('public session hides provider and model ids before vote', async () => {
    await resetCompareHistoryForTests();
    resetCompareStoreForTests();
    const session = createSession({
      prompt: 'Say hello',
      picks: [
        { providerId: 'local', modelId: 'alpha-model' },
        { providerId: 'cloud', modelId: 'beta-model' },
      ],
      generationIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
      randomFn: () => 0.6,
    });

    const pub = getSessionPublic(session.id);
    assert.ok(pub);
    assert.equal(pub.voted, false);
    assert.equal(pub.slots.length, 2);
    assert.equal(JSON.stringify(pub).includes('alpha-model'), false);
    assert.equal(JSON.stringify(pub).includes('beta-model'), false);
    assert.equal(JSON.stringify(pub).includes('local'), false);
    assert.equal(JSON.stringify(pub).includes('cloud'), false);
  });

  test('randomization can swap column models with deterministic rng', async () => {
    await resetCompareHistoryForTests();
    resetCompareStoreForTests();
    const fixed = createSession({
      prompt: 'Ping',
      picks: [
        { providerId: 'p1', modelId: 'm-left' },
        { providerId: 'p2', modelId: 'm-right' },
      ],
      generationIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
      randomFn: () => 0.9,
    });
    assert.equal(fixed.slots[0].model.modelId, 'm-right');
    assert.equal(fixed.slots[1].model.modelId, 'm-left');
    assert.equal(fixed.slots[0].generationId, '22222222-2222-4222-8222-222222222222');
    assert.equal(fixed.slots[1].generationId, '11111111-1111-4111-8111-111111111111');
  });

  test('generation ids stay aligned with screen columns when not swapped', async () => {
    await resetCompareHistoryForTests();
    resetCompareStoreForTests();
    const session = createSession({
      prompt: 'Ping',
      picks: [
        { providerId: 'p1', modelId: 'm-left' },
        { providerId: 'p2', modelId: 'm-right' },
      ],
      generationIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
      randomFn: () => 0.1,
    });
    assert.equal(session.slots[0].model.modelId, 'm-left');
    assert.equal(session.slots[1].model.modelId, 'm-right');
    assert.equal(session.slots[0].generationId, '11111111-1111-4111-8111-111111111111');
    assert.equal(session.slots[1].generationId, '22222222-2222-4222-8222-222222222222');
  });

  test('multi-model sessions assign letter aliases in parallel mode', async () => {
    await resetCompareHistoryForTests();
    resetCompareStoreForTests();
    const session = createSession({
      prompt: 'Three-way',
      picks: [
        { providerId: 'p1', modelId: 'm1' },
        { providerId: 'p2', modelId: 'm2' },
        { providerId: 'p3', modelId: 'm3' },
      ],
      generationIds: ['g1', 'g2', 'g3'],
      parallel: true,
      randomFn: () => 0.2,
    });
    assert.equal(session.slots.length, 3);
    assert.deepEqual(
      session.slots.map((slot) => slot.alias),
      ['A', 'B', 'C'],
    );
  });

  test('sequential mode uses numeric aliases and deferred slot activation', async () => {
    await resetCompareHistoryForTests();
    resetCompareStoreForTests();
    const session = createSession({
      prompt: 'Sequential',
      picks: [
        { providerId: 'p1', modelId: 'm1' },
        { providerId: 'p2', modelId: 'm2' },
      ],
      generationIds: ['', ''],
      parallel: false,
      randomFn: () => 0.2,
    });
    assert.equal(session.parallel, false);
    assert.deepEqual(
      session.slots.map((slot) => slot.alias),
      ['1', '2'],
    );
    activateSlotGeneration(session.id, 0, '11111111-1111-4111-8111-111111111111');
    const refreshed = getSession(session.id);
    assert.ok(refreshed);
    assert.equal(refreshed.slots[0].activated, true);
    assert.equal(refreshed.slots[1].activated, false);
  });

  test('double vote is rejected', async () => {
    await resetCompareHistoryForTests();
    resetCompareStoreForTests();
    const session = createSession({
      prompt: 'Vote once',
      picks: [
        { providerId: 'p1', modelId: 'a' },
        { providerId: 'p2', modelId: 'b' },
      ],
      generationIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
      randomFn: () => 0.2,
    });

    const first = await recordVote(session.id, 'left');
    assert.ok(!('error' in first));
    const second = await recordVote(session.id, 'right');
    assert.equal(second.error, 'Already voted');
  });

  test('history returns revealed votes with slot refs', async () => {
    await resetCompareHistoryForTests();
    resetCompareStoreForTests();
    const session = createSession({
      prompt: 'History row',
      picks: [
        { providerId: 'prov-a', modelId: 'model-a' },
        { providerId: 'prov-b', modelId: 'model-b' },
      ],
      generationIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
      randomFn: () => 0.2,
    });
    await recordVote(session.id, 'tie', 'even');

    const history = await listHistory(10);
    assert.equal(history.length, 1);
    assert.equal(history[0].revealed, true);
    assert.equal(history[0].winner, 'tie');
    assert.equal(history[0].slots.length, 2);
    const providerIds = history[0].slots.map((slot) => slot.providerId).sort();
    assert.deepEqual(providerIds, ['prov-a', 'prov-b']);
  });

  test('slot-index winner resolves for multi-model votes', async () => {
    await resetCompareHistoryForTests();
    resetCompareStoreForTests();
    const session = createSession({
      prompt: 'Pick slot 1',
      picks: [
        { providerId: 'p1', modelId: 'm1' },
        { providerId: 'p2', modelId: 'm2' },
        { providerId: 'p3', modelId: 'm3' },
      ],
      generationIds: ['g1', 'g2', 'g3'],
      parallel: true,
      randomFn: () => 0.2,
    });
    const result = await recordVote(session.id, 1);
    assert.ok(!('error' in result));
    assert.equal(result.vote.winner, 1);
    assert.equal(result.vote.slots.length, 3);
  });
});
