import { estimateTokensFromText } from '../chat/prompts/token-estimate-core';
import { getActiveChat } from '../state/sessions';
import type { Message } from '../types';

function serializeMessage(msg: Message): string {
  if (msg.role === 'user' || msg.role === 'assistant') {
    return String(msg.content ?? '');
  }
  if (msg.role === 'tool') {
    return `[tool ${msg.tool_call_id ?? ''}]\n${String(msg.content ?? '')}`;
  }
  return '';
}

/** Collect messages for a user-turn index from runs output or history fallback. */
export function reassembleTurnFromChat(
  chat: ReturnType<typeof getActiveChat>,
  turnIndex: number,
): { text: string; tokenEstimate: number; source: 'runs' | 'history' } | null {
  const history = chat.history ?? [];
  let userTurn = -1;
  let start = -1;
  for (let i = 0; i < history.length; i += 1) {
    if (history[i].role !== 'user') continue;
    userTurn += 1;
    if (userTurn === turnIndex) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;

  let end = start + 1;
  while (end < history.length && history[end].role !== 'user') {
    end += 1;
  }

  const runs = chat.runs ?? [];
  for (const run of runs) {
    const out = run.outputMessages;
    if (!out?.length) continue;
    const runText = out.map(serializeMessage).join('\n\n').trim();
    if (!runText) continue;
    if (run.forkHistoryIndex === start) {
      const text = out.map(serializeMessage).join('\n\n');
      return {
        text,
        tokenEstimate: estimateTokensFromText(text),
        source: 'runs',
      };
    }
  }

  const slice = history.slice(start, end);
  const text = slice.map(serializeMessage).join('\n\n');
  return {
    text,
    tokenEstimate: estimateTokensFromText(text),
    source: 'history',
  };
}

/** Browser tool handler: recall_turn_full */
export function toolRecallTurnFull(args: Record<string, unknown>): string {
  const raw = args.turnIndex;
  const turnIndex =
    typeof raw === 'number' ? Math.floor(raw) : Math.floor(Number(raw));
  if (!Number.isFinite(turnIndex) || turnIndex < 0) {
    return 'Error: "turnIndex" must be a non-negative integer';
  }

  const chat = getActiveChat();
  const result = reassembleTurnFromChat(chat, turnIndex);
  if (!result) {
    return `Error: no turn found at index ${turnIndex}`;
  }

  return [
    `Turn ${turnIndex} (source: ${result.source}, ~${result.tokenEstimate} tokens):`,
    '',
    result.text,
  ].join('\n');
}
