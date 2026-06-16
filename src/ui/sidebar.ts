import { isChatsWorkspacePath } from '../lib/chats-workspace';
import { isDesktopChatActive } from '../os/desktop-state';
import { decodeModelSelectKey, encodeModelSelectKey } from '../lib/model-select-key';
import { isChatStreaming } from '../chat/streaming-state';
import {
  createGroup,
  deleteGroup,
  getActiveBoardGroup,
  getGroupsForWorkspace,
  openBoardGroup,
  renameGroup,
  toggleGroupCollapsed,
} from '../state/chat-groups';
import { syncComposerFromStreamingState } from './composer-send';
import {
  createEmptyChatObject,
  getActiveChat,
  getChatsForWorkspace,
  getUnassignedChats,
  isHiddenFromMainSidebar,
  onWorkspaceChanged,
  removeChatById,
  sessionState,
  touchChat,
  recordChatMessage,
  scheduleSaveSessions,
  type RemoveChatResult,
} from '../state/sessions';
import {
  getExpertScopeId,
  isExpertScopeActive,
  renderExpertScopeChatList,
  renderExpertScopeHeader,
} from './experts/experts-scope';
import { getWorkspacePath } from '../state/workspace';
import { normalizeModeId, type ModeId } from '../chat/modes/types';
import { normalizeOrchestratePlanPath } from '../chat/orchestrate/plan-path';
import type { Chat } from '../types';
import {
  applySidebarVisuals,
  closeMobileSidebar,
} from './layout';
import { bootGenerationResumeForChat } from '../chat/generation-resume';
import {
  renderChatFromHistory,
  renderStatsForChat,
  showCachedModelInfo,
} from './messages';
import { updateCodeChangeStrip } from './code-change-strip';
import { updateWorkspaceCodeChangeDisplay } from './workspace-code-change';
import {
  formatCodeChangeTotalsText,
  hasCodeChangeTotals,
} from '../usage/code-change-ledger';
import { getDefaultWorkAgentForMode } from '../agents/work-agent-registry';
import { syncModeSelectorFromActiveChat } from './mode-selector';
import { syncThinkingControlFromActiveChat } from './composer-thinking';
import { syncOrchestratePlanStripFromActiveChat } from './orchestrate-plan-selector';
import { syncComposerPinnedSkillFromActiveChat } from './composer-pinned-skill';
import { buildDefaultPinnedSkillForNewChat } from '../skills/config';
import { syncViewModeToggleFromActiveChat } from './view-mode-toggle';
import { isOrchestrateHubMounted, teardownOrchestrateHub } from './orchestrate-hub';
import { suspendOrchestratePlanScreenOnLeave } from './orchestrate-plan-screen';
import { onModelRoutingActiveChatChanged } from './settings-model-routing';
import { syncReefWidgetSettingsFromActiveChat } from './reef-widget-settings';
import { syncWorkAgentDevFromActiveChat, workAgentSidebarAbbrev } from './work-agent-dev';
import { updateModelLoadUnloadButtons } from '../api/models';
import { updateModelStateDot } from './model-state-dot';
import { syncModelSelectPicker } from './model-select-picker';
import { setStatus } from './status';
import { formatSidebarStatsPreview } from './stats';
import { refreshTerminalHistoryForActiveChat } from './terminal-panel';
import {
  applyChatItemDotClasses,
  getChatItemDotContext,
  maybeMarkChatUnreadAfterLeave,
  recordChatOpened,
  resolveChatItemDotState,
  syncChatItemDotsInDom,
} from './chat-item-dot';

/** Read canonical model id + optional provider from the top-bar composite select value. */
function readTopBarModelBinding(): { modelId: string; providerId?: string } {
  const raw = (document.getElementById('modelSelect') as HTMLSelectElement)?.value ?? '';
  const parsed = decodeModelSelectKey(raw);
  const modelId = (parsed?.modelId ?? raw).trim();
  return { modelId, providerId: parsed?.providerId };
}

