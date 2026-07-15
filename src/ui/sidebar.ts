import { isChatsWorkspacePath } from '../lib/chats-workspace';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import { isDesktopChatActive } from '../os/desktop-state';
import { isBoardSetupIncomplete } from '../chat/orchestrate/board-setup';
import { isChatStreaming } from '../chat/streaming-state';
import { stopGeneration } from '../chat/stop-generation';
import {
  createGroup,
  deleteGroup,
  findBoardGroupForPlanner,
  findGroupById,
  getActiveBoardGroup,
  getBoardGroupForChat,
  buildSortedWorkspaceSidebarEntries,
  getGroupsForWorkspace,
  listBoardGroupChatIds,
  openBoardGroup,
  renameGroup,
  toggleGroupCollapsed,
} from '../state/chat-groups';
import { createBoardCategoryIcon } from './board-category-icons';
import { isChatAppForeground } from './chat-mount';
import { syncComposerFromStreamingState } from './composer-send';
import { syncGoalActiveHint } from './goal-active-hint';
import { syncTodoPanel } from './todo-panel';
import {
  createEmptyChatObject,
  formatDraftChatSidebarName,
  getActiveChat,
  getSidebarListedChatsForWorkspace,
  getUnassignedChats,
  isEphemeralEmptyChat,
  isHiddenFromMainSidebar,
  onWorkspaceChanged,
  pruneEphemeralEmptyChats,
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
import type { BoardCategory, BoardTask, Chat, ChatGroup } from '../types';
import {
  applySidebarVisuals,
  closeMobileSidebar,
} from './layout';
import { bootGenerationResumeForChat } from '../chat/generation-resume';
import { resumeIncompleteToolBatchOnChatSwitch } from '../chat/incomplete-tool-resume';
import {
  renderChatFromHistory,
  renderStatsForChat,
  showCachedModelInfo,
} from './messages';
import { appendCodeChangeTotalsSpans, updateCodeChangeStrip } from './code-change-strip';
import { updateWorkspaceCodeChangeDisplay } from './workspace-code-change';
import { hasCodeChangeTotals } from '../usage/code-change-ledger';
import { getDefaultWorkAgentForMode } from '../agents/work-agent-registry';
import { syncModeSelectorFromActiveChat } from './mode-selector';
import { syncComposerReasoningEffortFromActiveChat } from './composer-reasoning-effort';
import { syncOrchestratePlanStripFromActiveChat } from './orchestrate-plan-selector';
import { syncComposerPinnedSkillFromActiveChat } from './composer-pinned-skill';
import { syncComposerRunTargetFromActiveChat } from './composer-run-target';
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
import { restoreChatColumnOnChatSelect } from './workspace-split-resize';
import { updateModelStateDot } from './model-state-dot';
import { syncModelSelectPicker } from './model-select-picker';
import {
  applyDefaultModelToChat,
  persistDefaultModelValue,
  readDefaultModelBinding,
} from './default-model';
import { syncActiveChatModelUi, onActiveChatModelChange } from './chat-model-ui';
import { setStatus } from './status';
import { formatSidebarStatsPreview } from './stats';
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
import { createModeMaskIcon, applyModeMaskIcon } from './mode-icons';
import { hasComposerDraft } from '../state/session-workspace-scope';
import {
  flushActiveComposerDraftBeforeNewChat,
  resetComposerForEphemeralReuse,
  switchComposerDraft,
} from './composer-draft';
import { isMainColumnOverlaySuppressingChatDom } from './main-column-overlay';

/** True when every task in a wave is complete (sidebar auto-collapse). */
function isWaveComplete(tasks: BoardTask[], waveId: number | string): boolean {
  const wt = tasks.filter((t) => t.wave === waveId);
  return wt.length > 0 && wt.every((t) => t.status === 'complete');
}

function toggleSidebarWaveCollapsed(group: ChatGroup, waveId: number | string): void {
  const wave = group.orchestrateBoard?.waves.find((w) => w.id === waveId);
  if (!wave) return;
  wave.collapsed = !(wave.collapsed ?? false);
  scheduleSaveSessions();
}

function appendWaveSubgroupHeader(
  container: HTMLElement,
  waveId: number | string,
  collapsed: boolean,
  onToggle: () => void,
): void {
  const head = document.createElement('div');
  head.className = 'chat-wave-subgroup-header';
  head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

  const caret = document.createElement('button');
  caret.type = 'button';
  caret.className = 'chat-wave-subgroup-header__caret';
  caret.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  caret.setAttribute(
    'aria-label',
    collapsed ? `Expand wave ${waveId} chats` : `Collapse wave ${waveId} chats`,
  );
  caret.textContent = collapsed ? '▸' : '▾';
  caret.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggle();
    renderSidebar();
  });

  const label = document.createElement('span');
  label.textContent = `Wave ${waveId}`;

  head.appendChild(caret);
  head.appendChild(label);
  container.appendChild(head);
}

