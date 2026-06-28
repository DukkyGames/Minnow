/**
 * Full settings page with category hash routing (MIN-130).
 */

import '../styles/settings-page.css';

import { loadPromptMetaSettings, savePromptMetaSettings } from '../config/prompt-meta';
import { detectLocalServer } from '../tools/client';
import { refreshSettingsSection } from './settings-sections';
import {
  initSettingsPromptEstimate,
  refreshPromptTokenEstimate,
  schedulePromptTokenEstimateRefresh,
} from './settings-prompt-estimate';
import { setStatus } from './status';
import type { PromptProfile } from '../chat/prompts/types';
import {
  SETTINGS_CATEGORY_AREAS,
  SETTINGS_CATEGORIES,
  categoryForArea,
  type SettingsCategoryId,
  type SettingsSectionId,
} from './settings-page-types';
import { initSettingsSearchFinder } from './settings-search-finder';
import { applySettingsPageFilter, clearSettingsPageFilter } from './settings-filter';
import {
  flashSettingsSearchTarget,
  resolveSettingsSearchDomTarget,
  scrollToSettingsArea,
  scrollToSettingsHub,
  updateSettingsSubnavActive,
} from './settings-search-navigate';
import { upgradeSettingsCheckboxes } from './settings-switch';
import { isOsAppHash, isOsEmbedded } from '../os/page-bridge';
import { requestCloseWindowApp, registerWindowTeardown } from '../os/window-mounted-apps';
import { fieldByKey } from './settings-catalog';
import { resolveBrainMemoryRoute } from './brain-memory-routing';
import { launchApp, navigateToDesktop } from '../os/router';

export type { SettingsSectionId, SettingsCategoryId } from './settings-page-types';
export { categoryForArea } from './settings-page-types';
export { isOsEmbedded };

const CATEGORIES = SETTINGS_CATEGORIES;

let activeCategory: SettingsCategoryId = 'general';
let staticBindingsDone = false;
/** Pending area scroll after category panel opens (legacy hash or deep link). */
let pendingScrollArea: SettingsSectionId | null = null;
/** Pending field flash after navigation. */
let pendingSearchKey: string | null = null;

function getSettingsRoot(): HTMLElement | null {
  return document.getElementById('settingsView');
}

function getChatShell(): HTMLElement | null {
  return document.getElementById('appBody');
}

function isSettingsSectionId(value: string): value is SettingsSectionId {
  return CATEGORIES.some((cat) =>
    SETTINGS_CATEGORY_AREAS[cat].includes(value as SettingsSectionId),
  );
}

function isSettingsCategoryId(value: string): value is SettingsCategoryId {
  return CATEGORIES.includes(value as SettingsCategoryId);
}

/** Parse `#/settings/<category|legacy-area>`. */
function parseHashRoute(): {
  category: SettingsCategoryId;
  scrollArea?: SettingsSectionId;
} {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const match = hash.match(/^settings(?:\/([\w-]+))?/);
  const slug = match?.[1];
  if (!slug || slug === 'voice') {
    return { category: 'general' };
  }
  if (isSettingsCategoryId(slug)) {
    return { category: slug };
  }
  if (isSettingsSectionId(slug)) {
    return { category: categoryForArea(slug), scrollArea: slug };
  }
  return { category: 'general' };
}

async function refreshCategoryAreas(category: SettingsCategoryId): Promise<void> {
  const areas = SETTINGS_CATEGORY_AREAS[category];
  await Promise.all(areas.map((area) => refreshSettingsSection(area)));
}

/** Highlight the subnav tab that matches a section slug (when present). */
function syncSettingsSubnavActive(area?: SettingsSectionId): void {
  updateSettingsSubnavActive(area);
}

