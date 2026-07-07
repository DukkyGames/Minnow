/**
 * Orchestrate hub: top-bar entry for plan pick + recent boards (Vibe hub layout).
 */

import { PLACEHOLDER_CHAT_NAME } from '../constants';
import { mountPlanPreviewContent } from '../chat/orchestrate/plan-preview';
import {
  boardSetupStatusLabel,
} from '../chat/orchestrate/board-setup';
import {
  isExecutableOrchestratePlan,
} from '../chat/orchestrate/plan-path';
import { executeTool } from '../tools/client';
import { normalizeModeId } from '../chat/modes/types';
import {
  getGroupsForWorkspace,
  openBoardGroup,
} from '../state/chat-groups';
import { getBoardProgressPercent } from '../state/orchestrate-board-store';
import { getActiveChat, sessionState } from '../state/sessions';
import type { Chat, ChatGroup } from '../types';
import { getWorkspaceLabel, getWorkspacePath } from '../state/workspace';
import {
  populateOrchestratePlanSelect,
  persistOrchestratePlanPathFromSelectValue,
  shortPlanLabel,
} from './orchestrate-plan-picker';
import { setChatMode } from './mode-selector';
import { launchBoardFromPlan } from './orchestrate-launch';
import { switchChat } from './sidebar';
import { renderChatFromHistory } from './messages';
import { closeCodeOverview, isCodeOverviewOpen } from './code-overview';
import { teardownCodeBrainMapBeforeChatPaint } from './code-brain-map';
import { stripMainColumnOverlayClasses } from './main-column-overlay';
import { teardownHub } from './hub';
import {
  openOrchestratePlanScreen,
  teardownOrchestratePlanScreen,
} from './orchestrate-plan-screen';
export const ORCHESTRATE_HUB_ROOT_ID = 'orchestrateHub';
const ORCHESTRATE_HUB_RECENT_LIMIT = 9;

let hubReturnChatId: string | null = null;
/** Bumps on each preview fetch so stale read_file results are ignored. */
let hubPlanPreviewRequestId = 0;

export interface OrchestrateHubPlanPreviewElements {
  section: HTMLElement;
  pathChip: HTMLElement;
  previewMount: HTMLElement;
}

/**
 * Load and render the selected plan file into the hub preview panel (plan screen parity).
 */
export async function refreshOrchestrateHubPlanPreview(
  planPath: string,
  elements: OrchestrateHubPlanPreviewElements,
): Promise<void> {
  const trimmed = planPath.trim();
  if (!trimmed || !isExecutableOrchestratePlan(trimmed)) {
    elements.section.hidden = true;
    elements.pathChip.textContent = '';
    elements.pathChip.removeAttribute('title');
    elements.previewMount.replaceChildren();
    return;
  }

  const requestId = (hubPlanPreviewRequestId += 1);
  elements.section.hidden = false;
  elements.pathChip.textContent = shortPlanLabel(trimmed);
  elements.pathChip.title = trimmed;
  elements.previewMount.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'orchestrate-hub__plan-preview-loading';
  loading.textContent = 'Loading plan…';
  elements.previewMount.appendChild(loading);

  try {
    const result = await executeTool('read_file', { path: trimmed });
    if (requestId !== hubPlanPreviewRequestId) return;
    mountPlanPreviewContent(elements.previewMount, result.content, { modeId: 'plan' });
  } catch {
    if (requestId !== hubPlanPreviewRequestId) return;
    elements.previewMount.replaceChildren();
    const err = document.createElement('p');
    err.className = 'orchestrate-plan-screen__preview-empty';
    err.textContent = 'Could not load plan file.';
    elements.previewMount.appendChild(err);
  }
}

/** True when the orchestrate hub is mounted in #chatArea. */
export function isOrchestrateHubMounted(): boolean {
  return Boolean(document.getElementById(ORCHESTRATE_HUB_ROOT_ID));
}

function syncTopBarOrchestrateButton(): void {
  if (typeof document === 'undefined') return;
  const btn = document.getElementById('btnOrchestrate');
  if (!btn) return;
  const open = isOrchestrateHubMounted();
  btn.setAttribute('aria-pressed', open ? 'true' : 'false');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  btn.classList.toggle('icon-btn--active', open);
}

/** Remove orchestrate hub chrome and restore the prior chat view. */
export function teardownOrchestrateHub(): void {
  if (typeof document === 'undefined') {
    hubReturnChatId = null;
    return;
  }
  const root = document.getElementById(ORCHESTRATE_HUB_ROOT_ID);
  if (root) root.remove();
  document.getElementById('chatArea')?.classList.remove('chat-area--orchestrate-hub');
  hubReturnChatId = null;
  syncTopBarOrchestrateButton();
}

