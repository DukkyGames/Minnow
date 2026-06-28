/**
 * Navigate to a settings search result and scroll to the best DOM target.
 */

import {
  categoryForArea,
  SETTINGS_CATEGORY_AREAS,
  SETTINGS_INTEGRATIONS_HUBS,
  hubForArea,
  type SettingsCategoryId,
  type SettingsSectionId,
} from './settings-page-types';
import { refreshSettingsSection } from './settings-sections';
import { openSettings } from './settings-page';
import type { SettingsSearchEntry } from './settings-search-types';

const TARGET_FLASH_CLASS = 'settings-search-target-flash';
const FLASH_MS = 1800;

function getSectionRoot(sectionId: SettingsSectionId): HTMLElement | null {
  return document.getElementById(`settingsSection-${sectionId}`);
}

function getCategoryPanel(category: SettingsCategoryId): HTMLElement | null {
  return document.querySelector(
    `.settings-category[data-category="${category}"]`,
  );
}

/** Ensure the area's category panel is visible and expand collapsed groups. */
export function ensureSettingsAreaVisible(sectionId: SettingsSectionId): void {
  const category = categoryForArea(sectionId);
  const panel = getCategoryPanel(category);
  if (!panel?.classList.contains('is-active')) {
    document.querySelectorAll('.settings-category').forEach((node) => {
      node.classList.toggle(
        'is-active',
        node === panel,
      );
    });
    document.querySelectorAll('[data-settings-category]').forEach((btn) => {
      const isActive =
        (btn as HTMLElement).dataset.settingsCategory === category;
      if (isActive) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
  }

  const sectionRoot = getSectionRoot(sectionId);
  if (!sectionRoot) return;

  sectionRoot.querySelectorAll('details:not([open])').forEach((details) => {
    const keyed = details.querySelector('[data-settings-search-key]');
    if (keyed) details.setAttribute('open', '');
  });
}

/** Show one integrations hub panel; other hubs stay in the DOM for deep links and search. */
export function activateIntegrationsHub(hubId: string): void {
  const panel = document.querySelector(
    '.settings-category[data-category="integrations"]',
  );
  if (!panel) return;
  panel.querySelectorAll<HTMLElement>('.settings-hub').forEach((hub) => {
    hub.classList.toggle('is-active', hub.dataset.hub === hubId);
  });
}

/** Scroll to an integrations hub container and sync hub subnav. */
export function scrollToSettingsHub(hubId: string): void {
  const hubDef = SETTINGS_INTEGRATIONS_HUBS.find((hub) => hub.id === hubId);
  const firstArea = hubDef?.areas[0];
  if (firstArea) ensureSettingsAreaVisible(firstArea);
  activateIntegrationsHub(hubId);
  updateSettingsSubnavActive(undefined, hubId);
  const hub = document.getElementById(`settingsHub-${hubId}`);
  hub?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** Highlight the subnav tab (or integrations hub) that matches the target area. */
export function updateSettingsSubnavActive(
  area?: SettingsSectionId,
  hubId?: string,
): void {
  const activePanel = document.querySelector('.settings-category.is-active');
  if (!activePanel) return;

  const category = activePanel.getAttribute('data-category') as SettingsCategoryId;

  if (category === 'integrations') {
    const targetHub =
      hubId ??
      (area ? hubForArea(area) : undefined) ??
      SETTINGS_INTEGRATIONS_HUBS[0]?.id;
    if (targetHub) activateIntegrationsHub(targetHub);
    const links = activePanel.querySelectorAll<HTMLAnchorElement>(
      '.settings-category-subnav__link[data-hub-jump]',
    );
    links.forEach((link) => {
      const isActive = link.dataset.hubJump === targetHub;
      link.classList.toggle('is-active', isActive);
      if (isActive) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    return;
  }

  const links = activePanel.querySelectorAll<HTMLAnchorElement>(
    '.settings-category-subnav__link[data-area-jump]',
  );
  if (links.length === 0) return;
  const target = area ?? links[0]?.dataset.areaJump;
  links.forEach((link) => {
    const isActive = link.dataset.areaJump === target;
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

/** Scroll to an area anchor within the stacked category panel. */
export function scrollToSettingsArea(sectionId: SettingsSectionId): void {
  ensureSettingsAreaVisible(sectionId);
  updateSettingsSubnavActive(sectionId);
  const root = getSectionRoot(sectionId);
  root?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** Resolve scroll target: search key, then first group, then section root. */
export function resolveSettingsSearchDomTarget(
  sectionId: SettingsSectionId,
  searchKey?: string,
): HTMLElement | null {
  ensureSettingsAreaVisible(sectionId);
  const sectionRoot = getSectionRoot(sectionId);
  if (!sectionRoot) return null;

  if (searchKey) {
    const escaped = searchKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const keyed = sectionRoot.querySelector(
      `[data-settings-search-key="${escaped}"]`,
    );
    if (keyed instanceof HTMLElement) return keyed;
  }

  const group = sectionRoot.querySelector('.settings-group');
  if (group instanceof HTMLElement) return group;

  return sectionRoot;
}

/** Brief highlight so users see where they landed. */
export function flashSettingsSearchTarget(node: HTMLElement): void {
  node.classList.add(TARGET_FLASH_CLASS);
  window.setTimeout(() => {
    node.classList.remove(TARGET_FLASH_CLASS);
  }, FLASH_MS);
}

/** Open settings or Models app, refresh the section, then scroll to the resolved target. */
export async function navigateToSettingsSearchEntry(
  entry: SettingsSearchEntry,
): Promise<void> {
  if (entry.modelsSection) {
    const { openModels } = await import('./models-page');
    openModels(entry.modelsSection as import('./models-page').ModelsSectionId);
    return;
  }

  if (entry.brainSection) {
    const { openBrain } = await import('./brain-page');
    openBrain(entry.brainSection as import('./brain-page').BrainSectionId);
    return;
  }

  const category = categoryForArea(entry.sectionId);
  openSettings(entry.sectionId, { searchKey: entry.searchKey });

  const areas = SETTINGS_CATEGORY_AREAS[category];
  await Promise.all(areas.map((area) => refreshSettingsSection(area)));

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });

  const target = resolveSettingsSearchDomTarget(
    entry.sectionId,
    entry.searchKey,
  );
  if (!target) return;

  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  flashSettingsSearchTarget(target);
}
