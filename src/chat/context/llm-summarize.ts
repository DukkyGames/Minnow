/**
 * LLM-based summarization of dropped chat turns for context enforcement.
 */

import { extractMessageText } from '../../api/chat';
import { extractReasoningMessage } from '../../api/reasoning';
import type { ChatCompletionBody } from '../../api/chat';
import { completeNonStreamingViaGenerations } from '../../providers/fetch-chat';
import { getActiveProvider } from '../../providers/store';
import {
  buildExtractiveSummary,
  SUMMARY_HEADER,
} from '../context-budget';

const SUMMARIZE_SYSTEM_PROMPT = `You compress prior chat turns into a concise summary for model context.
Preserve: decisions made, file paths touched, open tasks, tool outcomes, and user goals.
Do not invent facts. Use short bullet points when helpful.
Output plain text only — no preamble.`;

const SUMMARIZE_TIMEOUT_MS = 45_000;

export interface LlmSummarizeParams {
  droppedText: string;
  providerId: string;
  modelId: string;
  summaryReserveTokens: number;
  signal?: AbortSignal;
}

export interface LlmSummarizeResult {
  summaryBody: string;
  usedLlm: boolean;
}

function extractCompletionText(message: unknown): string {
  const content = extractMessageText(message).trim();
  if (!content) return '';
  const reasoning = extractReasoningMessage(message).trim();
  if (reasoning && content === reasoning) return '';
  return content;
}

function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Context summarization timed out'));
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/**
 * Summarize dropped turn text via the active chat model; falls back to extractive head/tail.
 */
export async function summarizeDroppedTurns(
  params: LlmSummarizeParams,
): Promise<LlmSummarizeResult> {
  const source = params.droppedText.trim();
  if (!source) {
    return { summaryBody: '', usedLlm: false };
  }

  const budgetTokens = Math.max(64, Math.floor(params.summaryReserveTokens));
  const fallback = buildExtractiveSummary(source, budgetTokens);

  const modelId = params.modelId?.trim();
  const providerId = params.providerId?.trim();
  if (!modelId || !providerId) {
    return { summaryBody: fallback, usedLlm: false };
  }

  try {
    const provider = await getActiveProvider(providerId);
    const body = {
      model: modelId,
      stream: false,
      temperature: 0.2,
      max_tokens: Math.min(2048, budgetTokens * 2),
      messages: [
        { role: 'system', content: SUMMARIZE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Summarize the following prior conversation turns:\n\n${source}`,
        },
      ],
    } as ChatCompletionBody & { stream: false };

    const chunk = await withTimeout(
      completeNonStreamingViaGenerations(provider, body, params.signal ?? new AbortController().signal, {
        fallbackRole: 'context-summarize',
      }),
      SUMMARIZE_TIMEOUT_MS,
      params.signal,
    );

    const raw = extractCompletionText(chunk.choices?.[0]?.message);
    const trimmed = raw.trim();
    if (!trimmed) {
      return { summaryBody: fallback, usedLlm: false };
    }

    const maxChars = Math.max(128, budgetTokens * 4);
    const bodyText =
      trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}\n…` : trimmed;
    return { summaryBody: bodyText, usedLlm: true };
  } catch {
    return { summaryBody: fallback, usedLlm: false };
  }
}

/** Wrap summary body with the standard outbound prefix. */
export function formatSummaryForApi(summaryBody: string): string {
  return SUMMARY_HEADER + summaryBody.trim();
}
