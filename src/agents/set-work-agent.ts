import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import type { Chat } from '../types';
import { getWorkAgent } from './work-agent-registry';

export function setWorkAgentForChat(chat: Chat, agentId: string | null): void {
  if (agentId && !getWorkAgent(agentId)) {
    throw new Error(`Unknown work agent: ${agentId}`);
  }
  chat.workAgentId = agentId;
  chat.workAgentAuto = false;
  touchChat(chat);
  scheduleSaveSessions();
}

export function setWorkAgentForActiveChat(agentId: string | null): void {
  setWorkAgentForChat(getActiveChat(), agentId);
}
