/**
 * Pure tray context-menu template (testable without Electron runtime).
 */

import type { TrayStatusSnapshot } from './tray-types.js';

function modelSummaryLabel(status: TrayStatusSnapshot): string {
  const count = status.loadedLocalModels.length;
  if (count === 0) return 'Local models loaded: 0';
  const names = status.loadedLocalModels.map((m) => m.label).join(', ');
  return `Local models loaded: ${count} (${names})`;
}

/** Rebuild the tray context menu from the latest status snapshot. */
export function buildTrayMenuTemplate(options: {
  status: TrayStatusSnapshot;
  launchAtStartup: boolean;
  onOpen: () => void;
  onNewChat: () => void;
  onUnloadModels: () => void;
  onOpenSettings: () => void;
  onToggleStartup: (enabled: boolean) => void;
  onQuit: () => void;
}): Electron.MenuItemConstructorOptions[] {
  const agentLabel =
    options.status.runningAgentCount === 1
      ? 'Agents running: 1'
      : `Agents running: ${options.status.runningAgentCount}`;

  const modelRows: Electron.MenuItemConstructorOptions[] =
    options.status.loadedLocalModels.length === 0
      ? []
      : options.status.loadedLocalModels.map((row) => ({
          label: row.label,
          enabled: false,
        }));

  const modelsParent: Electron.MenuItemConstructorOptions = {
    label: modelSummaryLabel(options.status),
    enabled: false,
    ...(modelRows.length > 0 ? { submenu: modelRows } : {}),
  };

  return [
    { label: 'Open Minnow', click: options.onOpen },
    { label: 'New chat', click: options.onNewChat },
    { type: 'separator' },
    { label: agentLabel, enabled: false },
    modelsParent,
    {
      label: 'Unload local models',
      enabled: options.status.loadedLocalModels.length > 0,
      click: options.onUnloadModels,
    },
    { type: 'separator' },
    { label: 'Open Settings', click: options.onOpenSettings },
    {
      label: 'Launch at startup',
      type: 'checkbox',
      checked: options.launchAtStartup,
      click: (item) => options.onToggleStartup(item.checked),
    },
    { type: 'separator' },
    { label: 'Quit Minnow', click: options.onQuit },
  ];
}
