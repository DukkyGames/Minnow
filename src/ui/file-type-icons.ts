/**
 * File / folder icons for the Code file tree and editor tabs.
 * Uses Material Icon Theme (PKief) — colorful SVGs served from public/material-icons/.
 */

import {
  resolveFileIconId,
  resolveFolderIconId,
} from './file-type-icon-resolve';

export type FileTypeIconContext = 'tree' | 'tab';

export { resolveFileIconId, resolveFolderIconId } from './file-type-icon-resolve';

/** Base path for synced SVG assets (see scripts/sync-material-file-icons.mjs). */
const ICON_BASE = './material-icons';

/** True when the active Minnow palette is a light variant. */
export function isFileIconLightTheme(): boolean {
  if (typeof document === 'undefined') return false;
  const theme = document.documentElement.getAttribute('data-theme') ?? '';
  return theme.endsWith('-light') || theme === 'light';
}

/** Public URL for a Material icon id. */
export function getMaterialIconUrl(iconId: string): string {
  const safe = iconId.replace(/[^a-z0-9_-]/gi, '');
  return `${ICON_BASE}/${safe}.svg`;
}

function createIconImage(
  iconId: string,
  context: FileTypeIconContext,
  title: string,
  fallbackId = 'file',
): HTMLImageElement {
  const img = document.createElement('img');
  img.className = `file-type-icon file-type-icon--${context}`;
  img.alt = '';
  img.draggable = false;
  img.setAttribute('aria-hidden', 'true');
  img.title = title;
  img.width = context === 'tab' ? 14 : 16;
  img.height = context === 'tab' ? 14 : 16;
  img.src = getMaterialIconUrl(iconId);
  img.dataset.iconId = iconId;

  // Fall back to generic file glyph when a specialized asset is missing.
  img.addEventListener('error', () => {
    if (img.dataset.iconId === fallbackId) return;
    img.dataset.iconId = fallbackId;
    img.src = getMaterialIconUrl(fallbackId);
  }, { once: true });

  return img;
}

/** Folder glyph for directory rows (name-aware: src, node_modules, …). */
export function createFolderTypeIconElement(
  folderName: string,
  context: FileTypeIconContext = 'tree',
  options?: { expanded?: boolean },
): HTMLImageElement {
  const iconId = resolveFolderIconId(folderName, {
    expanded: options?.expanded,
    light: isFileIconLightTheme(),
  });
  return createIconImage(iconId, context, folderName || 'Folder', 'folder');
}

/** File glyph for a path — used in the tree and editor tabs. */
export function createFileTypeIconElement(
  name: string,
  context: FileTypeIconContext = 'tree',
): HTMLImageElement {
  const iconId = resolveFileIconId(name, { light: isFileIconLightTheme() });
  const base = (name.split(/[/\\]/).pop() ?? name) || 'File';
  return createIconImage(iconId, context, base);
}
