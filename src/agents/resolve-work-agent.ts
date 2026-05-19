/**
 * Resolve active Work Agent id for a chat turn.
 */

import { normalizeModeId } from '../chat/modes/types';
import type { Chat } from '../types';
import {
  getDefaultWorkAgentForMode,
  getWorkAgent,
} from './work-agent-registry';
import type { WorkAgentDefinition } from './work-agent-types';

/** True when work-agent composer part should be omitted. */
export function isPassthroughWorkAgentId(agentId: string | null | undefined): boolean {
  return !agentId || agentId === 'default';
}

/**
 * Effective Work Agent for this send (auto from mode or pinned id).
 */
export function resolveActiveWorkAgent(chat: Chat): WorkAgentDefinition | null {
  const auto = chat.workAgentAuto !== false;

  if (!auto && chat.workAgentId) {
    const pinned = getWorkAgent(chat.workAgentId);
    return pinned && !pinned.disabled ? pinned : null;
  }

  if (chat.workAgentId && !isPassthroughWorkAgentId(chat.workAgentId)) {
    const pinned = getWorkAgent(chat.workAgentId);
    if (pinned && !pinned.disabled) return pinned;
  }

  if (auto) {
    const modeId = normalizeModeId(chat.modeId);
    const fromMode = getDefaultWorkAgentForMode(modeId);
    if (fromMode) return fromMode;
  }

  return null;
}

/** Resolved id for compose context (null = omit work-agent part). */
export function resolveActiveWorkAgentId(chat: Chat): string | null {
  const agent = resolveActiveWorkAgent(chat);
  if (!agent || isPassthroughWorkAgentId(agent.id)) return null;
  return agent.id;
}
