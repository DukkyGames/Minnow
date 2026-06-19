/**
 * Keyboard shortcut helpers for copying xterm selection without breaking SIGINT.
 */

/** True when the event is the platform copy chord (Ctrl+C or Cmd+C). */
export function isTerminalCopyShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  const key = event.key.toLowerCase();
  if (key !== 'c') return false;
  if (event.shiftKey || event.altKey) return false;
  // Windows/Linux: Ctrl+C. macOS: Cmd+C (Ctrl+C remains SIGINT in shells).
  return (event.ctrlKey && !event.metaKey) || (event.metaKey && !event.ctrlKey);
}

/** Whether xterm should handle copy instead of sending Ctrl/Cmd+C to the PTY. */
export function shouldCopyTerminalSelectionOnKeydown(
  event: { type: string; key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean },
  hasSelection: boolean,
): boolean {
  if (event.type !== 'keydown') return false;
  if (!hasSelection) return false;
  return isTerminalCopyShortcut(event);
}

/** Write plain text to the clipboard when available. */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } finally {
    textarea.remove();
  }
}
