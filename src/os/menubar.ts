import { getAppById } from './app-registry';
import {
  getForegroundAppId,
  getOsView,
  getTotalUnread,
  subscribeInstances,
} from './instances';
import { launchApp, navigateToDesktop } from './router';
import { MINNOW_GLYPH_HEADER_HTML } from '../ui/minnow-glyph';
import { createAppIcon, createOsIcon } from './icons';
import { initOsModelChipMenu } from './model-chip-menu';
import {
  chatToggleAriaLabel,
  isChatToggleVisible,
  isMenubarCenterVisible,
} from './menubar-visibility';
import { initOsNotificationsMenu } from './notifications-menu';
import { openSchedulerFromMenubar } from '../ui/scheduler-page';

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
  brand.textContent = 'MinnowOS';

  const desktopBtn = document.createElement('button');
  desktopBtn.type = 'button';
  desktopBtn.className = 'mn-os-mb-desktop';
  desktopBtn.hidden = true;
  desktopBtn.appendChild(createOsIcon('grid', { size: 15 }));
  desktopBtn.appendChild(document.createTextNode(' Desktop'));
  desktopBtn.addEventListener('click', () => navigateToDesktop());

  const sep = document.createElement('span');
  sep.className = 'mn-os-mb-sep';
  sep.hidden = true;

  const appName = document.createElement('span');
  appName.className = 'mn-os-mb-appname';
  appName.hidden = true;

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

  left.append(brand, desktopBtn, sep, appName, chatToggle);

  const center = document.createElement('div');
  center.id = 'osMenubarCenter';
  center.className = 'mn-os-mb-center';
  center.hidden = true;

  const settingsSlot = document.createElement('div');
  settingsSlot.id = 'osMenubarSettingsSearchSlot';
  settingsSlot.className = 'mn-os-mb-settings-slot';

  center.append(settingsSlot);

  const right = document.createElement('div');
  right.className = 'mn-os-mb-right';

  const workspaceSlot = document.createElement('div');
  workspaceSlot.id = 'osMenubarWorkspaceSlot';
  workspaceSlot.className = 'mn-os-mb-workspace-slot';
  workspaceSlot.hidden = true;

  const modelChip = document.createElement('button');
  modelChip.type = 'button';
  modelChip.className = 'mn-os-mb-chip';
  const chipDot = document.createElement('span');
  const chipText = document.createElement('span');
  chipText.className = 'mn-os-mb-chip-text';
  modelChip.append(chipDot, chipText);
  const cleanupModelChip = initOsModelChipMenu(modelChip, chipDot, chipText);

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

  right.append(workspaceSlot, modelChip, schedulerBtn, bell, settingsBtn, timeEl);
  root.append(left, center, right);

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

    center.hidden = !isMenubarCenterVisible(fgApp);
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

    const unread = getTotalUnread();
    bell.classList.toggle('is-on', unread > 0);
    if (unread > 0) {
      bellBadge.hidden = false;
      bellBadge.textContent = String(unread);
    } else {
      bellBadge.hidden = true;
      bellBadge.textContent = '';
    }
  }

  syncMenubar();
  const unsub = subscribeInstances(syncMenubar);

  const stopClock = startMenubarClock(timeEl);

  return () => {
    unsub();
    stopClock();
    cleanupModelChip();
    cleanupNotifications();
  };
}
