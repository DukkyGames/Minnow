import '../styles/calendar.css';
import '../styles/calendar-window.css';

import { createAppIcon } from '../os/icons';
import { isOsAppHash, isOsShellEnabled } from '../os/page-bridge';
import { launchApp, navigateToDesktop } from '../os/router';
import { registerWindowTeardown, requestCloseWindowApp } from '../os/window-mounted-apps';
import { renderCalendarPanel } from './calendar/calendar-panel';

let initialized = false;
let statusTimer: number | undefined;

function getRoot(): HTMLElement | null {
  return document.getElementById('calendarView');
}

function getBody(): HTMLElement | null {
  return document.getElementById('calendarPanelMount');
}

function getStatusEl(): HTMLElement | null {
  return document.getElementById('calendarStatus');
}

function setPanelStatus(state: 'ok' | 'err', message: string): void {
  const el = getStatusEl();
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('is-err', state === 'err');
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    el.textContent = '';
    el.classList.remove('is-err');
  }, 4000);
}

async function refreshPanel(): Promise<void> {
  const body = getBody();
  if (!body) return;
  await renderCalendarPanel(body, { onStatus: setPanelStatus });
}

function mountHeaderIcon(): void {
  const slot = document.getElementById('calendarPageIcon');
  if (!slot || slot.childElementCount > 0) return;
  slot.appendChild(createAppIcon('calendar'));
}

export function initCalendarPage(): void {
  if (initialized) return;
  initialized = true;
  registerWindowTeardown('calendar', () => closeCalendar({ skipNavigate: true }));
  mountHeaderIcon();
  window.addEventListener('hashchange', onHashChange);
  if (
    window.location.hash === '#/calendar' ||
    window.location.hash.startsWith('#/app/calendar')
  ) {
    if (isOsShellEnabled()) {
      launchApp('calendar');
    } else {
      void openCalendar();
    }
  }
}

/** Mount calendar content (window frame is opened by app-host / launchApp). */
export async function openCalendar(): Promise<void> {
  const root = getRoot();
  if (!root) return;

  root.classList.add('is-open');
  if (!isOsShellEnabled()) {
    window.location.hash = '#/calendar';
  }
  mountHeaderIcon();
  await refreshPanel();
}

export function closeCalendar(options?: { skipNavigate?: boolean }): void {
  const root = getRoot();
  if (!root) return;
  root.classList.remove('is-open');
  if (!isOsShellEnabled()) {
    if (!options?.skipNavigate && window.location.hash.startsWith('#/calendar')) {
      window.location.hash = '#/';
    }
  } else if (!options?.skipNavigate) {
    if (!requestCloseWindowApp('calendar')) {
      navigateToDesktop();
    }
  }
}

export function isCalendarPageOpen(): boolean {
  return getRoot()?.classList.contains('is-open') ?? false;
}

function onHashChange(): void {
  const hash = window.location.hash;
  if (hash === '#/calendar' || hash.startsWith('#/app/calendar')) {
    if (isOsShellEnabled()) {
      launchApp('calendar');
      return;
    }
    void openCalendar();
    return;
  }
  if (isOsShellEnabled() && isOsAppHash(hash)) return;
  if (isCalendarPageOpen()) {
    closeCalendar();
  }
}

/** Menubar shortcut — opens the Calendar app in Minnow. */
export function openCalendarFromMenubar(): void {
  if (isOsShellEnabled()) {
    launchApp('calendar');
    return;
  }
  void openCalendar();
}
