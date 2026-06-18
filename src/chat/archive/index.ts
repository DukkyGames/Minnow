/**
 * Archive policy pre-pass — offload stale turns to Brain and recall on demand (MIN-139).
 */

import type { ApiMessage, Chat } from '../../types';
import { brainWorkspaceKeyFromPath } from '../../lib/brain-workspace-key';
import { getWorkspacePath } from '../../state/workspace';
import { estimateApiMessagesTokens } from '../context-budget';
import { resolveContextLimit } from '../context-usage';
import { buildArchivePreludeBlock } from './auto-prelude';
import { splitRangeForBundling } from './chunking';
import { applyMemoizedCollapse, replaceArchivedRangesWithPlaceholder } from './collapse';
import { detectStaleTurnRanges } from './staleness';
import {
  enqueueArchiveBundle,
  fetchArchiveStatus,
  retrieveChatArchive,
  sliceTurnsForRange,
} from './store-client';
import type { AgentContextBudgetConfig } from '../context-budget';
import type { ArchiveConfig, ArchiveHistoryRange, ArchivePreResult } from './types';
import { DEFAULT_ARCHIVE_CONFIG } from './types';

export type { ArchivePreResult } from './types';
export { applyMemoizedCollapse } from './collapse';

let archiveDisabledReason: string | null = null;

/** Last error that caused archive to self-disable for this session. */
export function getArchiveDisabledReason(): string | null {
  return archiveDisabledReason;
}

export function reportArchiveDisabled(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  archiveDisabledReason = message;
}

export function clearArchiveDisabledReason(): void {
  archiveDisabledReason = null;
}

function resolveArchiveConfig(
  agentConfig: AgentContextBudgetConfig,
): ArchiveConfig {
  return { ...DEFAULT_ARCHIVE_CONFIG, ...(agentConfig.archive ?? {}) };
}

function lastUserText(messages: ApiMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role === 'user' && typeof msg.content === 'string') {
      return msg.content.trim();
    }
  }
  return '';
}

async function pollArchiveReadiness(
  chatId: string,
  workspaceKey: string,
  staleRanges: ArchiveHistoryRange[],
): Promise<{ allReady: boolean; pending: ArchiveHistoryRange[] }> {
  if (staleRanges.length === 0) {
    return { allReady: true, pending: [] };
  }
  const status = await fetchArchiveStatus(chatId, workspaceKey, staleRanges);
  if (!status) {
    return { allReady: false, pending: staleRanges };
  }
  const readyKeys = new Set(
    status.ranges.map((r) => `${r.startIndex}-${r.endIndex}`),
  );
  const pending = staleRanges.filter(
    (r) => !readyKeys.has(`${r.startIndex}-${r.endIndex}`),
  );
  return { allReady: pending.length === 0, pending };
}

/**
 * Async pre-pass: bundle stale turns into Brain, collapse placeholders, inject recall.
 * Main chat only — sub-agents fall back to slide.
 */
export async function applyArchivePolicy(
  messages: ApiMessage[],
  ctx: {
    chat: Chat;
    agentConfig: AgentContextBudgetConfig;
  },
): Promise<ArchivePreResult> {
  const { chat, agentConfig } = ctx;
  const config = resolveArchiveConfig(agentConfig);
  const history = chat.history ?? [];
  const contextLimit = chat.modelId
    ? resolveContextLimit(chat.modelId, chat)
    : null;
  const staleRanges = detectStaleTurnRanges(history, config, {
    estimatedTokens: estimateApiMessagesTokens(messages),
    contextLimit,
  });

  const chunkedRanges = staleRanges.flatMap((range) => {
    const turns = sliceTurnsForRange(messages, range, history.length);
    return splitRangeForBundling(range, turns);
  });

  const empty: ArchivePreResult = {
    messages,
    archived: 0,
    recalled: 0,
    recallTokens: 0,
    collapsedRanges: [],
  };
  if (chunkedRanges.length === 0) return empty;

  const workspaceKey =
    brainWorkspaceKeyFromPath(chat.workspacePath || getWorkspacePath()) || 'workspace';
  const readiness = await pollArchiveReadiness(chat.id, workspaceKey, chunkedRanges);

  if (!readiness.allReady) {
    for (const range of readiness.pending) {
      void enqueueArchiveBundle({
        chatId: chat.id,
        workspaceKey,
        turns: sliceTurnsForRange(messages, range, history.length),
        sourceTurnIndices: range.sourceTurnIndices,
      });
    }
    return empty;
  }

  clearArchiveDisabledReason();

  const collapsed = replaceArchivedRangesWithPlaceholder(
    messages,
    staleRanges,
    history.length,
  );
  let nextMessages = collapsed.messages;

  const userQuery = lastUserText(messages);
  let recalled = 0;
  let recallTokens = 0;
  let retrievedBlock: string | undefined;

  if (userQuery) {
    const retrieve = await retrieveChatArchive(
      userQuery,
      workspaceKey,
      chat.id,
      config.retrievalTopK,
      {
        embeddingModelId: config.embeddingModelId,
        llmRerank: config.llmRerank,
      },
    );
    const hits = retrieve?.hits ?? [];
    const prelude = buildArchivePreludeBlock(hits, config.retrievalTopK);
    if (prelude.content) {
      let systemEnd = 0;
      for (const msg of nextMessages) {
        if (msg.role === 'system') systemEnd += 1;
        else break;
      }
      nextMessages = [
        ...nextMessages.slice(0, systemEnd),
        { role: 'system', content: prelude.content },
        ...nextMessages.slice(systemEnd),
      ];
      recalled = prelude.recalled;
      recallTokens = prelude.recallTokens;
      retrievedBlock = prelude.content;
    }
  }

  return {
    messages: nextMessages,
    archived: collapsed.archived,
    recalled,
    recallTokens,
    collapsedRanges: staleRanges,
    retrievedBlock,
  };
}
