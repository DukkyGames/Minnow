/**
 * Fire-and-forget title jobs on the first user message (Step 07).
 */

import { loadTitlesConfig } from '../../config/titles-meta';
import { PLACEHOLDER_CHAT_NAME } from '../../constants';
import {
  applyGeneratedChatTitle,
  findChatById,
  scheduleSaveSessions,
  touchChat,
} from '../../state/sessions';
import { renderSidebar } from '../../ui/sidebar';
import { generateChatTitle } from './generate';
import {
  hasTitleJobInflight,
  registerTitleJobInflight,
  releaseTitleJobInflight,
} from './inflight';
import { createTitleProviderPort } from './provider-port';

let titleGenerateImpl = generateChatTitle;

/** Replace title generator (unit tests). */
export function setGenerateChatTitleForTests(
  impl: typeof generateChatTitle | null,
): void {
  titleGenerateImpl = impl ?? generateChatTitle;
}

/** True when this chat has no user messages yet (call before pushing the first user row). */
export function isFirstUserMessagePending(chat: { history: { role: string }[] }): boolean {
  return !chat.history.some((m) => m.role === 'user');
}

export { resetTitleGenerationInflight } from './inflight';

/**
 * Schedule async title generation — returns immediately; never blocks send.
 */
export function scheduleChatTitleGeneration(chatId: string, seed: string): void {
  if (hasTitleJobInflight(chatId)) return;

  const chat = findChatById(chatId);
  if (!chat || chat.name !== PLACEHOLDER_CHAT_NAME) return;

  const controller = new AbortController();
  if (!registerTitleJobInflight(chatId, controller)) return;

  void runTitleJob(chatId, seed, controller.signal).finally(() => {
    releaseTitleJobInflight(chatId, controller);
  });
}

async function runTitleJob(chatId: string, seed: string, signal: AbortSignal): Promise<void> {
  const config = await loadTitlesConfig();
  if (!config.enabled) return;

  const chatBefore = findChatById(chatId);
  if (!chatBefore || chatBefore.name !== PLACEHOLDER_CHAT_NAME) return;

  const modelId = config.modelId.trim() || chatBefore.modelId.trim();
  if (!modelId) return;

  const providerId =
    config.providerId.trim() || chatBefore.providerId?.trim() || undefined;

  const title = await titleGenerateImpl(
    seed,
    {
      modelId,
      providerId,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      signal,
    },
    createTitleProviderPort(providerId),
  );

  if (!title || signal.aborted) return;

  const applied = applyGeneratedChatTitle(chatId, title);
  if (!applied) return;

  const chat = findChatById(chatId);
  if (chat) touchChat(chat);
  scheduleSaveSessions();
  renderSidebar();
}