function appendBoardGroupWaveMembers(
  membersEl: HTMLElement,
  group: ChatGroup,
  members: Chat[],
  highlightChatId: string | null,
): void {
  const board = group.orchestrateBoard;
  if (!board) return;

  const plannerId = group.plannerChatId?.trim();
  const taskById = new Map(board.tasks.map((t) => [t.id, t]));
  const rendered = new Set<string>();

  if (plannerId) {
    const planner = members.find((c) => c.id === plannerId);
    if (planner) {
      appendChatRow(membersEl, planner, highlightChatId, { inGroup: true, group });
      rendered.add(planner.id);
    }
  }

  for (const wave of board.waves) {
    const waveChats = members.filter((c) => {
      if (rendered.has(c.id)) return false;
      const taskId = c.boardTaskId?.trim();
      if (!taskId) return false;
      const task = taskById.get(taskId);
      return task?.wave === wave.id;
    });
    if (waveChats.length === 0) continue;

    const collapsed = isWaveComplete(board.tasks, wave.id) || (wave.collapsed ?? false);
    appendWaveSubgroupHeader(membersEl, wave.id, collapsed, () => {
      toggleSidebarWaveCollapsed(group, wave.id);
    });

    for (const chat of waveChats) rendered.add(chat.id);

    if (!collapsed) {
      const waveMembersEl = document.createElement('div');
      waveMembersEl.className = 'chat-wave-members';
      for (const chat of waveChats) {
        appendChatRow(waveMembersEl, chat, highlightChatId, { inGroup: true, group });
      }
      membersEl.appendChild(waveMembersEl);
    }
  }

  for (const chat of members) {
    if (rendered.has(chat.id)) continue;
    if (plannerId && chat.id === plannerId) continue;
    if (chat.boardTaskId?.trim()) continue;
    appendChatRow(membersEl, chat, highlightChatId, { inGroup: true, group });
  }
}

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

/** Refresh composer model UI from the active chat (default #modelSelect stays put). */
export function syncModelSelectForActiveChat(): void {
  syncActiveChatModelUi();
}

export { onActiveChatModelChange };

/** Global default model changed via header picker or menubar chip. */
export function onModelSelectChange(): void {
  const sel = document.getElementById('modelSelect') as HTMLSelectElement;
  persistDefaultModelValue(sel.value);
  updateModelStateDot(sel.value);
  updateModelLoadUnloadButtons();
  syncModelSelectPicker();
  showCachedModelInfo();
  void import('./composer-model-trigger').then((m) => m.syncComposerModelTriggers());
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
    syncComposerReasoningEffortFromActiveChat();
    void syncOrchestratePlanStripFromActiveChat();
    syncComposerPinnedSkillFromActiveChat();
    syncComposerRunTargetFromActiveChat();
    syncViewModeToggleFromActiveChat();
    syncWorkAgentDevFromActiveChat();
    syncReefWidgetSettingsFromActiveChat();
    onModelRoutingActiveChatChanged(activeChat.id);
    void import('./terminal-panel').then((m) => m.refreshTerminalHistoryForActiveChat());
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
  /** Board folder for resolving task category icons on in-group rows. */
  group?: import('../types').ChatGroup;
  /** Override default switchChat activation (e.g. Experts hub before shell opens). */
  onActivate?: (chat: Chat) => void;
  /** Override default deleteChat (e.g. Experts hub detail list refresh). */
  onDelete?: (chat: Chat) => void;
}

