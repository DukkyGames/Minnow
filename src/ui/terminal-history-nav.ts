export const HISTORY_LINE_CLEAR = '\x01\x0b';

/** WSL distro profile ids (`wsl:Ubuntu`) spawn a real Unix line editor inside the distro. */
const WSL_SHELL_PROFILE_PREFIX = 'wsl:';

/** Interactive shells whose line editor must receive ArrowUp/Down unchanged. */
const NATIVE_HISTORY_SHELL_IDS = new Set([
  'powershell',
  'cmd',
  'zsh',
  'bash',
  'git-bash',
  'fish',
]);

/** Build PTY input that replaces the current editable line with `nextLine`. */
export function buildHistoryReplaceInput(
  _currentBuffer: string,
  nextLine: string,
): string {
  return HISTORY_LINE_CLEAR + nextLine;
}

/** Build PTY input that clears the current editable line. */
export function buildHistoryClearInput(_currentBuffer: string): string {
  return HISTORY_LINE_CLEAR;
}

/** CSI / SS3 arrow-up and arrow-down (incl. Windows modifyOtherKeys prefixes). */
export function parseHistoryArrow(data: string): HistoryArrow | null {
  if (data === '\x1bOA') return 'up';
  if (data === '\x1bOB') return 'down';
  const match = /^\x1b\[([0-9;]*)?([AB])$/.exec(data);
  if (!match) return null;
  return match[2] === 'A' ? 'up' : 'down';
}

/** True when `data` is a terminal escape sequence (must not update lineBuffer). */
export function isTerminalEscapeInput(data: string): boolean {
  return data.length > 0 && data.charCodeAt(0) === 0x1b;
}

/** Interactive PTY shells own ArrowUp/Down via their line editor (zle, readline, fish, PSReadLine, DOSKEY). */
export function usesShellNativeHistory(shellProfileId: string | null | undefined): boolean {
  if (!shellProfileId) return false;
  if (shellProfileId.startsWith(WSL_SHELL_PROFILE_PREFIX)) return true;
  return NATIVE_HISTORY_SHELL_IDS.has(shellProfileId);
}

/** True when the xterm handler should swallow this key and inject a stored line. */
export function shouldInterceptPtyHistoryArrow(options: {
  data: string;
  shellProfileId: string | null | undefined;
  tabHistoryLength: number;
}): boolean {
  if (!parseHistoryArrow(options.data)) return false;
  if (usesShellNativeHistory(options.shellProfileId)) return false;
  return options.tabHistoryLength > 0;
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
