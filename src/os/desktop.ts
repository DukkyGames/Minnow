import { loadDesktopPrefs, subscribeDesktopPrefs } from './desktop-prefs';
import { closeInstance, getInstanceSnapshot, subscribeInstances } from './instances';
import { launchApp } from './router';
import { renderConcierge } from './concierge';
import { renderMiniPreviews } from './mini-previews';
import { renderWallpaper, type WallpaperRenderOptions } from './wallpaper';
import { getAppearanceAssetObjectUrl } from '../appearance/asset-store';
import { wireDesktopChatRail } from '../ui/desktop-chat-rail';
import { subscribeDesktopState } from './desktop-state';
import { wireDesktopResearchControls } from './research-desktop';
import type { AppId, DesktopPrefs, LaunchOptions } from './types';

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

/** Milliseconds until the next wall-clock minute (for aligned tick updates). */
function msUntilNextMinute(d: Date): number {
  return (60 - d.getSeconds()) * 1000 - d.getMilliseconds();
}

/** Render the MinnowOS desktop (greeting, concierge, chat surface, mini-previews). */
export function renderDesktop(root: HTMLElement): () => void {
  root.replaceChildren();
  root.className = 'mn-os-desktop';
  root.id = 'osDesktopLayer';

  const prefs = loadDesktopPrefs();
  const now = new Date();
  const { time, date } = formatDateTime(now);

  const wallpaperMount = document.createElement('div');
  wallpaperMount.className = 'mn-os-desktop-wall';

  async function paintWallpaper(p: DesktopPrefs): Promise<void> {
    const options: WallpaperRenderOptions = {
      mode: p.wallpaper,
      imageFit: p.wallpaperImageFit ?? 'cover',
    };
    if (p.wallpaper === 'custom' && p.wallpaperImageId) {
      options.imageUrl = await getAppearanceAssetObjectUrl(p.wallpaperImageId);
    }
    renderWallpaper(wallpaperMount, options);
  }

  void paintWallpaper(prefs);
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
  conciergeMount.className = 'mn-os-concierge-mount';
  const onLaunch = (appId: AppId, options: LaunchOptions) => launchApp(appId, options);
  renderConcierge(conciergeMount, onLaunch);
  hero.appendChild(conciergeMount);

  const desktopChat = document.createElement('div');
  desktopChat.className = 'mn-os-desktop-chat';

  const rail = document.createElement('aside');
  rail.className = 'mn-os-chat-rail is-collapsed';
  rail.setAttribute('aria-label', 'Chat sessions');

  const railTab = document.createElement('button');
  railTab.type = 'button';
  railTab.id = 'btnDesktopChatRailToggle';
  railTab.className = 'mn-os-chat-rail-tab';
  railTab.setAttribute('aria-label', 'Show chat sessions');
  railTab.setAttribute('aria-expanded', 'false');
  railTab.textContent = 'Chats';

  const railPanel = document.createElement('div');
  railPanel.className = 'mn-os-chat-rail-panel';

  const railList = document.createElement('div');
  railList.id = 'desktopChatSessionList';
  railList.className = 'mn-os-chat-rail-list';
  railList.setAttribute('role', 'list');
  railPanel.appendChild(railList);
  rail.append(railTab, railPanel);

  const transcript = document.createElement('div');
  transcript.className = 'mn-os-chat-transcript';
  transcript.setAttribute('role', 'log');
  transcript.setAttribute('aria-live', 'polite');
  transcript.setAttribute('aria-label', 'Messages');

  const transcriptCol = document.createElement('div');
  transcriptCol.id = 'desktopChatCol';
  transcriptCol.className = 'mn-os-chat-col';
  transcript.appendChild(transcriptCol);

  const desktopResearch = document.createElement('div');
  desktopResearch.className = 'mn-os-desktop-research dr';
  desktopResearch.setAttribute('aria-label', 'Research');

  const researchToolbar = document.createElement('div');
  researchToolbar.className = 'mn-os-research-toolbar';

  const researchCancel = document.createElement('button');
  researchCancel.type = 'button';
  researchCancel.id = 'btnDesktopResearchCancel';
  researchCancel.className = 'mn-os-research-toolbar-btn';
  researchCancel.textContent = 'Cancel';
  researchCancel.hidden = true;

  const researchLibrary = document.createElement('button');
  researchLibrary.type = 'button';
  researchLibrary.id = 'btnDesktopResearchLibrary';
  researchLibrary.className = 'mn-os-research-toolbar-btn';
  researchLibrary.textContent = 'Library';

  researchToolbar.append(researchCancel, researchLibrary);

  const researchProgress = document.createElement('div');
  researchProgress.id = 'desktopResearchProgressMount';
  researchProgress.className = 'mn-os-research-card mn-os-research-progress';
  researchProgress.setAttribute('aria-live', 'polite');

  const researchResult = document.createElement('div');
  researchResult.id = 'desktopResearchResultMount';
  researchResult.className = 'mn-os-research-card mn-os-research-result';

  const researchLibraryMount = document.createElement('div');
  researchLibraryMount.id = 'desktopResearchLibraryMount';
  researchLibraryMount.className = 'mn-os-research-card mn-os-research-library hidden';

  desktopResearch.append(
    researchToolbar,
    researchProgress,
    researchResult,
    researchLibraryMount,
  );

  desktopChat.append(rail, transcript);
  stage.append(hero, desktopChat, desktopResearch);
  root.appendChild(stage);

  const composerDock = document.createElement('div');
  composerDock.className = 'mn-os-composer-dock';
  root.appendChild(composerDock);

  wireDesktopChatRail();
  wireDesktopResearchControls();

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

  function applyWallpaper(p: DesktopPrefs): void {
    void paintWallpaper(p);
  }
  refreshPreviews();

  function refreshGreetingClock(): void {
    const d = new Date();
    const formatted = formatDateTime(d);
    greetTime.textContent = `${formatted.time} · ${formatted.date}`;
    greet.textContent = `${greetingFor(d)}.`;
  }

  let clockInterval: number | undefined;
  const clockAlignTimeout = window.setTimeout(() => {
    refreshGreetingClock();
    clockInterval = window.setInterval(refreshGreetingClock, 60_000);
  }, msUntilNextMinute(new Date()));

  const unsubInstances = subscribeInstances(() => refreshPreviews());
  const unsubPrefs = subscribeDesktopPrefs((p) => {
    applyWallpaper(p);
    refreshPreviews();
  });
  const unsubDesktopState = subscribeDesktopState(() => {
    rail.hidden = false;
  });

  return () => {
    clearTimeout(clockAlignTimeout);
    if (clockInterval !== undefined) clearInterval(clockInterval);
    unsubInstances();
    unsubPrefs();
    unsubDesktopState();
  };
}
