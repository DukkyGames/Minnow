/**
 * Platform-specific tray icon path resolution (pure helpers — no Electron imports).
 */

import path from 'node:path';

export type TrayPlatform = 'darwin' | 'linux' | 'win32' | string;

/** Resolve the primary tray icon path for the current platform. */
export function resolveTrayIconPath(platform: TrayPlatform, root: string): string {
  if (platform === 'win32') {
    return path.join(root, 'build', 'icon.ico');
  }
  if (platform === 'darwin') {
    return path.join(root, 'build', 'tray', 'trayTemplate.png');
  }
  if (platform === 'linux') {
    return path.join(root, 'build', 'tray', 'tray-linux.png');
  }
  return path.join(root, 'build', 'tray', 'tray-linux.png');
}

/** Fallback ladder PNG when the dedicated tray asset is missing. */
export function resolveTrayIconFallbackPath(root: string): string {
  return path.join(
    root,
    'public',
    'logos',
    'minnow-logo',
    'minnow',
    'png',
    'minnow-32.png',
  );
}

/** True when the loaded asset should be treated as a macOS menu-bar template. */
export function shouldUseTemplateTrayIcon(platform: TrayPlatform, iconPath: string): boolean {
  if (platform !== 'darwin') return false;
  return iconPath.includes(`${path.sep}tray${path.sep}trayTemplate`);
}
