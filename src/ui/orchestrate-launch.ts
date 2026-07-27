/**
 * Shared orchestrator board launch path — plan pick, chat/group setup, board view, kickoff.
 */

import {
  normalizeOrchestratePlanPath,
} from '../chat/orchestrate/plan-path';
import { normalizeModeId } from '../chat/modes/types';
import { getOrCreateBoardGroup, getBoardGroupForChat } from '../state/chat-groups';
import {
  getActiveChat,
  scheduleSaveSessions,
  sessionState,
} from '../state/sessions';
import { setChatMode } from './mode-selector';
import {
  persistOrchestratePlanPathFromSelectValue,
} from './orchestrate-plan-picker';
import { createChatWithMode, switchChat } from './sidebar';
import { setOrchestrateViewMode } from './view-mode-toggle';

/** Resolve or create an Orchestrate planner chat, bind the plan, open board view, kick off init when new. */
export function launchBoardFromPlan(planPath: string): void {
  const active = getActiveChat();
  const canReuse =
    !active.history.length &&
    normalizeModeId(active.modeId) === 'orchestrate' &&
    !getBoardGroupForChat(active);
  let chat = active;
  if (!canReuse) {
    const created = createChatWithMode({ modeId: 'orchestrate' });
    if (created.ok && created.chatId && sessionState) {
      chat =
        sessionState.chats.find((c) => c.id === created.chatId) ?? getActiveChat();
      if (sessionState.activeId !== chat.id) switchChat(chat.id);
    }
  }
  persistOrchestratePlanPathFromSelectValue(chat, planPath);
  if (normalizeModeId(chat.modeId) !== 'orchestrate') {
    setChatMode('orchestrate');
  }
  const group = getOrCreateBoardGroup(chat);
  const norm = normalizeOrchestratePlanPath(planPath);
  if (norm) {
    group.orchestratePlanPath = norm;
    scheduleSaveSessions();
  }
  const needsKickoff = !group.orchestrateBoard;
  setOrchestrateViewMode('board');
  if (needsKickoff) {
    void import('./orchestrate-board-kickoff').then((m) => m.kickoffOrchestrateBoardBuild());
  }
}
