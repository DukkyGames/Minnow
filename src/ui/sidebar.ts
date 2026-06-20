import { isChatsWorkspacePath } from '../lib/chats-workspace';
import { isDesktopChatActive } from '../os/desktop-state';
import { decodeModelSelectKey, encodeModelSelectKey } from '../lib/model-select-key';
import { isChatStreaming } from '../chat/streaming-state';
import {
  createGroup,
  deleteGroup,
  getActiveBoardGroup,
  buildSortedWorkspaceSidebarEntries,
  getGroupsForWorkspace,
  openBoardGroup,
  renameGroup,
  toggleGroupCollapsed,
} from '../state/chat-groups';
import { isChatAppForeground } from './chat-mount';
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
import { isBoardViewActive, syncViewModeToggleFromActiveChat } from './view-mode-toggle';
import {
  isOrchestrateHubMounted,
  refreshOrchestrateHubBoardList,
  refreshOrchestrateHubPlanList,
  teardownOrchestrateHub,
} from './orchestrate-hub';
import { suspendOrchestratePlanScreenOnLeave } from './orchestrate-plan-screen';
import { exitBoardViewForNavigation } from './exit-board-view';
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
  applyGroupHeaderDotClasses,
  getChatItemDotContext,
  isChatItemDotVisible,
  maybeMarkChatUnreadAfterLeave,
  recordChatOpened,
  resolveChatItemDotState,
  resolveGroupHeaderDotState,
  syncChatItemDotsInDom,
} from './chat-item-dot';
import { acknowledgeChatViewed } from '../notifications/acknowledge';

// ─── Multi-select state ───────────────────────────────────────────────────────

const selectedChatIds = new Set<string>();
let lastSelectedChatId: string | null = null;

function clearChatSelection(): void {
  if (selectedChatIds.size === 0) return;
  selectedChatIds.clear();
  lastSelectedChatId = null;
  document.querySelectorAll<HTMLElement>('.chat-item-row--selected').forEach((el) => {
    el.classList.remove('chat-item-row--selected');
  });
}

function toggleChatSelected(chatId: string): void {
  if (selectedChatIds.has(chatId)) {
    selectedChatIds.delete(chatId);
  } else {
    selectedChatIds.add(chatId);
    lastSelectedChatId = chatId;
  }
  updateSelectionVisuals();
}

function selectRangeTo(toId: string): void {
  const list = document.getElementById('chatList');
  if (!list || !lastSelectedChatId) {
    selectedChatIds.add(toId);
    lastSelectedChatId = toId;
    updateSelectionVisuals();
    return;
  }
  const rows = [...list.querySelectorAll<HTMLElement>('.chat-item-row[data-chat-id]')];
  const fromIdx = rows.findIndex((r) => r.dataset.chatId === lastSelectedChatId);
  const toIdx = rows.findIndex((r) => r.dataset.chatId === toId);
  if (fromIdx < 0 || toIdx < 0) {
    selectedChatIds.add(toId);
    lastSelectedChatId = toId;
    updateSelectionVisuals();
    return;
  }
  const [lo, hi] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
  for (let i = lo; i <= hi; i++) {
    const id = rows[i].dataset.chatId;
    if (id) selectedChatIds.add(id);
  }
  updateSelectionVisuals();
}

function updateSelectionVisuals(): void {
  const list = document.getElementById('chatList');
  if (!list) return;
  list.querySelectorAll<HTMLElement>('.chat-item-row[data-chat-id]').forEach((row) => {
    row.classList.toggle('chat-item-row--selected', selectedChatIds.has(row.dataset.chatId ?? ''));
  });
}

