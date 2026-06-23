import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  buildPlanGrillMeQuestions,
  formatPlanIntakeForPrompt,
  resetPlanGrillMeForTests,
  shouldShowPlanGrillMe,
} from '../../src/superplan/plan-intake.ts';
import type { Chat } from '../../src/types.ts';

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    name: 'Plan chat',
    workspacePath: '/workspace',
    modelId: 'test-model',
    modeId: 'plan',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: Date.now(),
    ...overrides,
  } as Chat;
}

describe('plan-intake', () => {
  beforeEach(() => {
    resetPlanGrillMeForTests();
  });

  afterEach(() => {
    resetPlanGrillMeForTests();
  });

  test('buildPlanGrillMeQuestions returns ~20 prompts', () => {
    const questions = buildPlanGrillMeQuestions();
    assert.ok(questions.length >= 18);
    assert.ok(questions.every((q) => q.id && q.prompt));
  });

  test('shouldShowPlanGrillMe is true for fresh Plan chats without intake', () => {
    assert.equal(shouldShowPlanGrillMe(makeChat()), true);
  });

  test('shouldShowPlanGrillMe is false after intake or with user history', () => {
    assert.equal(
      shouldShowPlanGrillMe(
        makeChat({ planIntake: { completed: true, answers: { goal: 'Ship feature' } } }),
      ),
      false,
    );
    assert.equal(
      shouldShowPlanGrillMe(
        makeChat({ history: [{ role: 'user', content: 'hello' } as never] }),
      ),
      false,
    );
    assert.equal(shouldShowPlanGrillMe(makeChat({ modeId: 'build' })), false);
  });

  test('formatPlanIntakeForPrompt renders answered fields', () => {
    const text = formatPlanIntakeForPrompt(
      { goal: 'Add auth', audience: 'Team engineers' },
      buildPlanGrillMeQuestions().slice(0, 3),
    );
    assert.match(text, /Grill Me/i);
    assert.match(text, /Add auth/);
    assert.match(text, /Team engineers/);
  });
});
