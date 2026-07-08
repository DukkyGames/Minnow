import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const {
  createDefaultOnboardingState,
  isOnboardingComplete,
  recordStepProgress,
  buildOnboardingContext,
} = await import('../../src/onboarding/state-core.ts');

describe('onboarding state-core', () => {
  test('createDefaultOnboardingState returns version 1 incomplete state', () => {
    const state = createDefaultOnboardingState();
    assert.equal(state.version, 1);
    assert.equal(state.completedAt, null);
    assert.deepEqual(state.steps, {});
  });

  test('recordStepProgress merges step data', () => {
    const base = createDefaultOnboardingState();
    const next = recordStepProgress(base, 'theme', {
      done: true,
      data: { mode: 'light' },
    });
    assert.equal(next.lastStep, 'theme');
    assert.equal(next.steps.theme?.done, true);
    assert.equal(next.steps.theme?.data?.mode, 'light');
  });

  test('isOnboardingComplete reflects completedAt', () => {
    const open = createDefaultOnboardingState();
    assert.equal(isOnboardingComplete(open), false);
    const done = { ...open, completedAt: '2026-07-07T00:00:00.000Z' };
    assert.equal(isOnboardingComplete(done), true);
  });

  test('buildOnboardingContext reads provider path from step data', () => {
    const base = recordStepProgress(createDefaultOnboardingState(), 'provider-choice', {
      data: { path: 'cloud' },
    });
    const ctx = buildOnboardingContext(base, {
      serverAvailable: true,
      configServerAvailable: true,
    });
    assert.equal(ctx.providerPath, 'cloud');
  });
});