// ─────────────────────────────────────────────────────────────────────────────

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
  clearChatSelection();
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
  const isSelected = selectedChatIds.has(chat.id);
  const inGroup = options?.inGroup === true;
  const modelLabel = chat.modelId || 'No model selected';
  const statsPreview = formatSidebarStatsPreview(chat.lastStats);
  const rowLabel = inGroup
    ? chat.name
    : `${chat.name}, ${modelLabel}${statsPreview ? `, ${statsPreview}` : ''}`;

  const row = document.createElement('div');
  row.dataset.chatId = chat.id;
  row.className =
    'chat-item-row' +
    (isActive ? ' active' : '') +
    (inGroup ? ' chat-item-row--in-group' : '') +
    (isSelected ? ' chat-item-row--selected' : '');
  row.setAttribute('role', 'listitem');
  row.setAttribute('aria-label', rowLabel);
  row.title = [chat.name, modelLabel, statsPreview].filter(Boolean).join('\n');
  row.tabIndex = 0;
  if (options?.draggable !== false) {
    row.draggable = true;
    row.classList.add('chat-item-row--draggable');
  }
  row.addEventListener('click', (e) => {
    if ((e.target as Element).closest('.chat-rename-input')) return;
    if (e.shiftKey) {
      e.preventDefault();
      selectRangeTo(chat.id);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      toggleChatSelected(chat.id);
      return;
    }
    clearChatSelection();
    lastSelectedChatId = chat.id;
    if (options?.onActivate) {
      options.onActivate(chat);
      return;
    }
    switchChat(chat.id);
  });
  row.addEventListener('keydown', (e) => {
    if ((e.target as Element).closest('.chat-rename-input')) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      clearChatSelection();
      lastSelectedChatId = chat.id;
      if (options?.onActivate) {
        options.onActivate(chat);
        return;
      }
      switchChat(chat.id);
    }
    if (e.key === 'Escape') {
      clearChatSelection();
    }
  });

  const head = document.createElement('div');
  head.className = 'chat-item-head';

  const titleRow = document.createElement('div');
  titleRow.className = 'chat-item-title-row';

  // Collapsed-rail chat bubble glyph (hidden in expanded sidebar via CSS).
  const icon = document.createElement('span');
  icon.className = 'chat-item-icon';
  icon.setAttribute('aria-hidden', 'true');
  titleRow.appendChild(icon);

  const dotCtx = getChatItemDotContext(sessionState?.activeId ?? null);
  const dotState = resolveChatItemDotState(chat, dotCtx);
  if (!inGroup) {
    const dot = document.createElement('div');
    dot.className = 'chat-item-dot';
    dot.setAttribute('aria-hidden', 'true');
    applyChatItemDotClasses(dot, dotState, row);
    titleRow.appendChild(dot);
  } else if (isChatItemDotVisible(dotState)) {
    row.dataset.dotState = dotState;
  }

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

  head.appendChild(titleRow);

  row.addEventListener('contextmenu', (e) => {
    if ((e.target as Element).closest('.chat-rename-input')) return;
    e.preventDefault();
    if (selectedChatIds.size > 1 && selectedChatIds.has(chat.id)) {
      showMultiSelectContextMenu(e.clientX, e.clientY, [...selectedChatIds]);
    } else {
      showChatItemContextMenu(e.clientX, e.clientY, chat, nameSpan, options);
    }
  });

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


function appendGroupHeader(
  list: HTMLElement,
  group: import('../types').ChatGroup,
  members: Chat[],
  memberCount: number,
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

  const dotCtx = getChatItemDotContext(sessionState?.activeId ?? null);
  applyGroupHeaderDotClasses(head, resolveGroupHeaderDotState(members, dotCtx));

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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectedChatIds.size > 0) clearChatSelection();
  });
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
  const highlightChatId = sidebarHighlightChatId();
  const sidebarEntries = buildSortedWorkspaceSidebarEntries(
    getGroupsForWorkspace(ws),
    workspaceChats,
  );

  for (const entry of sidebarEntries) {
    if (entry.kind === 'group') {
      const { group, members } = entry;
      appendGroupHeader(
        list,
        group,
        members,
        members.length,
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
      continue;
    }
    appendChatRow(list, entry.chat, highlightChatId);
  }

  const unassigned = getUnassignedChats(sessionState)
    .filter((c) => !isHiddenFromMainSidebar(c))
    .filter(excludeAssistantChats);
  appendChatListSection(list, 'Unassigned', unassigned, highlightChatId);
  syncChatItemDotsInDom();
  void import('./global-bugs-page').then((m) => m.refreshGlobalBugsSidebarBadge());
}

