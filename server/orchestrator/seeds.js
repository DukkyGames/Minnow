/**
 * P2-E — six seed builders (MIN-702 / P0-E `SeedKind`).
 *
 * Seeds are **pure functions of derived task state**. No model call builds a
 * seed, and this file does no I/O — the same inputs always produce the same
 * string. That is load-bearing: `state = fold(journal)` only recovers a crashed
 * run if replay reseeds the same way live did.
 *
 * Lives here, not in `server/runner/`, because seeds know what a task is.
 * Lives outside `core/` because they produce prompt text, not a decision.
 *
 * Every retry in the policy table targets the builder. Tester's first attempt
 * also uses `initial` — the *system* prompt is what distinguishes the roles;
 * the seed is the task spec plus whatever history that kind needs.
 */

import { lastEndedAttempt } from './core/derive.js';

/** The six kinds, in the order the policy table names them. */
export const SEED_KINDS = /** @type {const} */ ([
  'initial',
  'failure-aware',
  'repair',
  'continue',
  'fix',
  'rebase',
]);

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string');
}

/**
 * @param {string[]} items
 * @returns {string}
 */
function bullets(items) {
  if (items.length === 0) return '(none recorded)';
  return items.map((item) => `- ${item}`).join('\n');
}

/**
 * The plan spec every seed starts from. Role is in the system prompt, not here.
 *
 * @param {import('./core/types').TaskState} task
 * @returns {string}
 */
function specBlock(task) {
  return [
    `# Task ${task.id} — ${task.title}`,
    '',
    '## Build',
    task.buildSpec || '(none)',
    '',
    '## Test',
    task.testSpec || '(none)',
    '',
    '## Accept',
    task.accept || '(none)',
  ].join('\n');
}

/**
 * @param {import('./core/types').Attempt | undefined} attempt
 * @returns {string[]}
 */
function blockersOf(attempt) {
  if (!attempt) return [];
  const fromEvidence = asStringList(attempt.evidence?.blockers);
  if (fromEvidence.length) return fromEvidence;
  return [];
}

/**
 * @param {import('./core/types').Attempt | undefined} attempt
 * @returns {string[]}
 */
function needsOf(attempt) {
  if (!attempt) return [];
  return asStringList(attempt.evidence?.needs);
}

/**
 * Tester fail carries `testOutput` on the attempt's evidence so a fix seed
 * can quote it. P2-F journals that field from the report payload.
 *
 * @param {import('./core/types').Attempt | undefined} attempt
 * @returns {string}
 */
function testOutputOf(attempt) {
  if (!attempt) return '';
  const value = attempt.evidence?.testOutput;
  if (typeof value === 'string' && value) return value;
  // Fall back to blockers so a fail that went through TurnResult still seeds.
  const blockers = blockersOf(attempt);
  return blockers[0] || attempt.summary || '';
}

/**
 * Summaries of finished attempts, oldest first — what is already done.
 *
 * @param {import('./core/types').TaskState} task
 * @returns {string[]}
 */
function alreadyDone(task) {
  /** @type {string[]} */
  const lines = [];
  for (const attempt of task.attempts) {
    if (!attempt.ended) continue;
    if (typeof attempt.summary === 'string' && attempt.summary) lines.push(attempt.summary);
  }
  return lines;
}

/**
 * @param {import('./core/types').Attempt | undefined} attempt
 * @returns {string}
 */
function endedHow(attempt) {
  if (!attempt) return 'The previous attempt ended without a recorded outcome.';
  if (attempt.outcome === 'crashed') return 'The previous attempt crashed.';
  if (attempt.outcome === 'timeout') return 'The previous attempt timed out.';
  if (attempt.outcome === 'no_report') {
    return 'The previous attempt ended without calling report_outcome.';
  }
  return `The previous attempt ended as ${attempt.outcome}.`;
}

/**
 * @param {import('./core/types').TaskState} task
 * @returns {string}
 */
function initialSeed(task) {
  return specBlock(task);
}

