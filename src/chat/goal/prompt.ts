/**
 * Evaluator prompt for the /goal judge (reads transcript only — no tools).
 */

import type { ApiMessage } from '../../types';
import type { Chat } from '../../types';

const MAX_TRANSCRIPT_CHARS = 12000;

/** Flatten recent chat history into a readable transcript block. */
export function buildGoalTranscriptExcerpt(chat: Chat): string {
  const lines: string[] = [];

  for (const message of chat.history) {
    if (message.role === 'user') {
      lines.push(`User: ${message.content}`);
      continue;
    }
    if (message.role === 'assistant') {
      const content =
        typeof message.content === 'string' ? message.content : String(message.content ?? '');
      if (content.trim()) lines.push(`Assistant: ${content}`);
      continue;
    }
    if (message.role === 'tool') {
      const preview = message.content.slice(0, 400).replace(/\s+/g, ' ').trim();
      lines.push(`Tool (${message.tool_call_id}): ${preview}`);
    }
  }

  const joined = lines.join('\n\n');
  if (joined.length <= MAX_TRANSCRIPT_CHARS) return joined;
  return joined.slice(joined.length - MAX_TRANSCRIPT_CHARS);
}

/** Build system + user messages for the goal evaluator completion. */
export function buildGoalEvalMessages(chat: Chat, conditionText: string): ApiMessage[] {
  const transcript = buildGoalTranscriptExcerpt(chat);
  return [
    {
      role: 'system',
      content: [
        'You are a goal-completion judge for an autonomous coding assistant.',
        'Read the completion condition and the transcript.',
        'Reply with exactly one line starting with YES or NO, then a short reason.',
        'YES means the condition is fully satisfied based on evidence in the transcript.',
        'NO means more work is required — explain what is still missing.',
        'Do not suggest tools or actions; only judge completion.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Completion condition:\n${conditionText}`,
        '',
        'Transcript:',
        transcript || '(empty)',
        '',
        'Has the condition been met? Reply YES or NO plus a brief reason.',
      ].join('\n'),
    },
  ];
}
