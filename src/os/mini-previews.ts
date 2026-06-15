import { APPS, getAppById, getPresentationMode } from './app-registry';
import { createAppIcon, createOsIcon } from './icons';
import { isWindowMountedApp } from './window-mounted-apps';
import type { AppInstance } from './types';
import type { DesktopPrefs } from './types';

/** Render minimized instance previews (card or tile style). */
export function renderMiniPreviews(
  container: HTMLElement,
  snapshot: {
    instances: readonly AppInstance[];
    foregroundId: string | null;
    view: 'desktop' | 'app';
  },
  prefs: Pick<DesktopPrefs, 'previewStyle'>,
  onRestore: (id: string) => void,
  onClose: (id: string) => void,
): void {
  container.replaceChildren();

  // Mini-stack cards belong on the desktop launcher only — not over foreground apps.
  if (snapshot.view === 'app') return;

  const minimized = snapshot.instances.filter((i) => {
    // Window-mounted apps use WindowFrame minimize — skip duplicate desktop cards.
    if (isWindowMountedApp(i.appId) && getPresentationMode(i.appId) === 'window') {
      return false;
    }
    return i.id !== snapshot.foregroundId || snapshot.view === 'desktop';
  });

  if (minimized.length === 0) return;

  const stack = document.createElement('div');
  stack.className = `mn-os-mini-stack mn-os-stack-${prefs.previewStyle}`;

  const label = document.createElement('div');
  label.className = 'mn-os-mini-stack-label mn-os-mono';
  label.textContent = `RUNNING · ${minimized.length}`;
  stack.appendChild(label);

  for (const inst of minimized) {
    const app = getAppById(inst.appId);
    if (!app) continue;
    if (prefs.previewStyle === 'tile') {
      stack.appendChild(buildTilePreview(inst, app.name, onRestore, onClose));
    } else {
      stack.appendChild(buildCardPreview(inst, app, onRestore, onClose));
    }
  }

  container.appendChild(stack);
}

function buildTilePreview(
  inst: AppInstance,
  name: string,
  onRestore: (id: string) => void,
  onClose: (id: string) => void,
): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `mn-os-mini-tile${inst.unread ? ' is-alert' : ''}`;
  btn.addEventListener('click', () => onRestore(inst.id));

  const iconKey = APPS.find((a) => a.id === inst.appId)?.icon ?? 'chat';
  btn.appendChild(createAppIcon(iconKey as 'code', { size: 22 }));

  const nameEl = document.createElement('span');
  nameEl.className = 'mn-os-mini-tile-name';
  nameEl.textContent = name;
  btn.appendChild(nameEl);

  if (inst.unread > 0) {
    const badge = document.createElement('span');
    badge.className = 'mn-os-badge';
    badge.textContent = String(inst.unread);
    btn.appendChild(badge);
  }

  const close = document.createElement('span');
  close.className = 'mn-os-mini-x';
  close.appendChild(createOsIcon('close', { size: 13 }));
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    onClose(inst.id);
  });
  btn.appendChild(close);

  return btn;
}

function buildCardPreview(
  inst: AppInstance,
  app: (typeof APPS)[number],
  onRestore: (id: string) => void,
  onClose: (id: string) => void,
): HTMLElement {
  const card = document.createElement('div');
  card.className = `mn-os-mini-card${inst.unread ? ' is-alert' : ''}`;
  card.addEventListener('click', () => onRestore(inst.id));

  const head = document.createElement('div');
  head.className = 'mn-os-mini-head';

  const ico = document.createElement('span');
  ico.className = 'mn-os-mini-ico';
  ico.appendChild(createAppIcon(app.icon as 'code', { size: 16 }));
  head.appendChild(ico);

  const title = document.createElement('span');
  title.className = 'mn-os-mini-title';
  title.textContent = app.name;
  head.appendChild(title);

  if (inst.unread > 0) {
    const badge = document.createElement('span');
    badge.className = 'mn-os-badge';
    badge.appendChild(createOsIcon('bell', { size: 11 }));
    badge.appendChild(document.createTextNode(String(inst.unread)));
    head.appendChild(badge);
  }

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'mn-os-mini-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.appendChild(createOsIcon('close', { size: 14 }));
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClose(inst.id);
  });
  head.appendChild(closeBtn);
  card.appendChild(head);

  const body = document.createElement('div');
  body.className = 'mn-os-mini-body';

  const snap = document.createElement('div');
  snap.className = 'mn-os-mini-snap';
  if (app.id === 'code') {
    snap.appendChild(buildCodeSnap());
  } else {
    const generic = document.createElement('div');
    generic.className = 'mn-os-snap-generic';
    generic.appendChild(createAppIcon(app.icon as 'code', { size: 34 }));
    snap.appendChild(generic);
  }
  body.appendChild(snap);

  const msg = document.createElement('div');
  msg.className = `mn-os-mini-msg${inst.unread ? '' : ' is-dim'}`;
  if (inst.unread > 0) {
    const dot = document.createElement('span');
    dot.className = 'mn-os-cc-dot';
    msg.appendChild(dot);
    msg.appendChild(document.createTextNode(` ${inst.msg}`));
  } else {
    msg.textContent = app.tag;
  }
  body.appendChild(msg);
  card.appendChild(body);

  return card;
}

function buildCodeSnap(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mn-os-snap-code';

  const lines = document.createElement('div');
  lines.className = 'mn-os-snap-lines';
  for (const w of [60, 40, 75, 30, 55, 45]) {
    const span = document.createElement('span');
    span.style.width = `${w}%`;
    lines.appendChild(span);
  }
  wrap.appendChild(lines);

  const side = document.createElement('div');
  side.className = 'mn-os-snap-side';
  for (let i = 0; i < 5; i++) {
    side.appendChild(document.createElement('span'));
  }
  wrap.appendChild(side);

  return wrap;
}
