/**
 * Boot-time re-subscribe for in-flight backend generations (`currentGenerationId`).
 * Boot re-subscribe for main chat streams after reload (Phase 2b+).
 *
 * Phase 4: when the Session Engine owns the turn, the renderer must NOT call
 * runChatTurn — tokens are mirrored via engine-stream-mirror instead. Resuming
 * here would double-drive tools after the generation ends.
 */

import { isChatStreaming } from './streaming-state';
import { GENERATION_LOST_ON_RESTART_MESSAGE } from '../api/generations';
import type { Chat } from '../types';
import { isGoalLoopActive } from '../state/sessions';
import { isServerEngineEnabled } from '../state/server-engine-flag';
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
 * Resume all chats that still reference a backend generation id.
 * The first matching chat owns the global streaming flag; others subscribe in the background.
 */
export async function bootGenerationResumeForChats(chats: Chat[]): Promise<void> {
  // Engine default-on: stream mirror + server tool loop own in-flight gens.
  if (isServerEngineEnabled()) {
    const { syncEngineStreamMirrors } = await import('./engine-stream-mirror');
    syncEngineStreamMirrors();
    return;
  }

  const resumable = listChatsWithGenerationId(chats);
  if (!resumable.length) {
    return;
  }

  let first = true;
  for (const chat of resumable) {
    await bootGenerationResumeForChat(chat, { ownsGlobalStreaming: first });
    first = false;
  }
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
  // Engine owns the tool loop — mirror tokens only (no renderer runChatTurn).
  if (isServerEngineEnabled()) {
    const { syncEngineStreamMirrors } = await import('./engine-stream-mirror');
    syncEngineStreamMirrors();
    return;
  }

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

  const { runChatTurn } = await import('../tools/loop');

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