/** Keep model picker aligned with the active chat's stored model id. */
export function syncModelSelectForActiveChat(): void {
  const sel = document.getElementById('modelSelect') as HTMLSelectElement | null;
  const chat = getActiveChat();
  if (!sel || !sel.options.length) return;
  const opts = [...sel.options];
  const values = opts.map((o) => o.value);
  const pid = chat.providerId?.trim();
  const mid = chat.modelId?.trim();
  if (pid && mid) {
    const want = encodeModelSelectKey(pid, mid);
    if (values.includes(want)) sel.value = want;
  }
  if (!sel.value && mid) {
    const match = opts.find(
      (o) => decodeModelSelectKey(o.value)?.modelId === mid || o.value === mid,
    );
    if (match) sel.value = match.value;
  }
  updateModelStateDot(sel.value);
  updateModelLoadUnloadButtons();
  syncModelSelectPicker();
}

export function onModelSelectChange(): void {
  const sel = document.getElementById('modelSelect') as HTMLSelectElement;
  const chat = getActiveChat();
  const raw = sel.value;
  const decoded = decodeModelSelectKey(raw);
  if (decoded) {
    chat.providerId = decoded.providerId;
    chat.modelId = decoded.modelId;
  } else {
    chat.modelId = raw;
  }
  touchChat(chat);
  scheduleSaveSessions();
  updateModelStateDot(sel.value);
  updateModelLoadUnloadButtons();
  syncModelSelectPicker();
  showCachedModelInfo();
}

/** Refresh main column after workspace folder changes. */
export function applyWorkspaceScopedSession(newPath: string, previousPath?: string): void {
  const { activeChat, activeChanged } = onWorkspaceChanged(newPath, previousPath);
  if (activeChanged) {
    recordChatOpened(activeChat.id);
    syncModelSelectForActiveChat();
    renderChatFromHistory(activeChat);
    renderStatsForChat(activeChat);
    syncModeSelectorFromActiveChat();
    syncThinkingControlFromActiveChat();
    void syncOrchestratePlanStripFromActiveChat();
    syncComposerPinnedSkillFromActiveChat();
    syncViewModeToggleFromActiveChat();
    syncWorkAgentDevFromActiveChat();
    syncReefWidgetSettingsFromActiveChat();
    onModelRoutingActiveChatChanged(activeChat.id);
    void refreshTerminalHistoryForActiveChat();
  }
  renderSidebar();
  if (document.getElementById('globalBugsView')?.classList.contains('is-open')) {
    void import('./global-bugs-page').then((m) => m.renderGlobalBugsList());
  }
}

interface AppendChatRowOptions {
  /** Workspace chats can be dragged onto group headers; Unassigned rows cannot. */
  draggable?: boolean;
  /** Compact name-only row when listed under a sidebar group. */
  inGroup?: boolean;
  /** Override default switchChat activation (e.g. Experts hub before shell opens). */
  onActivate?: (chat: Chat) => void;
  /** Override default deleteChat (e.g. Experts hub detail list refresh). */
  onDelete?: (chat: Chat) => void;
}

/** Sidebar row highlight id; suppressed while a board folder owns the main column. */
function sidebarHighlightChatId(): string | null {
  if (!sessionState) return null;
  const boardGroup = getActiveBoardGroup();
  if (boardGroup?.viewMode === 'board') return null;
  return sessionState.activeId;
}

function appendChatListSection(
  list: HTMLElement,
  title: string,
  chats: Chat[],
  activeId: string | null,
): void {
  if (!chats.length) return;

  const head = document.createElement('div');
  head.className = 'chat-list-section-head';
  head.setAttribute('role', 'presentation');

  const titleEl = document.createElement('span');
  titleEl.className = 'chat-list-section-title';
  titleEl.textContent = title;
  head.appendChild(titleEl);

  const badge = document.createElement('span');
  badge.className = 'chat-list-section-badge';
  badge.textContent = String(chats.length);
  badge.setAttribute('aria-hidden', 'true');
  head.appendChild(badge);

  list.appendChild(head);

  for (const chat of chats) {
    appendChatRow(list, chat, activeId, { draggable: false });
  }
}

