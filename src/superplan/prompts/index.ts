/**
 * Super Plan stage prompts — bundled markdown templates with token substitution.
 */

import draftPrompt from './draft.md?raw';
import questionGenerationPrompt from './question-generation.md?raw';
import reviewPrompt from './review.md?raw';
import specSynthesisPrompt from './spec-synthesis.md?raw';

/** Replace `{{TOKEN}}` placeholders in a prompt template. */
export function fillSuperPlanPrompt(
  template: string,
  tokens: Record<string, string>,
): string {
  let out = template;
  for (const [key, value] of Object.entries(tokens)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

export function buildQuestionGenerationTask(userPrompt: string): string {
  const body = fillSuperPlanPrompt(questionGenerationPrompt, {
    USER_PROMPT: userPrompt.trim(),
  });
  return `${body}\n\n## User prompt\n\n${userPrompt.trim()}\n`;
}

export function buildSpecSynthesisTask(
  userPrompt: string,
  answersBlock: string,
  revisionNotes = '',
): string {
  const notesBlock = revisionNotes.trim()
    ? `\n## Revision notes from user\n\n${revisionNotes.trim()}\n`
    : '';
  const body = fillSuperPlanPrompt(specSynthesisPrompt, {
    USER_PROMPT: userPrompt.trim(),
    ANSWERS_BLOCK: answersBlock.trim(),
    REVISION_NOTES: notesBlock,
  });
  return [
    body,
    '',
    '## User request',
    userPrompt.trim(),
    '',
    '## Intake answers',
    answersBlock.trim(),
    notesBlock,
  ].join('\n');
}

export function buildDraftTask(
  spec: string,
  research: string,
  planPath: string,
  reviewNotes = '',
): string {
  const notesBlock = reviewNotes.trim()
    ? `\n## Prior review feedback to address\n\n${reviewNotes.trim()}\n`
    : '';
  return fillSuperPlanPrompt(draftPrompt, {
    SPEC: spec.trim(),
    RESEARCH: research.trim() || '(No research brief available.)',
    PLAN_PATH: planPath.trim(),
    REVIEW_NOTES: notesBlock,
  });
}

export function buildReviewTask(spec: string, planContent: string): string {
  return fillSuperPlanPrompt(reviewPrompt, {
    SPEC: spec.trim(),
    PLAN_CONTENT: planContent.trim(),
  });
}
