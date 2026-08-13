/**
 * Provider-specific outbound message fixes (LM Studio Jinja, etc.).
 */

import type { ApiAssistantMessage, ApiMessage, ApiToolMessage } from '../types';

/**
 * Stand-in result for a `tool_call` the harness never recorded an answer for
 * (aborted batch, crashed executor, context trim that severed the pair).
 */
export const MISSING_TOOL_RESULT_CONTENT =
  'Tool call did not complete; no result was recorded.';

function assistantToolCalls(message: ApiMessage): ApiAssistantMessage['tool_calls'] {
  if (message.role !== 'assistant') return undefined;
  const calls = (message as ApiAssistantMessage).tool_calls;
  return calls?.length ? calls : undefined;
}

/**
 * Guarantee every assistant `tool_calls` id has exactly one matching `tool` row.
 *
 * Every OpenAI-compatible provider 400s a history where an assistant announced a
 * tool call with no result, or where a `tool` row answers an id nobody requested.
 * Once such a row is persisted the chat is unsendable forever, so repair on the
 * way out rather than trusting the loop to never orphan a call.
 */
export function repairUnpairedToolCalls(messages: ApiMessage[]): ApiMessage[] {
  const out: ApiMessage[] = [];
  const requestedIds = new Set<string>();

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];

    if (message.role === 'tool') {
      // A result for a call the model never made is just as fatal as a missing one.
      if (requestedIds.has((message as ApiToolMessage).tool_call_id)) {
        out.push(message);
      }
      continue;
    }

    const toolCalls = assistantToolCalls(message);
    if (!toolCalls) {
      out.push(message);
      continue;
    }

    out.push(message);
    for (const call of toolCalls) {
      requestedIds.add(call.id);
    }

    // Consume the contiguous result block so synthesized rows land inside it.
    const answered = new Set<string>();
    let j = i + 1;
    while (j < messages.length && messages[j].role === 'tool') {
      const row = messages[j] as ApiToolMessage;
      if (requestedIds.has(row.tool_call_id)) {
        out.push(row);
        answered.add(row.tool_call_id);
      }
      j += 1;
    }
    for (const call of toolCalls) {
      if (!answered.has(call.id)) {
        out.push({
          role: 'tool',
          tool_call_id: call.id,
          content: MISSING_TOOL_RESULT_CONTENT,
        });
      }
    }
    i = j - 1;
  }

  return out;
}

function plainTextContent(message: ApiMessage): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part.type === 'text')
    .map((part) => ('text' in part ? part.text : ''))
    .join('');
}

function systemContent(message: ApiMessage): string {
  if (message.role !== 'system') return '';
  return plainTextContent(message);
}

function assistantPlainText(message: ApiMessage): string {
  if (message.role !== 'assistant') return '';
  return plainTextContent(message);
}

/**
 * LM Studio / Qwen Jinja templates reject histories that start with assistant
 * prose before the first user turn ("No user query found in messages").
 * Fold that preamble into the system block; UI history is unchanged.
 */
export function foldLeadingAssistantPreamble(messages: ApiMessage[]): ApiMessage[] {
  if (messages.length < 2) return messages;

  let index = 0;
  const systemChunks: string[] = [];
  while (index < messages.length && messages[index].role === 'system') {
    const chunk = systemContent(messages[index]).trim();
    if (chunk) systemChunks.push(chunk);
    index += 1;
  }

  const preamble: string[] = [];
  while (index < messages.length && messages[index].role === 'assistant') {
    const text = assistantPlainText(messages[index]).trim();
    if (text) preamble.push(text);
    index += 1;
  }

  if (preamble.length === 0) return messages;

  const foldedSystem = [
    ...systemChunks,
    [
      '[The specialist already greeted the user in the UI. Continue naturally; do not repeat the greeting verbatim unless helpful.]',
      ...preamble,
    ].join('\n\n'),
  ]
    .filter(Boolean)
    .join('\n\n');

  const out: ApiMessage[] = [];
  if (foldedSystem.trim()) {
    out.push({ role: 'system', content: foldedSystem });
  }
  out.push(...messages.slice(index));
  return out;
}
