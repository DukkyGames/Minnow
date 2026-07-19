/**
 * Sidebar chat groups: create, rename, collapse, assign chats.
 * Orchestrate board folders delete member chats on group delete; plain groups only ungroup.
 * Boards are owned by folders ({@link ChatGroup.orchestrateBoard}).
 */

import { getChatAbort, setChatStopReason } from '../app-state.ts';
import { isBoardSetupIncomplete } from '../chat/orchestrate/board-setup.ts';
import { syncOrchestratorPlannerChatTitle } from '../chat/orchestrate/planner-chat-title.ts';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import type { Chat, ChatGroup } from '../types';
import { getChatLastMessageAt } from './session-workspace-scope';
import {
  newChatId,
  removeChatById,
  scheduleSaveSessions,
  sessionState,
  touchChat,
  type RemoveChatResult,
} from './sessions';

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

/** Newest member activity for sidebar ordering; empty groups use `createdAt`. */
export function getGroupActivityAt(group: ChatGroup, chats: Chat[]): number {
  let newest = 0;
  for (const chat of chats) {
    if (chat.groupId !== group.id) continue;
    newest = Math.max(newest, getChatLastMessageAt(chat));
  }
  if (newest > 0) return newest;
  return typeof group.createdAt === 'number' && Number.isFinite(group.createdAt)
    ? group.createdAt
    : 0;
}

export type WorkspaceSidebarEntry =
  | { kind: 'group'; group: ChatGroup; members: Chat[] }
  | { kind: 'chat'; chat: Chat };

/** Board folders pin the planner chat first; other members stay activity-sorted. */
function sortBoardGroupMembers(group: ChatGroup, members: Chat[]): Chat[] {
  const plannerId = group.plannerChatId?.trim();
  if (!plannerId) return members;
  const planner = members.find((c) => c.id === plannerId);
  const rest = members
    .filter((c) => c.id !== plannerId)
    .sort((a, b) => getChatLastMessageAt(b) - getChatLastMessageAt(a));
  return planner ? [planner, ...rest] : rest;
}

/** Merge groups and ungrouped chats by newest activity (sidebar main list). */
export function buildSortedWorkspaceSidebarEntries(
  groups: ChatGroup[],
  workspaceChats: Chat[],
): WorkspaceSidebarEntry[] {
  const groupedIds = new Set<string>();
  const entries: WorkspaceSidebarEntry[] = [];

  for (const group of groups) {
    const members = sortBoardGroupMembers(
      group,
      workspaceChats.filter((c) => c.groupId === group.id),
    );
    members.forEach((c) => groupedIds.add(c.id));
    entries.push({ kind: 'group', group, members });
  }

  for (const chat of workspaceChats) {
    if (!groupedIds.has(chat.id)) {
      entries.push({ kind: 'chat', chat });
    }
  }

  entries.sort((a, b) => {
    const aActivity =
      a.kind === 'group' ? getGroupActivityAt(a.group, a.members) : getChatLastMessageAt(a.chat);
    const bActivity =
      b.kind === 'group' ? getGroupActivityAt(b.group, b.members) : getChatLastMessageAt(b.chat);
    return bActivity - aActivity;
  });

  return entries;
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

export interface DeleteGroupResult {
  ok: boolean;
  /** True when deleting a board folder removed the active chat. */
  activeChanged: boolean;
  /** Last chat removal result when a board folder and its chats were deleted. */
  chatRemoval?: RemoveChatResult;
}

/** Chat ids belonging to a board folder (membership + task-linked chats). */
export function listBoardGroupChatIds(group: ChatGroup, chats: readonly Chat[]): string[] {
  const ids = new Set<string>();
  const groupId = group.id;
  for (const chat of chats) {
    if (chat.groupId === groupId || chat.boardGroupId === groupId) {
      ids.add(chat.id);
    }
  }
  const board = group.orchestrateBoard;
  if (board) {
    const plannerId = group.plannerChatId?.trim();
    if (plannerId) ids.add(plannerId);
    for (const task of board.tasks) {
      if (task.chatId?.trim()) ids.add(task.chatId.trim());
      if (task.testChatId?.trim()) ids.add(task.testChatId.trim());
      if (task.fixerChatId?.trim()) ids.add(task.fixerChatId.trim());
    }
    if (board.finalTest?.chatId?.trim()) ids.add(board.finalTest.chatId.trim());
  }
  return [...ids];
}

function teardownBoardGroup(group: ChatGroup, chatIds: readonly string[]): void {
  for (const chatId of chatIds) {
    setChatStopReason(chatId, 'system');
    getChatAbort(chatId)?.abort();
  }
  if (group.orchestrateBoard?.integrationBranch) {
    void fetch('/api/worktree', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'cleanup', boardId: group.id }),
    }).catch(() => {
      /* best-effort on folder delete */
    });
  }
}

