/**
 * Deterministic sidebar title for orchestrate-mode planner (parse) chats.
 */

import { normalizeModeId } from '../modes/types';
import { isPlaceholderChatName } from '../titles/placeholder';
import type { Chat } from '../../types';

const MANAGED_ORCHESTRATOR_TITLE = /^Orchestrator( - .+)?$/;

/** Plan basename without `.md`, matching board folder naming. */
export function planBasenameForTitle(planPath: string): string {
  return planPath.split('/').pop()?.replace(/\.md$/i, '') ?? '';
}

/** Sidebar title for a planner chat bound to a plan path. */
export function orchestratorPlannerChatTitle(planPath?: string): string {
  const basename = planPath?.trim() ? planBasenameForTitle(planPath.trim()) : '';
  return basename ? `Orchestrator - ${basename}` : 'Orchestrator';
}

/** True when the name is still auto-managed (placeholder or prior orchestrator title). */
export function isManagedOrchestratorPlannerTitle(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (isPlaceholderChatName(trimmed)) return true;
  return MANAGED_ORCHESTRATOR_TITLE.test(trimmed);
}

/** Apply the orchestrator planner title when the chat name is still managed. */
export function syncOrchestratorPlannerChatTitle(chat: Chat, planPath?: string): boolean {
  if (normalizeModeId(chat.modeId) !== 'orchestrate') return false;
  if (!isManagedOrchestratorPlannerTitle(chat.name)) return false;
  const resolvedPath = planPath?.trim() || chat.orchestratePlanPath?.trim();
  const nextName = orchestratorPlannerChatTitle(resolvedPath);
  if (chat.name === nextName) return false;
  chat.name = nextName;
  return true;
}
