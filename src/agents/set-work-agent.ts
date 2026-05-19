/**
 * Programmatic Work Agent selection (S09 / orchestrator hook stub).
 */

import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import type { Chat } from '../types';
import { getWorkAgent } from './work-agent-registry';

/** Set active Work Agent on a chat and persist. */
export function setWorkAgentForChat(chat: Chat, agentId: string | null): void {
  if (agentId && !getWorkAgent(agentId)) {
    throw new Error(`Unknown work agent: ${agentId}`);
  }
  chat.workAgentId = agentId;
  chat.workAgentAuto = false;
  touchChat(chat);
  scheduleSaveSessions();
}

/** Set Work Agent on the active session chat. */
export function setWorkAgentForActiveChat(agentId: string | null): void {
  setWorkAgentForChat(getActiveChat(), agentId);
}
