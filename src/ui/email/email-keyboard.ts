/**
 * Keyboard model for the mail surface.
 *
 * Single-key, Gmail-compatible bindings — the vocabulary power users already
 * have in their fingers. Shortcuts are suppressed while a text field or the
 * compose editor has focus, so typing "e" in a subject line never archives the
 * thread behind it.
 */

export interface MailShortcutContext {
  next(): void;
  previous(): void;
  open(): void;
  back(): void;
  archive(): void;
  trash(): void;
  star(): void;
  select(): void;
  reply(): void;
  replyAll(): void;
  forward(): void;
  compose(): void;
  search(): void;
  undo(): void;
  help(): void;
}

/** One row of the cheat sheet. */
export interface ShortcutDoc {
  keys: string;
  label: string;
}

export const MAIL_SHORTCUTS: ShortcutDoc[] = [
  { keys: 'j / k', label: 'Next / previous conversation' },
  { keys: 'Enter, o', label: 'Open conversation' },
  { keys: 'u', label: 'Back to the list' },
  { keys: 'e', label: 'Archive' },
  { keys: '#', label: 'Move to trash' },
  { keys: 's', label: 'Star' },
  { keys: 'x', label: 'Select' },
  { keys: 'r / a / f', label: 'Reply / reply all / forward' },
  { keys: 'c', label: 'Compose' },
  { keys: '/', label: 'Search' },
  { keys: 'Ctrl/Cmd + Enter', label: 'Send' },
  { keys: 'z', label: 'Undo the last action' },
  { keys: '?', label: 'This list' },
];

/**
 * Is the user typing? Shortcuts must not fire into a text field.
 * Exported because the reader pane checks it too.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

/**
 * Bind mail shortcuts to a root element.
 * @returns a teardown function
 */
export function bindMailShortcuts(
  root: HTMLElement,
  context: MailShortcutContext,
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    // Modified keys belong to the browser and to compose's Cmd+Enter.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTypingTarget(event.target)) return;

    const handlers: Record<string, () => void> = {
      j: context.next,
      k: context.previous,
      Enter: context.open,
      o: context.open,
      u: context.back,
      e: context.archive,
      '#': context.trash,
      s: context.star,
      x: context.select,
      r: context.reply,
      a: context.replyAll,
      f: context.forward,
      c: context.compose,
      '/': context.search,
      z: context.undo,
      '?': context.help,
    };

    const handler = handlers[event.key];
    if (!handler) return;

    event.preventDefault();
    handler();
  };

  root.addEventListener('keydown', onKeyDown);
  return () => root.removeEventListener('keydown', onKeyDown);
}

/** Render the `?` cheat sheet as a dismissible overlay. */
export function showShortcutCheatSheet(mount: HTMLElement): () => void {
  const existingBackdrop = mount.querySelector('.email-shortcut-backdrop');
  const existing = mount.querySelector('.email-shortcut-sheet');
  if (existingBackdrop || existing) {
    existingBackdrop?.remove();
    existing?.remove();
    return () => {};
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'email-shortcut-backdrop';

  const sheet = document.createElement('div');
  sheet.className = 'email-shortcut-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Keyboard shortcuts');
  sheet.tabIndex = -1;

  const title = document.createElement('p');
  title.className = 'email-shortcut-sheet-title';
  title.textContent = 'Keyboard shortcuts';
  sheet.appendChild(title);

  const table = document.createElement('dl');
  table.className = 'email-shortcut-sheet-list';
  for (const row of MAIL_SHORTCUTS) {
    const keys = document.createElement('dt');
    keys.textContent = row.keys;
    const label = document.createElement('dd');
    label.textContent = row.label;
    table.append(keys, label);
  }
  sheet.appendChild(table);

  const close = (): void => {
    sheet.remove();
    backdrop.remove();
    document.removeEventListener('keydown', onEscape);
  };

  backdrop.addEventListener('click', close);

  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' || event.key === '?') {
      event.preventDefault();
      close();
    }
  };
  document.addEventListener('keydown', onEscape);

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'email-btn';
  dismiss.textContent = 'Close';
  dismiss.addEventListener('click', close);
  sheet.appendChild(dismiss);

  mount.append(backdrop, sheet);
  sheet.focus();
  return close;
}
