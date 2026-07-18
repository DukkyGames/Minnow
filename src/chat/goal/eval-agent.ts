/**
 * Agentic goal evaluator — headless tool loop that independently verifies completion.
 */

import { formatGenerationErrorMessage } from '../../api/generations';
import { loadGoalEvalConfig } from '../../config/goal-eval-meta';
import { sessionState } from '../../state/sessions';
import { resolveChatToolWorkspaceRoot } from '../../state/worktree-isolation';
import type { ApiMessage, Chat, ToolCall } from '../../types';
import { ensureToolConfigReady } from '../../tools/config';
import { executeTool } from '../../tools/client';
import { runHeadlessToolBatch } from '../../tools/headless-tool-batch';
import type { ChatCompletionBody } from '../../api/chat';
import { extractGoalEvalCompletionText } from './completion-text';
import {
  getGoalEvalToolDefinitions,
  isGoalEvalVerificationTool,
  MAX_GOAL_EVAL_TOOL_ROUNDS,
} from './eval-tools';
import { buildGoalEvalMessages } from './prompt';
import { createGoalEvalProviderPort } from './provider-port';

export interface GoalEvalAgentResult {
  raw: string;
  verificationToolCalls: number;
}

let goalEvalPortFactory: typeof createGoalEvalProviderPort = createGoalEvalProviderPort;

/** Replace evaluator port factory (unit tests). */
export function setGoalEvalPortFactoryForTests(
  factory: typeof createGoalEvalProviderPort | null,
): void {
  goalEvalPortFactory = factory ?? createGoalEvalProviderPort;
}

let goalEvalAgentImpl: typeof runGoalEvalAgentInner = runGoalEvalAgentInner;

/** Replace the full agentic evaluator (unit tests). */
export function setGoalEvalAgentImplForTests(
  impl: typeof runGoalEvalAgentInner | null,
): void {
  goalEvalAgentImpl = impl ?? runGoalEvalAgentInner;
}

async function completeGoalEvalWithRetry(
  port: ReturnType<typeof createGoalEvalProviderPort>,
  body: ChatCompletionBody,
  signal: AbortSignal,
) {
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

function countVerificationToolCalls(toolCalls: ToolCall[]): number {
  return toolCalls.filter((tc) => isGoalEvalVerificationTool(tc.function.name)).length;
}

/** Run the agentic verifier loop for one evaluation pass. */
export async function runGoalEvalAgent(
  chat: Chat,
  conditionText: string,
  signal: AbortSignal,
): Promise<GoalEvalAgentResult> {
  return goalEvalAgentImpl(chat, conditionText, signal);
}

async function runGoalEvalAgentInner(
  chat: Chat,
  conditionText: string,
  signal: AbortSignal,
): Promise<GoalEvalAgentResult> {
  const config = await loadGoalEvalConfig();
  const modelId = config.modelId.trim() || chat.modelId.trim();
  if (!modelId) {
    return {
      raw: 'NO: No model configured for goal evaluation.',
      verificationToolCalls: 0,
    };
  }

  await ensureToolConfigReady();

  const providerId = config.providerId.trim() || chat.providerId?.trim() || undefined;
  const port = goalEvalPortFactory(providerId);
  const tools = getGoalEvalToolDefinitions();
  const workspaceRoot =
    resolveChatToolWorkspaceRoot(chat, sessionState?.groups ?? undefined) ?? undefined;

  const messages: ApiMessage[] = buildGoalEvalMessages(chat, conditionText);
  let verificationToolCalls = 0;

  try {
    for (let round = 0; round < MAX_GOAL_EVAL_TOOL_ROUNDS; round += 1) {
      const body: ChatCompletionBody = {
        model: modelId,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        ...(tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
      };

      const chunk = await completeGoalEvalWithRetry(port, body, signal);
      const message = chunk.choices?.[0]?.message;
      const toolCalls: ToolCall[] =
        message && Array.isArray((message as { tool_calls?: ToolCall[] }).tool_calls)
          ? ((message as { tool_calls?: ToolCall[] }).tool_calls ?? [])
          : [];

      if (toolCalls.length > 0) {
        verificationToolCalls += countVerificationToolCalls(toolCalls);
        messages.push({
          role: 'assistant',
          content: extractGoalEvalCompletionText(message) || null,
          tool_calls: toolCalls,
        });

        const outcomes = await runHeadlessToolBatch({
          toolCalls,
          signal,
          execute: (name, args, ctx) =>
            executeTool(name, args as Record<string, unknown>, {
              chatId: chat.id,
              toolCallId: ctx.toolCallId,
              modeId: chat.modeId,
              workspaceRoot,
            }),
        });

        for (const outcome of outcomes) {
          const tc = outcome.toolCall;
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: outcome.parseError ?? outcome.result?.content ?? '',
          });
        }
        continue;
      }

      const raw = extractGoalEvalCompletionText(message);
      if (raw.trim()) {
        return { raw: raw.trim(), verificationToolCalls };
      }

      return {
        raw: 'NO: Evaluator returned an empty response.',
        verificationToolCalls,
      };
    }

    return {
      raw: 'NO: verification incomplete — ran out of evaluator tool rounds.',
      verificationToolCalls,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      raw: `NO: Goal evaluator failed: ${formatGenerationErrorMessage(message)}`,
      verificationToolCalls,
    };
  }
}
