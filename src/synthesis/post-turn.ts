/**
 * Build recent chat messages for synthesis extraction.
 */

import type { AssistantMessage, Chat, Message } from '../types';

/** Max user/assistant pairs to include in synthesis context. */
const MAX_MESSAGES = 12;

function messageText(content: Message['content']): string {
  if (typeof content === 'string') return content.trim();
  return '';
}

/** Remove reasoning/thinking blocks from assistant prose for excerpts and extraction. */
export function stripThinkingForExcerpt(text: string): string {
  let value = String(text ?? '');
  const patterns = [
    /<think>[\s\S]*?<\/redacted_thinking>\s*/gi,
    /<think(?:ing)?(?:\s+[^>]*)?>[\s\S]*?<\/think(?:ing)?>\s*/gi,
    /<think>[\s\S]*$/i,
    /<think(?:ing)?(?:\s+[^>]*)?>[\s\S]*$/i,
  ];
  let prev = '';
  while (prev !== value) {
    prev = value;
    for (const re of patterns) {
      value = value.replace(re, '');
    }
  }
  return value.trim();
}

/** User-visible assistant prose — never fall back to thinking-only content. */
function assistantVisibleText(msg: AssistantMessage): string {
  return stripThinkingForExcerpt(messageText(msg.content));
}

/**
 * Collect recent user/assistant messages as plain text for the synthesis API.
 */
export function buildSynthesisMessages(chat: Chat): Array<{ role: string; content: string }> {
  const rows: Array<{ role: string; content: string }> = [];
  for (const msg of chat.history) {
    if (msg.role === 'user') {
      const text = messageText(msg.content);
      if (text) rows.push({ role: 'user', content: text });
      continue;
    }
    if (msg.role === 'assistant') {
      const text = assistantVisibleText(msg);
      if (text) rows.push({ role: 'assistant', content: text });
    }
  }
  return rows.slice(-MAX_MESSAGES);
}

/**
 * Short private excerpt for the proposal review UI (latest user/assistant pair).
 * Uses chat history — not the send-time `userText` param (which can be stale after steer/tool turns).
 */
export function buildSynthesisExcerpt(chat: Chat): string {
  let lastUserIdx = -1;
  for (let i = chat.history.length - 1; i >= 0; i -= 1) {
    const msg = chat.history[i];
    if (msg?.role === 'user' && messageText(msg.content)) {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return '';

  const userLine = messageText(chat.history[lastUserIdx]!.content);

  let assistantLine = '';
  for (let i = chat.history.length - 1; i > lastUserIdx; i -= 1) {
    const msg = chat.history[i];
    if (msg?.role !== 'assistant') continue;
    const visible = assistantVisibleText(msg);
    if (visible) {
      assistantLine = visible;
      break;
    }
  }

  const parts = [`User: ${userLine.slice(0, 400)}`];
  if (assistantLine) {
    parts.push(`Assistant: ${assistantLine.slice(0, 400)}`);
  }
  return parts.join('\n').slice(0, 2000);
}
