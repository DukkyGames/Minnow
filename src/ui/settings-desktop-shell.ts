/**
 * Settings → General: Desktop app (close-to-tray, launch at startup).
 */

import { detectConfigServer } from '../config/storage-mode';
import { setStatus } from './status';
import { appendSettingsOfflineHint } from './settings-controls';

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

function isElectronShell(): boolean {
  return window.minnow?.app?.isElectron === true;
}

function trayApi(): NonNullable<typeof window.minnow>['tray'] | null {
  return window.minnow?.tray ?? null;
}

/** Render Desktop app controls into the General settings mount. */
export async function renderDesktopShellSettings(mount: HTMLElement): Promise<void> {
  const section = el('section', 'settings-desktop-shell');
  section.dataset.settingsSearchKey = 'general.desktop';

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
      'Close-to-tray requires <code>npm start</code> so preferences can be saved to config.json.',
    );
  }

  const [closeToTray, loginItem] = await Promise.all([
    api.getCloseToTray(),
    api.getLoginItem(),
  ]);

  const closeRow = el('label', 'settings-toggle-row');
  const closeInput = document.createElement('input');
  closeInput.type = 'checkbox';
  closeInput.checked = closeToTray;
  closeInput.disabled = serverUp !== 'server';
  closeRow.append(
    closeInput,
    el(
      'span',
      'settings-toggle-label',
      'Keep Minnow running after closing the window',
    ),
  );
  closeRow.appendChild(
    el(
      'p',
      'settings-field-hint',
      'When enabled, closing the window hides Minnow in the system tray so chats and agents keep running.',
    ),
  );

  const loginRow = el('label', 'settings-toggle-row');
  const loginInput = document.createElement('input');
  loginInput.type = 'checkbox';
  loginInput.checked = loginItem.openAtLogin;
  loginInput.disabled = !loginItem.supported;
  loginRow.append(loginInput, el('span', 'settings-toggle-label', 'Launch Minnow at startup'));
  if (!loginItem.supported) {
    loginRow.appendChild(
      el('p', 'settings-field-hint', 'Launch at startup is not supported on this platform.'),
    );
  }

  section.append(closeRow, loginRow);
  mount.appendChild(section);

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
