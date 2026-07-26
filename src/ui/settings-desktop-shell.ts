/**
 * Settings → General → Desktop app (close-to-tray, launch at startup).
 */

import {
  loadCloseToTrayFromConfig,
  saveCloseToTray,
} from '../config/desktop-shell-meta';
import { getTrayApi, isTrayBridgeAvailable } from '../electron/tray-client';
import type { MinnowTrayDesktopState } from '../electron.d.ts';
import { setStatus } from './status';
import { createSettingsToggleRow } from './settings-switch';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function unsupportedCallout(reason: 'browser' | 'linux'): HTMLElement {
  const message =
    reason === 'linux'
      ? 'Desktop tray controls are available on Windows and macOS installs. Linux builds keep the standard window close behavior.'
      : 'Desktop tray controls apply to the installed Minnow app (Electron), not a browser tab.';
  const p = el('p', 'settings-desktop-shell__callout', message);
  p.setAttribute('role', 'note');
  return p;
}

async function readDesktopState(): Promise<MinnowTrayDesktopState | null> {
  const tray = getTrayApi();
  if (!tray) return null;
  return tray.getDesktopState();
}

/** Render Desktop app settings into the General section mount. */
export async function renderDesktopShellSettings(mount: HTMLElement): Promise<void> {
  const section = el('section', 'settings-desktop-shell');
  section.dataset.settingsSearchKey = 'general.desktop';

  const trayAvailable = isTrayBridgeAvailable();
  if (!trayAvailable) {
    section.appendChild(unsupportedCallout('browser'));
    mount.appendChild(section);
    return;
  }

  const desktopState = await readDesktopState();
  if (!desktopState?.supported) {
    section.appendChild(unsupportedCallout(desktopState?.unsupportedReason ?? 'linux'));
    mount.appendChild(section);
    return;
  }

  const closeToTraySaved = await loadCloseToTrayFromConfig();

  const { row: closeRow, input: closeInput } = createSettingsToggleRow(
    'Keep Minnow running after closing the window',
    {
      checked: closeToTraySaved,
      ariaLabel: 'Keep Minnow running after closing the window',
      searchKey: 'general.desktop.closeToTray',
      description:
        'When on, closing the window hides Minnow in the system tray so chats, agents, and local models keep running.',
      onChange: (checked) => {
        void (async () => {
          try {
            await saveCloseToTray(checked);
            setStatus('ok', checked ? 'Minnow will stay running in the tray' : 'Closing the window will quit Minnow');
          } catch {
            closeInput.checked = !checked;
            setStatus('err', 'Could not save desktop setting');
          }
        })();
      },
    },
  );
  section.appendChild(closeRow);

  const { row: startupRow, input: startupInput } = createSettingsToggleRow(
    'Launch Minnow at startup',
    {
      checked: desktopState.launchAtStartup,
      ariaLabel: 'Launch Minnow at startup',
      searchKey: 'general.desktop.launchAtStartup',
      description: 'Register Minnow to open when you sign in to this computer (Windows Startup Apps / macOS Login Items).',
      onChange: (checked) => {
        void (async () => {
          const tray = getTrayApi();
          if (!tray) return;
          try {
            const next = await tray.setLaunchAtStartup(checked);
            startupInput.checked = next.launchAtStartup;
            setStatus('ok', checked ? 'Minnow will launch at startup' : 'Removed from startup');
          } catch {
            startupInput.checked = !checked;
            setStatus('err', 'Could not update startup registration');
          }
        })();
      },
    },
  );
  section.appendChild(startupRow);

  const refreshStartup = (): void => {
    void readDesktopState().then((state) => {
      if (!state) return;
      startupInput.checked = state.launchAtStartup;
    });
  };

  window.addEventListener('focus', refreshStartup);
  mount.appendChild(section);
}
