/**
 * Drag-and-drop for orchestrate kanban cards (Phase 3.1).
 *
 * Columns are derived from task status, so a drop is a status transition — the
 * same transitions the deleted per-card status buttons used to fire. The drag
 * idiom (module-level active-drag descriptor, because `dragover` cannot read
 * `getData`) is lifted from `issues-page.ts`, and matches `sidebar-chat-dnd.ts`
 * and `file-tree-dnd.ts`.
 */

import { hasPipelineHold } from '../state/orchestrate-pipeline-holds.ts';
import {
  moveTaskStatus,
  requeueBoardTask,
  startTask,
  startTaskTesting,
} from '../state/orchestrate-board-actions.ts';
import { isChatStreaming } from '../chat/streaming-state.ts';
import { appConfirm } from './app-dialog.ts';
import type { BoardTask, Chat, ChatGroup } from '../types.ts';

const TASK_DRAG_MIME = 'application/x-minnow-board-task-id';

/** `dragover` cannot read `getData`, so the payload lives here for the drag's life. */
let activeTaskDrag: { taskId: string; fromColumn: string } | null = null;

/** Kanban column ids that accept a drop (mirrors `getKanbanColumnDefs`). */
export type KanbanColumnId = 'planned' | 'in_progress' | 'testing' | 'complete';

function asColumnId(value: string | null | undefined): KanbanColumnId | null {
  return value === 'planned' || value === 'in_progress' || value === 'testing' || value === 'complete'
    ? value
    : null;
}

/**
 * A `merging` task is mid-git-merge with a fixer possibly attached; yanking its
 * status out from under that corrupts the merge queue. Reconcile merge is the
 * supported way out.
 */
export function isBoardTaskDraggable(task: BoardTask): boolean {
  return task.status !== 'merging';
}

/** True when moving this task would interrupt work that is currently running. */
export function boardTaskDragDisrupts(task: BoardTask, group: ChatGroup): boolean {
  const streaming = [task.chatId, task.testChatId, task.fixerChatId].some((id) => {
    const trimmed = id?.trim();
    return Boolean(trimmed && isChatStreaming(trimmed));
  });
  if (streaming) return true;
  return hasPipelineHold(group.orchestrateBoard, task.id);
}

/**
 * What a drop into `column` means for a task currently in `task.status`.
 * `null` when the drop is a no-op (same lane) or not a supported transition.
 */
export function resolveBoardDropAction(
  task: BoardTask,
  column: KanbanColumnId,
): 'start' | 'test' | 'complete' | 'requeue' | 'plan' | null {
  const status = task.status;
  switch (column) {
    case 'in_progress':
      return status === 'in_progress' || status === 'merging' ? null : 'start';
    case 'testing':
      return status === 'testing' ? null : 'test';
    case 'complete':
      return status === 'complete' ? null : 'complete';
    case 'planned':
      if (status === 'planned') return null;
      // Coming back from a terminal lane is a real requeue: attempt counters and
      // quarantine payload have to clear or the task re-fails immediately.
      if (status === 'complete' || status === 'failed' || status === 'quarantined') {
        return 'requeue';
      }
      return 'plan';
    default:
      return null;
  }
}

function describeDropAction(action: NonNullable<ReturnType<typeof resolveBoardDropAction>>): string {
  if (action === 'start') return 'start it';
  if (action === 'test') return 'move it to testing';
  if (action === 'complete') return 'mark it complete';
  if (action === 'requeue') return 'requeue it';
  return 'move it back to planned';
}

/**
 * Apply a column drop. Shared by drag-and-drop and the keyboard bindings so both
 * routes take exactly the same path (including the disruption confirm).
 */