/** Shared session row builder (main sidebar + expert-scoped list). */
export function appendChatRow(
  list: HTMLElement,
  chat: Chat,
  highlightChatId: string | null,
  options?: AppendChatRowOptions,
): void {
  const isActive = highlightChatId != null && chat.id === highlightChatId;
  const inGroup = options?.inGroup === true;
  const modelLabel = chat.modelId || 'No model selected';
  const statsPreview = formatSidebarStatsPreview(chat.lastStats);
  const rowLabel = inGroup
    ? chat.name
    : `${chat.name}, ${modelLabel}${statsPreview ? `, ${statsPreview}` : ''}`;

  const row = document.createElement('div');
  row.dataset.chatId = chat.id;
  row.className =
    'chat-item-row' + (isActive ? ' active' : '') + (inGroup ? ' chat-item-row--in-group' : '');
  row.setAttribute('role', 'listitem');
  row.setAttribute('aria-label', rowLabel);
  row.title = [chat.name, modelLabel, statsPreview].filter(Boolean).join('\n');
  row.tabIndex = 0;
  if (options?.draggable !== false) {
    row.draggable = true;
    row.classList.add('chat-item-row--draggable');
  }
  row.addEventListener('click', (e) => {
    if ((e.target as Element).closest('.chat-item-actions')) return;
    if (options?.onActivate) {
      options.onActivate(chat);
      return;
    }
    switchChat(chat.id);
  });
  row.addEventListener('keydown', (e) => {
    if ((e.target as Element).closest('.chat-item-actions')) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (options?.onActivate) {
        options.onActivate(chat);
        return;
      }
      switchChat(chat.id);
    }
  });

  const head = document.createElement('div');
  head.className = 'chat-item-head';

  const titleRow = document.createElement('div');
  titleRow.className = 'chat-item-title-row';

  const dot = document.createElement('div');
  dot.className = 'chat-item-dot';
  dot.setAttribute('aria-hidden', 'true');
  const dotCtx = getChatItemDotContext(sessionState?.activeId ?? null);
  applyChatItemDotClasses(dot, resolveChatItemDotState(chat, dotCtx), row);
  titleRow.appendChild(dot);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'chat-item-name';
  nameSpan.textContent = chat.name;
  titleRow.appendChild(nameSpan);

  if (!inGroup) {
    const agentAbbrev = workAgentSidebarAbbrev(chat.workAgentId);
    if (agentAbbrev) {
      const badge = document.createElement('span');
      badge.className = 'chat-item-agent-badge';
      badge.textContent = agentAbbrev;
      badge.title = `Work agent: ${chat.workAgentId}`;
      titleRow.appendChild(badge);
    }
  }

  const actions = document.createElement('div');
  actions.className = 'chat-item-actions';

  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'chat-rename-btn';
  renameBtn.textContent = '\u270E';
  renameBtn.setAttribute('aria-label', `Rename chat: ${chat.name}`);
  renameBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    beginRenameChat(chat.id, nameSpan, renameBtn, deleteBtn, actions);
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'chat-delete-btn';
  deleteBtn.textContent = '\u{1F5D1}';
  deleteBtn.setAttribute('aria-label', `Delete chat: ${chat.name}`);
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (options?.onDelete) {
      options.onDelete(chat);
      return;
    }
    deleteChat(chat.id, e);
  });

  actions.appendChild(renameBtn);
  actions.appendChild(deleteBtn);

  head.appendChild(titleRow);
  head.appendChild(actions);

  row.appendChild(head);
  if (!inGroup) {
    const modelEl = document.createElement('div');
    modelEl.className = 'chat-item-model';
    modelEl.textContent = chat.modelId || '\u2014';

    const statsEl = document.createElement('div');
    statsEl.className = 'chat-item-stats';
    const statsParts = [formatSidebarStatsPreview(chat.lastStats)];
    if (hasCodeChangeTotals(chat.codeChangeTotals)) {
      statsParts.push(formatCodeChangeTotalsText(chat.codeChangeTotals!));
    }
    statsEl.textContent = statsParts.filter(Boolean).join(' · ');

    row.appendChild(modelEl);
    row.appendChild(statsEl);
  }
  list.appendChild(row);
}

