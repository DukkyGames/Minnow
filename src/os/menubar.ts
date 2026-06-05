import { APPS, getAppById } from './app-registry';
import {
  getForegroundAppId,
  getInstanceSnapshot,
  getOsView,
  getTotalUnread,
  subscribeInstances,
} from './instances';
import { launchApp, navigateToDesktop } from './router';
import { createOsIcon } from './icons';
import type { AppId } from './types';

const CLOCK_INTERVAL_MS = 30_000;

function formatClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function syncModelChipText(chipText: HTMLElement): void {
  const source = document.getElementById('modelSelectTriggerText');
  if (source) {
    chipText.textContent = source.textContent?.trim() || 'No model';
  }
}

/** Render the MinnowOS menubar. Returns cleanup function. */
export function renderMenubar(root: HTMLElement): () => void {
  root.replaceChildren();
  root.className = 'mn-os-menubar';

  const left = document.createElement('div');
  left.className = 'mn-os-mb-left';

  const logo = document.createElement('div');
  logo.className = 'mn-os-mb-logo';
  logo.appendChild(createOsIcon('fish', { size: 18 }));
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

  left.append(brand, desktopBtn, sep, appName);

  const right = document.createElement('div');
  right.className = 'mn-os-mb-right';

  const modelChip = document.createElement('button');
  modelChip.type = 'button';
  modelChip.className = 'mn-os-mb-chip';
  const wsDot = document.createElement('span');
  wsDot.className = 'mn-os-ws-dot is-ok';
  wsDot.setAttribute('aria-hidden', 'true');
  const chipText = document.createElement('span');
  modelChip.append(wsDot, chipText);
  syncModelChipText(chipText);

  const bell = document.createElement('button');
  bell.type = 'button';
  bell.className = 'mn-os-mb-bell';
  bell.setAttribute('aria-label', 'Notifications');
  bell.appendChild(createOsIcon('bell', { size: 16 }));
  const bellBadge = document.createElement('span');
  bellBadge.className = 'mn-os-bell-badge';
  bellBadge.hidden = true;
  bell.appendChild(bellBadge);
  bell.addEventListener('click', () => {
    const snap = getInstanceSnapshot();
    const unreadInst = snap.instances.find((i) => i.unread > 0);
    if (unreadInst) launchApp(unreadInst.appId);
  });

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'mn-os-mb-icon';
  settingsBtn.setAttribute('aria-label', 'Settings');
  settingsBtn.appendChild(createOsIcon('gear', { size: 16 }));
  settingsBtn.addEventListener('click', () => launchApp('settings'));

  const timeEl = document.createElement('span');
  timeEl.className = 'mn-os-mb-time mn-os-mono';
  timeEl.textContent = formatClock(new Date());

  right.append(modelChip, bell, settingsBtn, timeEl);
  root.append(left, right);

  function syncMenubar(): void {
    const view = getOsView();
    const fgApp = getForegroundAppId();
    const onDesktop = view === 'desktop';

    brand.hidden = !onDesktop;
    desktopBtn.hidden = onDesktop;
    sep.hidden = onDesktop;
    appName.hidden = onDesktop;

    if (!onDesktop && fgApp) {
      const meta = getAppById(fgApp);
      appName.replaceChildren();
      if (meta) {
        appName.appendChild(createOsIcon(meta.icon as 'code', { size: 14 }));
        appName.appendChild(document.createTextNode(` ${meta.name}`));
      }
    }

    const unread = getTotalUnread();
    bell.classList.toggle('is-on', unread > 0);
    if (unread > 0) {
      bellBadge.hidden = false;
      bellBadge.textContent = String(unread);
    } else {
      bellBadge.hidden = true;
    }
  }

  syncMenubar();
  const unsub = subscribeInstances(syncMenubar);

  const clockIv = window.setInterval(() => {
    timeEl.textContent = formatClock(new Date());
  }, CLOCK_INTERVAL_MS);

  const modelSource = document.getElementById('modelSelectTriggerText');
  let modelObserver: MutationObserver | null = null;
  let modelPoll: number | undefined;
  if (modelSource) {
    modelObserver = new MutationObserver(() => syncModelChipText(chipText));
    modelObserver.observe(modelSource, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  } else {
    modelPoll = window.setInterval(() => syncModelChipText(chipText), 2000);
  }

  return () => {
    unsub();
    clearInterval(clockIv);
    modelObserver?.disconnect();
    if (modelPoll !== undefined) clearInterval(modelPoll);
  };
}