/** Remove a plain group (ungroup chats) or a board folder (delete all member chats). */
export function deleteGroup(
  id: string,
  options: { fallbackModelId?: string } = {},
): DeleteGroupResult {
  const state = requireSession();
  const groups = ensureGroupsArray();
  const idx = groups.findIndex((g) => g.id === id);
  if (idx < 0) return { ok: false, activeChanged: false };

  const group = groups[idx]!;
  const fallbackModelId = options.fallbackModelId ?? '';

  if (group.orchestrateBoard) {
    if (state.activeBoardGroupId === id) {
      dismissActiveBoardView();
    }
    const chatIds = listBoardGroupChatIds(group, state.chats);
    teardownBoardGroup(group, chatIds);
    groups.splice(idx, 1);

    let lastRemoval: RemoveChatResult | undefined;
    let activeChanged = false;
    for (const chatId of chatIds) {
      const result = removeChatById(chatId, fallbackModelId);
      if (result.ok) {
        lastRemoval = result;
        if (result.activeChanged) activeChanged = true;
      }
    }
    scheduleSaveSessions();
    return { ok: true, activeChanged, chatRemoval: lastRemoval };
  }

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
  return { ok: true, activeChanged: false };
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

/** Clear board main-column focus (same as leaving board via switchChat). */
export function dismissActiveBoardView(): boolean {
  const state = sessionState;
  if (!state?.activeBoardGroupId) return false;
  const openGroup = getActiveBoardGroup();
  if (openGroup) {
    openGroup.viewMode = 'chat';
  }
  delete state.activeBoardGroupId;
  scheduleSaveSessions();
  return true;
}

/**
 * When leaving a board task chat for the planner row, reopen the kanban instead of chat view.
 * External chats and non-task folder members are unchanged.
 */
export function resolveBoardRestoreGroupOnSwitch(targetChatId: string): ChatGroup | undefined {
  const state = sessionState;
  if (!state) return undefined;
  const group = findBoardGroupForPlanner(targetChatId);
  if (!group?.orchestrateBoard) return undefined;
  const leaving = state.chats.find((c) => c.id === state.activeId);
  if (!leaving?.boardTaskId?.trim()) return undefined;
  const folderId = group.id;
  if (leaving.boardGroupId !== folderId && leaving.groupId !== folderId) return undefined;
  return group;
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

/** Sidebar folder membership + board link for the orchestrate planner (parse) chat. */
export function linkPlannerChatToBoardFolder(plannerChat: Chat, group: ChatGroup): void {
  group.plannerChatId = plannerChat.id;
  plannerChat.boardGroupId = group.id;
  plannerChat.groupId = group.id;
  if (plannerChat.orchestratePlanPath && !group.orchestratePlanPath) {
    group.orchestratePlanPath = plannerChat.orchestratePlanPath;
  }
  syncOrchestratorPlannerChatTitle(
    plannerChat,
    plannerChat.orchestratePlanPath ?? group.orchestratePlanPath,
  );
  touchChat(plannerChat);
  scheduleSaveSessions();
}

/** Create or return the board folder for an Orchestrate planner chat. */
export function getOrCreateBoardGroup(plannerChat: Chat): ChatGroup {
  const existing = plannerChat.boardGroupId
    ? findGroupById(plannerChat.boardGroupId)
    : findBoardGroupForPlanner(plannerChat.id);
  if (existing) {
    linkPlannerChatToBoardFolder(plannerChat, existing);
    return existing;
  }

  const planLabel =
    plannerChat.orchestratePlanPath?.split('/').pop()?.replace(/\.md$/i, '') ||
    'Orchestrate';
  const group = createGroup(planLabel, plannerChat.workspacePath);
  linkPlannerChatToBoardFolder(plannerChat, group);
  return group;
}

/** Planner chat for a board folder (required for board tools / timer). */
export function getPlannerChatForGroup(group: ChatGroup): Chat | undefined {
  const id = group.plannerChatId?.trim();
  if (!id) return undefined;
  return requireSession().chats.find((c) => c.id === id);
}

/** Mount board view for a folder after session fields are set. */
function activateBoardGroupView(groupId: string, group: ChatGroup): void {
  const state = requireSession();
  state.activeBoardGroupId = groupId;
  group.viewMode = 'board';
  scheduleSaveSessions();
  void import('../ui/code-overview')
    .then(({ dismissCodeOverviewForNavigation }) => {
      dismissCodeOverviewForNavigation();
      return import('./orchestrate-board-store.ts');
    })
    .then(({ applyOpenBoardWaveCollapse }) => {
    if (group.orchestrateBoard) {
      applyOpenBoardWaveCollapse(group);
    }
    void import('../ui/sidebar').then((m) => m.renderSidebar());
    void import('../ui/messages').then((m) => {
      const chat = state.chats.find((c) => c.id === state.activeId);
      if (chat) m.renderChatFromHistory(chat);
    });
  });
}

/** Open folder board view in the main column (focuses planner chat when a task chat was active). */
export function openBoardGroup(groupId: string): void {
  const state = requireSession();
  const group = findGroupById(groupId);
  if (!group) return;
  if (!group.orchestrateBoard && !isBoardSetupIncomplete(group)) return;

  const plannerId = group.plannerChatId?.trim();
  const active = state.chats.find((c) => c.id === state.activeId);
  if (plannerId && active && active.id !== plannerId) {
    const inFolder =
      active.boardGroupId === groupId || active.groupId === groupId;
    if (!inFolder) {
      void import('../ui/sidebar').then((m) => {
        m.switchChat(plannerId);
        activateBoardGroupView(groupId, group);
      });
      return;
    }
    state.activeId = plannerId;
    const planner = state.chats.find((c) => c.id === plannerId);
    if (planner) {
      planner.unread = false;
      planner.turnError = false;
    }
  }

  activateBoardGroupView(groupId, group);
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
    void import('../ui/sidebar').then(async (sidebar) => {
      if (plannerId !== state.activeId) {
        sidebar.switchChat(plannerId);
        return;
      }
      sidebar.renderSidebar();
      const { dismissCodeOverviewForNavigation } = await import('../ui/code-overview');
      dismissCodeOverviewForNavigation();
      const { renderChatFromHistory } = await import('../ui/messages');
      const planner = state.chats.find((c) => c.id === plannerId);
      if (planner) renderChatFromHistory(planner);
    });
    return;
  }
  void import('../ui/sidebar').then((m) => m.renderSidebar());
  void import('../ui/code-overview').then(({ dismissCodeOverviewForNavigation }) => {
    dismissCodeOverviewForNavigation();
    void import('../ui/messages').then((m) => {
      const chat = state.chats.find((c) => c.id === state.activeId);
      if (chat) m.renderChatFromHistory(chat);
    });
  });
}
