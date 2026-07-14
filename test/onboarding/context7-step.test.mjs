import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { context7Step, resetContext7StepState } = await import(
  '../../src/onboarding/steps/context7.ts'
);
const { ONBOARDING_STEPS } = await import('../../src/onboarding/steps/registry.ts');
const { ONBOARDING_PHASES } = await import('../../src/onboarding/phases.ts');

describe('onboarding context7 step', () => {
  test('step is registered after api-keys in workspace phase', () => {
    const ids = ONBOARDING_STEPS.map((step) => step.id);
    const apiKeysIndex = ids.indexOf('api-keys');
    const context7Index = ids.indexOf('context7');
    assert.ok(apiKeysIndex >= 0);
    assert.ok(context7Index > apiKeysIndex);
    assert.equal(ids[context7Index], 'context7');
  });

  test('workspace phase includes context7 after api-keys', () => {
    const workspace = ONBOARDING_PHASES.find((phase) => phase.id === 'workspace');
    assert.ok(workspace);
    const apiKeysIndex = workspace.stepIds.indexOf('api-keys');
    const context7Index = workspace.stepIds.indexOf('context7');
    assert.ok(apiKeysIndex >= 0);
    assert.equal(context7Index, apiKeysIndex + 1);
  });

  test('isApplicable requires local tool server', () => {
    assert.equal(context7Step.isApplicable({ serverAvailable: true }), true);
    assert.equal(context7Step.isApplicable({ serverAvailable: false }), false);
  });

  test('can be skipped and exposes reset helper', () => {
    assert.equal(context7Step.canSkip, true);
    resetContext7StepState();
    assert.equal(context7Step.id, 'context7');
  });
});
