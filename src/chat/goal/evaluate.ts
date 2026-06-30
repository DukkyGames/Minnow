/**
 * Per-turn goal evaluation and auto-continuation after goal-driven turns settle.
 */

import { formatGenerationErrorMessage } from '../../api/generations';
import { extractGoalEvalCompletionText } from './completion-text';
import { loadGoalEvalConfig } from '../../config/goal-eval-meta';
import {
  getActiveGoal,
  isGoalLoopActive,
  recordChatMessage,
  scheduleSaveSessions,
  touchChat,
} from '../../state/sessions';
import type { Chat } from '../../types';
import { resumeParentChatWithMessage } from '../../tools/loop';
import { isStreamDomVisible } from '../streaming-state';
import { appendBubble } from '../../ui/messages';
import { scrollChatIfPinned } from '../../ui/chat-scroll';
import { markMessageGoalAchieved } from '../../ui/goal-affordance';
import { syncGoalActiveHint } from '../../ui/goal-active-hint';
import { renderSidebar } from '../../ui/sidebar';
import { buildGoalEvalMessages } from './prompt';
import { parseGoalEvalResponse } from './parse-response';
import type { ChatCompletionBody } from '../../api/chat';
import type { ChatCompletionChunk } from '../../types';
import { createGoalEvalProviderPort } from './provider-port';

export interface GoalEvaluationResult {
  met: boolean;
  reason: string;
}

let goalEvalImpl: typeof runGoalEvalRequest = runGoalEvalRequest;

/** Replace evaluator port factory (unit tests). */
export function setGoalEvalPortFactoryForTests(
  factory: typeof createGoalEvalProviderPort | null,
): void {
  goalEvalPortFactory = factory ?? createGoalEvalProviderPort;
}

let goalEvalPortFactory: typeof createGoalEvalProviderPort = createGoalEvalProviderPort;

/** Replace evaluator request impl (unit tests). */
export function setGoalEvalImplForTests(
  impl: typeof runGoalEvalRequest | null,
): void {
  goalEvalImpl = impl ?? runGoalEvalRequest;
}

async function completeGoalEvalWithRetry(
  port: ReturnType<typeof createGoalEvalProviderPort>,
  body: ChatCompletionBody,
  signal: AbortSignal,
): Promise<ChatCompletionChunk> {
  try {
    return await port.complete(body, signal);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const transientFetch = err instanceof TypeError && message.includes('Failed to fetch');
    if (!transientFetch) {
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    return port.complete(body, signal);
  }
}

async function runGoalEvalRequest(
  chat: Chat,
  conditionText: string,
  signal: AbortSignal,
): Promise<GoalEvaluationResult> {
  const config = await loadGoalEvalConfig();
  const modelId = config.modelId.trim() || chat.modelId.trim();
  if (!modelId) {
    return { met: false, reason: 'No model configured for goal evaluation.' };
  }

  const providerId = config.providerId.trim() || chat.providerId?.trim() || undefined;
  const port = goalEvalPortFactory(providerId);
  const body = {
    model: modelId,
    messages: buildGoalEvalMessages(chat, conditionText),
    temperature: config.temperature,
    max_tokens: config.maxTokens,
  };

  try {
    const chunk = await completeGoalEvalWithRetry(port, body, signal);
    const raw = extractGoalEvalCompletionText(chunk.choices?.[0]?.message);
    return parseGoalEvalResponse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      met: false,
      reason: `Goal evaluator failed: ${formatGenerationErrorMessage(message)}`,
    };
  }
}

/** Call the configured goal-eval model once after a goal-driven turn. */
export async function evaluateGoal(chat: Chat): Promise<GoalEvaluationResult> {
  const goal = getActiveGoal(chat);
  if (!goal) {
    return { met: false, reason: 'No active goal.' };
  }

  const controller = new AbortController();
  return goalEvalImpl(chat, goal.conditionText, controller.signal);
}

/** User-visible continuation directive after a failed evaluation. */
export function buildGoalContinuationMessage(
  conditionText: string,
  evaluatorReason: string,
): string {
  return [
    'Continue working toward the active goal.',
    '',
    `Goal: ${conditionText}`,
    '',
    `Evaluator feedback: ${evaluatorReason}`,
  ].join('\n');
}

/** Persist and optionally render the achieved marker row. */
export function recordGoalAchieved(chat: Chat, reason: string): void {
  const content = `Goal achieved: ${reason}`;
  chat.history.push({ role: 'user', content, goalAchieved: true });
  recordChatMessage(chat);
  touchChat(chat);
  scheduleSaveSessions();

  if (!isStreamDomVisible(chat.id)) return;

  const historyIndex = chat.history.length - 1;
  const { wrap } = appendBubble('user', content, {
    historyIndex,
    turnKind: 'user',
    chatId: chat.id,
  });
  markMessageGoalAchieved(wrap);
  scrollChatIfPinned();
}

/**
 * After a goal-driven turn completes normally, run the evaluator and either clear
 * the loop (achieved) or resume with evaluator guidance.
 */
export async function maybeContinueGoalAfterTurn(chat: Chat): Promise<void> {
  if (!isGoalLoopActive(chat)) return;

  const goal = getActiveGoal(chat);
  if (!goal) return;

  goal.turnCount += 1;
  touchChat(chat);
  scheduleSaveSessions();

  const result = await evaluateGoal(chat);
  goal.lastReason = result.reason;

  if (result.met) {
    goal.achieved = true;
    recordGoalAchieved(chat, result.reason);
    touchChat(chat);
    scheduleSaveSessions();
    syncGoalActiveHint();
    renderSidebar();
    return;
  }

  touchChat(chat);
  scheduleSaveSessions();
  syncGoalActiveHint();

  const directive = buildGoalContinuationMessage(goal.conditionText, result.reason);
  await resumeParentChatWithMessage(chat, directive, { goalDriven: true });
}

