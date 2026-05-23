/**
 * Aggregate parent + sub-agent token stats for Orchestrate mode (MIN-36).
 */

import { listSubAgentRunsForParentTurn } from '../../agents/orchestrator';
import { resolveModelInfo } from '../../api/models';
import { normalizeModeId } from '../modes/types';
import { findChatById, getActiveChat } from '../../state/sessions';
import type { SubAgentRun } from '../../agents/types';
import type { Chat, FinalizedResponseMeta } from '../../types';
import { buildLastStatsSnapshot, updateStrip } from '../../ui/stats';
import { renderSidebar } from '../../ui/sidebar';
import { aggregateOrchestrateTurnMeta } from './stats-math';

export { aggregateOrchestrateTurnMeta, averageStatsSegments, sumUsageSegments } from './stats-math';

/** Whether this chat should roll up sub-agent usage into lastStats / stats strip. */
export function shouldAggregateOrchestrateStats(chat: Chat): boolean {
  return normalizeModeId(chat.modeId) === 'orchestrate';
}

/** Latest assistant row stats from history (parent-only meta for aggregation). */
export function getLatestAssistantTurnMeta(chat: Chat): FinalizedResponseMeta | null {
  for (let i = chat.history.length - 1; i >= 0; i--) {
    const row = chat.history[i];
    if (row.role !== 'assistant') continue;
    if (!row.stats && !row.usage) continue;
    return {
      stats: row.stats ?? {},
      usage: row.usage ?? {},
      model_info: chat.modelInfo ?? {},
    };
  }
  return null;
}

/** Apply aggregated stats to a chat and refresh UI when it is active. */
export function applyOrchestrateAggregatedStatsToChat(
  chat: Chat,
  parentTurnId: string | null | undefined,
  parent: FinalizedResponseMeta,
): FinalizedResponseMeta {
  if (!shouldAggregateOrchestrateStats(chat) || !parentTurnId) {
    return parent;
  }

  const subRuns = listSubAgentRunsForParentTurn(parentTurnId).filter(
    (r) => r.usage || r.stats,
  );
  if (subRuns.length === 0) {
    return parent;
  }

  const aggregated = aggregateOrchestrateTurnMeta(parent, subRuns);
  chat.lastStats = buildLastStatsSnapshot(aggregated.stats, aggregated.usage);

  const active = getActiveChat();
  if (active.id === chat.id) {
    const modelId =
      (document.getElementById('modelSelect') as HTMLSelectElement | null)?.value ||
      chat.modelId ||
      '';
    updateStrip(
      aggregated.stats,
      aggregated.usage,
      resolveModelInfo(modelId, aggregated.model_info),
    );
    renderSidebar();
  }

  return aggregated;
}

/** Re-aggregate after a sub-agent settles (late wait:false completions). */
export function refreshOrchestrateStatsAfterSubAgent(run: SubAgentRun): void {
  if (!run.parentChatId || !run.parentTurnId) return;
  if (run.status !== 'completed' && run.status !== 'failed' && run.status !== 'cancelled') {
    return;
  }

  const chat = findChatById(run.parentChatId);
  if (!chat || !shouldAggregateOrchestrateStats(chat)) return;

  const activeTurnId = chat.orchestrateBoard?.activeParentTurnId;
  if (!activeTurnId || activeTurnId !== run.parentTurnId) return;

  const parent = getLatestAssistantTurnMeta(chat);
  if (!parent) return;

  applyOrchestrateAggregatedStatsToChat(chat, run.parentTurnId, parent);
}
