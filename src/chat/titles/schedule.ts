/**
 * Fire-and-forget title jobs on the first user message (Step 07).
 */

import { loadTitlesConfig } from '../../config/titles-meta';
import { getActiveProvider } from '../../providers/store';
import { hasMeasurableUsage } from '../../usage/pricing';
import { recordChatCompletionUsage } from '../../usage/record-chat-usage';
import { waitForEngineTurnIdle } from '../../state/session-commands';
import {
  applyGeneratedChatTitle,
  findChatById,
  scheduleSaveSessions,
  touchChat,
} from '../../state/sessions';
import { renderSidebar } from '../../ui/sidebar';
import { generateChatTitle } from './generate';
import { fallbackTitleFromSeed } from './sanitize';
import {
  hasTitleJobInflight,
  registerTitleJobInflight,
  releaseTitleJobInflight,
} from './inflight';
import { emitTitleJobEnded, emitTitleJobStarted } from './activity-events';
import { isPlaceholderChatName } from './placeholder';
import { createTitleProviderPort } from './provider-port';
import type { TitleGenerationOptions } from './types';

/** Resolved send binding passed from the main message path (work-agent / UI designer). */
export interface TitleScheduleContext {
  modelId?: string;
  providerId?: string;
}

const scheduleContextByChatId = new Map<string, TitleScheduleContext>();

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

/** Clear per-chat schedule context (tests). */
export function resetTitleScheduleContext(): void {
  scheduleContextByChatId.clear();
}

/** Read-only model binding captured when the title job was scheduled. */
export function getTitleScheduleContext(chatId: string): TitleScheduleContext | undefined {
  return scheduleContextByChatId.get(chatId);
}

/**
 * Schedule async title generation — returns immediately; never blocks send.
 * Pass `context` when the send path already resolved model/provider bindings.
 */
export function scheduleChatTitleGeneration(
  chatId: string,
  seed: string,
  context?: TitleScheduleContext,
): void {
  if (hasTitleJobInflight(chatId)) return;

  const chat = findChatById(chatId);
  if (!chat || !isPlaceholderChatName(chat.name)) return;

  if (context && (context.modelId?.trim() || context.providerId?.trim())) {
    scheduleContextByChatId.set(chatId, {
      modelId: context.modelId?.trim() || undefined,
      providerId: context.providerId?.trim() || undefined,
    });
  }

  const controller = new AbortController();
  if (!registerTitleJobInflight(chatId, controller)) return;

  emitTitleJobStarted(chatId, scheduleContextByChatId.get(chatId) ?? context);

  void runTitleJob(chatId, seed, controller.signal).finally(() => {
    scheduleContextByChatId.delete(chatId);
    releaseTitleJobInflight(chatId, controller);
    emitTitleJobEnded(chatId);
  });
}

export interface ScheduleEngineTitleOptions extends TitleScheduleContext {
  /**
   * When set, overrides the first-user-message check. Capture before `send_message`
   * appends the user row via SSE (after which {@link isFirstUserMessagePending} is false).
   */
  shouldSchedule?: boolean;
}

/**
 * Session Engine sends never run renderer `runChatTurn`, so titles must be scheduled here.
 * Waits for the engine turn to settle (parity with `deferTitleUntilTurnEnd`) then fires
 * {@link scheduleChatTitleGeneration}. Fire-and-forget — never blocks the send path.
 */
export function scheduleChatTitleAfterEngineTurn(
  chatId: string,
  seed: string,
  options?: ScheduleEngineTitleOptions,
): void {
  const chat = findChatById(chatId);
  if (!chat || !isPlaceholderChatName(chat.name)) return;

  const shouldSchedule =
    options?.shouldSchedule !== undefined
      ? options.shouldSchedule
      : isFirstUserMessagePending(chat);
  if (!shouldSchedule) return;

  const trimmedSeed = seed.trim();
  if (!trimmedSeed) return;

  const context: TitleScheduleContext = {
    modelId: options?.modelId,
    providerId: options?.providerId,
  };

  // Optimistic busy so idle wait cannot resolve before the first SSE busy patch.
  chat.engineTurnActive = true;

  void waitForEngineTurnIdle(chatId, { assumeStarted: true })
    .catch(() => undefined)
    .then(() => {
      scheduleChatTitleGeneration(chatId, trimmedSeed, context);
    });
}

function resolveTitleGenerationOptions(
  chatBefore: { modelId: string; providerId?: string },
  config: Awaited<ReturnType<typeof loadTitlesConfig>>,
  scheduled: TitleScheduleContext | undefined,
): Pick<TitleGenerationOptions, 'modelId' | 'providerId'> | null {
  const modelId =
    config.modelId.trim() ||
    scheduled?.modelId?.trim() ||
    chatBefore.modelId.trim();
  if (!modelId) return null;

  const providerId =
    config.providerId.trim() ||
    scheduled?.providerId?.trim() ||
    chatBefore.providerId?.trim() ||
    undefined;

  return { modelId, providerId };
}

async function runTitleJob(chatId: string, seed: string, signal: AbortSignal): Promise<void> {
  const config = await loadTitlesConfig();
  if (!config.enabled) return;

  const chatBefore = findChatById(chatId);
  if (!chatBefore || !isPlaceholderChatName(chatBefore.name)) return;

  const scheduled = scheduleContextByChatId.get(chatId);
  const resolved = resolveTitleGenerationOptions(chatBefore, config, scheduled);
  if (!resolved) return;

  const activeProvider = await getActiveProvider(resolved.providerId ?? chatBefore.providerId);
  const providerId = activeProvider.id;

  const generated = await titleGenerateImpl(
    seed,
    {
      modelId: resolved.modelId,
      providerId: resolved.providerId,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      signal,
    },
    createTitleProviderPort(resolved.providerId),
  );

  const title = generated.title ?? fallbackTitleFromSeed(seed);
  if (hasMeasurableUsage(generated.usage)) {
    const chatForLedger = findChatById(chatId);
    if (chatForLedger) {
      void recordChatCompletionUsage(chatForLedger, {
        source: { kind: 'title' },
        providerId,
        modelId: resolved.modelId,
        usage: generated.usage!,
      });
    }
  }
  if (!title || signal.aborted) return;

  const applied = applyGeneratedChatTitle(chatId, title);
  if (!applied) return;

  const chat = findChatById(chatId);
  if (chat) touchChat(chat);
  scheduleSaveSessions();
  renderSidebar();
}
