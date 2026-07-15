import { getAppById } from './app-registry';
import {
  getForegroundAppId,
  getOsView,
  subscribeInstances,
} from './instances';
import { getUnreadNotificationCount } from './notifications-menu';
import { onNewNotification } from '../notifications/push';
import { subscribeNotifications } from '../notifications/store';
import { launchApp, navigateToDesktop } from './router';
import { MINNOW_GLYPH_HEADER_HTML } from '../ui/minnow-glyph';
import { createAppIcon, createOsIcon } from './icons';
import { chatToggleAriaLabel, isChatToggleVisible } from './menubar-visibility';
import { initOsNotificationsMenu } from './notifications-menu';
import { openSchedulerFromMenubar } from '../ui/scheduler-page';
import { initShellMenubarChrome } from './menubar-window-controls';

function formatClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Tick the menubar clock on minute boundaries and when the window becomes visible again. */
function startMenubarClock(el: HTMLElement): () => void {
  const tick = () => {
    el.textContent = formatClock(new Date());
  };

  tick();

  let minuteTimer: number | undefined;

  const scheduleNextMinute = () => {
    const now = new Date();
    const msUntilNextMinute =
      (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50;
    minuteTimer = window.setTimeout(() => {
      tick();
      scheduleNextMinute();
    }, msUntilNextMinute);
  };

  scheduleNextMinute();

  const onVisibility = () => {
    if (document.visibilityState !== 'visible') return;
    tick();
    if (minuteTimer !== undefined) clearTimeout(minuteTimer);
    scheduleNextMinute();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    if (minuteTimer !== undefined) clearTimeout(minuteTimer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/** Render the MinnowOS menubar. Returns cleanup function. */
export function renderMenubar(root: HTMLElement): () => void {
  root.replaceChildren();
  root.className = 'mn-os-menubar';

  const left = document.createElement('div');
  left.className = 'mn-os-mb-left';

  const logo = document.createElement('div');
  logo.className = 'mn-os-mb-logo';
  logo.innerHTML = MINNOW_GLYPH_HEADER_HTML;
  left.appendChild(logo);

  const brand = document.createElement('span');
  brand.className = 'mn-os-mb-brand';
  brand.textContent = 'Minnow';

  const statusPill = document.createElement('div');
  statusPill.className = 'mn-os-mb-status status-pill';
  statusPill.setAttribute('role', 'status');
  statusPill.setAttribute('aria-live', 'polite');
  const statusDot = document.createElement('div');
  statusDot.className = 's-dot';
  statusDot.id = 'osStatusDot';
  statusDot.setAttribute('aria-hidden', 'true');
  const statusText = document.createElement('span');
  statusText.id = 'osStatusText';
  statusText.textContent = 'Loading models…';
  statusPill.append(statusDot, statusText);
  // Mirror legacy topbar pill when menubar mounts after early boot status updates.
  const legacyDot = document.getElementById('sDot');
  const legacyText = document.getElementById('sText');
  if (legacyDot && legacyText) {
    statusDot.className = legacyDot.className;
    statusText.textContent = legacyText.textContent?.trim() || 'Loading models…';
    const title = legacyText.getAttribute('title');
    if (title) statusText.setAttribute('title', title);
  }

  const desktopBtn = document.createElement('button');
  desktopBtn.type = 'button';
  desktopBtn.className = 'mn-os-mb-desktop';
  desktopBtn.hidden = true;
  desktopBtn.appendChild(createOsIcon('grid', { size: 15 }));
  desktopBtn.appendChild(document.createTextNode(' Desktop'));
  desktopBtn.addEventListener('click', () => navigateToDesktop());

  const sep = document.createElement('span');
  sep.className = 'mn-os-mb-sep mn-os-mb-app-sep';
  sep.hidden = true;

  const appName = document.createElement('span');
  appName.className = 'mn-os-mb-appname';
  appName.hidden = true;

  const statusSep = document.createElement('span');
  statusSep.className = 'mn-os-mb-sep mn-os-mb-status-sep';

  const chatToggle = document.createElement('button');
  chatToggle.type = 'button';
  chatToggle.className = 'mn-os-mb-icon mn-os-mb-chat-toggle';
  chatToggle.setAttribute('aria-label', 'Chat sessions');
  chatToggle.hidden = true;
  chatToggle.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
  chatToggle.addEventListener('click', () => {
    const fg = getForegroundAppId();
    if (fg === 'chat') {
      void import('../ui/chat-app').then((m) => {
        m.toggleChatAppSessionRail();
        chatToggle.setAttribute(
          'aria-pressed',
          m.isChatAppSessionRailHidden() ? 'false' : 'true',
        );
      });
      return;
    }
    void import('../ui/layout').then((m) => m.toggleSidebarLayout());
  });

  left.append(brand, desktopBtn, sep, appName, statusSep, statusPill, chatToggle);

  const right = document.createElement('div');
  right.className = 'mn-os-mb-right';

  const workspaceSlot = document.createElement('div');
  workspaceSlot.id = 'osMenubarWorkspaceSlot';
  workspaceSlot.className = 'mn-os-mb-workspace-slot';
  workspaceSlot.hidden = true;

  const schedulerBtn = document.createElement('button');
  schedulerBtn.type = 'button';
  schedulerBtn.className = 'mn-os-mb-icon mn-os-mb-scheduler';
  schedulerBtn.setAttribute('aria-label', 'Scheduler');
  schedulerBtn.title = 'Scheduler';
  schedulerBtn.appendChild(createAppIcon('scheduler', { size: 16 }));
  schedulerBtn.addEventListener('click', () => openSchedulerFromMenubar());

  const bell = document.createElement('button');
  bell.type = 'button';
  bell.className = 'mn-os-mb-bell';
  bell.setAttribute('aria-label', 'Notifications');
  bell.appendChild(createOsIcon('bell', { size: 16 }));
  const bellBadge = document.createElement('span');
  bellBadge.className = 'mn-os-bell-badge';
  bellBadge.hidden = true;
  bell.appendChild(bellBadge);
  const cleanupNotifications = initOsNotificationsMenu(bell);

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'mn-os-mb-icon';
  settingsBtn.setAttribute('aria-label', 'Settings');
  settingsBtn.appendChild(createOsIcon('gear', { size: 16 }));
  settingsBtn.addEventListener('click', () => launchApp('settings'));

  const timeEl = document.createElement('span');
  timeEl.className = 'mn-os-mb-time mn-os-mono';
  timeEl.textContent = formatClock(new Date());

  right.append(workspaceSlot, schedulerBtn, bell, settingsBtn, timeEl);
  root.append(left, right);

  const cleanupShellChrome = initShellMenubarChrome(root, right);

  function syncMenubar(): void {
    const view = getOsView();
    const fgApp = getForegroundAppId();
    const onDesktop = view === 'desktop';

    root.dataset.view = view;
    brand.hidden = !onDesktop;
    desktopBtn.hidden = onDesktop;
    sep.hidden = onDesktop;
    appName.hidden = onDesktop;

    if (!onDesktop && fgApp) {
      const meta = getAppById(fgApp);
      appName.replaceChildren();
      if (meta) {
        appName.appendChild(createAppIcon(meta.icon as 'code', { size: 14 }));
        appName.appendChild(document.createTextNode(` ${meta.name}`));
      }
    }

    chatToggle.hidden = !isChatToggleVisible(fgApp);
    const toggleLabel = chatToggleAriaLabel(fgApp);
    if (toggleLabel) {
      chatToggle.setAttribute('aria-label', toggleLabel);
    }
    if (fgApp === 'chat') {
      void import('../ui/chat-app').then((m) => {
        chatToggle.setAttribute(
          'aria-pressed',
          m.isChatAppSessionRailHidden() ? 'false' : 'true',
        );
      });
    } else {
      chatToggle.removeAttribute('aria-pressed');
    }

    void import('./workspace-menubar').then((m) => m.syncWorkspaceMenubarPlacement());

    const unread = getUnreadNotificationCount();
    bell.classList.toggle('is-on', unread > 0);
    if (unread > 0) {
      bellBadge.hidden = false;
      bellBadge.textContent = unread > 99 ? '99+' : String(unread);
    } else {
      bellBadge.hidden = true;
      bellBadge.textContent = '';
    }
  }

  function ringBell(): void {
    bell.classList.remove('is-ringing');
    // Force reflow so repeated notifications retrigger animation.
    void bell.offsetWidth;
    bell.classList.add('is-ringing');
    window.setTimeout(() => bell.classList.remove('is-ringing'), 1200);
  }

  syncMenubar();
  const unsub = subscribeInstances(syncMenubar);
  const unsubInbox = subscribeNotifications(syncMenubar);
  const unsubNotif = onNewNotification((record) => {
    syncMenubar();
    if (!record.read) ringBell();
  });

  const stopClock = startMenubarClock(timeEl);

  return () => {
    unsub();
    unsubInbox();
    unsubNotif();
    stopClock();
    cleanupNotifications();
    cleanupShellChrome();
  };
}
