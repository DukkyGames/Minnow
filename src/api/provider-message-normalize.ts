/**
 * Provider-specific outbound message fixes (LM Studio Jinja, etc.).
 */

import type { ApiMessage } from '../types';

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
