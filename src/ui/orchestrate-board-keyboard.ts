/**
 * Keyboard grid navigation for orchestrate kanban task cards.
 */

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

/** Arrow-key navigation between kanban cards when a card holds focus. */
export function handleBoardCardKeydown(event: KeyboardEvent, card: HTMLElement): void {
  const root = card.closest('.board-kanban-waves') ?? card.closest('.board-main');
  if (!root || !(root instanceof HTMLElement)) return;

  const cards = listFocusableCards(root);
  const index = cards.indexOf(card);
  if (index < 0) return;

  const col = cardColumnIndex(card);
  const colCards = cardsInColumn(root, col);

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