function formatRelativeTime(ts: number): string {
  if (!ts) return '—';
  const delta = Date.now() - ts;
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Workspace folders that have an orchestrate board or plan path. */
export function listWorkspaceOrchestrateBoardGroups(
  workspacePath: string,
): ChatGroup[] {
  if (!sessionState) return [];
  return getGroupsForWorkspace(workspacePath)
    .filter(
      (group) =>
        Boolean(group.orchestrateBoard) || Boolean(group.orchestratePlanPath?.trim()),
    )
    .sort((a, b) => boardGroupSortKey(b) - boardGroupSortKey(a));
}

/** @deprecated Use {@link listWorkspaceOrchestrateBoardGroups}. */
export function listWorkspaceOrchestrateBoardChats(workspacePath: string): Chat[] {
  return listWorkspaceOrchestrateBoardGroups(workspacePath)
    .map((group) =>
      group.plannerChatId
        ? sessionState?.chats.find((c) => c.id === group.plannerChatId)
        : undefined,
    )
    .filter((c): c is Chat => Boolean(c));
}

function boardGroupSortKey(group: ChatGroup): number {
  const boardUpdated = group.orchestrateBoard?.lastUpdatedAt;
  if (typeof boardUpdated === 'number' && boardUpdated > 0) return boardUpdated;
  return group.createdAt;
}

function boardTileMetrics(group: ChatGroup): string[] {
  const board = group.orchestrateBoard;
  if (!board) {
    const plan = group.orchestratePlanPath?.trim();
    return plan ? [shortPlanLabel(plan)] : ['Plan selected'];
  }
  const total = board.tasks.length;
  const pct = getBoardProgressPercent(board);
  if (!total) return ['0 tasks'];
  return [`${pct}%`, `${total} task${total === 1 ? '' : 's'}`];
}

function boardTileTitle(group: ChatGroup): string {
  const plan = group.orchestratePlanPath?.trim();
  if (plan) return shortPlanLabel(plan);
  if (group.name?.trim()) return group.name.trim();
  return PLACEHOLDER_CHAT_NAME;
}

/** Join board stats for list row copy and aria labels. */
function formatBoardStatsLine(metrics: string[]): string {
  if (!metrics.length) return '';
  return metrics.join(' · ');
}

function openBoardGroupFromHub(groupId: string, plannerChatId?: string): void {
  teardownOrchestrateHub();
  if (!sessionState) return;
  if (plannerChatId && sessionState.activeId !== plannerChatId) {
    switchChat(plannerChatId);
  }
  const chat = getActiveChat();
  if (normalizeModeId(chat.modeId) !== 'orchestrate') {
    setChatMode('orchestrate');
  }
  openBoardGroup(groupId);
}

function startBoardFromHub(planSelect: HTMLSelectElement): void {
  const path = planSelect.value.trim();
  if (!path || !isExecutableOrchestratePlan(path)) return;
  teardownOrchestrateHub();
  launchBoardFromPlan(path);
}

/** Re-render recent boards when session groups change (e.g. planner chat deleted). */
export function refreshOrchestrateHubBoardList(): void {
  const container = document.getElementById('orchestrateHubBoardsRow');
  if (container) renderBoardList(container);
}

/**
 * Re-populate the hub plan dropdown from the workspace. Called when session chats
 * change (e.g. a planner chat is deleted) so the plan list updates without the user
 * having to press Refresh (MIN-215). No-op when the hub is not mounted.
 */
export async function refreshOrchestrateHubPlanList(): Promise<void> {
  if (!isOrchestrateHubMounted()) return;
  const sel = document.getElementById('orchestrateHubPlanSelect');
  const hint = document.getElementById('orchestrateHubPlanHint');
  if (!(sel instanceof HTMLSelectElement) || !(hint instanceof HTMLElement)) return;
  await loadHubPlans(sel, hint, getActiveChat());
  const startBtn = document.getElementById('orchestrateHubStartBoard');
  if (startBtn instanceof HTMLButtonElement) {
    const path = sel.value.trim();
    startBtn.disabled = !path || !isExecutableOrchestratePlan(path);
  }
  const section = document.getElementById('orchestrateHubPlanPreview');
  const pathChip = document.getElementById('orchestrateHubPlanPreviewPath');
  const previewMount = document.getElementById('orchestrateHubPlanPreviewMount');
  if (
    section instanceof HTMLElement &&
    pathChip instanceof HTMLElement &&
    previewMount instanceof HTMLElement
  ) {
    await refreshOrchestrateHubPlanPreview(sel.value, { section, pathChip, previewMount });
  }
}

function renderBoardList(container: HTMLElement): void {
  container.replaceChildren();
  const workspacePath = getWorkspacePath();
  const boards = listWorkspaceOrchestrateBoardGroups(workspacePath).slice(
    0,
    ORCHESTRATE_HUB_RECENT_LIMIT,
  );
  const countEl = document.querySelector('.orchestrate-hub__board-count');
  const total = listWorkspaceOrchestrateBoardGroups(workspacePath).length;
  if (countEl) {
    countEl.textContent =
      total === 0 ? 'None yet' : `${total} in workspace`;
  }

  if (!boards.length) {
    const empty = document.createElement('div');
    empty.className = 'orchestrate-hub__board-empty';
    empty.setAttribute('role', 'status');

    const title = document.createElement('p');
    title.className = 'orchestrate-hub__board-empty-title';
    title.textContent = 'No boards in this workspace yet';

    const hint = document.createElement('p');
    hint.className = 'orchestrate-hub__board-empty-hint';
    hint.textContent = 'Choose a plan above, or draft one with Make a plan.';

    const focusBtn = document.createElement('button');
    focusBtn.type = 'button';
    focusBtn.className = 'orchestrate-hub__board-empty-action';
    focusBtn.textContent = 'Choose a plan';
    focusBtn.addEventListener('click', () => {
      document.getElementById('orchestrateHubPlanSelect')?.focus();
    });

    empty.append(title, hint, focusBtn);
    container.appendChild(empty);
    return;
  }

  for (const group of boards) {
    const title = boardTileTitle(group);
    const when = formatRelativeTime(boardGroupSortKey(group));
    const metrics = boardTileMetrics(group);
    const statsLine = formatBoardStatsLine(metrics);
    const statusLabel = group.orchestrateBoard ? 'Board' : boardSetupStatusLabel(group);
    const board = group.orchestrateBoard;
    const taskCount = board?.tasks.length ?? 0;
    const progressPct = board ? getBoardProgressPercent(board) : 0;
    const showProgress = Boolean(board && taskCount > 0);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'orchestrate-hub__board-row';
    row.setAttribute('role', 'listitem');

    const main = document.createElement('div');
    main.className = 'orchestrate-hub__board-row-main';

    const titleEl = document.createElement('span');
    titleEl.className = 'orchestrate-hub__board-row-title';
    titleEl.textContent = title;

    const chip = document.createElement('span');
    chip.className = 'orchestrate-hub__board-row-chip';
    chip.textContent = statusLabel;

    main.append(titleEl, chip);

    const meta = document.createElement('div');
    meta.className = 'orchestrate-hub__board-row-meta';

    const whenEl = document.createElement('span');
    whenEl.className = 'orchestrate-hub__board-row-when';
    whenEl.textContent = when;

    const statsEl = document.createElement('span');
    statsEl.className = 'orchestrate-hub__board-row-stats';
    statsEl.textContent = statsLine || '—';

    meta.append(whenEl, statsEl);
    row.append(main, meta);

    if (showProgress) {
      const track = document.createElement('div');
      track.className = 'orchestrate-hub__board-progress';
      track.setAttribute('role', 'progressbar');
      track.setAttribute('aria-valuemin', '0');
      track.setAttribute('aria-valuemax', '100');
      track.setAttribute('aria-valuenow', String(progressPct));
      track.setAttribute(
        'aria-label',
        `${progressPct}% complete, ${taskCount} task${taskCount === 1 ? '' : 's'}`,
      );

      const fill = document.createElement('div');
      fill.className = 'orchestrate-hub__board-progress-fill';
      fill.style.width = `${progressPct}%`;
      track.appendChild(fill);
      row.appendChild(track);
    }

    row.setAttribute(
      'aria-label',
      `${title}, ${statusLabel}, updated ${when}${statsLine ? `, ${statsLine}` : ''}`,
    );
    row.addEventListener('click', () =>
      openBoardGroupFromHub(group.id, group.plannerChatId),
    );
    container.appendChild(row);
  }
}

async function loadHubPlans(
  sel: HTMLSelectElement,
  hint: HTMLElement,
  chat: Chat,
): Promise<void> {
  await populateOrchestratePlanSelect(sel, hint, chat, {
    autoSelectSingle: false,
  });
}

function buildOrchestrateHubDom(): HTMLElement {
  const root = document.createElement('div');
  root.id = ORCHESTRATE_HUB_ROOT_ID;
  root.className = 'hub-root orchestrate-hub-root';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Orchestrate boards');

  const inner = document.createElement('div');
  inner.className = 'hub-inner orchestrate-hub__inner';

  const header = document.createElement('header');
  header.className = 'orchestrate-hub__header';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'orchestrate-hub__eyebrow';
  eyebrow.textContent = 'Orchestrate';

  const heading = document.createElement('h1');
  heading.className = 'orchestrate-hub__title';
  heading.textContent = 'Boards & plans';

  const lede = document.createElement('p');
  lede.className = 'orchestrate-hub__lede';
  lede.textContent =
    'Open a plan-backed board or resume work already linked to this workspace.';

  const workspaceLine = document.createElement('p');
  workspaceLine.id = 'orchestrateHubWorkspace';
  workspaceLine.className = 'orchestrate-hub__workspace';
  const workspaceLabel = getWorkspaceLabel().trim();
  const workspacePath = getWorkspacePath().trim();
  const workspaceDisplay = workspaceLabel || workspacePath;
  if (workspaceDisplay) {
    workspaceLine.textContent = workspaceDisplay;
    if (workspacePath && workspacePath !== workspaceDisplay) {
      workspaceLine.title = workspacePath;
    }
  } else {
    workspaceLine.classList.add('hidden');
    workspaceLine.setAttribute('aria-hidden', 'true');
  }

  header.append(eyebrow, heading, lede, workspaceLine);

  const workflow = document.createElement('section');
  workflow.className = 'orchestrate-hub__workflow';
  workflow.setAttribute('aria-labelledby', 'orchestrateHubPlanLabel');

  const workflowHead = document.createElement('div');
  workflowHead.className = 'orchestrate-hub__workflow-head';

  const planLabel = document.createElement('span');
  planLabel.id = 'orchestrateHubPlanLabel';
  planLabel.className = 'hub-strip__label';
  planLabel.textContent = 'Start from plan';

  workflowHead.appendChild(planLabel);

  const workflowBody = document.createElement('div');
  workflowBody.className = 'orchestrate-hub__workflow-body';

  const sel = document.createElement('select');
  sel.id = 'orchestrateHubPlanSelect';
  sel.className = 'orchestrate-hub__plan-select';
  sel.setAttribute('aria-label', 'Orchestrate plan file');

  const workflowActions = document.createElement('div');
  workflowActions.className = 'orchestrate-hub__workflow-actions';

  const secondaryActions = document.createElement('div');
  secondaryActions.className = 'orchestrate-hub__workflow-secondary';

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'orchestrate-hub__plan-refresh';
  refreshBtn.id = 'orchestrateHubPlanRefresh';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.title = 'Reload plan list from workspace';

  const makePlanBtn = document.createElement('button');
  makePlanBtn.type = 'button';
  makePlanBtn.className = 'orchestrate-hub__make-plan-btn';
  makePlanBtn.id = 'orchestrateHubMakePlan';
  makePlanBtn.textContent = 'Make a plan';

  secondaryActions.append(refreshBtn, makePlanBtn);

  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'orchestrate-hub__start-btn';
  startBtn.id = 'orchestrateHubStartBoard';
  startBtn.textContent = 'Open board';

  workflowActions.append(secondaryActions, startBtn);
  workflowBody.append(sel, workflowActions);

  const hint = document.createElement('p');
  hint.id = 'orchestrateHubPlanHint';
  hint.className = 'orchestrate-hub__plan-hint hidden';
  hint.setAttribute('role', 'status');

  const previewSection = document.createElement('div');
  previewSection.id = 'orchestrateHubPlanPreview';
  previewSection.className = 'orchestrate-hub__plan-preview';
  previewSection.hidden = true;
  previewSection.setAttribute('aria-live', 'polite');

  const pathChip = document.createElement('p');
  pathChip.className = 'orchestrate-plan-screen__path';
  pathChip.id = 'orchestrateHubPlanPreviewPath';

  const previewWrap = document.createElement('div');
  previewWrap.className = 'orchestrate-plan-screen__preview-wrap';

  const previewMount = document.createElement('div');
  previewMount.className = 'orchestrate-plan-screen__preview';
  previewMount.id = 'orchestrateHubPlanPreviewMount';
  previewWrap.appendChild(previewMount);
  previewSection.append(pathChip, previewWrap);

  const previewElements: OrchestrateHubPlanPreviewElements = {
    section: previewSection,
    pathChip,
    previewMount,
  };

  workflow.append(workflowHead, workflowBody, hint, previewSection);

  const boardsSection = document.createElement('section');
  boardsSection.className = 'orchestrate-hub__boards';
  boardsSection.setAttribute('aria-labelledby', 'orchestrateHubBoardsLabel');

  const boardsHead = document.createElement('div');
  boardsHead.className = 'orchestrate-hub__boards-head';

  const boardsLabel = document.createElement('span');
  boardsLabel.id = 'orchestrateHubBoardsLabel';
  boardsLabel.className = 'hub-strip__label';
  boardsLabel.textContent = 'Recent boards';

  const boardCount = document.createElement('span');
  boardCount.className = 'orchestrate-hub__board-count';
  boardCount.textContent = 'None yet';

  boardsHead.append(boardsLabel, boardCount);

  const boardsList = document.createElement('div');
  boardsList.className = 'orchestrate-hub__board-list';
  boardsList.id = 'orchestrateHubBoardsRow';
  boardsList.setAttribute('role', 'list');

  boardsSection.append(boardsHead, boardsList);

  inner.append(header, workflow, boardsSection);
  root.appendChild(inner);

  const chat = getActiveChat();

  const syncStartDisabled = () => {
    const path = sel.value.trim();
    startBtn.disabled = !path || !isExecutableOrchestratePlan(path);
  };

  const syncPlanPreview = () => {
    void refreshOrchestrateHubPlanPreview(sel.value, previewElements);
  };

  sel.addEventListener('change', () => {
    persistOrchestratePlanPathFromSelectValue(getActiveChat(), sel.value);
    syncStartDisabled();
    syncPlanPreview();
  });

  refreshBtn.addEventListener('click', () => {
    void loadHubPlans(sel, hint, getActiveChat()).then(() => {
      syncStartDisabled();
      syncPlanPreview();
    });
  });

  makePlanBtn.addEventListener('click', () => {
    teardownOrchestrateHub();
    void openOrchestratePlanScreen();
  });

  startBtn.addEventListener('click', () => startBoardFromHub(sel));

  void loadHubPlans(sel, hint, chat).then(() => {
    syncStartDisabled();
    syncPlanPreview();
  });
  renderBoardList(boardsList);

  return root;
}

/** Paint orchestrate hub into #chatArea (replaces current main view). */
export function renderOrchestrateHub(): void {
  teardownOrchestratePlanScreen();
  teardownHub();
  teardownCodeBrainMapBeforeChatPaint();
  if (isCodeOverviewOpen()) {
    closeCodeOverview({ skipNavigate: true, restoreChat: false });
  }
  const area = document.getElementById('chatArea');
  if (!area) return;
  if (!hubReturnChatId && sessionState?.activeId) {
    hubReturnChatId = sessionState.activeId;
  }
  area.replaceChildren();
  area.appendChild(buildOrchestrateHubDom());
  stripMainColumnOverlayClasses();
  area.classList.add('chat-area--orchestrate-hub');
  // Board view stays in chat state; hide board chrome while the hub overlay is open.
  document.getElementById('mainColumn')?.classList.remove('main-column--board-view');
  syncTopBarOrchestrateButton();
}

/** Close hub and restore the chat that was active when the hub opened. */
export function closeOrchestrateHub(): void {
  if (!isOrchestrateHubMounted()) return;
  const returnId = hubReturnChatId;
  teardownOrchestrateHub();
  if (!sessionState) return;
  const targetId =
    returnId && sessionState.chats.some((c) => c.id === returnId)
      ? returnId
      : sessionState.activeId;
  const chat = sessionState.chats.find((c) => c.id === targetId);
  if (chat) renderChatFromHistory(chat);
}

/** Toggle orchestrate hub from the top bar. */
export function toggleOrchestrateHubFromTopbar(): void {
  if (isOrchestrateHubMounted()) {
    closeOrchestrateHub();
    return;
  }
  renderOrchestrateHub();
}

/** Wire top-bar button (idempotent). */
export function initOrchestrateHub(): void {
  syncTopBarOrchestrateButton();
}

/** Clear hub state between tests. */
export function resetOrchestrateHubForTests(): void {
  hubReturnChatId = null;
  hubPlanPreviewRequestId = 0;
  teardownOrchestrateHub();
}
