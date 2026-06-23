/**
 * Load Super Plan stage prompt bodies (bundled at build time).
 */

import questionGeneration from './prompts/question-generation.md?raw';
import specSynthesis from './prompts/spec-synthesis.md?raw';
import draft from './prompts/draft.md?raw';
import review from './prompts/review.md?raw';

export type SuperPlanPromptId =
  | 'question-generation'
  | 'spec-synthesis'
  | 'draft'
  | 'review';

const PROMPTS: Record<SuperPlanPromptId, string> = {
  'question-generation': questionGeneration,
  'spec-synthesis': specSynthesis,
  draft,
  review,
};

/** Return the raw markdown instructions for a pipeline stage. */
export function loadSuperPlanPrompt(id: SuperPlanPromptId): string {
  return PROMPTS[id] ?? '';
}