function groupHasStreamingChat(groupId: string, chats: Chat[]): boolean {
  return chats.some((c) => c.groupId === groupId && isChatStreaming(c.id));
}

function appendGroupHeader(
  list: HTMLElement,
  group: import('../types').ChatGroup,
  memberCount: number,
  streaming: boolean,
): void {
  const head = document.createElement('div');
  head.className = 'chat-group-header';
  const isActiveBoardFolder =
    Boolean(group.orchestrateBoard) &&
    sessionState?.activeBoardGroupId === group.id &&
    group.viewMode === 'board';
  if (group.orchestrateBoard) {
    head.classList.add('chat-group-header--has-board');
  }
  if (isActiveBoardFolder) {
    head.classList.add('active');
    head.setAttribute('aria-current', 'true');
  }
  head.dataset.groupId = group.id;
  head.title = group.name;
  head.setAttribute('aria-expanded', group.collapsed ? 'false' : 'true');

  const icon = document.createElement('span');
  icon.className = 'chat-group-header__icon';
  icon.setAttribute('aria-hidden', 'true');

  const caret = document.createElement('button');
  caret.type = 'button';
  caret.className = 'chat-group-header__caret';
  caret.setAttribute('aria-expanded', group.collapsed ? 'false' : 'true');
  caret.setAttribute(
    'aria-label',
    group.collapsed ? 'Expand group chats' : 'Collapse group chats',
  );
  caret.textContent = group.collapsed ? '▸' : '▾';
  caret.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleGroupCollapsed(group.id);
    renderSidebar();
  });

  const nameSpan = document.createElement('span');
  nameSpan.className = 'chat-group-header__name';
  nameSpan.textContent = group.name;

  const count = document.createElement('span');
  count.className = 'chat-group-header__count';
  count.textContent = String(memberCount);

  if (streaming) {
    const runDot = document.createElement('span');
    runDot.className = 'chat-group-header__running';
    runDot.title = 'Task running';
    head.appendChild(runDot);
  }

  head.appendChild(icon);
  head.appendChild(caret);
  head.appendChild(nameSpan);
  head.appendChild(count);

  head.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showGroupContextMenu(e.clientX, e.clientY, group.id, nameSpan);
  });

  if (group.orchestrateBoard) {
    head.addEventListener('click', (e) => {
      if ((e.target as Element).closest('.chat-group-header__caret')) return;
      openBoardGroup(group.id);
      renderSidebar();
      syncViewModeToggleFromActiveChat();
    });
  }

  list.appendChild(head);
}

function showGroupContextMenu(
  x: number,
  y: number,
  groupId: string,
  nameSpan: HTMLSpanElement,
): void {
  const existing = document.getElementById('chatGroupContextMenu');
  existing?.remove();

  const menu = document.createElement('div');
  menu.id = 'chatGroupContextMenu';
  menu.className = 'chat-group-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const renameItem = document.createElement('button');
  renameItem.type = 'button';
  renameItem.textContent = 'Rename';
  renameItem.addEventListener('click', () => {
    menu.remove();
    beginRenameGroup(groupId, nameSpan);
  });

  const deleteItem = document.createElement('button');
  deleteItem.type = 'button';
  deleteItem.textContent = 'Delete group';
  deleteItem.addEventListener('click', () => {
    menu.remove();
    if (!confirm('Delete this group? Chats will stay in the list, ungrouped.')) return;
    deleteGroup(groupId);
    renderSidebar();
  });

  menu.appendChild(renameItem);
  menu.appendChild(deleteItem);
  document.body.appendChild(menu);

  const close = (): void => {
    menu.remove();
    document.removeEventListener('click', close);
  };
  window.setTimeout(() => document.addEventListener('click', close), 0);
}

