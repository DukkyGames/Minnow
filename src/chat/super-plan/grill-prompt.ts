/**
 * Super Plan grill stage prompt helpers — batch ask_question cards.
 */

/** Max questions per ask_question call during the Super Plan grill stage. */
export const SUPER_PLAN_GRILL_QUESTIONS_PER_BATCH = 5;

const GRILLING_ONE_AT_A_TIME =
  'Ask the questions one at a time, waiting for feedback on each question before continuing. Asking multiple questions at once is bewildering.';

/** Replace the default /grilling one-at-a-time rule with Super Plan batching. */
export function adaptGrillingSkillForSuperPlan(
  skillBody: string | null,
  batchSize: number = SUPER_PLAN_GRILL_QUESTIONS_PER_BATCH,
): string | null {
  if (!skillBody) return null;
  const batchInstruction =
    `Ask questions in batches of up to ${batchSize} per \`ask_question\` call (multiple questions in one card). ` +
    'Wait for the user to answer each batch before sending the next batch.';
  if (!skillBody.includes(GRILLING_ONE_AT_A_TIME)) return skillBody;
  return skillBody.replace(GRILLING_ONE_AT_A_TIME, batchInstruction);
}

/** Hidden controller user message for the grill stage turn. */
export function buildSuperPlanGrillStageUserText(
  grillQuestionBudget: number,
  prompt: string,
  batchSize: number = SUPER_PLAN_GRILL_QUESTIONS_PER_BATCH,
): string {
  return [
    'Super Plan pipeline — **Grill stage** (interview only).',
    `Ask me ~${grillQuestionBudget} design questions about this plan in batches of up to ${batchSize} per \`ask_question\` call (multiple questions per card), each with a recommended answer. Wait for my answers on each batch before sending the next. When a question is answerable from the repo, explore instead of asking.`,
    'Ask only genuine design, scope, and tradeoff questions. Do NOT ask whether a spec or plan "looks good", "is okay", or whether to proceed — those are not design questions.',
    'This stage is chat only. Do NOT write or save any file, and do NOT draft, outline, or write the build spec — the next stage does that and the user confirms it then.',
    'When you have asked enough questions, stop with one short sentence saying the interview is complete. The controller advances to the spec stage automatically — never move ahead or combine stages yourself.',
    '',
    prompt,
  ].join('\n');
}
