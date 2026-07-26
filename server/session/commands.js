/**
 * Typed session command handlers for the Session Engine (Phase 1).
 * Long-running send_message work continues after the 202 response.
 */

import { randomUUID } from 'node:crypto';
import {
  abortEngineTurn,
  beginEngineTurn,
  endEngineTurn,
  isEngineTurnActive,
  mutateEngineState,
} from './engine-api.js';
import { getSessionRev } from './rev-store.js';
import { runEngineMainChatTurn } from './loop-loader.js';

/**
 * @typedef {{
 *   type: 'send_message',
 *   chatId: string,
 *   text: string,
 *   modelId?: string,
 *   providerId?: string,
 *   temperature?: number,
 *   maxTokens?: number,
 *   systemPrompt?: string,
 *   goalDriven?: boolean,
 *   skillId?: string | null,
 *   displayText?: string,
 *   historyContent?: string,
 * }} SendMessageCommand
 *
 * @typedef {{ type: 'stop_generation', chatId: string }} StopGenerationCommand
 *
 * @typedef {{ type: 'steer_message', chatId: string, text: string }} SteerMessageCommand
 *
 * @typedef {{ type: 'enqueue_message', chatId: string, text: string }} EnqueueMessageCommand
 *
 * @typedef {SendMessageCommand | StopGenerationCommand | SteerMessageCommand | EnqueueMessageCommand} SessionCommand
 */

/**
 * Find a chat row by id on a SessionState-like blob.
 * @param {any} state
 * @param {string} chatId
 * @returns {any | null}
 */
export function findChatInState(state, chatId) {
  if (!state || !Array.isArray(state.chats)) return null;
  return state.chats.find((c) => c && c.id === chatId) ?? null;
}

/**
 * @param {SessionCommand} cmd
 * @returns {Promise<{ rev: number, accepted: boolean, detail?: string }>}
 */
export async function applySessionCommand(cmd) {
  if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') {
    throw Object.assign(new Error('Command type is required'), { statusCode: 400 });
  }

  switch (cmd.type) {
    case 'send_message':
      return handleSendMessage(cmd);
    case 'stop_generation':
      return handleStopGeneration(cmd);
    case 'steer_message':
      return handleSteerMessage(cmd);
    case 'enqueue_message':
      return handleEnqueueMessage(cmd);
    default:
      throw Object.assign(new Error(`Unknown command type: ${cmd.type}`), {
        statusCode: 400,
      });
  }
}

/**
 * @param {SendMessageCommand} cmd
 */
async function handleSendMessage(cmd) {
  const chatId = typeof cmd.chatId === 'string' ? cmd.chatId.trim() : '';
  const text = typeof cmd.text === 'string' ? cmd.text : '';
  if (!chatId) {
    throw Object.assign(new Error('chatId is required'), { statusCode: 400 });
  }
  if (!text.trim() && !cmd.historyContent?.trim()) {
    throw Object.assign(new Error('text is required'), { statusCode: 400 });
  }

  if (isEngineTurnActive(chatId)) {
    // Follow-up while streaming → queue (parity with composer enqueue).
    return handleEnqueueMessage({ type: 'enqueue_message', chatId, text });
  }

  const historyContent =
    typeof cmd.historyContent === 'string' && cmd.historyContent.trim()
      ? cmd.historyContent
      : text.trim();

  const rev = await mutateEngineState((state) => {
    const chat = findChatInState(state, chatId);
    if (!chat) {
      throw Object.assign(new Error(`Chat not found: ${chatId}`), { statusCode: 404 });
    }
    if (!Array.isArray(chat.history)) chat.history = [];
    chat.history.push({ role: 'user', content: historyContent });
    chat.updatedAt = Date.now();
    if (typeof cmd.modelId === 'string' && cmd.modelId.trim()) {
      chat.modelId = cmd.modelId.trim();
    }
    if (typeof cmd.providerId === 'string' && cmd.providerId.trim()) {
      chat.providerId = cmd.providerId.trim();
    }
    // Mark turn in progress for remote clients (mirrors streaming affordance).
    chat.engineTurnActive = true;
  });

  // Fire-and-forget tool loop — HTTP already returned 202 + rev.
  const controller = beginEngineTurn(chatId);
  void runEngineMainChatTurn({
    chatId,
    signal: controller.signal,
    modelId: cmd.modelId,
    providerId: cmd.providerId,
    temperature: cmd.temperature,
    maxTokens: cmd.maxTokens,
    systemPrompt: cmd.systemPrompt,
    goalDriven: cmd.goalDriven === true,
  })
    .catch((err) => {
      console.error('[session-engine] send_message failed:', err);
      return mutateEngineState((state) => {
        const chat = findChatInState(state, chatId);
        if (!chat) return;
        chat.engineTurnActive = false;
        chat.currentGenerationId = undefined;
        const message = err instanceof Error ? err.message : String(err);
        chat.history = Array.isArray(chat.history) ? chat.history : [];
        chat.history.push({
          role: 'assistant',
          content: `Error: ${message}`,
        });
        chat.updatedAt = Date.now();
      });
    })
    .finally(() => {
      endEngineTurn(chatId, controller);
    });

  return { rev, accepted: true };
}

