/**
 * Global keyboard shortcuts help overlay (`?`).
 * Per-app shortcuts (mail triage, file tree, board) are listed in context sections.
 */

import { isTypingTarget } from './a11y/typing-target';

export interface ShortcutDoc {
  keys: string;
  label: string;
  /** Group heading for the cheat sheet. */
  section?: string;
}

const SHELL_SHORTCUTS: ShortcutDoc[] = [
  { section: 'Shell', keys: '?', label: 'Open this keyboard shortcuts list' },
  { section: 'Shell', keys: 'Escape', label: 'Close overlays, popovers, and side panels' },
  { section: 'Shell', keys: 'Alt + `', label: 'Cycle focus among open floating windows' },
  {
    section: 'Shell',
    keys: 'Ctrl + Tab / Ctrl + Shift + Tab',
    label: 'Cycle between Desktop and recent Minnow apps (Cmd+Tab on macOS stays with the OS)',
  },
  { section: 'Shell', keys: 'Tab / Shift+Tab', label: 'Move focus through dock, menubar, and app chrome' },
];

const CHAT_SHORTCUTS: ShortcutDoc[] = [
  { section: 'Chat', keys: 'Enter', label: 'Send message (composer focused)' },
  { section: 'Chat', keys: 'Shift + Enter', label: 'New line in composer' },
  { section: 'Chat', keys: '/', label: 'Open skill picker in composer' },
  { section: 'Chat', keys: 'Arrow keys', label: 'Navigate model list when picker is open' },
  { section: 'Chat', keys: '1 / 2 / 3', label: 'Tool approval: allow once, always allow, cancel' },
];

const CODE_SHORTCUTS: ShortcutDoc[] = [
  { section: 'Code', keys: 'Ctrl/Cmd + K', label: 'Quick Edit on selection' },
  { section: 'Code', keys: 'Ctrl/Cmd + P', label: 'Go to file' },
  { section: 'Code', keys: 'Ctrl/Cmd + Shift + P', label: 'Command palette' },
];

const BOARD_SHORTCUTS: ShortcutDoc[] = [
  { section: 'Orchestrate board', keys: 'Tab', label: 'Move between task cards and header controls' },
  { section: 'Orchestrate board', keys: 'Arrow keys', label: 'Navigate cards in the kanban grid' },
  { section: 'Orchestrate board', keys: 'Enter / Space', label: 'Open task chat or plan panel' },
  { section: 'Orchestrate board', keys: 'Arrow keys (exec mode)', label: 'Change execution mode when a segment is focused' },
];

const MAIL_SHORTCUTS: ShortcutDoc[] = [
  { section: 'Email', keys: 'j / k', label: 'Next / previous conversation' },
  { section: 'Email', keys: 'e', label: 'Archive' },
  { section: 'Email', keys: '#', label: 'Trash' },
  { section: 'Email', keys: 'c', label: 'Compose' },
  { section: 'Email', keys: '?', label: 'Email-only shortcut list (when mail app is focused)' },
];

export const GLOBAL_KEYBOARD_SHORTCUTS: ShortcutDoc[] = [
  ...SHELL_SHORTCUTS,
  ...CHAT_SHORTCUTS,
  ...CODE_SHORTCUTS,
  ...BOARD_SHORTCUTS,
  ...MAIL_SHORTCUTS,
];

let sheetOpen = false;
let previousFocus: HTMLElement | null = null;
let escapeHandler: ((event: KeyboardEvent) => void) | null = null;

function trapFocus(event: KeyboardEvent): void {
  const panel = document.getElementById('shellKeyboardHelpPanel');
  if (!panel || panel.hidden) return;
  if (event.key !== 'Tab') return;
  const nodes = [...panel.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )].filter((el) => !el.hasAttribute('disabled'));
  if (nodes.length === 0) return;
  const active = document.activeElement as HTMLElement;
  const index = nodes.indexOf(active);
  event.preventDefault();
  const next = event.shiftKey
    ? nodes[(index - 1 + nodes.length) % nodes.length]
    : nodes[(index + 1) % nodes.length];
  next.focus();
}

function closeKeyboardHelp(): void {
  if (!sheetOpen) return;
  sheetOpen = false;
  const backdrop = document.getElementById('shellKeyboardHelpBackdrop');
  const panel = document.getElementById('shellKeyboardHelpPanel');
  backdrop?.remove();
  panel?.remove();
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler, true);
    escapeHandler = null;
  }
  document.removeEventListener('keydown', trapFocus, true);
  previousFocus?.focus();
  previousFocus = null;
}

/** Render grouped shortcut rows into a definition list. */
function renderShortcutList(shortcuts: ShortcutDoc[]): HTMLDListElement {
  const list = document.createElement('dl');
  list.className = 'shell-keyboard-help__list';
  let lastSection = '';
  for (const row of shortcuts) {
    if (row.section && row.section !== lastSection) {
      lastSection = row.section;
      const heading = document.createElement('div');
      heading.className = 'shell-keyboard-help__section';
      heading.textContent = row.section;
      list.appendChild(heading);
    }
    const keys = document.createElement('dt');
    keys.textContent = row.keys;
    const label = document.createElement('dd');
    label.textContent = row.label;
    list.append(keys, label);
  }
  return list;
}

/** Open the global shortcuts overlay. */
export function showShellKeyboardHelp(): void {
  if (sheetOpen) {
    closeKeyboardHelp();
    return;
  }

  sheetOpen = true;
  previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const backdrop = document.createElement('div');
  backdrop.id = 'shellKeyboardHelpBackdrop';
  backdrop.className = 'shell-keyboard-help-backdrop';
  backdrop.addEventListener('click', closeKeyboardHelp);

  const panel = document.createElement('div');
  panel.id = 'shellKeyboardHelpPanel';
  panel.className = 'shell-keyboard-help-sheet';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Keyboard shortcuts');
  panel.tabIndex = -1;

  const title = document.createElement('h2');
  title.className = 'shell-keyboard-help__title';
  title.textContent = 'Keyboard shortcuts';
  panel.appendChild(title);

  const intro = document.createElement('p');
  intro.className = 'shell-keyboard-help__intro';
  intro.textContent =
    'Shortcuts are suppressed while you type in a text field. Email has additional bindings when the mail app is focused.';
  panel.appendChild(intro);

  panel.appendChild(renderShortcutList(GLOBAL_KEYBOARD_SHORTCUTS));

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'shell-keyboard-help__close';
  dismiss.textContent = 'Close';
  dismiss.addEventListener('click', closeKeyboardHelp);
  panel.appendChild(dismiss);

  escapeHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape' || event.key === '?') {
      event.preventDefault();
      closeKeyboardHelp();
    }
  };
  document.addEventListener('keydown', escapeHandler, true);
  document.addEventListener('keydown', trapFocus, true);

  document.body.append(backdrop, panel);
  dismiss.focus();
}

let helpBound = false;

/** Bind global `?` shortcut for the shortcuts overlay. */
export function initShellKeyboardHelp(): void {
  if (helpBound) return;
  helpBound = true;

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (event.key !== '?') return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTypingTarget(event.target)) return;
  // Shift+? is the typical physical key; unshifted ? also works on some layouts.
    event.preventDefault();
    showShellKeyboardHelp();
  });
}
