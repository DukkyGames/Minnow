/**
 * Engine-hosted chat turn launcher for orchestrate board task/test/fixer chats (MIN-360).
 *
 * Replaces renderer runChatTurn when the Session Engine owns the board: awaits the
 * Phase 1 main-chat loop, then fires the in-process stream-end bus so board finalize
 * + drain run in the same Node process (no devices required).
 */

import { setStreaming } from '../app-state.ts';
import type { Chat } from '../types.ts';
import {
  notifyChatStreamActivity,
  notifyChatStreamEnded,
} from './stream-bus.ts';

export type BoardChatTurnOptions = {
  chat: Chat;
  pushUser: boolean;
  rawText: string;
  userText: string;
  displayText: string;
  historyContent: string;
  skillId: string | null;
  validAttachments: unknown[];
  titleSeed?: string;
  ownsGlobalStreaming?: boolean;
};

/**
 * Run one board-owned chat turn via the engine loop and emit stream-end when done.
 * Caller already reserved the launch slot and started heartbeat supervision.
 */
export async function runBoardEngineChatTurn(options: BoardChatTurnOptions): Promise<void> {
  const chatId = options.chat.id;
  const {
    beginEngineTurn,
    endEngineTurn,
    mutateEngineState,
    getEngineSessionState,
  } = await import('../../server/session/engine-api.js');
  const { findChatInState } = await import('../../server/session/commands.js');
  const { runEngineMainChatTurn } = await import('../../server/session/loop-loader.js');

  // Keep isChatStreaming() true for board concurrency / stall checks during the turn.
  setStreaming(true, chatId);

  const historyContent =
    typeof options.historyContent === 'string' && options.historyContent.trim()
      ? options.historyContent
      : options.rawText;

  const controller = beginEngineTurn(chatId);
  try {
    if (options.pushUser && historyContent.trim()) {
      await mutateEngineState((state: unknown) => {
        const chat = findChatInState(state, chatId) as Chat | null;
        if (!chat) throw new Error(`Chat not found: ${chatId}`);
        if (!Array.isArray(chat.history)) chat.history = [];
        chat.history.push({ role: 'user', content: historyContent });
        chat.engineTurnActive = true;
        chat.updatedAt = Date.now();
        if (options.chat.modelId?.trim()) chat.modelId = options.chat.modelId.trim();
        if (options.chat.providerId?.trim()) {
          chat.providerId = options.chat.providerId.trim();
        }
      });
    } else {
      await mutateEngineState((state: unknown) => {
        const chat = findChatInState(state, chatId) as Chat | null;
        if (!chat) return;
        chat.engineTurnActive = true;
        chat.updatedAt = Date.now();
      });
    }

    // Re-bind live chat fields from engine state (model may have been synced above).
    const live = findChatInState(getEngineSessionState(), chatId) as Chat | null;
    const modelId = live?.modelId ?? options.chat.modelId;
    const providerId = live?.providerId ?? options.chat.providerId;

    await runEngineMainChatTurn({
      chatId,
      signal: controller.signal,
      modelId,
      providerId,
      deps: {
        async getChat(id) {
          return findChatInState(getEngineSessionState(), id) as Chat | null;
        },
        async mutateChat(id, mutator, opts) {
          await mutateEngineState((state: unknown) => {
            const chat = findChatInState(state, id);
            if (!chat) throw new Error(`Chat not found: ${id}`);
            mutator(chat as Chat);
            (chat as Chat).updatedAt = Date.now();
          }, opts);
          // Stall supervision: treat each soft mutate during streaming as activity.
          notifyChatStreamActivity(id);
        },
      },
    });
  } finally {
    endEngineTurn(chatId, controller);
    await mutateEngineState((state: unknown) => {
      const chat = findChatInState(state, chatId) as Chat | null;
      if (!chat) return;
      chat.engineTurnActive = false;
      chat.currentGenerationId = undefined;
      chat.updatedAt = Date.now();
    }).catch(() => undefined);
    // Stream-end before clearing streaming flags (board drain depends on this order).
    notifyChatStreamEnded(chatId);
    setStreaming(false, chatId);
  }
}
