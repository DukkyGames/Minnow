export interface EmailContextMenuItem {
  id: string;
  label: string;
  /** Destructive styling (trash). */
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
}

export interface OpenEmailContextMenuOptions {
  /** Viewport coordinates for the menu origin. */
  clientX: number;
  clientY: number;
  items: EmailContextMenuItem[];
  /** Element that opened the menu; receives focus on close. */
  restoreFocus?: HTMLElement | null;
  /** Optional host; defaults to document.body. */
  mount?: HTMLElement;
}

export interface EmailContextMenuHandle {
  close: () => void;
  root: HTMLElement;
}

let activeMenu: EmailContextMenuHandle | null = null;

/** Close any open inbox context menu. */
export function closeEmailContextMenu(): void {
  activeMenu?.close();
}

/** Open a context menu at the pointer (or keyboard synthetic) coordinates. */
export function openEmailContextMenu(
  options: OpenEmailContextMenuOptions,
): EmailContextMenuHandle {
  closeEmailContextMenu();

  const host = options.mount ?? document.body;
  const root = document.createElement('div');
  root.className = 'email-context-menu';
  root.setAttribute('role', 'menu');
  root.setAttribute('aria-label', 'Conversation actions');
  root.tabIndex = -1;

  const items: HTMLButtonElement[] = [];
  for (const item of options.items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'email-context-menu-item';
    if (item.danger) btn.classList.add('is-danger');
    btn.setAttribute('role', 'menuitem');
    btn.dataset.id = item.id;
    btn.textContent = item.label;
    btn.disabled = Boolean(item.disabled);
    btn.addEventListener('click', () => {
      void (async () => {
        handle.close();
        await item.onSelect();
      })();
    });
    root.appendChild(btn);
    items.push(btn);
  }

  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'email-context-menu-empty';
    empty.textContent = 'No actions available';
    root.appendChild(empty);
  }

  host.appendChild(root);

  root.style.left = `${Math.max(0, options.clientX)}px`;
  root.style.top = `${Math.max(0, options.clientY)}px`;
  const rect = root.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
  root.style.left = `${Math.min(Math.max(8, options.clientX), maxLeft)}px`;
  root.style.top = `${Math.min(Math.max(8, options.clientY), maxTop)}px`;

  const focusItem = (index: number): void => {
    if (items.length === 0) {
      root.focus();
      return;
    }
    const next = ((index % items.length) + items.length) % items.length;
    items[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const current = items.findIndex((btn) => btn === document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      handle.close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(current < 0 ? 0 : current + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(current < 0 ? items.length - 1 : current - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusItem(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusItem(items.length - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      if (document.activeElement instanceof HTMLButtonElement) {
        event.preventDefault();
        document.activeElement.click();
      }
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (root.contains(event.target as Node)) return;
    handle.close();
  };

  const onResizeOrScroll = (): void => {
    handle.close();
  };

  const handle: EmailContextMenuHandle = {
    root,
    close: () => {
      if (activeMenu !== handle) return;
      activeMenu = null;
      root.remove();
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onResizeOrScroll);
      window.removeEventListener('scroll', onResizeOrScroll, true);
      options.restoreFocus?.focus();
    },
  };

  activeMenu = handle;
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('resize', onResizeOrScroll);
  window.addEventListener('scroll', onResizeOrScroll, true);

  const firstEnabled = items.findIndex((btn) => !btn.disabled);
  if (firstEnabled >= 0) focusItem(firstEnabled);
  else root.focus();

  return handle;
}
