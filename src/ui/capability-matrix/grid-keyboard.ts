export type CapabilityGridCoord = { row: number; col: number };

/** Next cell coordinates for arrow navigation; null when out of bounds or not an arrow key. */
export function adjacentCapabilityGridCell(
  row: number,
  col: number,
  key: string,
): CapabilityGridCoord | null {
  switch (key) {
    case 'ArrowLeft':
      return col > 0 ? { row, col: col - 1 } : null;
    case 'ArrowRight':
      return { row, col: col + 1 };
    case 'ArrowUp':
      return row > 0 ? { row: row - 1, col } : null;
    case 'ArrowDown':
      return { row: row + 1, col };
    default:
      return null;
  }
}

/** Move focus between grid cell buttons with arrow keys. */
export function attachCapabilityGridKeyboardNav(table: HTMLElement): () => void {
  const onKeyDown = (ev: KeyboardEvent): void => {
    const target = ev.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (!target.classList.contains('cap-matrix-grid__cell')) return;

    const row = Number(target.dataset.capRow);
    const col = Number(target.dataset.capCol);
    if (!Number.isFinite(row) || !Number.isFinite(col)) return;

    const next = adjacentCapabilityGridCell(row, col, ev.key);
    if (!next) return;
    ev.preventDefault();

    const nextBtn = table.querySelector<HTMLButtonElement>(
      `button.cap-matrix-grid__cell[data-cap-row="${next.row}"][data-cap-col="${next.col}"]`,
    );
    if (!nextBtn) return;
    nextBtn.focus();
    nextBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  table.addEventListener('keydown', onKeyDown);
  return () => table.removeEventListener('keydown', onKeyDown);
}
