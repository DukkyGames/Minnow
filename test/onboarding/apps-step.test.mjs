/**
 * Onboarding Choose your apps step + phase registration.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { ONBOARDING_PHASES } = await import('../../src/onboarding/phases.ts');
const { appsStep, resetAppsStepState } = await import('../../src/onboarding/steps/apps.ts');
const {
  buildOnboardingContext,
  createDefaultOnboardingState,
} = await import('../../src/onboarding/state-core.ts');
const { listOptionalReleasedApps } = await import('../../src/os/app-registry.ts');
const {
  isAppEnabled,
  resetAppPreferencesForTests,
  setAppEnabled,
} = await import('../../src/os/app-preferences.ts');

let testWindow = null;

function setupDom() {
  testWindow = new Window();
  globalThis.window = testWindow;
  globalThis.document = testWindow.document;
  globalThis.HTMLElement = testWindow.HTMLElement;
  globalThis.localStorage = testWindow.localStorage;
  testWindow.localStorage.clear();
  resetAppPreferencesForTests();
  resetAppsStepState();
}

function makeActions() {
  return {
    next: () => {},
    back: () => {},
    skip: () => {},
    patchContext: () => {},
    setPrimaryEnabled: () => {},
    setPrimaryLabel: () => {},
    stepIndex: 2,
    totalSteps: 12,
  };
}

describe('onboarding apps step', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(() => {
    resetAppPreferencesForTests();
    resetAppsStepState();
    testWindow?.close();
    testWindow = null;
  });

  test('Apps phase sits between Appearance and Models', () => {
    const look = ONBOARDING_PHASES.findIndex((phase) => phase.id === 'look');
    const apps = ONBOARDING_PHASES.findIndex((phase) => phase.id === 'apps');
    const models = ONBOARDING_PHASES.findIndex((phase) => phase.id === 'models');
    assert.ok(look >= 0);
    assert.ok(apps > look);
    assert.ok(models > apps);
    assert.deepEqual(ONBOARDING_PHASES[apps].stepIds, ['apps']);
  });

  test('render shows core note and selectable optional cards', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const ctx = buildOnboardingContext(createDefaultOnboardingState(), {
      serverAvailable: true,
      configServerAvailable: true,
    });

    appsStep.render(container, ctx, makeActions());

    const cards = [...container.querySelectorAll('.mn-app-picker-card')];
    assert.equal(cards.length, listOptionalReleasedApps().length);
    assert.equal(container.querySelectorAll('.mn-app-picker-card.is-always-on').length, 0);
    assert.ok(container.querySelector('.mn-app-picker-core'));
    assert.equal(
      container.querySelectorAll('.mn-app-picker-card[aria-pressed]').length,
      listOptionalReleasedApps().length,
    );
    assert.ok(container.querySelector('.mn-app-picker-toolbar'));
  });

  test('commit persists deselected optional apps', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const ctx = buildOnboardingContext(createDefaultOnboardingState(), {
      serverAvailable: true,
      configServerAvailable: true,
    });

    appsStep.render(container, ctx, makeActions());

    const schedulerCard = container.querySelector('.mn-app-picker-card[data-app-id="scheduler"]');
    assert.ok(schedulerCard);
    schedulerCard.click();
    appsStep.commit(ctx);

    assert.equal(isAppEnabled('scheduler'), false);
    assert.equal(ctx.state.steps.apps?.done, true);
    assert.ok(Array.isArray(ctx.state.steps.apps?.data?.enabledAppIds));
    assert.equal(ctx.state.steps.apps.data.enabledAppIds.includes('scheduler'), false);
  });

  test('render resumes from current preferences', () => {
    setAppEnabled('research', false);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const ctx = buildOnboardingContext(createDefaultOnboardingState(), {
      serverAvailable: true,
      configServerAvailable: true,
    });

    appsStep.render(container, ctx, makeActions());

    const researchCard = container.querySelector('.mn-app-picker-card[data-app-id="research"]');
    assert.ok(researchCard);
    assert.equal(researchCard.classList.contains('is-selected'), false);
    assert.equal(researchCard.classList.contains('is-off'), true);
    assert.equal(researchCard.getAttribute('aria-pressed'), 'false');
  });

  test('disable all clears working selection before commit', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const ctx = buildOnboardingContext(createDefaultOnboardingState(), {
      serverAvailable: true,
      configServerAvailable: true,
    });

    appsStep.render(container, ctx, makeActions());
    const disableAll = [...container.querySelectorAll('.mn-app-picker-toolbar__btn')].find(
      (btn) => btn.textContent === 'Disable all',
    );
    assert.ok(disableAll);
    disableAll.click();
    appsStep.commit(ctx);

    assert.deepEqual(ctx.state.steps.apps?.data?.enabledAppIds, []);
    for (const app of listOptionalReleasedApps()) {
      assert.equal(isAppEnabled(app.id), false);
    }
  });
});
