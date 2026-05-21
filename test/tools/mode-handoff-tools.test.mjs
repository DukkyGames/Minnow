/**
 * Mode-handoff tool argument builders (no DOM).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { validateAskQuestionArgs } from '../../src/tools/ask-question-types.ts';

/** Mirror preset builder from mode-handoff-tools for unit tests. */
function buildPlanCompleteQuestions(planPath) {
  const planHint = planPath?.trim() ? ` (${planPath})` : '';
  return {
    title: 'Plan ready',
    questions: [
      {
        id: 'next_step',
        prompt: `The plan${planHint} is saved. What should we do next?`,
        options: [
          { id: 'orchestrate_new', label: 'New Orchestrate chat' },
          { id: 'stay_plan', label: 'Stay in Plan' },
          { id: 'build_here', label: 'Implement in Build (this chat)' },
        ],
      },
    ],
  };
}

describe('mode-handoff propose presets', () => {
  test('plan_complete ask_question args validate', () => {
    const parsed = validateAskQuestionArgs(
      buildPlanCompleteQuestions('documentation/plans/foo.md'),
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.args.questions.length, 1);
      assert.ok(parsed.args.questions[0].options.length >= 2);
    }
  });

  test('reef_visualization preset has two options', () => {
    const args = {
      title: 'Reef widget',
      questions: [
        {
          id: 'reef_offer',
          prompt: 'Show this as an interactive Reef widget?',
          options: [
            { id: 'reef_yes', label: 'Yes — Reef widget' },
            { id: 'reef_no', label: 'No — text only' },
          ],
        },
      ],
    };
    const parsed = validateAskQuestionArgs(args);
    assert.equal(parsed.ok, true);
  });
});
