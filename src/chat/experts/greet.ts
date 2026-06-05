/**
 * Seed the first assistant turn when opening a new expert chat.
 */

import { extractMessageText } from '../../api/chat';
import { createTitleProviderPort } from '../titles/provider-port';
import { getExpert } from './registry';
import type { Chat } from '../../types';

function fallbackGreeting(label: string, description?: string): string {
  const desc = description?.trim();
  if (desc) {
    return `Hi — I'm **${label}**. ${desc}\n\nWhat would you like to work on?`;
  }
  return `Hi — I'm **${label}**. What would you like to work on?`;
}

/**
 * Produce a short opening message for a new expert chat (LLM when possible, template fallback).
 */
export async function generateExpertGreeting(
  expertId: string,
  chat: Chat,
  signal?: AbortSignal,
): Promise<string> {
  const expert = getExpert(expertId);
  if (!expert) {
    return 'Hello! How can I help you today?';
  }

  const label = expert.meta.label;
  const description = expert.meta.description;
  const modelId = chat.modelId?.trim();
  if (!modelId) {
    return fallbackGreeting(label, description);
  }

  const providerId = chat.providerId?.trim() || undefined;
  const system = [
    'You are opening a dedicated chat as a specialist persona.',
    'Write a warm, concise greeting (2–4 sentences). No tools, no questions list.',
    'Use markdown sparingly (bold name once). Do not mention being an AI.',
    expert.fullBody?.trim() ? `\nPersona:\n${expert.fullBody.trim().slice(0, 4000)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const port = createTitleProviderPort(providerId);
    const chunk = await port.complete(
      {
        model: modelId,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: `Introduce yourself as ${label} and invite the user to share what they need.`,
          },
        ],
        temperature: 0.6,
        max_tokens: 280,
      },
      signal ?? new AbortController().signal,
    );
    const text = extractMessageText(chunk.choices?.[0]?.message).trim();
    if (text) return text;
  } catch {
    /* template fallback */
  }

  return fallbackGreeting(label, description);
}