function beginRenameGroup(groupId: string, nameSpan: HTMLSpanElement): void {
  const groups = sessionState?.groups ?? [];
  const group = groups.find((g) => g.id === groupId);
  if (!group) return;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'chat-rename-input';
  inp.value = group.name;
  inp.maxLength = 80;
  nameSpan.replaceWith(inp);
  inp.focus();
  inp.select();
  const finish = (): void => {
    renameGroup(groupId, inp.value);
    inp.replaceWith(nameSpan);
    nameSpan.textContent = group.name;
    renderSidebar();
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') inp.blur();
    if (e.key === 'Escape') {
      inp.value = group.name;
      inp.blur();
    }
  });
  inp.addEventListener('blur', finish, { once: true });
}

/** Wire "+ New group" and chat drag-drop (call once at init). */
export function wireSidebarNewGroupButton(): void {
  void import('./sidebar-chat-dnd').then((m) => m.wireSidebarChatDragDrop());

  const btn = document.getElementById('btnNewChatGroup');
  if (!btn || btn.dataset.wired === '1') return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', () => {
    const g = createGroup('New group', getWorkspacePath());
    renderSidebar();
    const head = document.querySelector(
      `.chat-group-header[data-group-id="${g.id}"] .chat-group-header__name`,
    );
    if (head instanceof HTMLSpanElement) beginRenameGroup(g.id, head);
  });
}

/** Rebuild the session list in the left sidebar (workspace-scoped + Unassigned). */
export function renderSidebar(): void {
  if (isExpertScopeActive() && sessionState) {
    const expertId = getExpertScopeId();
    if (expertId) {
      renderExpertScopeHeader(expertId);
      renderExpertScopeChatList(expertId, getActiveChat().id);
    }
    void import('./global-bugs-page').then((m) => m.refreshGlobalBugsSidebarBadge());
    return;
  }

  const list = document.getElementById('chatList');
  if (!list || !sessionState) return;
  list.innerHTML = '';

  const ws = getWorkspacePath();
  const excludeAssistantChats = (chat: { workspacePath?: string }) =>
    !isChatsWorkspacePath(chat.workspacePath ?? '');
  const workspaceChats = getChatsForWorkspace(ws, sessionState)
    .filter((c) => !isHiddenFromMainSidebar(c))
    .filter(excludeAssistantChats);
  const groupedIds = new Set<string>();
  const highlightChatId = sidebarHighlightChatId();

  for (const group of getGroupsForWorkspace(ws)) {
    const members = workspaceChats.filter((c) => c.groupId === group.id);
    members.forEach((c) => groupedIds.add(c.id));
    appendGroupHeader(
      list,
      group,
      members.length,
      groupHasStreamingChat(group.id, workspaceChats),
    );
    if (!group.collapsed && members.length > 0) {
      const membersEl = document.createElement('div');
      membersEl.className = 'chat-group-members';
      membersEl.setAttribute('role', 'group');
      membersEl.setAttribute('aria-label', `${group.name} chats`);
      for (const chat of members) {
        appendChatRow(membersEl, chat, highlightChatId, { inGroup: true });
      }
      list.appendChild(membersEl);
    }
  }

  const ungrouped = workspaceChats.filter((c) => !groupedIds.has(c.id));
  for (const chat of ungrouped) {
    appendChatRow(list, chat, highlightChatId);
  }

  const unassigned = getUnassignedChats(sessionState)
    .filter((c) => !isHiddenFromMainSidebar(c))
    .filter(excludeAssistantChats);
  appendChatListSection(list, 'Unassigned', unassigned, highlightChatId);
  syncChatItemDotsInDom();
  void import('./global-bugs-page').then((m) => m.refreshGlobalBugsSidebarBadge());
}

