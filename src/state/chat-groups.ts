/**
 * Sidebar chat groups: create, rename, collapse, assign chats (never delete chats on group delete).
 * Orchestrate boards are owned by folders ({@link ChatGroup.orchestrateBoard}).
 */

import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import type { Chat, ChatGroup } from '../types';
import { newChatId, scheduleSaveSessions, sessionState, touchChat } from './sessions';

function newGroupId(): string {
  return `grp_${newChatId().slice(5)}`;
}

function requireSession(): NonNullable<typeof sessionState> {
  if (!sessionState) throw new Error('Session not loaded');
  return sessionState;
}

function ensureGroupsArray(): ChatGroup[] {
  const state = requireSession();
  if (!state.groups) {
    state.groups = [];
  }
  return state.groups;
}

/** Groups for a workspace sorted by order then createdAt. */
export function getGroupsForWorkspace(workspacePath: string): ChatGroup[] {
  const ws = normalizeWorkspacePath(workspacePath);
  const groups = requireSession().groups ?? [];
  return [...groups]
    .filter((g) => normalizeWorkspacePath(g.workspacePath) === ws)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

/** Create a group at the end of the workspace list. */
export function createGroup(name: string, workspacePath: string): ChatGroup {
  const state = requireSession();
  const groups = ensureGroupsArray();
  const ws = normalizeWorkspacePath(workspacePath);
  const siblings = getGroupsForWorkspace(ws);
  const group: ChatGroup = {
    id: newGroupId(),
    name: name.trim() || 'New group',
    workspacePath: ws,
    collapsed: false,
    order: siblings.length,
    createdAt: Date.now(),
  };
  groups.push(group);
  scheduleSaveSessions();
  return group;
}

export function renameGroup(id: string, name: string): void {
  const groups = ensureGroupsArray();
  const g = groups.find((x) => x.id === id);
  if (!g) return;
  const trimmed = name.trim();
  if (trimmed) g.name = trimmed;
  scheduleSaveSessions();
}

/** Remove group and ungroup member chats (chats are never deleted). */
export function deleteGroup(id: string): void {
  const state = requireSession();
  const groups = ensureGroupsArray();
  const idx = groups.findIndex((g) => g.id === id);
  if (idx < 0) return;
  groups.splice(idx, 1);
  if (state.activeBoardGroupId === id) {
    delete state.activeBoardGroupId;
  }
  for (const chat of state.chats) {
    if (chat.groupId === id) {
      delete chat.groupId;
    }
    if (chat.boardGroupId === id) {
      delete chat.boardGroupId;
    }
  }
  scheduleSaveSessions();
}

export function assignChatToGroup(chatId: string, groupId: string | null): void {
  const state = requireSession();
  const chat = state.chats.find((c) => c.id === chatId);
  if (!chat) return;
  if (groupId) {
    const group = (state.groups ?? []).find((g) => g.id === groupId);
    if (!group) return;
    chat.groupId = groupId;
  } else {
    delete chat.groupId;
  }
  scheduleSaveSessions();
}

export function toggleGroupCollapsed(id: string): void {
  const groups = ensureGroupsArray();
  const g = groups.find((x) => x.id === id);
  if (!g) return;
  g.collapsed = !g.collapsed;
  scheduleSaveSessions();
}

export function findGroupById(id: string): ChatGroup | undefined {
  return (requireSession().groups ?? []).find((g) => g.id === id);
}

/** Folder currently driving board view in #chatArea. */
export function getActiveBoardGroup(): ChatGroup | undefined {
  const state = sessionState;
  if (!state?.activeBoardGroupId) return undefined;
  return findGroupById(state.activeBoardGroupId);
}

/** Board folder linked from a planner or task chat. */
export function getBoardGroupForChat(chat: Chat): ChatGroup | undefined {
  const boardGroupId = chat.boardGroupId?.trim();
  if (boardGroupId) {
    const byLink = findGroupById(boardGroupId);
    if (byLink) return byLink;
  }
  const memberGroupId = chat.groupId?.trim();
  if (memberGroupId) {
    const memberGroup = findGroupById(memberGroupId);
    if (memberGroup?.orchestrateBoard) return memberGroup;
  }
  return undefined;
}

/** Find a folder whose planner chat matches the given chat id. */
export function findBoardGroupForPlanner(plannerChatId: string): ChatGroup | undefined {
  const id = plannerChatId.trim();
  if (!id) return undefined;
  return (requireSession().groups ?? []).find((g) => g.plannerChatId === id);
}

/** Create or return the board folder for an Orchestrate planner chat. */
export function getOrCreateBoardGroup(plannerChat: Chat): ChatGroup {
  const existing = plannerChat.boardGroupId
    ? findGroupById(plannerChat.boardGroupId)
    : findBoardGroupForPlanner(plannerChat.id);
  if (existing) {
    if (!existing.plannerChatId) {
      existing.plannerChatId = plannerChat.id;
    }
    if (!plannerChat.boardGroupId) {
      plannerChat.boardGroupId = existing.id;
    }
    return existing;
  }

  const planLabel =
    plannerChat.orchestratePlanPath?.split('/').pop()?.replace(/\.md$/i, '') ||
    'Orchestrate';
  const group = createGroup(planLabel, plannerChat.workspacePath);
  group.plannerChatId = plannerChat.id;
  if (plannerChat.orchestratePlanPath) {
    group.orchestratePlanPath = plannerChat.orchestratePlanPath;
  }
  plannerChat.boardGroupId = group.id;
  touchChat(plannerChat);
  scheduleSaveSessions();
  return group;
}

/** Planner chat for a board folder (required for board tools / timer). */
export function getPlannerChatForGroup(group: ChatGroup): Chat | undefined {
  const id = group.plannerChatId?.trim();
  if (!id) return undefined;
  return requireSession().chats.find((c) => c.id === id);
}

/** Open folder board view in the main column (focuses planner chat when a task chat was active). */
export function openBoardGroup(groupId: string): void {
  const state = requireSession();
  const group = findGroupById(groupId);
  if (!group?.orchestrateBoard) return;

  const plannerId = group.plannerChatId?.trim();
  const active = state.chats.find((c) => c.id === state.activeId);
  if (
    plannerId &&
    active &&
    active.id !== plannerId &&
    (active.boardGroupId === groupId || active.groupId === groupId)
  ) {
    state.activeId = plannerId;
    const planner = state.chats.find((c) => c.id === plannerId);
    if (planner) planner.unread = false;
  }

  state.activeBoardGroupId = groupId;
  group.viewMode = 'board';
  scheduleSaveSessions();
  void import('./orchestrate-board-store.ts').then(({ applyOpenBoardWaveCollapse }) => {
    applyOpenBoardWaveCollapse(group);
    void import('../ui/sidebar').then((m) => m.renderSidebar());
    void import('../ui/messages').then((m) => {
      const chat = state.chats.find((c) => c.id === state.activeId);
      if (chat) m.renderChatFromHistory(chat);
    });
  });
}

/** Return to planner chat view and clear board main-column focus. */
export function closeBoardGroupView(group: ChatGroup): void {
  const state = requireSession();
  group.viewMode = 'chat';
  if (state.activeBoardGroupId === group.id) {
    delete state.activeBoardGroupId;
  }
  scheduleSaveSessions();
  const plannerId = group.plannerChatId?.trim();
  if (plannerId) {
    void import('../ui/sidebar').then((m) => m.switchChat(plannerId));
    return;
  }
  void import('../ui/sidebar').then((m) => m.renderSidebar());
  void import('../ui/messages').then((m) => {
    const chat = state.chats.find((c) => c.id === state.activeId);
    if (chat) m.renderChatFromHistory(chat);
  });
}
