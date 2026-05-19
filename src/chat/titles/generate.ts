/**
 * Call the LLM once (non-streaming) to produce a normalized chat title.
 */

import { buildTitleMessages } from './prompt';
import { normalizeTitle } from './sanitize';
import type { TitleGenerationOptions, TitleProviderPort } from './types';

/** Plain text from a non-streaming completion message (avoids importing chat.ts). */
function extractCompletionText(message: { content?: string } | null | undefined): string {
  if (!message?.content) return '';
  return String(message.content);
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

    const raw = extractCompletionText(chunk.choices?.[0]?.message);
    return normalizeTitle(raw);
  } catch {
    return null;
  }
}