/** Board task category for a chat row (from group board state, not stored on Chat). */
function boardCategoryForChat(
  chat: Chat,
  group?: import('../types').ChatGroup,
): import('../types').BoardCategory | undefined {
  const taskId = chat.boardTaskId?.trim();
  if (!taskId || !group?.orchestrateBoard) return undefined;
  return group.orchestrateBoard.tasks.find((t) => t.id === taskId)?.category;
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
  const isDraftOnly = chat.history.length === 0 && hasComposerDraft(chat);
  const displayName = isDraftOnly ? formatDraftChatSidebarName(chat) : chat.name;
  const rowLabel = inGroup
    ? displayName
    : `${displayName}, ${modelLabel}${statsPreview ? `, ${statsPreview}` : ''}`;

  const row = document.createElement('div');
  row.dataset.chatId = chat.id;
  row.className =
    'chat-item-row' +
    (isActive ? ' active' : '') +
    (inGroup ? ' chat-item-row--in-group' : '') +
    (isSelected ? ' chat-item-row--selected' : '') +
    (isDraftOnly ? ' chat-item-row--draft' : '');
  row.setAttribute('role', 'listitem');
  row.setAttribute('aria-label', rowLabel);
  row.title = [displayName, modelLabel, statsPreview].filter(Boolean).join('\n');
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

  // Mode glyph: collapsed rail icon + compact marker beside name when expanded.
  const icon = createModeMaskIcon(chat.modeId, 'chat-item-icon mode-mask-icon');
  applyModeMaskIcon(icon, chat.modeId);
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
  nameSpan.textContent = displayName;
  if (isDraftOnly) {
    nameSpan.title = 'Unsent draft';
  }

  const boardCategory = inGroup ? boardCategoryForChat(chat, options?.group) : undefined;
  if (boardCategory) {
    const catIcon = createBoardCategoryIcon(boardCategory, 'chat-item-board-cat-icon');
    if (catIcon) titleRow.appendChild(catIcon);
  }
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
    const statsPreview = formatSidebarStatsPreview(chat.lastStats);
    const statsFrag = document.createDocumentFragment();
    if (statsPreview) {
      statsFrag.appendChild(document.createTextNode(statsPreview));
    }
    if (hasCodeChangeTotals(chat.codeChangeTotals)) {
      if (statsPreview) statsFrag.appendChild(document.createTextNode(' · '));
      appendCodeChangeTotalsSpans(statsFrag, chat.codeChangeTotals!);
    }
    statsEl.appendChild(statsFrag);

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

  if (group.orchestrateBoard || isBoardSetupIncomplete(group)) {
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
    const group = findGroupById(groupId);
    const isBoardGroup = Boolean(group?.orchestrateBoard);
    if (isBoardGroup) {
      const chatCount = group ? listBoardGroupChatIds(group, sessionState?.chats ?? []).length : 0;
      const chatLabel = chatCount === 1 ? '1 chat' : `${chatCount} chats`;
      if (
        !confirm(
          `Delete this board and ${chatLabel} inside it? This cannot be undone.`,
        )
      ) {
        return;
      }
      if (sessionState?.activeBoardGroupId === groupId) {
        exitBoardViewForNavigation();
      }
      for (const chatId of listBoardGroupChatIds(group, sessionState?.chats ?? [])) {
        if (isChatStreaming(chatId)) {
          stopGeneration(chatId, 'system');
        }
      }
    } else if (!confirm('Delete this group? Chats will stay in the list, ungrouped.')) {
      return;
    }
    const { modelId } = readDefaultModelBinding();
    const result = deleteGroup(groupId, { fallbackModelId: modelId });
    if (result.chatRemoval) {
      onChatRemoved({ ...result.chatRemoval, activeChanged: result.activeChanged });
    } else {
      renderSidebar();
      if (isOrchestrateHubMounted()) {
        refreshOrchestrateHubBoardList();
      }
    }
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
  const workspaceChats = getSidebarListedChatsForWorkspace(ws, sessionState)
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
        if (group.orchestrateBoard) {
          appendBoardGroupWaveMembers(membersEl, group, members, highlightChatId);
        } else {
          for (const chat of members) {
            appendChatRow(membersEl, chat, highlightChatId, { inGroup: true });
          }
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
    const { modelId } = readDefaultModelBinding();
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

  const isPlannerChat = normalizeModeId(chat.modeId) === 'orchestrate';
  let orchestrateItem: HTMLButtonElement | null = null;
  if (isPlannerChat) {
    orchestrateItem = document.createElement('button');
    orchestrateItem.type = 'button';
    orchestrateItem.textContent = 'Open in orchestrator';
    orchestrateItem.addEventListener('click', () => {
      menu.remove();
      const group = getBoardGroupForChat(chat) ?? findBoardGroupForPlanner(chat.id);
      if (group && (group.orchestrateBoard || isBoardSetupIncomplete(group))) {
        void import('../state/chat-groups').then((m) => m.openBoardGroup(group.id));
        return;
      }
      if (sessionState && sessionState.activeId !== chat.id) {
        switchChat(chat.id);
      }
      void import('./orchestrate-hub').then((m) => m.renderOrchestrateHub());
    });
  }

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
  if (orchestrateItem) menu.appendChild(orchestrateItem);
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

/** Render the active chat into the correct foreground shell (desktop / chat app / code). */
function paintActiveChatInForegroundShell(chat: Chat): void {
  if (isDesktopChatActive()) {
    void import('../os/desktop-chat').then((m) => m.activateDesktopChatSession(chat.id));
    return;
  }
  if (isChatAppForeground()) {
    renderChatFromHistory(chat, '#chatAppMessageCol');
    return;
  }
  if (document.getElementById('codeOverviewRoot')) {
    void import('./code-overview').then(({ closeCodeOverview }) => {
      closeCodeOverview({ skipNavigate: true, restoreChat: false });
      void import('../os/router').then(({ navigateToCodeChat }) => {
        navigateToCodeChat();
        renderChatFromHistory(chat);
      });
    });
    return;
  }
  renderChatFromHistory(chat);
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
  const victimLabel =
    victim.history.length === 0 && hasComposerDraft(victim)
      ? formatDraftChatSidebarName(victim)
      : victim.name;
  if (!confirm(`Delete "${victimLabel}"? Messages in this chat cannot be recovered.`)) return;

  const { modelId } = readDefaultModelBinding();
  const result = removeChatById(chatId, modelId);
  onChatRemoved(result);
}

export function switchChat(id: string): void {
  restoreChatColumnOnChatSelect();
  // Drop a blank preview that raced open after Code-entry collapse (MIN-434).
  void import('./preview-panel').then((m) => m.suppressStaleBlankPreviewOnChatSwitch());
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
  switchComposerDraft(prevActiveId, chat);
  syncModelSelectForActiveChat();
  paintActiveChatInForegroundShell(chat);
  void import('../usage/code-change-backfill').then((m) =>
    m.ensureChatCodeChangeBackfillOnSwitch(chat).then(() => {
      updateCodeChangeStrip(chat);
      updateWorkspaceCodeChangeDisplay();
    }),
  );
  void bootGenerationResumeForChat(chat);
  void resumeIncompleteToolBatchOnChatSwitch(chat);
  renderStatsForChat(chat);
  syncModeSelectorFromActiveChat();
  syncComposerReasoningEffortFromActiveChat();
  void syncOrchestratePlanStripFromActiveChat();
  syncComposerPinnedSkillFromActiveChat();
  syncComposerRunTargetFromActiveChat();
  syncViewModeToggleFromActiveChat();
  void import('./git-panel').then((m) => m.syncGitPanelFromOrchestrator());
  syncWorkAgentDevFromActiveChat();
  syncReefWidgetSettingsFromActiveChat();
  syncGoalActiveHint();
  syncTodoPanel();
  onModelRoutingActiveChatChanged(chat.id);
  void import('./terminal-panel').then((m) => m.refreshTerminalHistoryForActiveChat());
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

/** Apply operating mode and default work-agent binding on an existing chat row. */
function applyModeIdToChat(chat: Chat, modeId: ModeId): void {
  chat.modeId = modeId;
  if (chat.workAgentAuto !== false) {
    const agent = getDefaultWorkAgentForMode(modeId);
    chat.workAgentId = agent?.id ?? null;
  }
}

/** Board planners must not be repurposed when New chat requests a different mode. */
function isBoardAnchorChat(chat: Chat): boolean {
  if (findBoardGroupForPlanner(chat.id)) return true;
  return Boolean(chat.boardGroupId?.trim() && !chat.boardTaskId?.trim());
}

/** Sync composer chrome after reusing or retargeting the active chat row. */
function syncCreateChatChrome(chatId: string): void {
  syncModeSelectorFromActiveChat();
  syncComposerReasoningEffortFromActiveChat();
  void syncOrchestratePlanStripFromActiveChat();
  syncComposerPinnedSkillFromActiveChat();
  syncComposerRunTargetFromActiveChat();
  syncViewModeToggleFromActiveChat();
  syncWorkAgentDevFromActiveChat();
  syncReefWidgetSettingsFromActiveChat();
  onModelRoutingActiveChatChanged(chatId);
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

  const workspacePath = getWorkspacePath();
  const active = getActiveChat();
  flushActiveComposerDraftBeforeNewChat();

  const requestedMode = normalizeModeId(options.modeId);
  const sameWorkspace =
    normalizeWorkspacePath(active.workspacePath ?? '') === normalizeWorkspacePath(workspacePath);
  const canReuseEphemeral =
    !options.initialUserMessage?.trim() &&
    isEphemeralEmptyChat(active) &&
    sameWorkspace &&
    !isMainColumnOverlaySuppressingChatDom();

  if (canReuseEphemeral) {
    const activeMode = normalizeModeId(active.modeId);
    const needsNewChat = requestedMode !== activeMode && isBoardAnchorChat(active);
    if (!needsNewChat) {
      if (requestedMode !== activeMode) {
        applyModeIdToChat(active, requestedMode);
      }
      applyDefaultModelToChat(active);
      touchChat(active);
      resetComposerForEphemeralReuse();
      recordChatOpened(active.id);
      paintActiveChatInForegroundShell(active);
      syncCreateChatChrome(active.id);
      syncModelSelectForActiveChat();
      renderSidebar();
      scheduleSaveSessions();
      closeMobileSidebar();
      applySidebarVisuals();
      return {
        ok: true,
        chatId: active.id,
        modeId: requestedMode,
        orchestratePlanPath: active.orchestratePlanPath,
      };
    }
  }

  const modeId = requestedMode;
  const { modelId } = readDefaultModelBinding();
  const chat = createEmptyChatObject(modelId);
  applyDefaultModelToChat(chat);
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
  pruneEphemeralEmptyChats(sessionState!, chat.id);
  sessionState!.activeId = chat.id;
  if (!initial) resetComposerForEphemeralReuse();
  recordChatOpened(chat.id);
  paintActiveChatInForegroundShell(chat);
  void bootGenerationResumeForChat(chat);
  renderStatsForChat(chat);
  syncCreateChatChrome(chat.id);
  syncModelSelectForActiveChat();
  void import('./terminal-panel').then((m) => m.refreshTerminalHistoryForActiveChat());
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
