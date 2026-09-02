import { SETTINGS_FIELD_CATALOG } from './settings-catalog';

import {

  SETTINGS_CATEGORIES,

  SETTINGS_CATEGORY_AREAS,

  SETTINGS_INTEGRATIONS_HUBS,

  categoryForArea,

  hubForArea,

  type SettingsCategoryId,

  type SettingsSectionId,

} from './settings-page-types';

import { buildSettingsSearchIndex } from './settings-search-index';

import { rankSettingsSearch } from './settings-search-rank';

import { updateSettingsNavActive } from './settings-search-navigate';

const HIDDEN_CLASS = 'is-filter-hidden';

const DIM_CLASS = 'is-filter-dim';

let cachedFieldKeys: Set<string> | null = null;

// ── Match ────────────────────────────────────────────────────────────────────

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

      const cat = categoryForArea(area as SettingsSectionId);

      if (!SETTINGS_FIELD_CATALOG.some((e) => e.key === key)) {

        counts.set(cat, (counts.get(cat) ?? 0) + 1);

      }

    }

  }

  return counts;

}

function countMatchesByArea(keys: Set<string>): Map<SettingsSectionId, number> {

  const counts = new Map<SettingsSectionId, number>();

  for (const cat of SETTINGS_CATEGORIES) {

    for (const area of SETTINGS_CATEGORY_AREAS[cat]) {

      counts.set(area, 0);

    }

  }

  for (const entry of SETTINGS_FIELD_CATALOG) {

    if (keys.has(entry.key)) {

      counts.set(entry.area, (counts.get(entry.area) ?? 0) + 1);

    }

  }

  for (const key of keys) {

    const row = document.querySelector(`[data-settings-search-key="${CSS.escape(key)}"]`);

    const areaEl = row?.closest('[data-area]') as HTMLElement | null;

    const area = areaEl?.dataset.area as SettingsSectionId | undefined;

    if (area && !SETTINGS_FIELD_CATALOG.some((e) => e.key === key)) {

      counts.set(area, (counts.get(area) ?? 0) + 1);

    }

  }

  return counts;

}

function countMatchesByHub(keys: Set<string>): Map<string, number> {

  const counts = new Map<string, number>();

  for (const hub of SETTINGS_INTEGRATIONS_HUBS) {

    counts.set(hub.id, 0);

  }

  for (const [area, count] of countMatchesByArea(keys)) {

    const hubId = hubForArea(area);

    if (hubId && count > 0) {

      counts.set(hubId, (counts.get(hubId) ?? 0) + count);

    }

  }

  return counts;

}

// ── Badges ───────────────────────────────────────────────────────────────────

function setBadge(el: Element | null | undefined, count: number): void {

  if (!(el instanceof HTMLElement)) return;

  if (count > 0) {

    el.textContent = String(count);

    el.hidden = false;

    el.removeAttribute('aria-hidden');

  } else {

    el.textContent = '';

    el.hidden = true;

    el.setAttribute('aria-hidden', 'true');

  }

}

function updateSidebarCounts(

  categoryCounts: Map<SettingsCategoryId, number>,

  areaCounts: Map<SettingsSectionId, number>,

  hubCounts: Map<string, number>,

): void {

  for (const cat of SETTINGS_CATEGORIES) {

    const header = document.querySelector(

      `[data-settings-category="${cat}"].settings-nav-group__label`,

    );

    setBadge(header?.querySelector('.settings-nav-group__count'), categoryCounts.get(cat) ?? 0);

  }

  document.querySelectorAll<HTMLElement>('[data-settings-nav-area]').forEach((item) => {

    const area = item.dataset.settingsNavArea as SettingsSectionId | undefined;

    if (!area) return;

    setBadge(item.querySelector('.settings-nav__count'), areaCounts.get(area) ?? 0);

  });

  document.querySelectorAll<HTMLElement>('[data-settings-nav-hub]').forEach((item) => {

    const hub = item.dataset.settingsNavHub;

    if (!hub) return;

    setBadge(item.querySelector('.settings-nav__count'), hubCounts.get(hub) ?? 0);

  });

}

