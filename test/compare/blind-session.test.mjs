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
  createSession,
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
      pickLeft: { providerId: 'local', modelId: 'alpha-model' },
      pickRight: { providerId: 'cloud', modelId: 'beta-model' },
      leftGenerationId: '11111111-1111-4111-8111-111111111111',
      rightGenerationId: '22222222-2222-4222-8222-222222222222',
      randomFn: () => 0.6,
    });

    const pub = getSessionPublic(session.id);
    assert.ok(pub);
    assert.equal(pub.voted, false);
    assert.equal(pub.left.label, 'A');
    assert.equal(pub.right.label, 'B');
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
      pickLeft: { providerId: 'p1', modelId: 'm-left' },
      pickRight: { providerId: 'p2', modelId: 'm-right' },
      leftGenerationId: '11111111-1111-4111-8111-111111111111',
      rightGenerationId: '22222222-2222-4222-8222-222222222222',
      randomFn: () => 0.9,
    });
    assert.equal(fixed.left.modelId, 'm-right');
    assert.equal(fixed.right.modelId, 'm-left');
    assert.equal(fixed.leftGenerationId, '22222222-2222-4222-8222-222222222222');
    assert.equal(fixed.rightGenerationId, '11111111-1111-4111-8111-111111111111');
  });

  test('generation ids stay aligned with screen columns when not swapped', async () => {
    await resetCompareHistoryForTests();
    resetCompareStoreForTests();
    const session = createSession({
      prompt: 'Ping',
      pickLeft: { providerId: 'p1', modelId: 'm-left' },
      pickRight: { providerId: 'p2', modelId: 'm-right' },
      leftGenerationId: '11111111-1111-4111-8111-111111111111',
      rightGenerationId: '22222222-2222-4222-8222-222222222222',
      randomFn: () => 0.1,
    });
    assert.equal(session.left.modelId, 'm-left');
    assert.equal(session.right.modelId, 'm-right');
    assert.equal(session.leftGenerationId, '11111111-1111-4111-8111-111111111111');
    assert.equal(session.rightGenerationId, '22222222-2222-4222-8222-222222222222');
  });

  test('double vote is rejected', async () => {
    await resetCompareHistoryForTests();
    resetCompareStoreForTests();
    const session = createSession({
      prompt: 'Vote once',
      pickLeft: { providerId: 'p1', modelId: 'a' },
      pickRight: { providerId: 'p2', modelId: 'b' },
      leftGenerationId: '11111111-1111-4111-8111-111111111111',
      rightGenerationId: '22222222-2222-4222-8222-222222222222',
      randomFn: () => 0.2,
    });

    const first = await recordVote(session.id, 'left');
    assert.ok(!('error' in first));
    const second = await recordVote(session.id, 'right');
    assert.equal(second.error, 'Already voted');
  });

  test('history returns revealed votes only', async () => {
    await resetCompareHistoryForTests();
    resetCompareStoreForTests();
    const session = createSession({
      prompt: 'History row',
      pickLeft: { providerId: 'prov-a', modelId: 'model-a' },
      pickRight: { providerId: 'prov-b', modelId: 'model-b' },
      leftGenerationId: '11111111-1111-4111-8111-111111111111',
      rightGenerationId: '22222222-2222-4222-8222-222222222222',
      randomFn: () => 0.2,
    });
    await recordVote(session.id, 'tie', 'even');

    const history = await listHistory(10);
    assert.equal(history.length, 1);
    assert.equal(history[0].revealed, true);
    assert.equal(history[0].winner, 'tie');
    assert.equal(history[0].left.providerId, 'prov-a');
  });
});
