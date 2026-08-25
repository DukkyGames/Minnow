/**
 * Keyboard grid navigation for orchestrate kanban task cards.
 *
 * Arrows move focus between cards; Ctrl/Cmd+Arrow moves the *card* between lanes,
 * so every drag-and-drop transition (orchestrate-board-dnd.ts) has a keyboard
 * equivalent rather than being mouse-only.
 */

import { applyBoardTaskDrop, type KanbanColumnId } from './orchestrate-board-dnd.ts';
import type { Chat, ChatGroup } from '../types.ts';

/** Board context needed to apply a lane move; omitted on read-only surfaces. */
export interface BoardCardKeyboardContext {
  group: ChatGroup;
  plannerChat: Chat;
  onApplied?: () => void;
}

const FOCUSABLE_CARD_SELECTOR =
  '.board-task-card--clickable[tabindex="0"], .board-task-card--clickable';

function listFocusableCards(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_CARD_SELECTOR)].filter(
    (card) => card.tabIndex >= 0 || card.getAttribute('tabindex') === '0',
  );
}

function cardColumnIndex(card: HTMLElement): number {
  const column = card.closest('.kanban-column');
  if (!column?.parentElement) return 0;
  const columns = [...column.parentElement.querySelectorAll('.kanban-column')];
  return columns.indexOf(column);
}

function cardsInColumn(root: HTMLElement, columnIndex: number): HTMLElement[] {
  const columns = root.querySelectorAll('.kanban-column');
  const column = columns[columnIndex];
  if (!column) return [];
  return [...column.querySelectorAll<HTMLElement>(FOCUSABLE_CARD_SELECTOR)].filter(
    (card) => card.tabIndex >= 0 || card.getAttribute('tabindex') === '0',
  );
}

function focusCard(card: HTMLElement | undefined): void {
  if (!card) return;
  card.focus({ preventScroll: true });
  card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** Column id of the lane `offset` columns away from this card's, if it exists. */
function adjacentColumnId(
  root: HTMLElement,
  columnIndex: number,
  offset: number,
): KanbanColumnId | null {
  const columns = root.querySelectorAll('.kanban-column');
  const target = columns[columnIndex + offset];
  const id = target?.getAttribute('data-kanban-column');
  return id === 'planned' || id === 'in_progress' || id === 'testing' || id === 'complete'
    ? id
    : null;
}

/** Arrow-key navigation between kanban cards when a card holds focus. */
export function handleBoardCardKeydown(
  event: KeyboardEvent,
  card: HTMLElement,
  context?: BoardCardKeyboardContext,
): void {
  const root = card.closest('.board-kanban-waves') ?? card.closest('.board-main');
  if (!root || !(root instanceof HTMLElement)) return;

  const cards = listFocusableCards(root);
  const index = cards.indexOf(card);
  if (index < 0) return;

  const col = cardColumnIndex(card);
  const colCards = cardsInColumn(root, col);

  // Ctrl/Cmd + horizontal arrow moves the card itself, matching a lane drag.
  if (context && (event.ctrlKey || event.metaKey)) {
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (offset !== 0) {
      const taskId = card.getAttribute('data-board-task-id');
      const targetColumn = adjacentColumnId(root, col, offset);
      if (taskId && targetColumn) {
        event.preventDefault();
        void applyBoardTaskDrop(
          context.group,
          taskId,
          targetColumn,
          context.plannerChat,
        ).then((applied) => {
          if (applied) context.onApplied?.();
        });
      }
      return;
    }
  }

  if (event.key === 'ArrowDown') {
    const colIndex = colCards.indexOf(card);
    if (colIndex < colCards.length - 1) {
      event.preventDefault();
      focusCard(colCards[colIndex + 1]);
    }
    return;
  }

  if (event.key === 'ArrowUp') {
    const colIndex = colCards.indexOf(card);
    if (colIndex > 0) {
      event.preventDefault();
      focusCard(colCards[colIndex - 1]);
    }
    return;
  }

  if (event.key === 'ArrowRight') {
    const nextCol = cardsInColumn(root, col + 1);
    if (nextCol.length > 0) {
      event.preventDefault();
      const colIndex = colCards.indexOf(card);
      focusCard(nextCol[Math.min(colIndex, nextCol.length - 1)]);
    }
    return;
  }

  if (event.key === 'ArrowLeft') {
    const prevCol = cardsInColumn(root, col - 1);
    if (prevCol.length > 0) {
      event.preventDefault();
      const colIndex = colCards.indexOf(card);
      focusCard(prevCol[Math.min(colIndex, prevCol.length - 1)]);
    }
  }
}
