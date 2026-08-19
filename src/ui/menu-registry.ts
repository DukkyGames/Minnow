/**
 * Registry of context-menu contributions.
 *
 * "Create issue" and "Add to issue ▸" need to appear on the file tree, editor
 * selections, commit rows, chat messages, terminal selections, board cards and
 * research rows. Registering them once against a target kind keeps that from
 * becoming an edit to every one of those files — and keeps the ordering
 * consistent, which hand-edited menus never manage.
 *
 * A surface opens a menu with {@link buildMenuItems}; features add rows with
 * {@link registerMenuContributor} at module load.
 */

import { openContextMenu, type ContextMenuHandle, type MenuItem } from './context-menu';

/**
 * What a menu was opened on. `kind` selects the contributors; the rest is the
 * surface's own payload, read by contributors that understand that kind.
 */
export interface MenuTarget {
  kind: string;
  [key: string]: unknown;
}

/** Returns rows for this target, or null when it has nothing to add. */
export type MenuContributor = (target: MenuTarget) => MenuItem[] | null;

export interface MenuContributorOptions {
  /**
   * Sort weight. Owning-surface actions sit at 0, cross-cutting additions
   * (Issues capture, Copy path) at 100+, destructive rows last at 900+.
   */
  order?: number;
  /** Target kinds to match; omit or use `'*'` to match every menu. */
  kinds?: readonly string[];
}

interface Registration {
  id: string;
  order: number;
  kinds: readonly string[] | null;
  contribute: MenuContributor;
}

/** Weight bands so unrelated features order predictably against each other. */
export const MENU_ORDER = {
  /** The surface's own primary actions. */
  primary: 0,
  /** Cross-surface additions contributed from elsewhere. */
  integration: 100,
  /** Clipboard and reveal-style utilities. */
  utility: 500,
  /** Destructive rows. Always last. */
  destructive: 900,
} as const;

const registrations = new Map<string, Registration>();

/**
 * Register a contributor. Re-registering the same id replaces it, so a module
 * that hot-reloads does not stack duplicate rows.
 */
export function registerMenuContributor(
  id: string,
  contribute: MenuContributor,
  options: MenuContributorOptions = {},
): () => void {
  registrations.set(id, {
    id,
    order: options.order ?? MENU_ORDER.integration,
    kinds: options.kinds && !options.kinds.includes('*') ? [...options.kinds] : null,
    contribute,
  });
  return () => {
    registrations.delete(id);
  };
}

/** Remove a contributor by id. */
export function unregisterMenuContributor(id: string): void {
  registrations.delete(id);
}

/** Registered contributor ids, in resolved order (diagnostics and tests). */
export function listMenuContributorIds(): string[] {
  return [...registrations.values()]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((entry) => entry.id);
}

/**
 * Collect rows for a target.
 *
 * Each contributor's block is kept together and separated from the next, so a
 * surface never has to know what else ended up in its menu to keep the grouping
 * readable. `own` rows are the calling surface's items and always come first.
 */
export function buildMenuItems(target: MenuTarget, own: MenuItem[] = []): MenuItem[] {
  const blocks: MenuItem[][] = [];
  if (own.length > 0) blocks.push(own);

  const ordered = [...registrations.values()].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  );
  for (const entry of ordered) {
    if (entry.kinds && !entry.kinds.includes(target.kind)) continue;
    let rows: MenuItem[] | null = null;
    try {
      rows = entry.contribute(target);
    } catch {
      // One broken contributor must not cost the user the whole menu.
      rows = null;
    }
    if (rows && rows.length > 0) blocks.push(rows);
  }

  const out: MenuItem[] = [];
  for (const block of blocks) {
    if (out.length > 0) out.push({ kind: 'separator' });
    out.push(...block);
  }
  return out;
}

export interface OpenRegisteredMenuOptions {
  target: MenuTarget;
  /** The calling surface's own rows; rendered first. */
  items?: MenuItem[];
  label: string;
  clientX?: number;
  clientY?: number;
  anchor?: HTMLElement | null;
  restoreFocus?: HTMLElement | null;
  mount?: HTMLElement;
}

/** Open a context menu combining the surface's rows with registered ones. */
export function openRegisteredMenu(
  options: OpenRegisteredMenuOptions,
): ContextMenuHandle {
  return openContextMenu({
    items: buildMenuItems(options.target, options.items ?? []),
    label: options.label,
    clientX: options.clientX,
    clientY: options.clientY,
    anchor: options.anchor,
    restoreFocus: options.restoreFocus,
    mount: options.mount,
  });
}

/** Drop every registration (tests). */
export function resetMenuRegistryForTests(): void {
  registrations.clear();
}
