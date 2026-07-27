/**
 * Planned-task detail panel on the Orchestrate board (build/test specs from board_init).
 */

import { deriveTaskCategoryBadge } from '../chat/orchestrate/task-category-badge';
import { listTaskRelatedChats } from '../chat/orchestrate/task-chats';
import { getChatsSortedByUpdatedDesc } from '../state/sessions';
import type { BoardTask, BoardTaskStatus, Chat, ChatGroup } from '../types';
import { createIcon } from './icon';

const PANEL_CLASS = 'board-task-plan-panel';
const MAIN_OPEN_CLASS = 'board-main--task-plan-open';

let selectedPlannedTaskId: string | null = null;

/** Task id shown in the plan detail panel, if any. */
export function getBoardTaskPlanSelection(): string | null {
  return selectedPlannedTaskId;
}

export function setBoardTaskPlanSelection(taskId: string | null): void {
  selectedPlannedTaskId = taskId?.trim() || null;
}

/** Planned-column cards open the inline plan panel instead of chat. */
export function taskCardOpensPlanPanel(status: BoardTaskStatus): boolean {
  return status === 'planned' || status === 'blocked';
}

/** Switch to the best task chat (primary, related, or planner). */
export function openBoardTaskChat(
  task: BoardTask,
  group: ChatGroup,
  plannerChat: Chat,
): void {
  const related = listTaskRelatedChats(
    task,
    group,
    getChatsSortedByUpdatedDesc(),
  );
  const targetId =
    task.chatId?.trim() ||
    related.find((row) => row.isPrimary)?.chatId ||
    related[0]?.chatId ||
    plannerChat.id;
  void import('./sidebar').then((m) => m.switchChat(targetId));
}

function findTaskOnBoard(
  board: NonNullable<ChatGroup['orchestrateBoard']>,
  taskId: string,
): BoardTask | undefined {
  return board.tasks.find((t) => t.id === taskId);
}

function clearCardSelection(main: HTMLElement): void {
  for (const el of main.querySelectorAll('.board-task-card--selected')) {
    el.classList.remove('board-task-card--selected');
  }
}

function markCardSelected(main: HTMLElement, taskId: string): void {
  clearCardSelection(main);
  const card = main.querySelector(
    `.board-task-card[data-board-task-id="${CSS.escape(taskId)}"]`,
  );
  card?.classList.add('board-task-card--selected');
}

function setMainPlanOpen(main: HTMLElement, open: boolean): void {
  main.classList.toggle(MAIN_OPEN_CLASS, open);
}

function hideBoardTaskPlanPanel(main: HTMLElement): void {
  setMainPlanOpen(main, false);
  const panel = main.querySelector(`.${PANEL_CLASS}`);
  panel?.classList.add('hidden');
  panel?.setAttribute('aria-hidden', 'true');
}

function buildSpecBlock(
  label: string,
  value: string,
  emptyFallback: string,
): HTMLElement {
  const block = document.createElement('section');
  block.className = 'board-task-plan-panel__block';

  const heading = document.createElement('h4');
  heading.className = 'board-task-plan-panel__block-label';
  heading.textContent = label;

  const body = document.createElement('pre');
  body.className = 'board-task-plan-panel__spec';
  body.textContent = value.trim() || emptyFallback;

  block.appendChild(heading);
  block.appendChild(body);
  return block;
}

function buildMetaRow(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'board-task-plan-panel__meta-row';

  const dt = document.createElement('span');
  dt.className = 'board-task-plan-panel__meta-label';
  dt.textContent = label;

  const dd = document.createElement('span');
  dd.className = 'board-task-plan-panel__meta-value';
  dd.textContent = value;

  row.appendChild(dt);
  row.appendChild(dd);
  return row;
}

