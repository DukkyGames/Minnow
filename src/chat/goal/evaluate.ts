/**
 * Per-turn goal evaluation and auto-continuation after goal-driven turns settle.
 */

import { extractMessageText } from '../../api/chat';
import { loadGoalEvalConfig } from '../../config/goal-eval-meta';
import { getActiveProvider } from '../../providers/store';
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
import { createGoalEvalProviderPort, type GoalEvalProviderPort } from './provider-port';

export interface GoalEvaluationResult {
  met: boolean;
  reason: string;
}

let goalEvalPort = createGoalEvalProviderPort();
let goalEvalImpl: typeof runGoalEvalRequest = runGoalEvalRequest;

/** Replace evaluator port (unit tests). */
export function setGoalEvalPortForTests(port: GoalEvalProviderPort | null): void {
  goalEvalPort = port ?? createGoalEvalProviderPort();
}

/** Replace evaluator request impl (unit tests). */
export function setGoalEvalImplForTests(
  impl: typeof runGoalEvalRequest | null,
): void {
  goalEvalImpl = impl ?? runGoalEvalRequest;
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
  const provider = await getActiveProvider(providerId);
  const port = goalEvalPort;

  try {
    const chunk = await port.complete(
      {
        model: modelId,
        messages: buildGoalEvalMessages(chat, conditionText),
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      },
      signal,
    );
    const raw = extractMessageText(chunk.choices?.[0]?.message).trim();
    return parseGoalEvalResponse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { met: false, reason: `Goal evaluator failed: ${message}` };
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

