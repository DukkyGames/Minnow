import path from 'node:path';

export type TrayPlatform = 'darwin' | 'linux' | 'win32' | string;

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

export function shouldUseTemplateTrayIcon(platform: TrayPlatform, iconPath: string): boolean {
  if (platform !== 'darwin') return false;
  return iconPath.includes(`${path.sep}tray${path.sep}trayTemplate`);
}
