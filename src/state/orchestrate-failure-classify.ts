/**
 * Failure category classifier for AFK board tasks (MIN-285 Phase 2).
 *
 * Kept import-free from orchestrate-board-actions to avoid circular modules.
 * `resolveTaskChatStreamOutcome` logic is inlined here; the original in
 * board-actions remains the canonical frozen-signature export.
 *
 * Precedence for classifyTaskFailure:
 *  1. Structured buildOutcome signal — env_blocked ⇒ infra regardless of prose
 *  2. Stall markers in transcript (max-tool-turns, reply-could-not-complete)
 *  3. Service-infra markers in transcript (ECONNREFUSED, port-in-use, docker daemon …)
 *  4. Missing-binary markers — disambiguated by *which* binary is missing:
 *       - a project/npm toolchain bin (eslint, tsc, vite …) or an npm-script
 *         context ⇒ 'code' (the builder can `npm install` / add the devDep)
 *       - a host service client (psql, docker, redis-cli …) ⇒ 'infra'
 *       - an unrecognised bin ⇒ 'infra' (conservative; routes to the env-fixer)
 *  5. Falls through to 'code'
 *
 * Rationale: a missing *project-local* binary (eslint not in devDependencies)
 * is a fixable code/setup defect, not a broken host environment. Treating it as
 * 'infra' sent it down the provision-or-quarantine path and blocked the task
 * without ever re-seeding the builder. See MIN-285 follow-up.
 */

import type { BoardTask, Chat } from '../types.ts';

export type FailureCategory = 'infra' | 'code' | 'stall' | 'merge' | 'unknown';

/** Mirror of the frozen type from orchestrate-board-actions. */
export type TaskChatStreamOutcome = 'completed' | 'stopped' | 'failed';

/**
 * Unambiguous host/network/service failures — always infra. These never fire on
 * a plain code error, so they take precedence before the missing-binary scan.
 */
const SERVICE_INFRA_MARKERS: string[] = [
  'ECONNREFUSED',
  'Connection refused',
  'EADDRINUSE',
  'address already in use',
  'port in use',
  'port-in-use',
  'Cannot connect to the Docker daemon',
  'docker daemon',
  'psql: error',
  'timed out after',
  'ETIMEDOUT',
  'getaddrinfo',
  'socket hang up',
];

/**
 * "X is not installed / not found" phrasings. Ambiguous on their own — the
 * binary name (below) decides whether it is a fixable project dep or real infra.
 * Note: 'No such file or directory' / 'does not exist' are intentionally NOT
 * here — they fire on ordinary code errors ("Property 'x' does not exist…").
 */
const MISSING_BIN_MARKERS: string[] = [
  'command not found',
  'is not recognized as an internal',
];

/**
 * Project/npm toolchain binaries the Builder can install (devDependency) — a
 * missing one is a 'code'/setup defect, routed back to the builder, not infra.
 */
const PROJECT_TOOLCHAIN_BINS: string[] = [
  'eslint',
  'tsc',
  'typescript',
  'vite',
  'vitest',
  'jest',
  'mocha',
  'prettier',
  'tsx',
  'ts-node',
  'webpack',
  'rollup',
  'esbuild',
  'next',
  'nuxt',
  'svelte',
  'babel',
  'playwright',
  'cypress',
  'nodemon',
  'concurrently',
  'rimraf',
  'cross-env',
];

/** npm-script execution context — a missing bin here is project-local. */
const NPM_SCRIPT_MARKERS: string[] = ['npm run', 'npm error', 'npx ', 'node_modules/.bin'];

/**
 * Host service clients/daemons — a missing one is a genuine environment problem
 * (the host needs the service), routed to the env-fixer / provisioning path.
 */
const SERVICE_BINS: string[] = [
  'psql',
  'pg_ctl',
  'createdb',
  'docker',
  'docker-compose',
  'redis-cli',
  'redis-server',
  'mysql',
  'mongo',
  'mongod',
];

const STALL_MARKERS: string[] = [
  'Maximum tool turns reached',
  'Could not complete this reply',
];

/** Provider copy for a full context window — transient, retriable as code (not stall). */
const CONTEXT_LENGTH_MARKERS: string[] = [
  'context length exceeded',
  'context limit has been reached',
  'maximum context length',
  'context_length_exceeded',
  'exceed context window',
  'requested tokens',
];

function matchesAny(text: string, markers: string[]): boolean {
  const lower = text.toLowerCase();
  return markers.some((m) => lower.includes(m.toLowerCase()));
}

/** True when the transcript shows a context-window overflow (retriable, not a stall). */
export function isTransientContextLengthError(text: string): boolean {
  return matchesAny(text, CONTEXT_LENGTH_MARKERS);
}