/**
 * @param {import('./core/types').TaskState} task
 * @returns {string}
 */
function failureAwareSeed(task) {
  const last = lastEndedAttempt(task);
  return [
    specBlock(task),
    '',
    '## Prior attempt',
    'The last attempt failed. Fix the blockers; do not expand scope.',
    '',
    `Summary: ${last?.summary || '(none recorded)'}`,
    '',
    'Blockers:',
    bullets(blockersOf(last)),
  ].join('\n');
}

/**
 * Repair stays in this worktree because it is whose worktree it is — the
 * env-fixer agent is gone. `blocked` means the environment cannot support the
 * work, not that the code is hard.
 *
 * @param {import('./core/types').TaskState} task
 * @returns {string}
 */
function repairSeed(task) {
  const last = lastEndedAttempt(task);
  return [
    specBlock(task),
    '',
    '## Environment',
    'The environment cannot support the work. Fix it in this worktree — do not start a parallel repair elsewhere, and do not treat a hard build as an environment problem.',
    '',
    `Summary: ${last?.summary || '(none recorded)'}`,
    '',
    'Needs:',
    bullets(needsOf(last)),
  ].join('\n');
}

/**
 * @param {import('./core/types').TaskState} task
 * @returns {string}
 */
function continueSeed(task) {
  const last = lastEndedAttempt(task);
  const done = alreadyDone(task);
  return [
    specBlock(task),
    '',
    '## Resume',
    `${endedHow(last)} Continue from what is already done; do not redo completed work.`,
    '',
    'Already done:',
    bullets(done),
  ].join('\n');
}

/**
 * @param {import('./core/types').TaskState} task
 * @returns {string}
 */
function fixSeed(task) {
  const last = lastEndedAttempt(task);
  const output = testOutputOf(last);
  return [
    specBlock(task),
    '',
    '## Test output',
    'The tester rejected the build. Fix the failures below; do not expand scope.',
    '',
    output || '(none recorded)',
  ].join('\n');
}

/**
 * @param {import('./core/types').TaskState} task
 * @param {string | null | undefined} integrationTip
 * @returns {string}
 */
function rebaseSeed(task, integrationTip) {
  const files = Array.isArray(task.mergeConflicts) ? task.mergeConflicts.filter((f) => typeof f === 'string') : [];
  const tip =
    typeof integrationTip === 'string' && integrationTip
      ? integrationTip
      : '(unknown — rebase onto the integration branch)';
  return [
    specBlock(task),
    '',
    '## Integration conflict',
    'Rebase onto the current integration tip and resolve the listed files. You wrote this code; you have the context to merge it.',
    '',
    `Integration tip: ${tip}`,
    '',
    'Conflicted files:',
    bullets(files),
  ].join('\n');
}

/**
 * Build the user-message seed for one attempt.
 *
 * @param {import('./core/types').SeedKind} kind
 * @param {{
 *   state: import('./core/types').BoardState,
 *   taskId: string,
 * }} input
 * @returns {string}
 */
export function buildSeed(kind, input) {
  if (!input || typeof input !== 'object') {
    throw new Error('buildSeed: input { state, taskId } is required');
  }
  const task = input.state?.tasks?.get(input.taskId);
  if (!task) {
    throw new Error(`buildSeed: unknown task ${String(input.taskId)}`);
  }

  if (kind === 'initial') return finish(initialSeed(task));
  if (kind === 'failure-aware') return finish(failureAwareSeed(task));
  if (kind === 'repair') return finish(repairSeed(task));
  if (kind === 'continue') return finish(continueSeed(task));
  if (kind === 'fix') return finish(fixSeed(task));
  if (kind === 'rebase') return finish(rebaseSeed(task, input.state.integrationSha));

  throw new Error(`buildSeed: unknown seed kind ${String(kind)}`);
}

/**
 * Golden files are ordinary text files, so every seed ends in a newline.
 * @param {string} text
 * @returns {string}
 */
function finish(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}
