/**
 * Aggregate token metrics across planner + member chats on an orchestrate board (MIN-414).
 */

import { resolveModelInfo } from '../../api/models';
import {
  getActiveBoardGroup,
  getPlannerChatForGroup,
  listBoardGroupChatIds,
} from '../../state/chat-groups';
import { findChatById, sessionState } from '../../state/sessions';
import { isBoardViewActive } from '../../ui/view-mode-toggle';
import { updateStrip } from '../../ui/stats';
import type { Chat, ChatGroup, Stats, Usage } from '../../types';
import { averageStatsSegments, sumUsageSegments } from './stats-math';

export interface BoardAggregateMetrics {
  stats: Stats;
  usage: Usage;
  costUsd: number | null;
}

function collectUsageFromChatHistory(chat: Chat): Usage[] {
  // Lazy history: do not scan placeholder [] — prefer tokenLedger / lastStats instead.
  if (chat.historyLoaded === false) return [];
  const segments: Usage[] = [];
  for (const msg of chat.history) {
    if (msg.role === 'assistant' && msg.usage) segments.push(msg.usage);
  }
  return segments;
}

/** Per-chat cumulative usage: token ledger when populated, otherwise assistant history sum. */
export function chatCumulativeUsage(chat: Chat): Usage | null {
  const totals = chat.tokenLedger?.totals;
  if (totals && totals.totalTokens > 0) {
    return {
      prompt_tokens: totals.promptTokens,
      completion_tokens: totals.completionTokens,
      total_tokens: totals.totalTokens,
    };
  }
  const historySegments = collectUsageFromChatHistory(chat);
  if (!historySegments.length) return null;
  return sumUsageSegments(historySegments);
}

/** Latest turn stats/usage pair for board speed averaging. */
export function latestTurnStatsPair(chat: Chat): { stats: Stats; usage: Usage } | null {
  const ls = chat.lastStats;
  if (
    ls &&
    (ls.tokens_per_second != null ||
      ls.time_to_first_token != null ||
      ls.generation_time != null)
  ) {
    return {
      stats: {
        tokens_per_second: ls.tokens_per_second ?? undefined,
        time_to_first_token: ls.time_to_first_token ?? undefined,
        generation_time: ls.generation_time ?? undefined,
        stop_reason: ls.stop_reason ?? undefined,
      },
      usage: {
        prompt_tokens: ls.prompt_tokens ?? undefined,
        completion_tokens: ls.completion_tokens ?? undefined,
        total_tokens: ls.total_tokens ?? undefined,
      },
    };
  }
  if (chat.historyLoaded === false) return null;
  for (let i = chat.history.length - 1; i >= 0; i--) {
    const row = chat.history[i];
    if (row.role !== 'assistant') continue;
    if (!row.stats && !row.usage) continue;
    return {
      stats: row.stats ?? {},
      usage: row.usage ?? {},
    };
  }
  return null;
}

/** Sum usage and average per-chat speed across all chats linked to a board folder. */
export function aggregateBoardMetrics(group: ChatGroup): BoardAggregateMetrics {
  const chats = sessionState?.chats ?? [];
  const chatIds = listBoardGroupChatIds(group, chats);

  const usageSegments: Usage[] = [];
  const statsPairs: Array<{ stats: Stats; usage: Usage }> = [];
  let costUsd = 0;
  let hasCost = false;

  for (const chatId of chatIds) {
    const chat = findChatById(chatId);
    if (!chat) continue;

    const usage = chatCumulativeUsage(chat);
    if (usage) usageSegments.push(usage);

    const pair = latestTurnStatsPair(chat);
    if (
      pair &&
      (pair.stats.tokens_per_second != null ||
        pair.stats.time_to_first_token != null ||
        pair.stats.generation_time != null)
    ) {
      statsPairs.push(pair);
    }

    const chatCost = chat.tokenLedger?.totals?.costUsd;
    if (chatCost != null && chatCost > 0) {
      costUsd += chatCost;
      hasCost = true;
    }
  }

  return {
    stats: averageStatsSegments(statsPairs),
    usage: sumUsageSegments(usageSegments),
    costUsd: hasCost ? costUsd : null,
  };
}

/** True when the metrics strip should show board-wide rollups instead of one chat. */
export function shouldUseBoardAggregateStats(): boolean {
  if (!isBoardViewActive()) return false;
  const group = getActiveBoardGroup();
  return Boolean(group?.orchestrateBoard);
}

/** Refresh the bottom metrics strip for the active chat or board aggregate context. */
export function refreshMetricsStripForChat(chat: Chat): void {
  if (shouldUseBoardAggregateStats()) {
    const group = getActiveBoardGroup()!;
    const { stats, usage, costUsd } = aggregateBoardMetrics(group);
    const planner = getPlannerChatForGroup(group);
    const modelId = planner?.modelId?.trim() || chat.modelId?.trim() || '';
    updateStrip(
      stats,
      usage,
      resolveModelInfo(modelId, planner?.modelInfo ?? chat.modelInfo ?? {}),
      { costUsd },
    );
    return;
  }

  const mid = chat.modelId?.trim() || '';
  const ls = chat.lastStats;
  const hasNumeric =
    ls &&
    (ls.tokens_per_second != null ||
      ls.time_to_first_token != null ||
      ls.generation_time != null ||
      ls.total_tokens != null);
  if (hasNumeric) {
    const stats: Stats = {
      tokens_per_second: ls!.tokens_per_second ?? undefined,
      time_to_first_token: ls!.time_to_first_token ?? undefined,
      generation_time: ls!.generation_time ?? undefined,
      stop_reason: ls!.stop_reason ?? undefined,
    };
    const usage: Usage = {
      total_tokens: ls!.total_tokens ?? undefined,
      prompt_tokens: ls!.prompt_tokens ?? undefined,
      completion_tokens: ls!.completion_tokens ?? undefined,
    };
    updateStrip(stats, usage, resolveModelInfo(mid, chat.modelInfo || {}));
  } else {
    updateStrip({}, {}, resolveModelInfo(mid, chat.modelInfo || {}));
  }
}
