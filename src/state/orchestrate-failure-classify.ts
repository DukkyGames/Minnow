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
 *  3. Infra markers in transcript (ECONNREFUSED, port-in-use, missing binary …)
 *  4. Falls through to 'code'
 */

import type { BoardTask, Chat } from '../types.ts';

export type FailureCategory = 'infra' | 'code' | 'stall' | 'merge' | 'unknown';

/** Mirror of the frozen type from orchestrate-board-actions. */
export type TaskChatStreamOutcome = 'completed' | 'stopped' | 'failed';

const INFRA_MARKERS: string[] = [
  'ECONNREFUSED',
  'Connection refused',
  'EADDRINUSE',
  'address already in use',
  'port in use',
  'port-in-use',
  'command not found',
  'is not recognized as an internal',
  'No such file or directory',
  'Cannot connect to the Docker daemon',
  'docker daemon',
  'does not exist',
  'psql: error',
  'timed out after',
  'ETIMEDOUT',
  'getaddrinfo',
  'socket hang up',
];

const STALL_MARKERS: string[] = [
  'Maximum tool turns reached',
  'Could not complete this reply',
];

function matchesAny(text: string, markers: string[]): boolean {
  const lower = text.toLowerCase();
  return markers.some((m) => lower.includes(m.toLowerCase()));
}

function extractChatText(chat: Chat): string {
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
  return parts.join('\n');
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
        content.includes('Could not complete this reply')
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
 * @param signal  Optional `buildOutcome` reported by board_report_build_result.
 */
export function classifyTaskFailure(chat: Chat, signal?: string): FailureCategory {
  // 1. Structured signal takes highest precedence.
  if (signal === 'env_blocked') return 'infra';
  // 'ok' should not reach the failure path.
  // 'failed' falls through to text scan below.

  // 2. Transcript text scan (covers both prose and embedded tool output).
  const text = extractChatText(chat);
  if (matchesAny(text, STALL_MARKERS)) return 'stall';
  if (matchesAny(text, INFRA_MARKERS)) return 'infra';

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
  if (task.buildOutcome) return false;
  if (!task.testSpec?.trim()) return false;
  return inferStreamOutcome(chat) === 'completed';
}
