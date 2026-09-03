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

type SummarizeCompleteFn = typeof completeNonStreamingViaGenerations;
type SummarizeProviderFn = typeof getActiveProvider;

/** Test-only overrides so timeout abort coverage does not wait 45s or hit the network. */
let summarizeTimeoutMsForTests: number | null = null;
let summarizeCompleteForTests: SummarizeCompleteFn | null = null;
let summarizeProviderForTests: SummarizeProviderFn | null = null;

export function setSummarizeTimeoutMsForTests(ms: number | null): void {
  summarizeTimeoutMsForTests = ms;
}

export function setSummarizeCompleteForTests(fn: SummarizeCompleteFn | null): void {
  summarizeCompleteForTests = fn;
}

export function setSummarizeProviderForTests(fn: SummarizeProviderFn | null): void {
  summarizeProviderForTests = fn;
}

function summarizeTimeoutMs(): number {
  return summarizeTimeoutMsForTests ?? SUMMARIZE_TIMEOUT_MS;
}

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

type CompletionMessageLike = {
  content?: unknown;
  reasoning?: string;
  reasoning_content?: string;
  thinking?: string;
};

function asCompletionMessage(message: unknown): CompletionMessageLike | null | undefined {
  if (message === null || message === undefined) return message;
  if (typeof message !== 'object') return undefined;
  return message as CompletionMessageLike;
}

function extractCompletionText(message: unknown): string {
  const msg = asCompletionMessage(message);
  const content = extractMessageText(msg).trim();
  if (!content) return '';
  const reasoning = extractReasoningMessage(msg).trim();
  if (reasoning && content === reasoning) return '';
  return content;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
  onTimeout?: () => void,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
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
    const provider = await (summarizeProviderForTests ?? getActiveProvider)(providerId);
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

    // Abort the in-flight generation on timeout so a hung utility call cannot
    // pin llama.cpp's single slot while the main turn continues.
    const timeoutCtrl = new AbortController();
    const onParentAbort = (): void => {
      timeoutCtrl.abort(params.signal?.reason);
    };
    if (params.signal?.aborted) {
      timeoutCtrl.abort(params.signal.reason);
    } else {
      params.signal?.addEventListener('abort', onParentAbort, { once: true });
    }

    try {
      const chunk = await withTimeout(
        (summarizeCompleteForTests ?? completeNonStreamingViaGenerations)(
          provider,
          body,
          timeoutCtrl.signal,
          {
            fallbackRole: 'context-summarize',
          },
        ),
        summarizeTimeoutMs(),
        timeoutCtrl.signal,
        () => timeoutCtrl.abort(),
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
    } finally {
      params.signal?.removeEventListener('abort', onParentAbort);
    }
  } catch {
    return { summaryBody: fallback, usedLlm: false };
  }
}

/** Wrap summary body with the standard outbound prefix. */
export function formatSummaryForApi(summaryBody: string): string {
  return SUMMARY_HEADER + summaryBody.trim();
}
