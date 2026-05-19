/**
 * Optional LLM expert classifier (non-streaming, strict JSON).
 */

import type { ExpertRecord, ExpertRouteResult } from './types';

const CLASSIFIER_TIMEOUT_MS = 2000;
const MAX_USER_CHARS = 2000;

export interface LlmClassifierInput {
  userText: string;
  registry: ExpertRecord[];
  /** Provider base URL for chat completions. */
  baseUrl: string;
  modelId: string;
  apiKey?: string;
}

/**
 * Call chat completions once to classify expert; returns null on failure.
 */
export async function classifyExpertWithLlm(
  input: LlmClassifierInput,
): Promise<ExpertRouteResult | null> {
  const hints = input.registry
    .filter((r) => !r.meta.id.startsWith('_'))
    .map((r) => `${r.meta.id}: ${r.meta.classifierHint ?? r.meta.description ?? r.meta.label}`)
    .join('\n');

  const userSnippet = input.userText.slice(0, MAX_USER_CHARS);
  const system = [
    'You classify the user message into exactly one expert id.',
    'Reply with JSON only: {"expertId":"<id>"}',
    'Valid ids:',
    hints,
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT_MS);

  try {
    const url = `${input.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: input.modelId,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userSnippet },
        ],
        temperature: 0,
        max_tokens: 64,
        stream: false,
      }),
    });

    if (!res.ok) return null;
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content?.trim() ?? '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as { expertId?: string };
    const expertId = typeof parsed.expertId === 'string' ? parsed.expertId.trim() : '';
    if (!expertId) return null;

    const record = input.registry.find((r) => r.meta.id === expertId);
    if (!record) return null;

    return {
      expertId,
      source: 'llm',
      confidence: 0.85,
      label: record.meta.label,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
