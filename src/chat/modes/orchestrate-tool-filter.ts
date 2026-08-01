/**
 * Orchestrate auto-pilot tool gating (delegate_tasks) and board-member tool stripping.
 */

import { BUILT_IN_TOOLS, type OpenAIFunctionDefinition } from '../../tools/definitions';
import type { AutopilotExecutionMode } from '../../config/autopilot-meta';
import { getBoardGroupForChat } from '../../state/chat-groups';
import type { Chat } from '../../types';
import { isExternalDynamicTool } from './tool-policy';
import { applyEducationToolFilter } from './education-overlay';
import { isEducationModeEnabledSync } from '../../config/education-meta';
import {
  BOARD_ROLE_BOARD_SUBSET,
  type BoardMemberRole,
  expandBoardRoleAllowedTools,
} from './tool-groups';

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
 * Resolve builder / tester / fixer from a board task chat. Fixer is keyed off the
 * task's fixerChatId (single scope for merge + env fixers).
 */
export function resolveBoardMemberRole(chat: Chat): BoardMemberRole {
  if (chat.workAgentId === 'tester') return 'test';

  const board = getBoardGroupForChat(chat)?.orchestrateBoard;
  const taskId = chat.boardTaskId?.trim();
  if (board && taskId) {
    const task = board.tasks.find((t) => t.id === taskId);
    if (task) {
      const chatId = chat.id;
      if (task.fixerChatId?.trim() === chatId) return 'fix';
      if (task.testChatId?.trim() === chatId) return 'test';
    }
  }

  return 'build';
}

/**
 * Board task chats run in build mode but need orchestrate-only board tools. Inject
 * `board_get_state` / `board_report` before role filtering (not gated by Settings).
 */
export function injectBoardMemberSubsetTools(
  defs: OpenAIFunctionDefinition[],
): OpenAIFunctionDefinition[] {
  if (!defs.length) return defs;
  const existing = new Set(defs.map((d) => d.function.name));
  const extra: OpenAIFunctionDefinition[] = [];
  for (const tool of BUILT_IN_TOOLS) {
    if (
      (BOARD_ROLE_BOARD_SUBSET as readonly string[]).includes(tool.id) &&
      !existing.has(tool.id)
    ) {
      extra.push(tool.definition);
    }
  }
  return extra.length ? [...defs, ...extra] : defs;
}

/**
 * Board task/tester/fixer chats must not mutate the board or delegate — the auto-pilot
 * advances cards programmatically. Intersects with per-role allowlists (MIN-333) so
 * builder/fixer no longer inherit the full mode tool payload.
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

  const role = resolveBoardMemberRole(chat);
  const roleAllowed = expandBoardRoleAllowedTools(role);
  const stripUserPrompts = isHandsOffMode(executionMode);

  const filtered = defs.filter((def) => {
    const name = def.function.name;
    if (BOARD_MEMBER_STRIPPED_TOOLS.has(name)) return false;
    // MCP/plugin tools are gated in Settings, not the board role matrix (MIN-333).
    if (!isExternalDynamicTool(name) && !roleAllowed.has(name)) return false;
    if (stripUserPrompts && USER_BLOCKING_TOOLS.has(name)) return false;
    return true;
  });

  // Build and fix roles carry their own files-write allowlist that bypasses the
  // mode matrix, so Education Mode has to strip it here too.
  return applyEducationToolFilter(isEducationModeEnabledSync(), filtered);
}
