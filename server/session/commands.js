/**
 * Typed session command handlers for the Session Engine (Phase 1 + Phase 2 board).
 * Long-running send_message / board task work continues after the 202 response.
 */

import { randomUUID } from 'node:crypto';
import {
  abortEngineTurn,
  endEngineTurn,
  isEngineTurnActive,
  mutateEngineState,
  publishLiveEngineState,
  tryBeginEngineTurn,
} from './engine-api.js';
import { getSessionRev } from './rev-store.js';
import { runEngineMainChatTurn } from './loop-loader.js';
import { applyBoardCommand } from './board-loader.js';
import { applyControllerCommand } from './controller-loader.js';

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
 *   pushUser?: boolean,
 *   attachments?: unknown[],
 * }} SendMessageCommand
 *
 * @typedef {{ type: 'stop_generation', chatId: string }} StopGenerationCommand
 *
 * @typedef {{ type: 'steer_message', chatId: string, text: string }} SteerMessageCommand
 *
 * @typedef {{ type: 'enqueue_message', chatId: string, text: string }} EnqueueMessageCommand
 *
 * @typedef {{
 *   type: 'answer_question',
 *   chatId: string,
 *   toolCallId?: string,
 *   result: unknown,
 * }} AnswerQuestionCommand
 *
 * @typedef {{ type: string, [key: string]: unknown }} BoardishCommand
 *
 * @typedef {SendMessageCommand | StopGenerationCommand | SteerMessageCommand | EnqueueMessageCommand | AnswerQuestionCommand | BoardishCommand} SessionCommand
 */

const BOARD_COMMAND_TYPES = new Set([
  'board_init',
  'board_start',
  'board_stop',
  'board_start_task',
  'board_requeue_task',
  'board_set_autonomy',
  'board_run_final_test',
  'board_recover_task',
  'set_model',
]);

const CONTROLLER_COMMAND_TYPES = new Set([
  'spawn_sub_agent',
  'cancel_sub_agent',
]);

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

  if (BOARD_COMMAND_TYPES.has(cmd.type)) {
    const result = await applyBoardCommand(/** @type {any} */ (cmd));
    // Board mutates sessionState in place — publish so SSE clients see the change.
    const rev = await publishLiveEngineState({ soft: false });
    return { rev, accepted: result.accepted !== false, detail: result.detail };
  }

  if (CONTROLLER_COMMAND_TYPES.has(cmd.type)) {
    const result = await applyControllerCommand(/** @type {any} */ (cmd));
    // Live slice publish is coalesced from emitSubAgentRunUpdated; bump rev now too.
    const rev = await publishLiveEngineState({ soft: true });
    return { rev, accepted: result.accepted !== false, detail: result.detail };
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
    case 'answer_question':
      return handleAnswerQuestion(cmd);
    default:
      throw Object.assign(new Error(`Unknown command type: ${cmd.type}`), {
        statusCode: 400,
      });
  }
}

/**
 * Normalize attachment payloads from send_message (shared with unit tests).
 * @param {unknown} raw
 * @returns {unknown[]}
 */
export function normalizeCommandAttachments(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const kind = /** @type {{ kind?: unknown, name?: unknown }} */ (item).kind;
    const name = /** @type {{ kind?: unknown, name?: unknown }} */ (item).name;
    if (typeof kind !== 'string' || typeof name !== 'string') continue;
    if (kind === 'error') continue;
    out.push(item);
    if (out.length >= 32) break;
  }
  return out;
}

/**
 * @param {SendMessageCommand} cmd
 */
