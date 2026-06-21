/**
 * Orchestrate auto-pilot tool gating (delegate_tasks) and board-member tool stripping.
 */

import type { OpenAIFunctionDefinition } from '../../tools/definitions';
import type { Chat } from '../../types';

const BOARD_MEMBER_STRIPPED_TOOLS = new Set([
  'board_init',
  'board_update_task',
  'delegate_tasks',
]);

/** Hide delegate_tasks from the planner LLM — auto/sequential delegates programmatically. */
export function applyOrchestrateAutoToolFilter(
  defs: OpenAIFunctionDefinition[],
  _executionMode: 'manual' | 'auto' | 'sequential' | 'afk' | undefined,
): OpenAIFunctionDefinition[] {
  return defs.filter((def) => def.function.name !== 'delegate_tasks');
}

/**
 * Board task/tester chats must not mutate the board or delegate — the auto-pilot
 * advances cards programmatically. Keeps board_get_state and board_report_test_result.
 */
export function applyBoardMemberToolFilter(
  defs: OpenAIFunctionDefinition[],
  chat: Chat,
): OpenAIFunctionDefinition[] {
  if (!chat.boardTaskId?.trim()) return defs;
  return defs.filter((def) => !BOARD_MEMBER_STRIPPED_TOOLS.has(def.function.name));
}