function beginRenameChat(
  chatId: string,
  nameSpan: HTMLSpanElement,
  renameBtn: HTMLButtonElement,
  deleteBtn: HTMLButtonElement,
  actionsEl: HTMLDivElement
): void {
  const chat = sessionState!.chats.find((c) => c.id === chatId);
  if (!chat) return;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'chat-rename-input';
  inp.value = chat.name;
  inp.maxLength = 120;
  inp.setAttribute('aria-label', 'Chat title');
  nameSpan.replaceWith(inp);
  actionsEl.style.visibility = 'hidden';
  inp.focus();
  inp.select();

  const finish = () => {
    const v = inp.value.trim();
    if (v) chat.name = v;
    inp.replaceWith(nameSpan);
    nameSpan.textContent = chat.name;
    actionsEl.style.visibility = '';
    touchChat(chat);
    renderSidebar();
    scheduleSaveSessions();
  };

  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      inp.blur();
    }
    if (e.key === 'Escape') {
      inp.value = chat.name;
      inp.blur();
    }
  });
  inp.addEventListener('blur', finish, { once: true });
}

/** Refresh sidebar and main chat UI after removeChatById. */
function onChatRemoved(result: RemoveChatResult): void {
  if (!result.ok) return;
  if (result.activeChanged) {
    const active = result.activeChat;
    recordChatOpened(active.id);
    syncModelSelectForActiveChat();
    renderStatsForChat(active);
    if (isDesktopChatActive()) {
      void import('../os/desktop-chat').then((m) => m.activateDesktopChatSession(active.id));
    } else {
      renderChatFromHistory(active);
    }
  } else if (isDesktopChatActive()) {
    void import('../ui/desktop-chat-rail').then((m) => m.refreshDesktopChatRail());
  }
  renderSidebar();
  closeMobileSidebar();
}

export function deleteChat(chatId: string, evt?: Event): void {
  if (evt) evt.stopPropagation();
  if (isChatStreaming(chatId)) {
    setStatus('spin', 'Finish the current reply first');
    return;
  }
  const idx = sessionState!.chats.findIndex((c) => c.id === chatId);
  if (idx < 0) return;
  const victim = sessionState!.chats[idx];
  if (!confirm(`Delete "${victim.name}"? Messages in this chat cannot be recovered.`)) return;

  const { modelId } = readTopBarModelBinding();
  const result = removeChatById(chatId, modelId);
  onChatRemoved(result);
}

