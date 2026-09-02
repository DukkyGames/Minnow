export const TERMINAL_XTERM_MIN_HEIGHT_PX = 311;

/** Panel chrome above `#terminalXtermHost` when not yet measured (resize handle, header, shell hint). */
export const TERMINAL_PANEL_CHROME_FALLBACK_PX = 80;

export const TERMINAL_PANEL_MIN_HEIGHT_PX =
  TERMINAL_XTERM_MIN_HEIGHT_PX + TERMINAL_PANEL_CHROME_FALLBACK_PX;

/** Read `--terminal-xterm-min-height` from CSS (falls back to constant). */
export function readTerminalXtermMinHeightPx(): number {
  if (typeof document === 'undefined') return TERMINAL_XTERM_MIN_HEIGHT_PX;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--terminal-xterm-min-height')
    .trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : TERMINAL_XTERM_MIN_HEIGHT_PX;
}

/** Minimum docked panel height that preserves the PTY viewport floor. */
export function resolveTerminalPanelMinHeightPx(
  panelEl?: HTMLElement | null,
  xtermHostEl?: HTMLElement | null,
): number {
  const xtermMin = readTerminalXtermMinHeightPx();
  if (panelEl && xtermHostEl) {
    const panelH = panelEl.getBoundingClientRect().height;
    const hostH = xtermHostEl.getBoundingClientRect().height;
    if (panelH > 0 && hostH > 0) {
      const chrome = Math.max(
        TERMINAL_PANEL_CHROME_FALLBACK_PX,
        Math.round(panelH - hostH),
      );
      return chrome + xtermMin;
    }
  }
  return TERMINAL_PANEL_MIN_HEIGHT_PX;
}