export function extractChatText(chat: Chat): string {
  const parts: string[] = [];
  for (const msg of chat.history) {
    const content =
      typeof msg.content === 'string'
        ? msg.content
        : msg.content == null
          ? ''
          : JSON.stringify(msg.content);
    if (content) parts.push(content);
  }
  for (const run of chat.runs ?? []) {
    if (run.errorMessage?.trim()) parts.push(run.errorMessage.trim());
  }
  return parts.join('\n');
}

/** Transcript plus failed-run error messages (board chats often only record errors on runs). */
export function extractChatFailureText(chat: Chat): string {
  return extractChatText(chat);
}

/**
 * Inlined outcome detection (mirrors the frozen resolveTaskChatStreamOutcome).
 * Called inside this module only; callers that need the canonical export
 * should use resolveTaskChatStreamOutcome from orchestrate-board-actions.
 */
export function inferStreamOutcome(chat: Chat): TaskChatStreamOutcome {
  const runs = chat.runs ?? [];
  if (runs.length > 0) {
    let latest = runs[0]!;
    for (const run of runs) {
      if (run.createdAt > latest.createdAt) latest = run;
    }
    if (latest.status === 'failed') return 'failed';
    if (latest.status === 'stopped') return 'stopped';
  }
  for (let i = chat.history.length - 1; i >= 0; i--) {
    const msg = chat.history[i];
    if (msg.role === 'assistant') {
      if ('stopped' in msg && msg.stopped) return 'stopped';
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content == null
            ? ''
            : JSON.stringify(msg.content);
      if (
        content.includes('Maximum tool turns reached') ||
        (content.includes('Could not complete this reply') &&
          !isTransientContextLengthError(content))
      ) {
        return 'failed';
      }
      return 'completed';
    }
    if (msg.role === 'user') break;
  }
  return 'failed';
}

/**
 * Classify the likely root cause of a task failure.
 *
 * @param chat    The builder/tester chat that just ended.
 * @param signal  Optional outcome signal (`board_report` outcome or legacy `buildOutcome`).
 * @param task    Optional board task for `boardReport` / `buildOutcome` fallback.
 */
export function classifyTaskFailure(
  chat: Chat,
  signal?: string,
  task?: BoardTask,
): FailureCategory {
  const reportOutcome = task?.boardReport?.outcome;
  if (reportOutcome === 'env_blocked') return 'infra';
  const buildOutcome = task?.buildOutcome?.trim();
  if (buildOutcome === 'env_blocked') return 'infra';
  // 1. Structured signal takes highest precedence.
  if (signal === 'env_blocked') return 'infra';
  // 'ok' should not reach the failure path.
  // 'failed' falls through to text scan below.

  // 2. Transcript text scan (covers both prose and embedded tool output).
  const text = extractChatFailureText(chat);
  if (isTransientContextLengthError(text)) return 'code';
  if (matchesAny(text, STALL_MARKERS)) return 'stall';
  if (matchesAny(text, SERVICE_INFRA_MARKERS)) return 'infra';

  // 3. Missing-binary: disambiguate by which binary / context is named.
  if (matchesAny(text, MISSING_BIN_MARKERS)) {
    // A project toolchain bin or an npm-script context ⇒ the builder can fix it.
    if (matchesAny(text, PROJECT_TOOLCHAIN_BINS) || matchesAny(text, NPM_SCRIPT_MARKERS)) {
      return 'code';
    }
    // A host service client ⇒ genuine infra.
    if (matchesAny(text, SERVICE_BINS)) return 'infra';
    // Unrecognised missing bin ⇒ conservative infra (env-fixer can investigate).
    return 'infra';
  }

  return 'code';
}

/**
 * Sibling of `resolveTaskChatStreamOutcome` that also returns the failure category.
 * The original in board-actions is left untouched (frozen signature per MIN-285).
 */
export function resolveTaskChatStreamFailure(chat: Chat): {
  outcome: TaskChatStreamOutcome;
  category: FailureCategory;
} {
  const outcome = inferStreamOutcome(chat);
  if (outcome !== 'failed') {
    return { outcome, category: 'unknown' };
  }
  const category = classifyTaskFailure(chat);
  return { outcome, category };
}

/**
 * GAP-3: true when the Builder completed with prose but never called
 * `board_report_build_result` AND the task declares a testSpec (so
 * verification was expected). Forces preflight + bounded verification
 * instead of advancing on prose alone.
 */
export function isUnverifiedCompletion(task: BoardTask, chat: Chat): boolean {
  if (task.boardReport?.outcome) return false;
  if (task.buildOutcome) return false;
  if (!task.testSpec?.trim()) return false;
  return inferStreamOutcome(chat) === 'completed';
}