/**
 * @param {StopGenerationCommand} cmd
 */
async function handleStopGeneration(cmd) {
  const chatId = typeof cmd.chatId === 'string' ? cmd.chatId.trim() : '';
  if (!chatId) {
    throw Object.assign(new Error('chatId is required'), { statusCode: 400 });
  }

  abortEngineTurn(chatId);

  const rev = await mutateEngineState((state) => {
    const chat = findChatInState(state, chatId);
    if (!chat) return;
    chat.engineTurnActive = false;
    chat.currentGenerationId = undefined;
    if (chat.pendingSteerMessage) chat.pendingSteerMessage = undefined;
    chat.updatedAt = Date.now();
  });

  return { rev, accepted: true };
}

/**
 * Last-write-wins steer slot (parity with src/chat/steer-message.ts).
 * Cancels the live generation so the tool loop can consume steer at the next
 * boundary — does NOT abort the whole turn (loop keeps running).
 * @param {SteerMessageCommand} cmd
 */
async function handleSteerMessage(cmd) {
  const chatId = typeof cmd.chatId === 'string' ? cmd.chatId.trim() : '';
  const text = typeof cmd.text === 'string' ? cmd.text.trim() : '';
  if (!chatId) {
    throw Object.assign(new Error('chatId is required'), { statusCode: 400 });
  }
  if (!text) {
    throw Object.assign(new Error('text is required'), { statusCode: 400 });
  }

  /** @type {string | undefined} */
  let generationId;
  const rev = await mutateEngineState((state) => {
    const chat = findChatInState(state, chatId);
    if (!chat) {
      throw Object.assign(new Error(`Chat not found: ${chatId}`), { statusCode: 404 });
    }
    chat.pendingSteerMessage = text;
    generationId =
      typeof chat.currentGenerationId === 'string'
        ? chat.currentGenerationId.trim()
        : undefined;
    chat.updatedAt = Date.now();
  });

  // Push-now: end the live generation so the loop round settles and consumePendingSteer runs.
  if (generationId) {
    try {
      const { getGenerationState, cancel } = await import('../generations/store.js');
      const gen = getGenerationState(generationId);
      if (gen) cancel(gen);
    } catch (err) {
      console.error('[session-engine] steer cancel generation failed:', err);
    }
  }

  return { rev, accepted: true };
}

/**
 * Composer follow-up queue while a turn is active.
 * @param {EnqueueMessageCommand} cmd
 */
async function handleEnqueueMessage(cmd) {
  const chatId = typeof cmd.chatId === 'string' ? cmd.chatId.trim() : '';
  const text = typeof cmd.text === 'string' ? cmd.text.trim() : '';
  if (!chatId) {
    throw Object.assign(new Error('chatId is required'), { statusCode: 400 });
  }
  if (!text) {
    throw Object.assign(new Error('text is required'), { statusCode: 400 });
  }

  const rev = await mutateEngineState((state) => {
    const chat = findChatInState(state, chatId);
    if (!chat) {
      throw Object.assign(new Error(`Chat not found: ${chatId}`), { statusCode: 404 });
    }
    if (!Array.isArray(chat.pendingMessageQueue)) {
      chat.pendingMessageQueue = [];
    }
    chat.pendingMessageQueue.push({
      id: randomUUID(),
      text,
      createdAt: Date.now(),
    });
    chat.updatedAt = Date.now();
  });

  return { rev, accepted: true, detail: 'queued' };
}

// Re-export for tests that poke command helpers without full engine boot.
export { getSessionRev };
