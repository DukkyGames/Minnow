/**
 * Settings → General: Desktop app (close-to-tray, launch at startup, interface zoom).
 */

import { detectConfigServer } from '../config/storage-mode';
import { setStatus } from './status';
import { appendSettingsOfflineHint, createSettingsSelectRow } from './settings-controls';
import { createSettingsToggleRow } from './settings-switch';

/** Match electron/shell-zoom.ts presets (renderer cannot import the main process module). */
const SHELL_ZOOM_PRESET_PERCENTS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 200] as const;

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

  const [closeToTray, loginItem, zoomPercent] = await Promise.all([
    api.getCloseToTray(),
    api.getLoginItem(),
    api.getZoomPercent(),
  ]);

  const zoomOptions = SHELL_ZOOM_PRESET_PERCENTS.map((value) => ({
    value: String(value),
    label: `${value}%`,
  }));
  const zoomKey = String(zoomPercent);
  if (!zoomOptions.some((opt) => opt.value === zoomKey)) {
    zoomOptions.push({ value: zoomKey, label: `${zoomPercent}%` });
  }

  const { row: zoomRow, select: zoomSelect } = createSettingsSelectRow('Interface zoom', {
    searchKey: 'general.desktop.zoom',
    description:
      'Scale the Minnow desktop window. Ctrl/Cmd + and − adjust zoom; Ctrl + scroll wheel zooms in and out; the value here updates to match.',
    options: zoomOptions,
    value: zoomKey,
    disabled: serverUp !== 'server',
  });

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

  mount.append(zoomRow, closeRow, loginRow);

  zoomSelect.addEventListener('change', () => {
    void (async () => {
      const raw = Number.parseInt(zoomSelect.value, 10);
      if (!Number.isFinite(raw)) return;
      try {
        const next = await api.setZoomPercent(raw);
        zoomSelect.value = String(next);
        setStatus('ok', `Interface zoom set to ${next}%`);
      } catch {
        zoomSelect.value = String(await api.getZoomPercent());
        setStatus('err', 'Could not save zoom preference');
      }
    })();
  });

  api.onZoomPercentChanged((percent) => {
    zoomSelect.value = String(percent);
  });

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
