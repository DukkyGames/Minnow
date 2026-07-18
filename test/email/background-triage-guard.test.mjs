/**
 * Background email triage guard (MIN-444).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  BACKGROUND_TRIAGE_RESUME_BUFFER_MS,
  resetBackgroundTriageGuardForTests,
  shouldDeferBackgroundEmailTriage,
} from '../../server/email/background-triage-guard.js';
import {
  createGenerationState,
  deleteGenerationsForProviderShutdown,
  markComplete,
} from '../../server/generations/store.js';

describe('shouldDeferBackgroundEmailTriage', () => {
  afterEach(() => {
    deleteGenerationsForProviderShutdown();
    resetBackgroundTriageGuardForTests();
  });

  test('defers while a chat-bound generation is active', () => {
    createGenerationState({
      providerId: 'local',
      body: { model: 'test' },
      persist: true,
      chatId: 'chat-1',
    });

    const result = shouldDeferBackgroundEmailTriage();
    assert.equal(result.defer, true);
    assert.equal(result.reason, 'agent_active');
  });

  test('defers for 60s after agent activity ends', () => {
    const state = createGenerationState({
      providerId: 'local',
      body: { model: 'test' },
      persist: true,
      chatId: 'chat-1',
    });

    const endedAt = Date.parse('2026-07-16T12:00:00.000Z');
    assert.equal(shouldDeferBackgroundEmailTriage(endedAt).defer, true);

    markComplete(state);
    assert.equal(shouldDeferBackgroundEmailTriage(endedAt).defer, true);

    const withinBuffer = endedAt + BACKGROUND_TRIAGE_RESUME_BUFFER_MS - 1;
    assert.equal(shouldDeferBackgroundEmailTriage(withinBuffer).reason, 'resume_buffer');
    assert.equal(shouldDeferBackgroundEmailTriage(withinBuffer).defer, true);

    const afterBuffer = endedAt + BACKGROUND_TRIAGE_RESUME_BUFFER_MS;
    assert.equal(shouldDeferBackgroundEmailTriage(afterBuffer).defer, false);
  });

  test('does not defer for utility background generations', () => {
    createGenerationState({
      providerId: 'local',
      body: { model: 'test' },
      persist: false,
      fallbackRole: 'utility',
    });

    assert.equal(shouldDeferBackgroundEmailTriage().defer, false);
  });

  test('defers for sub-agent generations (typed fallback role)', () => {
    createGenerationState({
      providerId: 'local',
      body: { model: 'test' },
      persist: false,
      fallbackRole: 'explore',
    });

    const result = shouldDeferBackgroundEmailTriage();
    assert.equal(result.defer, true);
    assert.equal(result.reason, 'agent_active');
  });
});