function showMultiSelectContextMenu(x: number, y: number, chatIds: string[]): void {
  const existing = document.getElementById('chatItemContextMenu');
  existing?.remove();

  const chats = chatIds
    .map((id) => sessionState?.chats.find((c) => c.id === id))
    .filter((c): c is Chat => c != null);
  if (!chats.length) return;

  const menu = document.createElement('div');
  menu.id = 'chatItemContextMenu';
  menu.className = 'chat-group-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const label = document.createElement('div');
  label.className = 'chat-context-menu__multi-label';
  label.textContent = `${chats.length} chats selected`;
  menu.appendChild(label);

  const eligible = chats.filter((c) => !isChatStreaming(c.id) && c.history.length > 0);
  const brainItem = document.createElement('button');
  brainItem.type = 'button';
  brainItem.textContent = `Add ${eligible.length} to Brain`;
  brainItem.disabled = eligible.length === 0;
  if (eligible.length === 0) {
    brainItem.title = 'No eligible chats (must have messages and not be streaming)';
  }
  brainItem.addEventListener('click', () => {
    menu.remove();
    clearChatSelection();
    void import('./chat-brain-capture').then(async (m) => {
      for (const chat of eligible) {
        await m.runChatBrainCapture(chat);
      }
    });
  });

  const sep = document.createElement('div');
  sep.className = 'chat-context-menu__sep';

  const deletable = chats.filter((c) => !isChatStreaming(c.id));
  const deleteItem = document.createElement('button');
  deleteItem.type = 'button';
  deleteItem.textContent = `Delete ${deletable.length} chat${deletable.length === 1 ? '' : 's'}`;
  deleteItem.className = 'chat-context-menu__item--danger';
  deleteItem.disabled = deletable.length === 0;
  deleteItem.addEventListener('click', () => {
    menu.remove();
    const n = deletable.length;
    if (!n) return;
    if (!confirm(`Delete ${n} chat${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
    const prevActiveId = sessionState?.activeId;
    clearChatSelection();
    const { modelId } = readTopBarModelBinding();
    let lastResult: ReturnType<typeof removeChatById> | null = null;
    for (const chat of deletable) {
      const r = removeChatById(chat.id, modelId);
      if (r.ok) lastResult = r;
    }
    const activeChanged = prevActiveId !== sessionState?.activeId;
    if (lastResult) {
      onChatRemoved({ ...lastResult, activeChanged });
    } else {
      renderSidebar();
    }
  });

  menu.appendChild(brainItem);
  menu.appendChild(sep);
  menu.appendChild(deleteItem);
  document.body.appendChild(menu);

  const close = (): void => {
    menu.remove();
    document.removeEventListener('click', close);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  window.setTimeout(() => {
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
  }, 0);
}

function chatBrainCaptureState(chat: Chat): { disabled: boolean; title: string } {
  const streaming = isChatStreaming(chat.id);
  const empty = chat.history.length === 0;
  if (streaming) {
    return { disabled: true, title: 'Wait for reply to finish' };
  }
  if (empty) {
    return { disabled: true, title: 'Chat has no messages' };
  }
  return { disabled: false, title: 'Add to Brain' };
}

function showChatItemContextMenu(
  x: number,
  y: number,
  chat: Chat,
  nameSpan: HTMLSpanElement,
  options?: Pick<AppendChatRowOptions, 'onDelete'>,
): void {
  const existing = document.getElementById('chatItemContextMenu');
  existing?.remove();

  const menu = document.createElement('div');
  menu.id = 'chatItemContextMenu';
  menu.className = 'chat-group-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const renameItem = document.createElement('button');
  renameItem.type = 'button';
  renameItem.textContent = 'Rename';
  renameItem.addEventListener('click', () => {
    menu.remove();
    beginRenameChat(chat.id, nameSpan);
  });

  const brainState = chatBrainCaptureState(chat);
  const brainItem = document.createElement('button');
  brainItem.type = 'button';
  brainItem.textContent = 'Add to Brain';
  brainItem.title = brainState.title;
  brainItem.disabled = brainState.disabled;
  brainItem.addEventListener('click', () => {
    menu.remove();
    if (brainState.disabled) return;
    void import('./chat-brain-capture').then((m) => m.runChatBrainCapture(chat));
  });

  const deleteItem = document.createElement('button');
  deleteItem.type = 'button';
  deleteItem.textContent = 'Delete';
  deleteItem.className = 'chat-context-menu__item--danger';
  deleteItem.addEventListener('click', () => {
    menu.remove();
    if (options?.onDelete) {
      options.onDelete(chat);
      return;
    }
    deleteChat(chat.id);
  });

  menu.appendChild(renameItem);
  menu.appendChild(brainItem);
  menu.appendChild(deleteItem);
  document.body.appendChild(menu);

  const close = (): void => {
    menu.remove();
    document.removeEventListener('click', close);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  window.setTimeout(() => {
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
  }, 0);
}

function beginRenameChat(chatId: string, nameSpan: HTMLSpanElement): void {
  const chat = sessionState!.chats.find((c) => c.id === chatId);
  if (!chat) return;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'chat-rename-input';
  inp.value = chat.name;
  inp.maxLength = 120;
  inp.setAttribute('aria-label', 'Chat title');
  nameSpan.replaceWith(inp);
  inp.focus();
  inp.select();

  const finish = () => {
    const v = inp.value.trim();
    if (v) chat.name = v;
    inp.replaceWith(nameSpan);
    nameSpan.textContent = chat.name;
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
  if (isOrchestrateHubMounted()) {
    refreshOrchestrateHubBoardList();
    // Deleting a planner chat can free its plan; refresh the dropdown too (MIN-215).
    void refreshOrchestrateHubPlanList();
  }
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
  if (!sessionState) {
    closeMobileSidebar();
    applySidebarVisuals();
    return;
  }

  const boardWasOpen = exitBoardViewForNavigation();

  if (id === sessionState.activeId) {
    acknowledgeChatViewed(id);
    if (boardWasOpen) {
      const sameChat = sessionState.chats.find((c) => c.id === id);
      if (sameChat) {
        renderChatFromHistory(sameChat);
        syncViewModeToggleFromActiveChat();
        renderSidebar();
        scheduleSaveSessions();
      }
    }
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
  sessionState.activeId = id;
  acknowledgeChatViewed(id);
  syncModelSelectForActiveChat();
  if (isDesktopChatActive()) {
    void import('../os/desktop-chat').then((m) => m.activateDesktopChatSession(id));
  } else if (isChatAppForeground()) {
    renderChatFromHistory(chat, '#chatAppMessageCol');
  } else {
    renderChatFromHistory(chat);
  }
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

/** Start an LLM turn when the user message was already pushed into history. */
async function kickoffSeededChatTurn(chat: Chat, message: string): Promise<void> {
  const { detectLocalServer } = await import('../tools/client');
  const { buildHistoryUserContent, runChatTurn } = await import('../tools/loop');
  const { isFirstUserMessagePending } = await import('../chat/titles/schedule');

  await detectLocalServer();
  await runChatTurn({
    chat,
    pushUser: false,
    rawText: message,
    userText: message,
    displayText: message,
    historyContent: buildHistoryUserContent(message, []),
    skillId: null,
    validAttachments: [],
    titleSeed: message,
    shouldScheduleTitle: isFirstUserMessagePending(chat),
    ownsGlobalStreaming: chat.id === getActiveChat().id,
  });
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
  if (isOrchestrateHubMounted()) {
    teardownOrchestrateHub();
  }
  if (sessionState?.activeId) {
    suspendOrchestratePlanScreenOnLeave(sessionState.activeId);
  }
  exitBoardViewForNavigation();

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

  if (initial) {
    void kickoffSeededChatTurn(chat, initial).catch(() => {
      /* runChatTurn surfaces inline errors */
    });
  }

  return {
    ok: true,
    chatId: chat.id,
    modeId,
    orchestratePlanPath: chat.orchestratePlanPath,
  };
}

export function createChat(): void {
  const active = getActiveChat();
  const leavingOrchestrate =
    isBoardViewActive() || normalizeModeId(active.modeId) === 'orchestrate';
  createChatWithMode({
    modeId: leavingOrchestrate ? 'general' : normalizeModeId(active.modeId),
  });
}
