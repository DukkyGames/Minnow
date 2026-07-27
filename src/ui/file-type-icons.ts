/**
 * File / folder icons for the Code file tree and editor tabs.
 * Uses Material Icon Theme (PKief) — the colorful VS Code-style set
 * (TS blue square, JS yellow square, JSON braces, Vite bolt, etc.).
 */

import {
  resolveFileIconId,
  resolveFolderIconId,
} from './file-type-icon-resolve';

export type FileTypeIconContext = 'tree' | 'tab';

export { resolveFileIconId, resolveFolderIconId } from './file-type-icon-resolve';

/** Eager URL map so tree rows can set img.src synchronously. */
const iconUrlModules = import.meta.glob(
  '../../node_modules/material-icon-theme/icons/*.svg',
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
) as Record<string, string>;

const iconUrlById = new Map<string, string>();
for (const [modulePath, url] of Object.entries(iconUrlModules)) {
  const base = modulePath.replace(/\\/g, '/').split('/').pop();
  if (!base?.endsWith('.svg')) continue;
  iconUrlById.set(base.slice(0, -4), url);
}

/** True when the active Minnow palette is a light variant. */
export function isFileIconLightTheme(): boolean {
  if (typeof document === 'undefined') return false;
  const theme = document.documentElement.getAttribute('data-theme') ?? '';
  return theme.endsWith('-light') || theme === 'light';
}

/** Absolute (Vite) URL for a Material icon id, or undefined if missing. */
export function getMaterialIconUrl(iconId: string): string | undefined {
  return iconUrlById.get(iconId);
}

function createIconImage(
  iconId: string,
  context: FileTypeIconContext,
  title: string,
): HTMLImageElement {
  const img = document.createElement('img');
  img.className = `file-type-icon file-type-icon--${context}`;
  img.alt = '';
  img.draggable = false;
  img.setAttribute('aria-hidden', 'true');
  img.title = title;
  img.width = context === 'tab' ? 14 : 16;
  img.height = context === 'tab' ? 14 : 16;

  const url = getMaterialIconUrl(iconId) ?? getMaterialIconUrl('file');
  if (url) img.src = url;
  img.dataset.iconId = iconId;
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
  return createIconImage(iconId, context, folderName || 'Folder');
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
