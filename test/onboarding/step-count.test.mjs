/**
 * MIN-438 — onboarding step totals must reflect path-dependent steps.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { getApplicableSteps } = await import('../../src/onboarding/steps/registry.ts');
const {
  buildOnboardingContext,
  createDefaultOnboardingState,
} = await import('../../src/onboarding/state-core.ts');
const { mountStepSidebar } = await import('../../src/onboarding/step-sidebar.ts');

/** happy-dom windows keep the event loop alive unless closed. */
let testWindow = null;

function setupDom() {
  testWindow = new Window();
  globalThis.window = testWindow;
  globalThis.document = testWindow.document;
  globalThis.HTMLElement = testWindow.HTMLElement;
  globalThis.matchMedia = testWindow.matchMedia.bind(testWindow);
}

function ctxWith(overrides = {}) {
  const base = buildOnboardingContext(createDefaultOnboardingState(), {
    serverAvailable: true,
    configServerAvailable: true,
  });
  return { ...base, ...overrides };
}

describe('onboarding step count (MIN-438)', () => {
  afterEach(() => {
    testWindow?.close();
    testWindow = null;
  });

  test('before provider path is chosen, branch steps are excluded (11 with server)', () => {
    const steps = getApplicableSteps(ctxWith());
    assert.equal(steps.length, 11);
    assert.equal(steps.some((step) => step.id === 'provider-local'), false);
    assert.equal(steps.some((step) => step.id === 'model-pick'), false);
  });

  test('local provider path includes branch + model pick (13 with server, no api-keys)', () => {
    const steps = getApplicableSteps(ctxWith({ providerPath: 'local' }));
    assert.equal(steps.length, 13);
    assert.equal(steps.some((step) => step.id === 'provider-local'), true);
    assert.equal(steps.some((step) => step.id === 'model-pick'), true);
    assert.equal(steps.some((step) => step.id === 'context7'), true);
  });

  test('sidebar progress label updates when filtered steps grow', () => {
    setupDom();
    const aside = document.createElement('aside');
    const mobile = document.createElement('div');
    document.body.append(aside, mobile);

    const initial = getApplicableSteps(ctxWith());
    const handle = mountStepSidebar(aside, mobile, initial, 'welcome');

    assert.equal(
      aside.querySelector('.mn-onboarding__progress-label')?.textContent,
      'Step 1 of 11',
    );

    const expanded = getApplicableSteps(ctxWith({ providerPath: 'local' }));
    handle.setSteps(expanded);
    handle.setActiveStep('provider-local', 3);

    assert.equal(
      aside.querySelector('.mn-onboarding__progress-label')?.textContent,
      'Step 4 of 13',
    );

    handle.destroy();
  });
});
