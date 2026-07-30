/**
 * Manual `/compress` — persistently rewrite history with an LLM summary.
 */

import {
  agentContextBudgetFromWorkAgent,
  DEFAULT_CONTEXT_ENFORCEMENT_POLICY,
  partitionTurns,
  SUMMARY_HEADER,
} from '../context-budget';
import { resolveActiveWorkAgent } from '../../agents/resolve-work-agent';
import { resolveWorkAgentContextPolicy } from '../resolve-context-policy';
import { getActiveProvider } from '../../providers/store';
import { renderChatFromHistory } from '../../ui/messages';
import { setStatus } from '../../ui/status';
import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../../state/sessions';
import { isChatStreaming } from '../streaming-state';
import { historyToApiMessagesForEstimate } from '../prompts/token-estimate-core';
import type { Chat, Message } from '../../types';
import { appendContextNoticeIfNeeded } from './context-notice';
import { summarizeDroppedTurns } from './llm-summarize';
import { parseCompressSlashInput } from './parse-compress-command';

export type CompressCommandDispatch = 'handled' | null;

function transcriptHistory(history: Message[]): Message[] {
  return history.filter((m) => m.role !== 'context');
}

function rebuildHistoryAfterCompress(
  chat: Chat,
  minRecentTurns: number,
  summaryBody: string,
  droppedTurns: number,
): void {
  const transcript = transcriptHistory(chat.history);
  const apiMessages = historyToApiMessagesForEstimate(transcript);
  const turns = partitionTurns(apiMessages, 0);
  const keepTurns = turns.slice(-minRecentTurns);

  const kept: Message[] = [];
  for (const turn of keepTurns) {
    for (let i = turn.start; i < turn.end; i += 1) {
      kept.push(transcript[i]);
    }
  }

  chat.history = [
    { role: 'user', content: `${SUMMARY_HEADER}${summaryBody.trim()}` },
    ...kept,
  ];
  appendContextNoticeIfNeeded(chat, {
    policy: 'summarize',
    droppedTurns,
    summaryText: summaryBody,
  });
  touchChat(chat);
}

/**
 * Handle `/compress` (alias `/summarize`) before normal send.
 */
export async function handleCompressCommand(
  chat: Chat,
  rawText: string,
  providerId: string,
  modelId: string,
  signal?: AbortSignal,
): Promise<CompressCommandDispatch> {
  if (!parseCompressSlashInput(rawText)) return null;

  if (isChatStreaming(chat.id)) {
    setStatus('err', 'Wait for the current reply to finish');
    return 'handled';
  }

  const activeWorkAgent = resolveActiveWorkAgent(chat);
  const agentConfig = activeWorkAgent
    ? agentContextBudgetFromWorkAgent(
        activeWorkAgent,
        resolveWorkAgentContextPolicy(activeWorkAgent.id),
      )
    : { enforcementPolicy: DEFAULT_CONTEXT_ENFORCEMENT_POLICY };

  const minRecentTurns = Math.max(1, Math.floor(agentConfig.minRecentTurns ?? 2));
  const summaryReserveTokens = Math.max(
    64,
    Math.floor(agentConfig.summaryReserveTokens ?? 512),
  );

  const apiMessages = historyToApiMessagesForEstimate(
    chat.history.filter((m) => m.role !== 'context'),
  );
  const turns = partitionTurns(apiMessages, 0);
  if (turns.length <= minRecentTurns) {
    setStatus('err', `Need more than ${minRecentTurns} turns to compress`);
    return 'handled';
  }

  const droppedTurns = turns.length - minRecentTurns;
  const droppedChunks: string[] = [];
  for (let i = 0; i < droppedTurns; i += 1) {
    const parts: string[] = [];
    for (let j = turns[i].start; j < turns[i].end; j += 1) {
      const row = apiMessages[j];
      if (row.role === 'user' || row.role === 'assistant' || row.role === 'tool') {
        const text =
          typeof row.content === 'string'
            ? row.content
            : row.content == null
              ? ''
              : JSON.stringify(row.content);
        if (text.trim()) parts.push(text.trim());
      }
    }
    if (parts.length) droppedChunks.push(parts.join('\n\n'));
  }

  setStatus('spin', 'Compressing chat…');

  try {
    await getActiveProvider(providerId);
    const { summaryBody } = await summarizeDroppedTurns({
      droppedText: droppedChunks.join('\n\n'),
      providerId,
      modelId,
      summaryReserveTokens,
      signal,
    });

    if (!summaryBody.trim()) {
      setStatus('err', 'Nothing to compress');
      return 'handled';
    }

    rebuildHistoryAfterCompress(chat, minRecentTurns, summaryBody, droppedTurns);
    scheduleSaveSessions();
    renderChatFromHistory(getActiveChat());
    setStatus('ok', 'Chat compressed');
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      setStatus('err', 'Compress cancelled');
    } else {
      setStatus('err', 'Compress failed');
    }
  }

  return 'handled';
}