function renderPanelContent(
  panel: HTMLElement,
  task: BoardTask,
  group: ChatGroup,
): void {
  panel.replaceChildren();

  const header = document.createElement('header');
  header.className = 'board-task-plan-panel__header';

  const titleRow = document.createElement('div');
  titleRow.className = 'board-task-plan-panel__title-row';

  const id = document.createElement('span');
  id.className = 'board-task-plan-panel__id';
  id.textContent = task.id;

  const categoryBadge = deriveTaskCategoryBadge(task);
  const chip = document.createElement('span');
  chip.className = `board-task-card__cat bt--${categoryBadge.cssVariant}`;
  chip.textContent = categoryBadge.label;

  titleRow.appendChild(id);
  titleRow.appendChild(chip);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'icon-btn board-task-plan-panel__close';
  closeBtn.setAttribute('aria-label', 'Close task plan');
  closeBtn.title = 'Close';
  closeBtn.appendChild(createIcon('close'));
  closeBtn.addEventListener('click', () => {
    setBoardTaskPlanSelection(null);
    const main = panel.closest('.board-main');
    if (main instanceof HTMLElement) {
      hideBoardTaskPlanPanel(main);
      clearCardSelection(main);
    }
  });

  header.appendChild(titleRow);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const title = document.createElement('h3');
  title.className = 'board-task-plan-panel__title';
  title.textContent = task.title;
  panel.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'board-task-plan-panel__meta';
  meta.appendChild(buildMetaRow('Wave', String(task.wave)));
  meta.appendChild(buildMetaRow('Status', task.status.replace(/_/g, ' ')));
  panel.appendChild(meta);

  panel.appendChild(buildSpecBlock('Build', task.buildSpec ?? '', '(see plan file)'));
  panel.appendChild(buildSpecBlock('Test', task.testSpec ?? '', '(see plan file)'));

  if (task.notes?.trim()) {
    panel.appendChild(buildSpecBlock('Notes', task.notes, ''));
  }

  const planPath =
    group.orchestratePlanPath?.trim() ||
    group.orchestrateBoard?.planPath?.trim() ||
    '';
  if (planPath) {
    const actions = document.createElement('div');
    actions.className = 'board-task-plan-panel__actions';
    const openPlan = document.createElement('button');
    openPlan.type = 'button';
    openPlan.className = 'board-btn board-btn--compact';
    openPlan.textContent = 'Open full plan';
    openPlan.addEventListener('click', () => {
      void import('./file-viewer').then((m) => m.openFileInViewer(planPath));
    });
    actions.appendChild(openPlan);
    panel.appendChild(actions);
  }
}

/** Show or update the planned-task detail panel in board main. */
export function showBoardTaskPlanPanel(
  main: HTMLElement,
  task: BoardTask,
  group: ChatGroup,
): void {
  setBoardTaskPlanSelection(task.id);
  let panel: HTMLElement | null = main.querySelector(`.${PANEL_CLASS}`);
  if (!(panel instanceof HTMLElement)) {
    panel = document.createElement('aside');
    panel.className = PANEL_CLASS;
    panel.dataset.boardTaskPlanPanel = '';
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', 'Task plan details');
    main.appendChild(panel);
  }
  renderPanelContent(panel, task, group);
  panel.classList.remove('hidden');
  panel.setAttribute('aria-hidden', 'false');
  setMainPlanOpen(main, true);
  markCardSelected(main, task.id);
}

/** Reconcile panel visibility after kanban refresh or task status changes. */
export function syncBoardTaskPlanPanel(
  main: HTMLElement,
  board: NonNullable<ChatGroup['orchestrateBoard']>,
  group: ChatGroup,
): void {
  const taskId = selectedPlannedTaskId;
  if (!taskId) {
    hideBoardTaskPlanPanel(main);
    return;
  }
  const task = findTaskOnBoard(board, taskId);
  if (!task || !taskCardOpensPlanPanel(task.status)) {
    setBoardTaskPlanSelection(null);
    hideBoardTaskPlanPanel(main);
    clearCardSelection(main);
    return;
  }
  showBoardTaskPlanPanel(main, task, group);
}
