/**
 * Pure helpers for PTY tab command-history navigation (ArrowUp/ArrowDown).
 */

/** Build PTY input that replaces the current editable line with `nextLine`. */
export function buildHistoryReplaceInput(
  currentBuffer: string,
  nextLine: string,
): string {
  const clear = '\x7f'.repeat(currentBuffer.length);
  return clear + nextLine;
}

/** Build PTY input that clears the current editable line. */
export function buildHistoryClearInput(currentBuffer: string): string {
  return '\x7f'.repeat(currentBuffer.length);
}

export type HistoryArrow = 'up' | 'down';

export interface HistoryNavState {
  historyIndex: number;
  tabHistory: string[];
}

export interface HistoryNavResult {
  historyIndex: number;
  nextLine: string;
}

/** Resolve the next history entry after an ArrowUp/ArrowDown press. */
export function resolveHistoryNavigation(
  state: HistoryNavState,
  arrow: HistoryArrow,
): HistoryNavResult {
  const { tabHistory } = state;
  let historyIndex = state.historyIndex;

  if (arrow === 'up') {
    if (historyIndex <= 0) {
      historyIndex = 0;
    } else {
      historyIndex -= 1;
    }
  } else if (historyIndex >= tabHistory.length - 1) {
    historyIndex = tabHistory.length;
    return { historyIndex, nextLine: '' };
  } else {
    historyIndex += 1;
  }

  const nextLine =
    historyIndex < tabHistory.length ? tabHistory[historyIndex] : '';
  return { historyIndex, nextLine };
}
