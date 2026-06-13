/**
 * Build recent chat messages for synthesis extraction.
 */

import type { Chat, Message } from '../types';

/** Max user/assistant pairs to include in synthesis context. */
const MAX_MESSAGES = 12;

function messageText(content: Message['content']): string {
  if (typeof content === 'string') return content.trim();
  return '';
}

/**
 * Collect recent user/assistant messages as plain text for the synthesis API.
 */
export function buildSynthesisMessages(chat: Chat): Array<{ role: string; content: string }> {
  const rows: Array<{ role: string; content: string }> = [];
  for (const msg of chat.history) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    const text = messageText(msg.content);
    if (!text) continue;
    rows.push({ role: msg.role, content: text });
  }
  return rows.slice(-MAX_MESSAGES);
}

/**
 * Short private excerpt for proposal review UI (user-private data).
 */
export function buildSynthesisExcerpt(chat: Chat, userText?: string): string {
  const parts: string[] = [];
  if (userText?.trim()) {
    parts.push(`User: ${userText.trim().slice(0, 400)}`);
  }
  const lastAssistant = [...chat.history]
    .reverse()
    .find((m) => m.role === 'assistant' && messageText(m.content));
  if (lastAssistant) {
    parts.push(`Assistant: ${messageText(lastAssistant.content).slice(0, 400)}`);
  }
  return parts.join('\n').slice(0, 2000);
}