export async function applyBoardTaskDrop(
  group: ChatGroup,
  taskId: string,
  column: KanbanColumnId,
  plannerChat: Chat,
): Promise<boolean> {
  const board = group.orchestrateBoard;
  const task = board?.tasks.find((t) => t.id === taskId);
  if (!board || !task || !isBoardTaskDraggable(task)) return false;

  const action = resolveBoardDropAction(task, column);
  if (!action) return false;

  if (boardTaskDragDisrupts(task, group)) {
    const ok = await appConfirm(
      `${task.id} is running. Moving it will stop the run and ${describeDropAction(action)}.`,
      { title: 'Move running task?', confirmLabel: 'Move it', danger: true },
    );
    if (!ok) return false;
  }

  switch (action) {
    case 'start':
      await startTask(group, taskId, plannerChat);
      return true;
    case 'test':
      // startTaskTesting refuses anything not already in `testing`.
      moveTaskStatus(group, taskId, 'testing', plannerChat);
      await startTaskTesting(group, taskId, plannerChat);
      return true;
    case 'complete':
      moveTaskStatus(group, taskId, 'complete', plannerChat);
      return true;
    case 'requeue':
      await requeueBoardTask(group, taskId, plannerChat);
      return true;
    case 'plan':
      moveTaskStatus(group, taskId, 'planned', plannerChat);
      return true;
    default:
      return false;
  }
}

function dropIndexFromY(cards: Element[], clientY: number): number {
  for (let i = 0; i < cards.length; i += 1) {
    const rect = cards[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return cards.length;
}

function placeDropIndicator(host: HTMLElement, clientY: number): void {
  host.querySelector('.board-drop-indicator')?.remove();
  const cards = [...host.querySelectorAll('.board-task-card')];
  const indicator = document.createElement('div');
  indicator.className = 'board-drop-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  const index = dropIndexFromY(cards, clientY);
  if (index >= cards.length) host.appendChild(indicator);
  else host.insertBefore(indicator, cards[index]);
}

function asElement(value: EventTarget | null): Element | null {
  if (!value || typeof value !== 'object') return null;
  return typeof (value as { closest?: unknown }).closest === 'function'
    ? (value as Element)
    : null;
}

/** Make one task card draggable between lanes. */
export function bindBoardCardDrag(card: HTMLElement, task: BoardTask): void {
  // Set the attribute, not just the IDL property: the attribute is what the
  // rendered DOM (and anything inspecting it) actually reports.
  if (!isBoardTaskDraggable(task)) {
    card.setAttribute('draggable', 'false');
    return;
  }
  card.setAttribute('draggable', 'true');
  card.addEventListener('dragstart', (event) => {
    const column = card.closest('.kanban-column');
    activeTaskDrag = {
      taskId: task.id,
      fromColumn: column?.getAttribute('data-kanban-column') ?? '',
    };
    card.classList.add('board-task-card--dragging');
    const transfer = event.dataTransfer;
    if (!transfer) return;
    transfer.setData(TASK_DRAG_MIME, task.id);
    transfer.setData('text/plain', task.id);
    transfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => {
    activeTaskDrag = null;
    card.classList.remove('board-task-card--dragging');
  });
}

/** Accept card drops on one kanban column and apply the status transition. */
export function bindBoardColumnDrop(
  columnEl: HTMLElement,
  columnId: string,
  group: ChatGroup,
  plannerChat: Chat,
  onApplied: () => void,
): void {
  const target = asColumnId(columnId);
  if (!target) return;
  const list = columnEl.querySelector('.kanban-column__list') ?? columnEl;

  const clearHighlight = (): void => {
    columnEl.classList.remove('is-drag-over');
    list.querySelector('.board-drop-indicator')?.remove();
  };

  columnEl.addEventListener('dragover', (event) => {
    const drag = activeTaskDrag;
    if (!drag || drag.fromColumn === columnId) return;
    const task = group.orchestrateBoard?.tasks.find((t) => t.id === drag.taskId);
    if (!task || !resolveBoardDropAction(task, target)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    columnEl.classList.add('is-drag-over');
    placeDropIndicator(list as HTMLElement, event.clientY);
  });

  columnEl.addEventListener('dragleave', (event) => {
    const related = asElement(event.relatedTarget as EventTarget | null);
    if (related && columnEl.contains(related)) return;
    clearHighlight();
  });

  columnEl.addEventListener('drop', (event) => {
    const drag = activeTaskDrag;
    if (!drag) return;
    event.preventDefault();
    clearHighlight();
    activeTaskDrag = null;
    void applyBoardTaskDrop(group, drag.taskId, target, plannerChat).then((applied) => {
      if (applied) onApplied();
    });
  });
}

/** Test-only: clear the module-level drag descriptor between cases. */
export function resetBoardDragStateForTests(): void {
  activeTaskDrag = null;
}
