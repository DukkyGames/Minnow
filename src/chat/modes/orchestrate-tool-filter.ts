/**
 * Orchestrate auto-pilot tool gating (delegate_tasks) and board-member tool stripping.
 */

import type { OpenAIFunctionDefinition } from '../../tools/definitions';
import type { AutopilotExecutionMode } from '../../config/autopilot-meta';
import type { Chat } from '../../types';

const BOARD_MEMBER_STRIPPED_TOOLS = new Set([
  'board_init',
  'board_update_task',
  'board_set_autonomy',
  'delegate_tasks',
]);

/**
 * Tools that surface the blocking `ask_question` UI and wait for the user. Hands-off
 * runs must not expose these — with nobody at the keyboard they stall the chat, which
 * trips the stall watchdog and spawns redundant retry/fix agents.
 */
const USER_BLOCKING_TOOLS = new Set(['ask_question', 'propose_mode_switch']);

/** Auto and AFK both delegate programmatically; only AFK is fully hands-off for the planner. */
function isHandsOffMode(mode: AutopilotExecutionMode | undefined): boolean {
  return mode === 'auto' || mode === 'afk';
}

/** Hide delegate_tasks from the planner LLM — auto/sequential delegates programmatically. */
export function applyOrchestrateAutoToolFilter(
  defs: OpenAIFunctionDefinition[],
  executionMode: AutopilotExecutionMode | undefined,
): OpenAIFunctionDefinition[] {
  return defs.filter((def) => {
    if (def.function.name === 'delegate_tasks') return false;
    // AFK is fully hands-off — the planner itself must never prompt the user. In Auto
    // the orchestrator may still ask (the user is present); only its sub-agents are muted.
    if (executionMode === 'afk' && USER_BLOCKING_TOOLS.has(def.function.name)) return false;
    return true;
  });
}

/**
 * Board task/tester chats must not mutate the board or delegate — the auto-pilot
 * advances cards programmatically. Keeps board_get_state and board_report_test_result.
 *
 * Under Auto/AFK these sub-agents are also denied `ask_question`: only the orchestrator
 * may pause for the user (and only in Auto), so builders/testers/fixers can't block a
 * hands-off run waiting on input that never comes.
 */
export function applyBoardMemberToolFilter(
  defs: OpenAIFunctionDefinition[],
  chat: Chat,
  executionMode?: AutopilotExecutionMode,
): OpenAIFunctionDefinition[] {
  if (!chat.boardTaskId?.trim()) return defs;
  const stripUserPrompts = isHandsOffMode(executionMode);
  return defs.filter((def) => {
    if (BOARD_MEMBER_STRIPPED_TOOLS.has(def.function.name)) return false;
    if (stripUserPrompts && USER_BLOCKING_TOOLS.has(def.function.name)) return false;
    return true;
  });
}
