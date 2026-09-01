/**
 * Boot-time re-subscribe for in-flight backend generations (`currentGenerationId`).
 * Boot re-subscribe for main chat streams after reload (Phase 2b+).
 */

import { isChatStreaming } from './streaming-state';
import { GENERATION_LOST_ON_RESTART_MESSAGE } from '../api/generations';
import type { Chat } from '../types';
import { isGoalLoopActive } from '../state/sessions';
import { setStatus } from '../ui/status';

/** Read the composer model picker (empty when none selected). */
function getSelectedModelIdFromDom(): string {
  const el = document.getElementById('modelSelect') as HTMLSelectElement | null;
  return el?.value?.trim() ?? '';
}

/** Chats that still have a persisted backend generation id (boot resume candidates). */
export function listChatsWithGenerationId(chats: Chat[]): Chat[] {
  return chats.filter((c) => c.currentGenerationId?.trim());
}

/**
 * Resume chats that still reference a backend generation id.
 *
 * Only the active chat resumes at boot. A lazy boot leaves every other chat with an
 * empty history placeholder and a generation id that a server restart already
 * invalidated, so resuming them all meant hydrating and failing each one in turn —
 * and each failure ran the turn's history rollback. The rest resume on activation
 * (see `bootGenerationResumeForChat` from the chat switch), by which point their
 * transcript is loaded.
 */
export async function bootGenerationResumeForChats(chats: Chat[]): Promise<void> {
  const resumable = listChatsWithGenerationId(chats);
  if (!resumable.length) {
    return;
  }

  const { getActiveChat } = await import('../state/sessions');
  const activeId = getActiveChat()?.id;
  const active = resumable.find((chat) => chat.id === activeId);
  if (!active) {
    return;
  }
  await bootGenerationResumeForChat(active, { ownsGlobalStreaming: true });
}

export interface BootGenerationResumeOptions {
  /** When true, this chat drives `streaming` / sidebar thinking state. */
  ownsGlobalStreaming?: boolean;
}

/**
 * Re-subscribe to `chat.currentGenerationId` after reload or chat switch.
 * Does not push a new user message (`pushUser: false`).
 */
export async function bootGenerationResumeForChat(
  chat: Chat,
  options: BootGenerationResumeOptions = {},
): Promise<void> {
  if (isChatStreaming(chat.id)) {
    return;
  }

  const generationId = chat.currentGenerationId?.trim();
  if (!generationId) {
    return;
  }

  const modelId = getSelectedModelIdFromDom();
  if (!modelId) {
    setStatus('err', 'Select a model to resume this reply');
    return;
  }

  const { runChatTurn } = await import('./run-turn-chat');

  try {
    await runChatTurn({
      chat,
      pushUser: false,
      rawText: '',
      userText: '',
      skillId: null,
      displayText: '',
      historyContent: '',
      validAttachments: [],
      resumeGenerationId: generationId,
      ownsGlobalStreaming: options.ownsGlobalStreaming ?? true,
      goalDriven: isGoalLoopActive(chat),
    });
  } catch {
    /* runChatTurn surfaces inline errors; no auto-retry */
  }
}

/** Inline error copy when GET /stream returns 404 (generation evicted on server restart). */
export function generationLostOnRestartMessage(): string {
  return GENERATION_LOST_ON_RESTART_MESSAGE;
}
