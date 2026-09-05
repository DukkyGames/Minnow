/**
 * The tray's Workspaces submenu, built as plain data.
 *
 * Electron's `Menu.buildFromTemplate` takes exactly this shape, so the whole
 * menu can be asserted in a unit test without an Electron runtime — the same
 * split `tray-status.ts` uses for its label formatters.
 */

export interface TrayWorkspaceEntry {
  /** `BrowserWindow.id` — what the click handlers act on. */
  windowId: number;
  /** Absolute folder, or `''` for a window still at the folder gate. */
  workspacePath: string;
  /** False while the window is hidden in the tray. */
  visible: boolean;
}

export interface TrayWorkspaceMenuActions {
  focus: (windowId: number) => void;
  close: (windowId: number) => void;
  closeBackgrounded: () => void;
}

/** Loose stand-in for `Electron.MenuItemConstructorOptions`. */
export interface TrayMenuItemTemplate {
  label?: string;
  type?: 'separator';
  enabled?: boolean;
  click?: () => void;
  submenu?: TrayMenuItemTemplate[];
}

/** Last path segment, with the Windows drive root spelled out. */
export function workspaceMenuLabel(workspacePath: string): string {
  const trimmed = workspacePath.trim();
  if (!trimmed) return 'No folder';
  const normalized = trimmed.replace(/\\/g, '/').replace(/\/+$/, '');
  const last = normalized.split('/').filter(Boolean).pop();
  if (!last) return trimmed;
  if (/^[A-Za-z]:$/.test(last)) return `${last.toUpperCase()}\\`;
  return last;
}

/**
 * One row per open window. A backgrounded window says so in its label — the
 * whole point of the submenu is that windows hidden in the tray are otherwise
 * invisible, which is how they used to accumulate unnoticed.
 */
export function buildWorkspacesMenuTemplate(
  entries: TrayWorkspaceEntry[],
  actions: TrayWorkspaceMenuActions,
): TrayMenuItemTemplate {
  if (entries.length === 0) {
    return {
      label: 'Workspaces',
      submenu: [{ label: 'No open workspaces', enabled: false }],
    };
  }

  const submenu: TrayMenuItemTemplate[] = entries.map((entry) => {
    const name = workspaceMenuLabel(entry.workspacePath);
    return {
      label: entry.visible ? name : `${name} (background)`,
      submenu: [
        {
          label: entry.workspacePath || 'Choose a folder…',
          enabled: false,
        },
        { type: 'separator' },
        {
          label: entry.visible ? 'Focus window' : 'Show window',
          click: () => actions.focus(entry.windowId),
        },
        {
          label: 'Close workspace',
          click: () => actions.close(entry.windowId),
        },
      ],
    };
  });

  const backgrounded = entries.filter((entry) => !entry.visible).length;
  if (backgrounded > 0) {
    submenu.push({ type: 'separator' });
    submenu.push({
      label:
        backgrounded === 1
          ? 'Close 1 background workspace'
          : `Close ${backgrounded} background workspaces`,
      click: () => actions.closeBackgrounded(),
    });
  }

  return { label: 'Workspaces', submenu };
}
