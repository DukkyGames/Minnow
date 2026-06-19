/**
 * Navigate to a settings search result and scroll to the best DOM target.
 */

import {
  categoryForArea,
  SETTINGS_CATEGORY_AREAS,
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
      btn.setAttribute(
        'aria-current',
        (btn as HTMLElement).dataset.settingsCategory === category
          ? 'page'
          : 'false',
      );
    });
  }

  const sectionRoot = getSectionRoot(sectionId);
  if (!sectionRoot) return;

  sectionRoot.querySelectorAll('details:not([open])').forEach((details) => {
    const keyed = details.querySelector('[data-settings-search-key]');
    if (keyed) details.setAttribute('open', '');
  });
}

/** Scroll to an area anchor within the stacked category panel. */
export function scrollToSettingsArea(sectionId: SettingsSectionId): void {
  ensureSettingsAreaVisible(sectionId);
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