function filterActiveCategory(keys: Set<string>): void {

  const activePanel = document.querySelector('.settings-category.is-active');

  if (!activePanel) return;

  const filtering = keys.size > 0;

  activePanel.classList.toggle('is-filtering', filtering);

  activePanel.classList.toggle(

    'is-integrations-filtering',

    filtering && activePanel.getAttribute('data-category') === 'integrations',

  );

  if (filtering) {

    activePanel.querySelectorAll<HTMLElement>('.settings-area').forEach((area) => {

      area.classList.add('is-active');

    });

    if (activePanel.getAttribute('data-category') === 'integrations') {

      activePanel.querySelectorAll<HTMLElement>('.settings-hub').forEach((hub) => {

        hub.classList.add('is-active');

      });

    }

  }

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

  if (activePanel.getAttribute('data-category') === 'integrations' && filtering) {

    activePanel.querySelectorAll<HTMLElement>('.settings-hub').forEach((hub) => {

      const hubAreas = hub.querySelectorAll('.settings-area');

      let hubVisible = false;

      hubAreas.forEach((area) => {

        if (!area.classList.contains(DIM_CLASS)) hubVisible = true;

      });

      hub.classList.toggle('is-filter-empty', !hubVisible);

    });

  }

}

// ── Apply ────────────────────────────────────────────────────────────────────

/** Apply query: dim/hide non-matches in the active category; badge sidebar groups and items. */

export function applySettingsPageFilter(query: string): void {

  const keys = matchingFieldKeys(query);

  cachedFieldKeys = keys;

  updateSidebarCounts(

    countMatchesByCategory(keys),

    countMatchesByArea(keys),

    countMatchesByHub(keys),

  );

  filterActiveCategory(keys);

}

function getActiveAreaFromDom(): SettingsSectionId {
  const active = document.querySelector(
    '[data-settings-nav-area][aria-current="page"]',
  ) as HTMLElement | null;
  const area = active?.dataset.settingsNavArea;
  if (area) return area as SettingsSectionId;
  return 'general';
}

function restoreActiveAreaView(): void {
  const area = getActiveAreaFromDom();

  const category = categoryForArea(area);

  const panel = document.querySelector(`.settings-category[data-category="${category}"]`);

  if (!panel) return;

  if (category === 'integrations') {

    panel.querySelectorAll<HTMLElement>('.settings-area').forEach((section) => {

      section.classList.toggle('is-active', section.dataset.area === area);

    });

    const hubId = hubForArea(area);

    if (hubId) {

      panel.querySelectorAll<HTMLElement>('.settings-hub').forEach((hub) => {

        hub.classList.toggle('is-active', hub.dataset.hub === hubId);

      });

    }

    updateSettingsNavActive(area, hubId);

    return;

  }

  panel.querySelectorAll<HTMLElement>('.settings-area').forEach((section) => {

    section.classList.toggle('is-active', section.dataset.area === area);

  });

  updateSettingsNavActive(area);

}

// ── Clear ────────────────────────────────────────────────────────────────────

/** Restore all rows and clear sidebar badges. */

export function clearSettingsPageFilter(): void {

  cachedFieldKeys = null;

  document

    .querySelectorAll(`.${HIDDEN_CLASS}, .${DIM_CLASS}`)

    .forEach((el) => el.classList.remove(HIDDEN_CLASS, DIM_CLASS));

  document

    .querySelectorAll('.settings-category.is-filtering, .settings-category.is-integrations-filtering')

    .forEach((panel) => {

      panel.classList.remove('is-filtering', 'is-integrations-filtering');

    });

  document

    .querySelectorAll('.settings-hub.is-filter-empty')

    .forEach((hub) => hub.classList.remove('is-filter-empty'));

  document.querySelectorAll('.settings-nav__count').forEach((badge) => {

    if (badge instanceof HTMLElement) {

      badge.hidden = true;

      badge.textContent = '';

    }

  });

  restoreActiveAreaView();

}

/** Re-run filter after category switch (if a query is active). */

export function refreshSettingsPageFilterForCategory(): void {

  if (!cachedFieldKeys) return;

  filterActiveCategory(cachedFieldKeys);

}

