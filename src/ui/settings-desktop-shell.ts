/**
 * Settings → General: Desktop app (close-to-tray, launch at startup).
 */

import { detectConfigServer } from '../config/storage-mode';
import { setStatus } from './status';
import { appendSettingsOfflineHint } from './settings-controls';
import { createSettingsToggleRow } from './settings-switch';

function isElectronShell(): boolean {
  return window.minnow?.app?.isElectron === true;
}

function trayApi(): NonNullable<typeof window.minnow>['tray'] | null {
  return window.minnow?.tray ?? null;
}

/** Render Desktop app controls into the General settings mount. */
export async function renderDesktopShellSettings(mount: HTMLElement): Promise<void> {
  if (!isElectronShell()) {
    appendSettingsOfflineHint(
      mount,
      'Desktop app settings are available in the Minnow Electron shell.',
    );
    return;
  }

  const api = trayApi();
  if (!api) {
    appendSettingsOfflineHint(mount, 'Update Minnow to a build that includes the system tray.');
    return;
  }

  const serverUp = await detectConfigServer();
  if (serverUp !== 'server') {
    appendSettingsOfflineHint(
      mount,
      'Close-to-tray requires Minnow running locally so preferences can be saved to config.json.',
    );
  }

  const [closeToTray, loginItem] = await Promise.all([
    api.getCloseToTray(),
    api.getLoginItem(),
  ]);

  const { row: closeRow, input: closeInput } = createSettingsToggleRow(
    'Keep Minnow running after closing the window',
    {
      searchKey: 'general.desktop.closeToTray',
      checked: closeToTray,
      disabled: serverUp !== 'server',
      description:
        'When enabled, closing the window hides Minnow in the system tray so chats and agents keep running.',
    },
  );

  const loginDescription = loginItem.supported
    ? 'Register Minnow as a login item so it opens when you sign in to this computer.'
    : 'Launch at startup is not supported on this platform.';

  const { row: loginRow, input: loginInput } = createSettingsToggleRow(
    'Launch Minnow at startup',
    {
      searchKey: 'general.desktop.launchAtStartup',
      checked: loginItem.openAtLogin,
      disabled: !loginItem.supported,
      description: loginDescription,
    },
  );

  mount.append(closeRow, loginRow);

  closeInput.addEventListener('change', () => {
    void (async () => {
      try {
        const next = await api.setCloseToTray(closeInput.checked);
        closeInput.checked = next;
        setStatus('ok', next ? 'Minnow will stay running in the tray' : 'Closing the window will quit Minnow');
      } catch {
        closeInput.checked = !closeInput.checked;
        setStatus('err', 'Could not save desktop preference');
      }
    })();
  });

  loginInput.addEventListener('change', () => {
    void (async () => {
      try {
        const next = await api.setLoginItem(loginInput.checked);
        loginInput.checked = next.openAtLogin;
        setStatus('ok', next.openAtLogin ? 'Minnow will launch at startup' : 'Startup launch disabled');
      } catch {
        loginInput.checked = !loginInput.checked;
        setStatus('err', 'Could not update startup registration');
      }
    })();
  });

  api.onCloseToTrayChanged((enabled) => {
    closeInput.checked = enabled;
  });

  const refreshLogin = () => {
    void api.getLoginItem().then((next) => {
      loginInput.checked = next.openAtLogin;
      loginInput.disabled = !next.supported;
    });
  };
  window.addEventListener('focus', refreshLogin);
}
