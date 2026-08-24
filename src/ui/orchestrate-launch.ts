/**
 * Shared orchestrator board launch path — plan pick, chat/group setup, board view, kickoff.
 */

import {
  normalizeOrchestratePlanPath,
} from '../chat/orchestrate/plan-path';
import { normalizeModeId } from '../chat/modes/types';
import {
  findBoardGroupForPlanPath,
  getOrCreateBoardGroup,
  getBoardGroupForChat,
  getPlannerChatForGroup,
  linkPlannerChatToBoardFolder,
} from '../state/chat-groups';
import type { Chat, ChatGroup } from '../types';
import {
  getActiveChat,
  scheduleSaveSessions,
  sessionState,
} from '../state/sessions';
import { getWorkspacePath } from '../state/workspace';
import { setChatMode } from './mode-selector';
import {
  persistOrchestratePlanPathFromSelectValue,
} from './orchestrate-plan-picker';
import { createChatWithMode, switchChat } from './sidebar';
import { setOrchestrateViewMode } from './view-mode-toggle';

/** Open board view and kick off init when the board store is not ready yet. */
function finishBoardLaunch(group: ChatGroup): void {
  const needsKickoff = !group.orchestrateBoard;
  setOrchestrateViewMode('board');
  if (needsKickoff) {
    void import('./orchestrate-board-kickoff').then((m) => m.kickoffOrchestrateBoardBuild());
  }
}

/** The planner chat + board folder a launch resolved to. */
export interface BoardLaunchResult {
  chat: Chat;
  group: ChatGroup;
}

/**
 * Resolve or create an Orchestrate planner chat, bind the plan, open board view, kick off init when new.
 *
 * Returns what it actually launched. Callers must use this rather than reading
 * `sessionState.activeId` afterwards (MIN-637): a launch that reuses or keeps
 * the previous chat leaves `activeId` pointing somewhere else entirely.
 */
export function launchBoardFromPlan(planPath: string): BoardLaunchResult | null {
  const norm = normalizeOrchestratePlanPath(planPath);
  if (!norm) return null;

  const existingGroup = findBoardGroupForPlanPath(getWorkspacePath(), norm);
  if (existingGroup) {
    const planner = getPlannerChatForGroup(existingGroup);
    if (planner) {
      if (sessionState && sessionState.activeId !== planner.id) {
        switchChat(planner.id);
      }
      persistOrchestratePlanPathFromSelectValue(planner, planPath);
      if (normalizeModeId(planner.modeId) !== 'orchestrate') {
        setChatMode('orchestrate');
      }
      existingGroup.orchestratePlanPath = norm;
      scheduleSaveSessions();
      linkPlannerChatToBoardFolder(planner, existingGroup);
      finishBoardLaunch(existingGroup);
      return { chat: planner, group: existingGroup };
    }
  }

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
  group.orchestratePlanPath = norm;
  scheduleSaveSessions();
  finishBoardLaunch(group);
  return { chat, group };
}
