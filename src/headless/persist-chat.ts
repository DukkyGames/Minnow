/**
 * Persist a headless run transcript into ~/.minnow sessions (scheduler run history).
 * Uses PATCH so concurrent UI chat creates are not clobbered by a GET-splice-PUT.
 */

import { normalizeModeId } from '../chat/modes/types';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import { SESSION_SCHEMA_VERSION } from '../types';
import type { Chat, Message } from '../types';
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

/** Upsert one chat via PATCH /api/config/sessions (no whole-blob read/write). */
async function patchSessionsChat(chat: Chat): Promise<void> {
  const res = await fetch(headlessApiUrl('/api/config/sessions'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseVersion: SESSION_SCHEMA_VERSION,
      chats: [chat],
    }),
  });
  if (!res.ok) {
    throw new Error(`PATCH /api/config/sessions failed: HTTP ${res.status}`);
  }
}

/** Merge one scheduler/headless chat into the persisted session list. */
export async function persistHeadlessChat(input: PersistHeadlessChatInput): Promise<void> {
  const chatId = input.chatId.trim();
  if (!chatId) {
    throw new Error('chatId is required to persist a headless chat');
  }

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

  await patchSessionsChat(chat);
}
