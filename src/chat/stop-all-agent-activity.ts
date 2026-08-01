/**
 * Stop all in-flight agent work (boards, chats, sub-agents, titles, desktop research).
 */

import { abortByChatId, setChatAbort, setStreaming, streamingChatIds } from '../app-state';
import { listActiveSubAgentRuns } from '../agents/orchestrator';
import { cancelSubAgent } from '../agents/controller/controller';
import { clearMainTurnActivity, listMainTurnActivity } from './main-turn-activity';
import { isChatStreaming, notifyChatStreamEnded } from './streaming-state';
import { cancelSuperPlan, isSuperPlanAdvancing } from './super-plan/controller';
import { stopGeneration } from './stop-generation';
import {
  abortChatTitleGeneration,
  listTitleJobInflightChatIds,
} from './titles/inflight';
import { getPlannerChatForGroup } from '../state/chat-groups';
import { buildAgentActivitySnapshot } from '../state/agent-activity-registry';
import { countRunningTaskChats, stopBoardAutoRun } from '../state/orchestrate-board-actions';
import { isBoardRunning } from '../state/orchestrate-board-store';
import { findChatById, scheduleSaveSessions, sessionState, touchChat } from '../state/sessions';
import {
  cancelDesktopResearchRun,
  isDesktopResearchRunning,
} from '../os/research-desktop';
import { forceCloseAskQuestionModal } from '../ui/question-cards-modal';

function hasRunningBoardWork(): boolean {
  if (!sessionState) return false;
  for (const group of sessionState.groups) {
    const board = group.orchestrateBoard;
    if (!board) continue;
    if (isBoardRunning(group) || countRunningTaskChats(board) > 0) return true;
  }
  return false;
}

function hasActiveSuperPlanWork(): boolean {
  if (!sessionState) return false;
  for (const chat of sessionState.chats) {
    const plan = chat.superPlan;
    if (!plan || plan.cancelled) continue;
    if (isSuperPlanAdvancing(chat.id) || isChatStreaming(chat.id)) return true;
  }
  return false;
}

function hasAgentActivityPanelRows(): boolean {
  if (!sessionState) return false;
  const rows = buildAgentActivitySnapshot({
    nowMs: Date.now(),
    chats: sessionState.chats,
    mainTurns: listMainTurnActivity(),
    subAgents: listActiveSubAgentRuns(),
    titleJobs: listTitleJobInflightChatIds().map((chatId) => ({
      chatId,
      startedAtMs: Date.now(),
    })),
  });
  return rows.length > 0;
}

/** True when global stop-all would affect any in-flight agent work. */
export function hasStopAllAgentActivityTargets(): boolean {
  if (isDesktopResearchRunning()) return true;
  if (!sessionState) return false;
  if (hasAgentActivityPanelRows()) return true;
  if (hasRunningBoardWork()) return true;
  if (hasActiveSuperPlanWork()) return true;
  if (streamingChatIds.size > 0) return true;
  if (abortByChatId.size > 0) return true;
  return false;
}

/** Chat ids whose in-flight UI should be cleared after a global stop. */
function collectPresentationChatIds(extra?: ReadonlySet<string>): Set<string> {
  const ids = new Set<string>(extra ?? []);
  for (const chatId of streamingChatIds) ids.add(chatId);
  for (const chatId of abortByChatId.keys()) ids.add(chatId);
  for (const turn of listMainTurnActivity()) ids.add(turn.chatId);
  if (sessionState) {
    for (const chat of sessionState.chats) {
      if (chat.currentGenerationId?.trim()) ids.add(chat.id);
    }
  }
  return ids;
}

/**
 * Clear client streaming/activity flags immediately after stop-all.
 * Abort alone may not run runChatTurn finally (or may lag), but the UI must not
 * keep showing running chats or agent-activity rows.
 */
function flushStoppedAgentPresentation(extraChatIds?: ReadonlySet<string>): void {
  const chatIds = collectPresentationChatIds(extraChatIds);
  let sessionsDirty = false;

  for (const chatId of chatIds) {
    clearMainTurnActivity(chatId);
    setChatAbort(chatId, null);
    notifyChatStreamEnded(chatId);
    const chat = findChatById(chatId);
    if (chat?.currentGenerationId?.trim()) {
      chat.currentGenerationId = undefined;
      touchChat(chat);
      sessionsDirty = true;
    }
  }

  setStreaming(false);
  if (sessionsDirty) scheduleSaveSessions();

  void import('../ui/chat-item-dot').then((mod) => {
    for (const chatId of chatIds) {
      mod.setSidebarStreamPhase(null, chatId);
    }
    mod.syncChatItemDotsInDom();
  });
  void import('../ui/sidebar').then((mod) => mod.renderSidebar());
  void import('../ui/composer-send').then((mod) => mod.syncComposerFromStreamingState());
}

/** Best-effort halt of all agent activity; does not pause /loop schedules. */
export function stopAllAgentActivity(): void {
  forceCloseAskQuestionModal();

  const handledChatIds = new Set<string>();

  if (sessionState) {
    for (const group of sessionState.groups) {
      const board = group.orchestrateBoard;
      if (!board) continue;
      if (!isBoardRunning(group) && countRunningTaskChats(board) === 0) continue;
      const planner = getPlannerChatForGroup(group);
      if (!planner) continue;
      stopBoardAutoRun(group, planner, { reason: 'user' });
      handledChatIds.add(planner.id);
      for (const task of board.tasks) {
        if (task.chatId?.trim()) handledChatIds.add(task.chatId.trim());
      }
    }

    for (const chat of sessionState.chats) {
      const plan = chat.superPlan;
      if (!plan || plan.cancelled) continue;
      if (!isSuperPlanAdvancing(chat.id) && !isChatStreaming(chat.id)) continue;
      cancelSuperPlan(chat);
      handledChatIds.add(chat.id);
    }
  }

  for (const chatId of streamingChatIds) {
    if (handledChatIds.has(chatId)) continue;
    stopGeneration(chatId, 'user');
  }
  for (const chatId of abortByChatId.keys()) {
    if (handledChatIds.has(chatId)) continue;
    stopGeneration(chatId, 'user');
  }

  for (const run of listActiveSubAgentRuns()) {
    cancelSubAgent(run.runId, 'user_cancel');
  }

  for (const chatId of listTitleJobInflightChatIds()) {
    abortChatTitleGeneration(chatId);
  }

  void cancelDesktopResearchRun();

  flushStoppedAgentPresentation(handledChatIds);
}
