/**
 * Authenticated narrow-screen companion bootstrap and host reconnect feedback.
 */

import '../styles/companion.css';
import { initializeDevicePairing } from '../api/device-auth.ts';
import { clearDeviceToken, getDeviceToken, hasHostSessionToken } from '../api/session-token.ts';
import { listComposerModes } from '../chat/modes/registry.ts';
import { isModeId } from '../chat/modes/types.ts';
import { getActiveChat } from '../state/sessions.ts';
import { setChatMode } from '../ui/mode-selector.ts';

const COMPANION_MEDIA = '(max-width: 640px)';
const RECONNECT_INTERVAL_MS = 5_000;

let reconnectTimer: number | undefined;

function installModePicker(): void {
  const header = document.querySelector<HTMLElement>('.chat-app-top');
  if (!header || document.getElementById('companionModeSelect')) return;

  const select = document.createElement('select');
  select.id = 'companionModeSelect';
  select.className = 'companion-mode-select';
  select.setAttribute('aria-label', 'Chat mode');
  for (const mode of listComposerModes()) {
    const option = document.createElement('option');
    option.value = mode.id;
    option.textContent = mode.label;
    select.appendChild(option);
  }
  const syncValue = () => {
    try {
      select.value = getActiveChat().modeId;
    } catch {
      select.value = 'general';
    }
  };
  select.addEventListener('focus', syncValue);
  select.addEventListener('change', () => {
    if (!isModeId(select.value)) return;
    const result = setChatMode(select.value);
    if (!result.ok) syncValue();
  });
  syncValue();
  header.appendChild(select);
}

function renderAccessScreen(kind: 'required' | 'failed' | 'revoked'): void {
  document.documentElement.classList.add('minnow-companion-access');
  const existing = document.getElementById('companionAccess');
  existing?.remove();

  const screen = document.createElement('main');
  screen.id = 'companionAccess';
  screen.className = 'companion-access';
  screen.setAttribute('aria-labelledby', 'companionAccessTitle');

  const title = document.createElement('h1');
  title.id = 'companionAccessTitle';
  title.textContent = kind === 'revoked' ? 'Device access revoked' : 'Pair this device';

  const copy = document.createElement('p');
  copy.textContent =
    kind === 'failed'
      ? 'This pairing link is invalid, expired, or already used. Create a new link in Minnow Settings.'
      : kind === 'revoked'
        ? 'This device no longer has access. Create a new pairing from the host to reconnect.'
        : 'On the host, open Settings → General → Network access and scan a fresh pairing QR code.';

  const hint = document.createElement('p');
  hint.className = 'companion-access__hint';
  hint.textContent = 'Minnow companion works only while the host is running on the same network.';

  screen.append(title, copy, hint);
  document.body.appendChild(screen);
}

function ensureReconnectBanner(): HTMLElement {
  let banner = document.getElementById('companionReconnect');
  if (banner) return banner;
  banner = document.createElement('div');
  banner.id = 'companionReconnect';
  banner.className = 'companion-reconnect';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.textContent = 'Host unreachable — reconnecting…';
  banner.hidden = true;
  document.body.appendChild(banner);
  return banner;
}

async function probeHost(): Promise<void> {
  if (!document.documentElement.classList.contains('minnow-companion')) return;
  const banner = ensureReconnectBanner();
  try {
    const response = await fetch('/api/tools/ping', { cache: 'no-store' });
    if (response.status === 401) {
      clearDeviceToken();
      renderAccessScreen('revoked');
      return;
    }
    banner.hidden = response.ok;
  } catch {
    banner.hidden = false;
  }
}

function startReconnectMonitor(): void {
  if (reconnectTimer !== undefined) return;
  const probe = () => void probeHost();
  window.addEventListener('online', probe);
  window.addEventListener('offline', probe);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') probe();
  });
  window.addEventListener('minnow-auth-revoked', () => {
    clearDeviceToken();
    renderAccessScreen('revoked');
  });
  reconnectTimer = window.setInterval(probe, RECONNECT_INTERVAL_MS);
  probe();
}

function applyCompanionViewport(): void {
  const enabled =
    !hasHostSessionToken() &&
    Boolean(getDeviceToken()) &&
    window.matchMedia(COMPANION_MEDIA).matches;
  document.documentElement.classList.toggle('minnow-companion', enabled);
  if (!enabled) return;

  if (window.location.hash !== '#/app/chat') {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/app/chat`);
  }
  installModePicker();
  startReconnectMonitor();
}

/**
 * Pair a remote browser before normal API boot. Returns false when the access
 * screen owns the page and Minnow must not make additional API requests.
 */
export async function initializeCompanionAccess(): Promise<boolean> {
  const state = await initializeDevicePairing();
  if (state === 'pairing-required') {
    renderAccessScreen('required');
    return false;
  }
  if (state === 'pairing-failed') {
    renderAccessScreen('failed');
    return false;
  }

  applyCompanionViewport();
  window.matchMedia(COMPANION_MEDIA).addEventListener('change', applyCompanionViewport);
  return true;
}

