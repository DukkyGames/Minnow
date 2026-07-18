import { loadDesktopPrefs, subscribeDesktopPrefs } from './desktop-prefs';
import { renderConcierge } from './concierge';
import { renderWallpaper, type WallpaperRenderOptions } from './wallpaper';
import { getAppearanceAssetObjectUrl } from '../appearance/asset-store';
import { bindDesktopChatTranscriptScroll } from '../ui/chat-scroll';
import { wireDesktopChatRail } from '../ui/desktop-chat-rail';
import {
  renderDesktopWorkspaceRail,
  wireDesktopWorkspaceRail,
} from './desktop-workspace-rail';
import { isDesktopExpertsActive, isDesktopResearchActive, subscribeDesktopState } from './desktop-state';
import { wireDesktopResearchControls } from './research-desktop';
import { createOsIcon } from './icons';
import { ICON_CHEVRON_LEFT, ICON_SEARCH } from '../constants';
import type { DesktopPrefs } from './types';

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

/** Render the MinnowOS desktop (greeting, concierge, chat surface). */
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
  greetSub.textContent = "What should we get into? Tell me below — we'll start in chat.";

  hero.append(greetTime, greet, greetSub);

  const expertsHeroMount = document.createElement('div');
  expertsHeroMount.id = 'desktopExpertsHeroMount';
  expertsHeroMount.className = 'mn-os-experts-hero-mount hidden';
  expertsHeroMount.setAttribute('aria-hidden', 'true');
  hero.appendChild(expertsHeroMount);

  const conciergeMount = document.createElement('div');
  conciergeMount.className = 'mn-os-concierge-mount';
  renderConcierge(conciergeMount);
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
  railTab.appendChild(createOsIcon('chat', { size: 28 }));

  const railPanel = document.createElement('div');
  railPanel.className = 'mn-os-chat-rail-panel';

  const railMain = document.createElement('div');
  railMain.className = 'mn-os-chat-rail-main';

  const railHeader = document.createElement('div');
  railHeader.className = 'chat-sidebar-header';

  const railTitle = document.createElement('span');
  railTitle.className = 'chat-sidebar-title';
  railTitle.textContent = 'Chats';

  const railSearch = document.createElement('button');
  railSearch.type = 'button';
  railSearch.id = 'btnDesktopChatSearch';
  railSearch.className = 'icon-btn';
  railSearch.setAttribute('aria-label', 'Search chats');
  railSearch.title = 'Search chats';
  railSearch.setAttribute('aria-expanded', 'false');
  railSearch.innerHTML = ICON_SEARCH;

  const railCollapse = document.createElement('button');
  railCollapse.type = 'button';
  railCollapse.id = 'btnDesktopChatRailCollapse';
  railCollapse.className = 'icon-btn';
  railCollapse.setAttribute('aria-label', 'Collapse chat sessions');
  railCollapse.innerHTML = ICON_CHEVRON_LEFT;

  railHeader.append(railTitle, railSearch, railCollapse);

  const railNewChat = document.createElement('button');
  railNewChat.type = 'button';
  railNewChat.id = 'btnDesktopChatNew';
  railNewChat.className = 'chat-new-wide';
  railNewChat.textContent = '+ New chat';

  const railList = document.createElement('div');
  railList.id = 'desktopChatSessionList';
  railList.className = 'chat-list mn-os-chat-rail-list';
  railList.setAttribute('role', 'list');

  railMain.append(railHeader, railNewChat, railList);
  railPanel.appendChild(railMain);
  rail.append(railTab, railPanel);

  const railBackdrop = document.createElement('button');
  railBackdrop.type = 'button';
  railBackdrop.className = 'mn-os-chat-rail-backdrop';
  railBackdrop.setAttribute('aria-label', 'Close chat sessions');
  railBackdrop.setAttribute('aria-hidden', 'true');
  railBackdrop.tabIndex = -1;

  const transcript = document.createElement('div');
  transcript.className = 'mn-os-chat-transcript';
  transcript.setAttribute('role', 'log');
  transcript.setAttribute('aria-live', 'polite');
  transcript.setAttribute('aria-label', 'Messages');

  const transcriptCol = document.createElement('div');
  transcriptCol.id = 'desktopChatCol';
  transcriptCol.className = 'mn-os-chat-col';
  transcript.appendChild(transcriptCol);
  bindDesktopChatTranscriptScroll();

  const desktopResearch = document.createElement('div');
  desktopResearch.className = 'mn-os-desktop-research dr';
  desktopResearch.setAttribute('aria-label', 'Research');

  const researchProgress = document.createElement('div');
  researchProgress.id = 'desktopResearchProgressMount';
  researchProgress.className = 'mn-os-research-card mn-os-research-progress';
  researchProgress.setAttribute('aria-live', 'polite');

  const researchProgressChrome = document.createElement('div');
  researchProgressChrome.className = 'mn-os-research-progress-chrome';

  const researchCancel = document.createElement('button');
  researchCancel.type = 'button';
  researchCancel.id = 'btnDesktopResearchCancel';
  researchCancel.className = 'dr-cancel mn-os-research-cancel';
  researchCancel.textContent = 'Cancel';
  researchCancel.hidden = true;

  researchProgressChrome.appendChild(researchCancel);

  const researchProgressBody = document.createElement('div');
  researchProgressBody.id = 'desktopResearchProgressBody';
  researchProgressBody.className = 'mn-os-research-progress-body';

  researchProgress.append(researchProgressChrome, researchProgressBody);

  const researchResult = document.createElement('div');
  researchResult.id = 'desktopResearchResultMount';
  researchResult.className = 'mn-os-research-card mn-os-research-result';

  const researchResultChrome = document.createElement('div');
  researchResultChrome.className = 'mn-os-research-result-chrome';

  const researchClose = document.createElement('button');
  researchClose.type = 'button';
  researchClose.id = 'btnDesktopResearchClose';
  researchClose.className = 'dr-cancel mn-os-research-close';
  researchClose.textContent = 'Close';
  researchClose.hidden = true;

  researchResultChrome.appendChild(researchClose);

  const researchResultBody = document.createElement('div');
  researchResultBody.id = 'desktopResearchResultBody';
  researchResultBody.className = 'mn-os-research-result-body';

  researchResult.append(researchResultChrome, researchResultBody);

  desktopResearch.append(researchProgress, researchResult);

  const desktopExperts = document.createElement('div');
  desktopExperts.id = 'desktopExpertsMount';
  desktopExperts.className = 'mn-os-desktop-experts';
  desktopExperts.setAttribute('aria-label', "Experts' Lab");

  desktopChat.append(transcript);
  stage.append(hero, desktopChat, desktopResearch, desktopExperts);
  root.append(rail, railBackdrop);
  renderDesktopWorkspaceRail(root);
  root.appendChild(stage);

  const composerDock = document.createElement('div');
  composerDock.className = 'mn-os-composer-dock';

  const researchComposerActions = document.createElement('div');
  researchComposerActions.className = 'mn-os-composer-research-actions';

  const researchRoundsLabel = document.createElement('label');
  researchRoundsLabel.className = 'mn-os-research-toolbar-scope';
  researchRoundsLabel.htmlFor = 'desktopResearchMaxRounds';

  const researchRoundsText = document.createElement('span');
  researchRoundsText.className = 'mn-os-research-toolbar-scope__label';
  researchRoundsText.textContent = 'Rounds';

  const researchRounds = document.createElement('select');
  researchRounds.id = 'desktopResearchMaxRounds';
  researchRounds.className = 'mn-os-research-toolbar-select';
  researchRounds.setAttribute('aria-label', 'Research rounds');
  for (const option of [
    { value: 'auto', label: 'Auto' },
    { value: '1', label: '1' },
    { value: '2', label: '2' },
    { value: '3', label: '3' },
    { value: '4', label: '4' },
    { value: '5', label: '5' },
  ]) {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    researchRounds.appendChild(opt);
  }

  researchRoundsLabel.append(researchRoundsText, researchRounds);

  const researchScopeLabel = document.createElement('label');
  researchScopeLabel.className = 'mn-os-research-toolbar-scope';
  researchScopeLabel.htmlFor = 'desktopResearchScope';

  const researchScopeText = document.createElement('span');
  researchScopeText.className = 'mn-os-research-toolbar-scope__label';
  researchScopeText.textContent = 'Scope';

  const researchScope = document.createElement('select');
  researchScope.id = 'desktopResearchScope';
  researchScope.className = 'mn-os-research-toolbar-select';
  researchScope.setAttribute('aria-label', 'Research scope');
  for (const option of [
    { value: 'web', label: 'Web' },
    { value: 'codebase', label: 'Codebase' },
    { value: 'both', label: 'Web + Codebase' },
  ]) {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    researchScope.appendChild(opt);
  }

  researchScopeLabel.append(researchScopeText, researchScope);

  const researchWorkspaceLabel = document.createElement('label');
  researchWorkspaceLabel.className = 'mn-os-research-toolbar-scope';
  researchWorkspaceLabel.id = 'desktopResearchWorkspaceLabel';
  researchWorkspaceLabel.htmlFor = 'desktopResearchWorkspace';
  researchWorkspaceLabel.hidden = true;

  const researchWorkspaceText = document.createElement('span');
  researchWorkspaceText.className = 'mn-os-research-toolbar-scope__label';
  researchWorkspaceText.textContent = 'Workspace';

  const researchWorkspace = document.createElement('select');
  researchWorkspace.id = 'desktopResearchWorkspace';
  researchWorkspace.className = 'mn-os-research-toolbar-select';
  researchWorkspace.setAttribute('aria-label', 'Research workspace');

  const researchWorkspaceBrowse = document.createElement('button');
  researchWorkspaceBrowse.type = 'button';
  researchWorkspaceBrowse.id = 'btnDesktopResearchWorkspaceBrowse';
  researchWorkspaceBrowse.className = 'mn-os-research-toolbar-btn';
  researchWorkspaceBrowse.textContent = 'Browse…';
  researchWorkspaceBrowse.setAttribute('aria-label', 'Browse for research workspace folder');

  const researchWorkspaceRow = document.createElement('span');
  researchWorkspaceRow.className = 'mn-os-research-workspace-row';
  researchWorkspaceRow.append(researchWorkspace, researchWorkspaceBrowse);

  researchWorkspaceLabel.append(researchWorkspaceText, researchWorkspaceRow);

  const researchLibrary = document.createElement('button');
  researchLibrary.type = 'button';
  researchLibrary.id = 'btnDesktopResearchLibrary';
  researchLibrary.className = 'mn-os-research-toolbar-btn';
  researchLibrary.textContent = 'Library';

  researchComposerActions.append(
    researchRoundsLabel,
    researchScopeLabel,
    researchWorkspaceLabel,
    researchLibrary,
  );
  composerDock.appendChild(researchComposerActions);
  root.appendChild(composerDock);

  wireDesktopChatRail();
  wireDesktopWorkspaceRail();
  wireDesktopResearchControls();

  function applyWallpaper(p: DesktopPrefs): void {
    void paintWallpaper(p);
  }

  function refreshGreetingClock(): void {
    const d = new Date();
    const formatted = formatDateTime(d);
    greetTime.textContent = `${formatted.time} · ${formatted.date}`;
    // Research/experts mode uses fixed hero copy; only refresh the time-of-day greeting when idle/chat.
    if (!isDesktopResearchActive() && !isDesktopExpertsActive()) {
      greet.textContent = `${greetingFor(d)}.`;
    }
  }

  let clockInterval: number | undefined;
  const clockAlignTimeout = window.setTimeout(() => {
    refreshGreetingClock();
    clockInterval = window.setInterval(refreshGreetingClock, 60_000);
  }, msUntilNextMinute(new Date()));

  const unsubPrefs = subscribeDesktopPrefs((p) => {
    applyWallpaper(p);
  });
  const unsubDesktopState = subscribeDesktopState(() => {
    rail.hidden = false;
  });

  return () => {
    clearTimeout(clockAlignTimeout);
    if (clockInterval !== undefined) clearInterval(clockInterval);
    unsubPrefs();
    unsubDesktopState();
  };
}
