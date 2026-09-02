import '../styles/email.css';

import { isOsAppHash, isOsShellEnabled } from '../os/page-bridge';
import { navigateToDesktop } from '../os/router';
import { renderEmailPanel } from './email/email-panel';

let initialized = false;
let statusTimer: number | undefined;

function getRoot(): HTMLElement | null {
  return document.getElementById('emailView');
}

function getBody(): HTMLElement | null {
  return document.getElementById('emailPanelMount');
}

function getStatusEl(): HTMLElement | null {
  return document.getElementById('emailStatus');
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
  await renderEmailPanel(body, { onStatus: setPanelStatus });
}

export function initEmailPage(): void {
  if (initialized) return;
  initialized = true;
  window.addEventListener('hashchange', onHashChange);
  if (window.location.hash === '#/email' || window.location.hash.startsWith('#/app/email')) {
    void openEmail();
  }
}

export async function openEmail(): Promise<void> {
  const root = getRoot();
  if (!root) return;

  root.classList.add('is-open');
  if (!isOsShellEnabled()) {
    window.location.hash = '#/email';
  }
  await refreshPanel();
}

export function closeEmail(options?: { skipNavigate?: boolean }): void {
  const root = getRoot();
  if (!root) return;
  root.classList.remove('is-open');
  if (!isOsShellEnabled()) {
    if (!options?.skipNavigate && window.location.hash.startsWith('#/email')) {
      window.location.hash = '#/';
    }
  } else if (!options?.skipNavigate) {
    navigateToDesktop();
  }
}

export function isEmailPageOpen(): boolean {
  return getRoot()?.classList.contains('is-open') ?? false;
}

function onHashChange(): void {
  const hash = window.location.hash;
  if (hash === '#/email' || hash.startsWith('#/app/email')) {
    void openEmail();
    return;
  }
  if (isOsShellEnabled() && isOsAppHash(hash)) return;
  if (isEmailPageOpen()) {
    closeEmail();
  }
}

/** Menubar shortcut — opens the Email app in Minnow. */
export function openEmailFromMenubar(): void {
  if (isOsShellEnabled()) {
    void import('../os/router').then((m) => m.launchApp('email'));
    return;
  }
  void openEmail();
}
