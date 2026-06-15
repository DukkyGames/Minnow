/**
 * Persist a headless run transcript into ~/.minnow sessions (scheduler run history).
 */

import { normalizeModeId } from '../chat/modes/types';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import type { Chat, Message, SessionState } from '../types';
import { headlessApiUrl } from './server-context';

export interface PersistHeadlessChatInput {
  chatId: string;
  chatName: string;
  workspacePath: string;
  modeId: string;
  providerId: string;
  modelId: string;
  workAgentId?: string | null;
  history: Message[];
}

async function fetchSessions(): Promise<SessionState> {
  const res = await fetch(headlessApiUrl('/api/config/sessions'), { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`GET /api/config/sessions failed: HTTP ${res.status}`);
  }
  return (await res.json()) as SessionState;
}

async function putSessions(state: SessionState): Promise<void> {
  const res = await fetch(headlessApiUrl('/api/config/sessions'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  if (!res.ok) {
    throw new Error(`PUT /api/config/sessions failed: HTTP ${res.status}`);
  }
}

/** Merge one scheduler/headless chat into the persisted session list. */
export async function persistHeadlessChat(input: PersistHeadlessChatInput): Promise<void> {
  const chatId = input.chatId.trim();
  if (!chatId) {
    throw new Error('chatId is required to persist a headless chat');
  }

  const state = await fetchSessions();
  const now = Date.now();
  const workspacePath = normalizeWorkspacePath(input.workspacePath);

  const chat: Chat = {
    id: chatId,
    name: input.chatName.trim() || 'Scheduled run',
    workspacePath,
    modelId: input.modelId,
    providerId: input.providerId || undefined,
    modeId: normalizeModeId(input.modeId),
    workAgentId: input.workAgentId ?? undefined,
    workAgentAuto: !input.workAgentId,
    history: input.history,
    lastStats: null,
    modelInfo: {},
    updatedAt: now,
    lastMessageAt: now,
  };

  const existingIndex = state.chats.findIndex((row) => row.id === chatId);
  if (existingIndex >= 0) {
    state.chats[existingIndex] = { ...state.chats[existingIndex], ...chat };
  } else {
    state.chats.unshift(chat);
  }

  await putSessions(state);
}
