/**
 * Call the LLM once (non-streaming) to produce a normalized chat title.
 */

import { extractMessageText } from '../../api/chat';
import { extractReasoningMessage } from '../../api/reasoning';
import { buildTitleMessages } from './prompt';
import { normalizeTitle } from './sanitize';
import type { TitleGenerationOptions, TitleProviderPort } from './types';

/** Visible or reasoning text from a non-streaming completion message. */
function extractTitleCompletionText(
  message: { content?: string; reasoning?: string; reasoning_content?: string } | null | undefined,
): string {
  const content = extractMessageText(message).trim();
  if (content) return content;
  return extractReasoningMessage(message).trim();
}

/**
 * Request a title from the provider port; returns null on failure or empty output.
 */
export async function generateChatTitle(
  seed: string,
  options: TitleGenerationOptions,
  port: TitleProviderPort,
): Promise<string | null> {
  const messages = buildTitleMessages(seed);

  try {
    const chunk = await port.complete(
      {
        model: options.modelId,
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      },
      options.signal,
    );

    const raw = extractTitleCompletionText(chunk.choices?.[0]?.message);
    return normalizeTitle(raw);
  } catch {
    return null;
  }
}
