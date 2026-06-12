import { APPS } from './app-registry';
import { loadDesktopPrefs, subscribeDesktopPrefs } from './desktop-prefs';
import { closeInstance, getInstanceSnapshot, subscribeInstances } from './instances';
import { launchApp } from './router';
import { renderConcierge } from './concierge';
import { createOsIcon } from './icons';
import { renderMiniPreviews } from './mini-previews';
import { renderWallpaper } from './wallpaper';
import type { AppId } from './types';

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Working late';
}

function formatDateTime(d: Date): { time: string; date: string } {
  return {
    time: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    date: d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
  };
}

function buildAppTile(
  app: (typeof APPS)[number],
  onLaunch: (appId: AppId) => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mn-os-tile-grid';
  btn.title = app.tag;

  const ico = document.createElement('span');
  ico.className = 'mn-os-tile-ico';
  ico.appendChild(createOsIcon(app.icon as 'code', { size: 26 }));
  btn.appendChild(ico);

  const name = document.createElement('span');
  name.className = 'mn-os-tile-name';
  name.textContent = app.name;
  btn.appendChild(name);

  const tag = document.createElement('span');
  tag.className = 'mn-os-tile-tag';
  tag.textContent = app.description;
  btn.appendChild(tag);

  btn.addEventListener('click', () => onLaunch(app.id));
  return btn;
}

/** Render the MinnowOS desktop (greeting, concierge, launcher, mini-previews). */
export function renderDesktop(root: HTMLElement): () => void {
  root.replaceChildren();
  root.className = 'mn-os-desktop';

  const prefs = loadDesktopPrefs();
  const now = new Date();
  const { time, date } = formatDateTime(now);

  const wallpaperMount = document.createElement('div');
  wallpaperMount.className = 'mn-os-desktop-wall';
  renderWallpaper(wallpaperMount, prefs.wallpaper);
  root.appendChild(wallpaperMount);

  const stage = document.createElement('div');
  stage.className = 'mn-os-desk-stage';

  const hero = document.createElement('div');
  hero.className = 'mn-os-desk-hero';

  const greetTime = document.createElement('div');
  greetTime.className = 'mn-os-greet-time mn-os-mono';
  greetTime.textContent = `${time} · ${date}`;

  const greet = document.createElement('h1');
  greet.className = 'mn-os-greet';
  greet.textContent = `${greetingFor(now)}.`;

  const greetSub = document.createElement('p');
  greetSub.className = 'mn-os-greet-sub';
  greetSub.textContent = "What should we get into? Tell me, and I'll open the right app.";

  hero.append(greetTime, greet, greetSub);

  const conciergeMount = document.createElement('div');
  const onLaunch = (appId: AppId, seed: string) => launchApp(appId, { seed });
  renderConcierge(conciergeMount, onLaunch);
  hero.appendChild(conciergeMount);
  stage.appendChild(hero);

  const gridMount = document.createElement('div');
  gridMount.className = 'mn-os-app-grid';
  gridMount.hidden = prefs.desktopLayout !== 'grid';
  for (const app of APPS) {
    gridMount.appendChild(buildAppTile(app, (id) => launchApp(id)));
  }
  stage.appendChild(gridMount);
  root.appendChild(stage);

  const previewsMount = document.createElement('div');
  previewsMount.className = 'mn-os-desktop-previews';
  root.appendChild(previewsMount);

  function refreshPreviews(): void {
    renderMiniPreviews(
      previewsMount,
      getInstanceSnapshot(),
      loadDesktopPrefs(),
      (id) => {
        const inst = getInstanceSnapshot().instances.find((i) => i.id === id);
        if (inst) launchApp(inst.appId);
      },
      (id) => closeInstance(id),
    );
  }

  function applyLayout(layout: 'concierge' | 'grid'): void {
    gridMount.hidden = layout !== 'grid';
  }

  function applyWallpaper(mode: ReturnType<typeof loadDesktopPrefs>['wallpaper']): void {
    renderWallpaper(wallpaperMount, mode);
  }

  refreshPreviews();

  const unsubInstances = subscribeInstances(() => refreshPreviews());
  const unsubPrefs = subscribeDesktopPrefs((p) => {
    applyLayout(p.desktopLayout);
    applyWallpaper(p.wallpaper);
    refreshPreviews();
  });

  return () => {
    unsubInstances();
    unsubPrefs();
  };
}