async function handleSendMessage(cmd) {
  const chatId = typeof cmd.chatId === 'string' ? cmd.chatId.trim() : '';
  const text = typeof cmd.text === 'string' ? cmd.text : '';
  const attachments = normalizeCommandAttachments(cmd.attachments);
  if (!chatId) {
    throw Object.assign(new Error('chatId is required'), { statusCode: 400 });
  }
  if (!text.trim() && !cmd.historyContent?.trim() && attachments.length === 0) {
    throw Object.assign(new Error('text is required'), { statusCode: 400 });
  }

  if (isEngineTurnActive(chatId)) {
    // Follow-up while streaming → queue (parity with composer enqueue).
    // Attachments are not accepted on follow-ups (composer already blocks them).
    return handleEnqueueMessage({ type: 'enqueue_message', chatId, text });
  }

  // Claim before any await so concurrent send_message cannot double-start.
  const controller = tryBeginEngineTurn(chatId);
  if (!controller) {
    return handleEnqueueMessage({ type: 'enqueue_message', chatId, text });
  }

  // Prefer client-built historyContent; otherwise rebuild with the same helpers as loop.ts.
  let historyContent =
    typeof cmd.historyContent === 'string' && cmd.historyContent.trim()
      ? cmd.historyContent
      : '';
  if (!historyContent && attachments.length > 0) {
    try {
      const { buildEngineHistoryUserContent } = await import(
        '../../src/session-engine/build-api-messages.ts'
      );
      historyContent = buildEngineHistoryUserContent(text, /** @type {any} */ (attachments));
    } catch (err) {
      console.error('[session-engine] attachment history build failed:', err);
      historyContent = text.trim();
    }
  }
  if (!historyContent) historyContent = text.trim();
  // Fork/replay keeps the existing user row — do not append a duplicate.
  const pushUser = cmd.pushUser !== false;
  const pendingUserText =
    typeof cmd.displayText === 'string' ? cmd.displayText : text;

  let rev;
  try {
    rev = await mutateEngineState((state) => {
      const chat = findChatInState(state, chatId);
      if (!chat) {
        throw Object.assign(new Error(`Chat not found: ${chatId}`), { statusCode: 404 });
      }
      if (!Array.isArray(chat.history)) chat.history = [];
      if (pushUser) {
        chat.history.push({ role: 'user', content: historyContent });
      }
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
  } catch (err) {
    endEngineTurn(chatId, controller);
    throw err;
  }

  // Fire-and-forget tool loop — HTTP already returned 202 + rev.
  // Attachments stay in-memory for this turn (not published on Chat — avoid huge SSE blobs).
  void runEngineMainChatTurn({
    chatId,
    signal: controller.signal,
    modelId: cmd.modelId,
    providerId: cmd.providerId,
    temperature: cmd.temperature,
    maxTokens: cmd.maxTokens,
    systemPrompt: cmd.systemPrompt,
    goalDriven: cmd.goalDriven === true,
    turnAttachments: attachments,
    pendingUserText,
  })
    .catch((err) => {
      console.error('[session-engine] send_message failed:', err);
      return mutateEngineState((state) => {
        const chat = findChatInState(state, chatId);
        if (!chat) return;
        chat.engineTurnActive = false;
        chat.currentGenerationId = undefined;
        chat.pendingAskQuestion = undefined;
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
      // End the turn *before* draining the queue — otherwise send_message sees
      // isEngineTurnActive and re-enqueues the message it just shifted.
      const aborted = controller.signal.aborted;
      endEngineTurn(chatId, controller);
      if (!aborted) {
        void drainQueuedMessage(chatId);
      }
    });

  return { rev, accepted: true };
}

/**
 * After a turn settles, dequeue one follow-up and start the next turn.
 * Skips when a steer is pending (renderer precedence) or the queue is empty.
 * Recursion is intentional: each drained turn's teardown drains the next item.
 * @param {string} chatId
 */
async function drainQueuedMessage(chatId) {
  if (isEngineTurnActive(chatId)) return;

  /** @type {string | null} */
  let text = null;
  let skipForSteer = false;
  await mutateEngineState((state) => {
    const chat = findChatInState(state, chatId);
    if (!chat) return;
    if (typeof chat.pendingSteerMessage === 'string' && chat.pendingSteerMessage.trim()) {
      skipForSteer = true;
      return;
    }
    const queue = Array.isArray(chat.pendingMessageQueue) ? chat.pendingMessageQueue : [];
    if (queue.length === 0) return;
    const item = queue.shift();
    chat.pendingMessageQueue = queue.length > 0 ? queue : undefined;
    const next = typeof item?.text === 'string' ? item.text.trim() : '';
    if (!next) return;
    text = next;
    chat.updatedAt = Date.now();
  });

  if (skipForSteer || !text) return;

  // Fire-and-forget — mirrors renderer void flushPendingMessageQueue.
  void handleSendMessage({ type: 'send_message', chatId, text }).catch((err) => {
    console.error('[session-engine] drainQueuedMessage failed:', err);
  });
}

/**
 * @param {StopGenerationCommand} cmd
 */
async function handleStopGeneration(cmd) {
  const chatId = typeof cmd.chatId === 'string' ? cmd.chatId.trim() : '';
  if (!chatId) {
    throw Object.assign(new Error('chatId is required'), { statusCode: 400 });
  }

  // Cancel parked ask_question before abort so the tool batch settles cleanly.
  try {
    const { cancelParkedAskQuestion } = await import(
      '../../src/session-engine/ask-question-bridge.ts'
    );
    cancelParkedAskQuestion(chatId);
  } catch {
    /* bridge module unavailable in some test harnesses */
  }

  abortEngineTurn(chatId);

  const rev = await mutateEngineState((state) => {
    const chat = findChatInState(state, chatId);
    if (!chat) return;
    chat.engineTurnActive = false;
    chat.currentGenerationId = undefined;
    chat.pendingAskQuestion = undefined;
    if (chat.pendingSteerMessage) chat.pendingSteerMessage = undefined;
    chat.updatedAt = Date.now();
  });

  return { rev, accepted: true };
}

/**
 * Resume a parked engine ask_question with the user's answers.
 * @param {AnswerQuestionCommand} cmd
 */
async function handleAnswerQuestion(cmd) {
  const chatId = typeof cmd.chatId === 'string' ? cmd.chatId.trim() : '';
  if (!chatId) {
    throw Object.assign(new Error('chatId is required'), { statusCode: 400 });
  }
  const rawResult = cmd.result;
  if (!rawResult || typeof rawResult !== 'object') {
    throw Object.assign(new Error('result is required'), { statusCode: 400 });
  }
  const status = /** @type {{ status?: unknown }} */ (rawResult).status;
  if (status !== 'answered' && status !== 'cancelled' && status !== 'error') {
    throw Object.assign(new Error('result.status must be answered|cancelled|error'), {
      statusCode: 400,
    });
  }

  const toolCallId =
    typeof cmd.toolCallId === 'string' && cmd.toolCallId.trim()
      ? cmd.toolCallId.trim()
      : undefined;

  const { resolveParkedAskQuestion } = await import(
    '../../src/session-engine/ask-question-bridge.ts'
  );
  const accepted = resolveParkedAskQuestion(
    chatId,
    /** @type {any} */ (rawResult),
    toolCallId,
  );
  if (!accepted) {
    return {
      rev: getSessionRev(),
      accepted: false,
      detail: 'no_pending_question',
    };
  }

  // Clear the SSE hint immediately (loop also clears in finally).
  const rev = await mutateEngineState((state) => {
    const chat = findChatInState(state, chatId);
    if (!chat) return;
    if (
      !toolCallId ||
      chat.pendingAskQuestion?.toolCallId === toolCallId ||
      !chat.pendingAskQuestion
    ) {
      chat.pendingAskQuestion = undefined;
    }
    chat.updatedAt = Date.now();
  }, { soft: true });

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
