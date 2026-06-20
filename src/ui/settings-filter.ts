/**
 * Live in-page filter for settings search (MIN-130).
 * Dims non-matching rows and shows per-category match counts on the sidebar.
 */

import { SETTINGS_FIELD_CATALOG } from './settings-catalog';
import {
  SETTINGS_CATEGORIES,
  SETTINGS_CATEGORY_AREAS,
  categoryForArea,
  type SettingsCategoryId,
} from './settings-page-types';
import { buildSettingsSearchIndex } from './settings-search-index';
import { rankSettingsSearch } from './settings-search-rank';
import type { SettingsSearchEntry } from './settings-search-types';

const HIDDEN_CLASS = 'is-filter-hidden';
const DIM_CLASS = 'is-filter-dim';

let cachedFieldKeys: Set<string> | null = null;

function matchingFieldKeys(query: string): Set<string> {
  const ranked = rankSettingsSearch(query, buildSettingsSearchIndex(), {
    maxResults: 500,
  });
  const keys = new Set<string>();
  for (const entry of ranked) {
    if (entry.searchKey) keys.add(entry.searchKey);
    if (entry.kind === 'field') keys.add(entry.id.replace(/^field:/, ''));
  }
  return keys;
}

function countMatchesByCategory(keys: Set<string>): Map<SettingsCategoryId, number> {
  const counts = new Map<SettingsCategoryId, number>();
  for (const cat of SETTINGS_CATEGORIES) {
    counts.set(cat, 0);
  }
  for (const entry of SETTINGS_FIELD_CATALOG) {
    if (keys.has(entry.key)) {
      counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
    }
  }
  for (const key of keys) {
    const row = document.querySelector(`[data-settings-search-key="${CSS.escape(key)}"]`);
    const areaEl = row?.closest('[data-area]') as HTMLElement | null;
    const area = areaEl?.dataset.area;
    if (area) {
      const cat = categoryForArea(area as import('./settings-page-types').SettingsSectionId);
      if (!SETTINGS_FIELD_CATALOG.some((e) => e.key === key)) {
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function updateSidebarCounts(counts: Map<SettingsCategoryId, number>): void {
  for (const cat of SETTINGS_CATEGORIES) {
    const btn = document.querySelector(
      `[data-settings-category="${cat}"]`,
    );
    const badge = btn?.querySelector('.settings-nav__count');
    const n = counts.get(cat) ?? 0;
    if (!(badge instanceof HTMLElement)) continue;
    if (n > 0) {
      badge.textContent = String(n);
      badge.hidden = false;
      badge.removeAttribute('aria-hidden');
    } else {
      badge.textContent = '';
      badge.hidden = true;
      badge.setAttribute('aria-hidden', 'true');
    }
  }
}

function filterActiveCategory(keys: Set<string>): void {
  const activePanel = document.querySelector('.settings-category.is-active');
  if (!activePanel) return;

  const rows = activePanel.querySelectorAll('[data-settings-search-key]');
  rows.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const key = node.dataset.settingsSearchKey ?? '';
    const match = keys.has(key);
    node.classList.toggle(HIDDEN_CLASS, !match && keys.size > 0);
    node.classList.toggle(DIM_CLASS, false);
  });

  const areas = activePanel.querySelectorAll('.settings-area');
  areas.forEach((area) => {
    if (!(area instanceof HTMLElement)) return;
    const areaKeys = area.querySelectorAll('[data-settings-search-key]');
    let anyVisible = false;
    areaKeys.forEach((row) => {
      if (!(row instanceof HTMLElement)) return;
      if (!row.classList.contains(HIDDEN_CLASS)) anyVisible = true;
    });
    area.classList.toggle(DIM_CLASS, keys.size > 0 && !anyVisible && areaKeys.length > 0);
  });

  if (activePanel.getAttribute('data-category') === 'integrations') {
    const filtering = keys.size > 0;
    activePanel.classList.toggle('is-integrations-filtering', filtering);
    activePanel.querySelectorAll<HTMLElement>('.settings-hub').forEach((hub) => {
      const hubAreas = hub.querySelectorAll('.settings-area');
      let hubVisible = false;
      hubAreas.forEach((area) => {
        if (!area.classList.contains(DIM_CLASS)) hubVisible = true;
      });
      hub.classList.toggle('is-filter-empty', filtering && !hubVisible);
    });
  }
}

/** Apply query: dim/hide non-matches in the active category; badge other categories. */
export function applySettingsPageFilter(query: string): void {
  const keys = matchingFieldKeys(query);
  cachedFieldKeys = keys;
  updateSidebarCounts(countMatchesByCategory(keys));
  filterActiveCategory(keys);
}

/** Restore all rows and clear sidebar badges. */
export function clearSettingsPageFilter(): void {
  cachedFieldKeys = null;
  document
    .querySelectorAll(`.${HIDDEN_CLASS}, .${DIM_CLASS}`)
    .forEach((el) => el.classList.remove(HIDDEN_CLASS, DIM_CLASS));
  document
    .querySelectorAll('.settings-category.is-integrations-filtering')
    .forEach((panel) => panel.classList.remove('is-integrations-filtering'));
  document
    .querySelectorAll('.settings-hub.is-filter-empty')
    .forEach((hub) => hub.classList.remove('is-filter-empty'));
  for (const cat of SETTINGS_CATEGORIES) {
    const badge = document.querySelector(
      `[data-settings-category="${cat}"] .settings-nav__count`,
    );
    if (badge instanceof HTMLElement) {
      badge.hidden = true;
      badge.textContent = '';
    }
  }
}

/** Re-run filter after category switch (if a query is active). */
export function refreshSettingsPageFilterForCategory(): void {
  if (!cachedFieldKeys) return;
  filterActiveCategory(cachedFieldKeys);
}