function setActiveCategory(
  category: SettingsCategoryId,
  options?: { scrollArea?: SettingsSectionId; searchKey?: string },
): void {
  activeCategory = category;

  for (const cat of CATEGORIES) {
    const panel = document.querySelector(
      `.settings-category[data-category="${cat}"]`,
    );
    const nav = document.querySelector(
      `[data-settings-category="${cat}"]`,
    ) as HTMLButtonElement | null;
    panel?.classList.toggle('is-active', cat === category);
    if (nav) {
      if (cat === category) nav.setAttribute('aria-current', 'page');
      else nav.removeAttribute('aria-current');
    }
  }

  if (!isOsEmbedded()) {
    const nextHash = `#/settings/${category}`;
    if (window.location.hash !== nextHash && !options?.scrollArea) {
      window.location.hash = nextHash;
    }
  }

  void refreshCategoryAreas(category).then(() => {
    void detectLocalServer().then(() => refreshPromptTokenEstimate());
    const scrollArea = options?.scrollArea ?? pendingScrollArea;
    const searchKey = options?.searchKey ?? pendingSearchKey;
    pendingScrollArea = null;
    pendingSearchKey = null;
    updateSettingsSubnavActive(scrollArea ?? SETTINGS_CATEGORY_AREAS[category][0]);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (searchKey) {
          const area =
            options?.scrollArea ??
            pendingScrollArea ??
            SETTINGS_CATEGORY_AREAS[category][0]!;
          const target = resolveSettingsSearchDomTarget(area, searchKey);
          if (target) {
            target.scrollIntoView({ block: 'center', behavior: 'smooth' });
            flashSettingsSearchTarget(target);
            return;
          }
        }
        if (scrollArea) {
          scrollToSettingsArea(scrollArea);
        }
      });
    });
  });
}

/** Legacy API: open a section slug (maps to category + scroll). */
export function setActiveSection(section: SettingsSectionId): void {
  setActiveCategory(categoryForArea(section), { scrollArea: section });
}

function bindStaticSections(): void {
  if (staticBindingsDone) return;
  staticBindingsDone = true;

  const tabs = document.querySelectorAll('[data-profile-tab]');
  tabs.forEach((tab) => {
    const el = tab as HTMLButtonElement;
    el.addEventListener('click', async () => {
      const profile = el.dataset.profileTab as PromptProfile;
      await savePromptMetaSettings({ activePromptProfile: profile });
      tabs.forEach((t) =>
        (t as HTMLButtonElement).classList.toggle(
          'is-active',
          (t as HTMLButtonElement).dataset.profileTab === profile,
        ),
      );
      setStatus('ok', `Prompt profile: ${profile}`);
      await refreshSettingsSection('prompting');
      schedulePromptTokenEstimateRefresh();
    });
  });

  document.querySelectorAll('[data-area-jump]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const area = (link as HTMLElement).dataset.areaJump as
        | SettingsSectionId
        | undefined;
      if (area) {
        syncSettingsSubnavActive(area);
        scrollToSettingsArea(area);
      }
    });
  });

  document.querySelectorAll('[data-hub-jump]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const hub = (link as HTMLElement).dataset.hubJump;
      if (hub) scrollToSettingsHub(hub);
    });
  });
}

async function hydrateStaticFields(): Promise<void> {
  const meta = await loadPromptMetaSettings();
  document.querySelectorAll('[data-profile-tab]').forEach((tab) => {
    const el = tab as HTMLButtonElement;
    el.classList.toggle(
      'is-active',
      el.dataset.profileTab === meta.activePromptProfile,
    );
  });
}