export function switchChat(id: string): void {
  if (isOrchestrateHubMounted()) {
    teardownOrchestrateHub();
  }
  if (sessionState?.activeId) {
    suspendOrchestratePlanScreenOnLeave(sessionState.activeId);
  }
  if (!sessionState || id === sessionState.activeId) {
    closeMobileSidebar();
    applySidebarVisuals();
    return;
  }
  const prevActiveId = sessionState.activeId;
  const leaving = prevActiveId
    ? sessionState.chats.find((c) => c.id === prevActiveId)
    : undefined;
  if (leaving) {
    maybeMarkChatUnreadAfterLeave(leaving);
  }
  const chat = sessionState.chats.find((c) => c.id === id);
  if (!chat) return;
  if (sessionState.activeBoardGroupId) {
    delete sessionState.activeBoardGroupId;
    const boardGroup = sessionState.groups?.find(
      (g) => g.id === chat.boardGroupId || g.id === chat.groupId,
    );
    if (boardGroup) boardGroup.viewMode = 'chat';
  }
  sessionState.activeId = id;
  chat.unread = false;
  recordChatOpened(id);
  syncModelSelectForActiveChat();
  renderChatFromHistory(chat);
  void import('../usage/code-change-backfill').then((m) =>
    m.ensureChatCodeChangeBackfillOnSwitch(chat).then(() => {
      updateCodeChangeStrip(chat);
      updateWorkspaceCodeChangeDisplay();
    }),
  );
  void bootGenerationResumeForChat(chat);
  renderStatsForChat(chat);
  syncModeSelectorFromActiveChat();
  syncThinkingControlFromActiveChat();
  void syncOrchestratePlanStripFromActiveChat();
  syncComposerPinnedSkillFromActiveChat();
  syncViewModeToggleFromActiveChat();
  syncWorkAgentDevFromActiveChat();
  syncReefWidgetSettingsFromActiveChat();
  onModelRoutingActiveChatChanged(chat.id);
  void refreshTerminalHistoryForActiveChat();
  syncComposerFromStreamingState();
  renderSidebar();
  scheduleSaveSessions();
  closeMobileSidebar();
  applySidebarVisuals();
  void import('../tools/stream-chat-dom').then((m) => m.remountStreamDomForChat(id));
}

export interface CreateChatWithModeOptions {
  modeId: ModeId;
  orchestratePlanPath?: string;
  initialUserMessage?: string;
}

export interface CreateChatWithModeResult {
  ok: boolean;
  chatId?: string;
  modeId?: ModeId;
  orchestratePlanPath?: string;
  error?: string;
}

/** Create and activate a chat with a preset operating mode (tool handoff). */
export function createChatWithMode(
  options: CreateChatWithModeOptions,
): CreateChatWithModeResult {
  const modeId = normalizeModeId(options.modeId);
  const { modelId, providerId } = readTopBarModelBinding();
  const chat = createEmptyChatObject(modelId);
  if (providerId) chat.providerId = providerId;
  chat.modeId = modeId;
  if (chat.workAgentAuto !== false) {
    const agent = getDefaultWorkAgentForMode(modeId);
    chat.workAgentId = agent?.id ?? null;
  }

  const defaultPin = buildDefaultPinnedSkillForNewChat();
  if (defaultPin) {
    chat.pinnedSkill = defaultPin;
  }

  const planPath = options.orchestratePlanPath?.trim();
  if (planPath) {
    const normalized = normalizeOrchestratePlanPath(planPath);
    if (normalized) chat.orchestratePlanPath = normalized;
  }

  const initial = options.initialUserMessage?.trim();
  if (initial) {
    chat.history.push({ role: 'user', content: initial });
    recordChatMessage(chat);
  }

  sessionState!.chats.unshift(chat);
  sessionState!.activeId = chat.id;
  if (!initial) touchChat(chat);
  recordChatOpened(chat.id);
  renderChatFromHistory(chat);
  void bootGenerationResumeForChat(chat);
  renderStatsForChat(chat);
  syncModeSelectorFromActiveChat();
  syncThinkingControlFromActiveChat();
  void syncOrchestratePlanStripFromActiveChat();
  syncComposerPinnedSkillFromActiveChat();
  syncViewModeToggleFromActiveChat();
  syncWorkAgentDevFromActiveChat();
  syncReefWidgetSettingsFromActiveChat();
  onModelRoutingActiveChatChanged(chat.id);
  void refreshTerminalHistoryForActiveChat();
  syncComposerFromStreamingState();
  renderSidebar();
  scheduleSaveSessions();
  closeMobileSidebar();
  applySidebarVisuals();

  return {
    ok: true,
    chatId: chat.id,
    modeId,
    orchestratePlanPath: chat.orchestratePlanPath,
  };
}

export function createChat(): void {
  createChatWithMode({ modeId: normalizeModeId(getActiveChat().modeId) });
}
