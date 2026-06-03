/**
 * Navigate to a settings search result and scroll to the best DOM target.
 */

import { refreshSettingsSection } from './settings-sections';
import { openSettings } from './settings-page';
import type { SettingsSectionId } from './settings-page-types';
import type { SettingsSearchEntry } from './settings-search-types';

const TARGET_FLASH_CLASS = 'settings-search-target-flash';
const FLASH_MS = 1800;

function getSectionRoot(sectionId: SettingsSectionId): HTMLElement | null {
  return document.getElementById(`settingsSection-${sectionId}`);
}

/** Resolve scroll target: search key, then first group, then section root. */
export function resolveSettingsSearchDomTarget(
  sectionId: SettingsSectionId,
  searchKey?: string,
): HTMLElement | null {
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

/** Open settings, refresh the section, then scroll to the resolved target. */
export async function navigateToSettingsSearchEntry(
  entry: SettingsSearchEntry,
): Promise<void> {
  openSettings(entry.sectionId);
  await refreshSettingsSection(entry.sectionId);
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