/** Open settings; optional legacy area slug or field search key for deep link. */
export function openSettings(
  section?: SettingsSectionId,
  options?: { searchKey?: string },
): void {
  const root = getSettingsRoot();
  const shell = getChatShell();
  if (!root || !shell) return;

  void import('./global-bugs-page').then((m) => {
    if (m.isGlobalBugsPageOpen()) m.closeGlobalBugs();
  });
  void import('./experts/experts-hub').then((m) => {
    if (m.isExpertsPageOpen()) m.closeExpertLab();
  });
  void import('./welcome-page').then((m) => {
    if (m.isWelcomePageOpen()) m.closeWelcome({ skipHash: true });
  });

  const wasAlreadyOpen = root.classList.contains('is-open');

  root.classList.add('is-open');
  if (!isOsEmbedded()) {
    shell.classList.add('hidden');
    document.querySelector('header.topbar')?.classList.add('hidden');
  }
  document.getElementById('drawer')?.setAttribute('aria-hidden', 'true');
  void import('./preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );

  upgradeSettingsCheckboxes();
  bindStaticSections();
  initSettingsPromptEstimate();
  void hydrateStaticFields();
  void detectLocalServer().then(() => refreshPromptTokenEstimate());

  const route = section
    ? { category: categoryForArea(section), scrollArea: section }
    : parseHashRoute();

  if (options?.searchKey) {
    pendingSearchKey = options.searchKey;
  }

  if (wasAlreadyOpen && route.category === activeCategory && !section && !options?.searchKey) {
    void refreshCategoryAreas(route.category);
    return;
  }

  setActiveCategory(route.category, {
    scrollArea: route.scrollArea ?? section,
    searchKey: options?.searchKey,
  });
}

/** Close settings and return to chat or desktop. */
export function closeSettings(options?: { skipNavigate?: boolean }): void {
  const root = getSettingsRoot();
  const shell = getChatShell();
  if (!root || !shell) return;
  root.classList.remove('is-open');
  clearSettingsPageFilter();
  if (!isOsEmbedded()) {
    shell.classList.remove('hidden');
    document.querySelector('header.topbar')?.classList.remove('hidden');
    if (!options?.skipNavigate && window.location.hash.startsWith('#/settings')) {
      window.location.hash = '#/';
    }
  } else if (!options?.skipNavigate) {
    if (!requestCloseWindowApp('settings')) {
      navigateToDesktop();
    }
  }
  void import('./preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );
}

function onHashChange(): void {
  const hash = window.location.hash;
  if (hash.startsWith('#/bugs')) {
    if (getSettingsRoot()?.classList.contains('is-open')) {
      closeSettings();
    }
    return;
  }
  if (hash.startsWith('#/settings')) {
    if (hash === '#/settings/voice' || hash.startsWith('#/settings/voice/')) {
      void import('./models-page').then((m) => m.openModels('voice'));
      return;
    }
    void import('./global-bugs-page').then((m) => {
      if (m.isGlobalBugsPageOpen()) m.closeGlobalBugs();
    });
    const route = parseHashRoute();
    if (!getSettingsRoot()?.classList.contains('is-open')) {
      openSettings(route.scrollArea);
    } else {
      setActiveCategory(route.category, { scrollArea: route.scrollArea });
    }
    return;
  }
  if (isOsEmbedded() && isOsAppHash(hash)) {
    return;
  }
  if (getSettingsRoot()?.classList.contains('is-open')) {
    closeSettings();
  }
}

/** Wire nav, back button, hash routing, and in-page filter hooks. */
export function initSettingsPage(): void {
  registerWindowTeardown('settings', () => closeSettings({ skipNavigate: true }));
  upgradeSettingsCheckboxes();
  initSettingsSearchFinder({
    onQueryChange: (query) => {
      if (query.trim()) applySettingsPageFilter(query);
      else clearSettingsPageFilter();
    },
  });

  document
    .getElementById('btnSettingsPageBack')
    ?.addEventListener('click', () => {
      if (requestCloseWindowApp('settings')) return;
      if (isOsEmbedded()) navigateToDesktop();
      else closeSettings();
    });

  for (const cat of CATEGORIES) {
    document
      .querySelector(`[data-settings-category="${cat}"]`)
      ?.addEventListener('click', () => setActiveCategory(cat));
  }

  window.addEventListener('hashchange', onHashChange);
  if (window.location.hash.startsWith('#/settings')) {
    openSettings(parseHashRoute().scrollArea);
  }

  void detectLocalServer();
}

/** Topbar gear opens full settings instead of drawer when available. */
export function openSettingsFromTopbar(): void {
  openSettings('general');
}

/** Navigate to a catalog field key (chat deep-link). */
export function navigateToSettingsField(searchKey: string, area?: SettingsSectionId): void {
  const brainSection = resolveBrainMemoryRoute(searchKey, area);
  if (brainSection) {
    launchApp('brain', { brainSection });
    return;
  }
  const entry = fieldByKey(searchKey);
  const targetArea = area ?? entry?.area ?? 'general';
  openSettings(targetArea, { searchKey: entry?.key ?? searchKey });
}
