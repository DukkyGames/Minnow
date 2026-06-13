/**
 * Custom model picker list: load-state dots in menu + trigger synced to #modelSelect.
 * Groups models by producer (Qwen, Google, Llama, …) with logos in the popover UI.
 */

import { modelCache } from '../app-state';
import { decodeModelSelectKey } from '../lib/model-select-key';
import {
  formatCapabilityBadges,
  formatCapabilityTooltip,
} from '../providers/capability-badges';
import { getLastCapabilitiesProbedAt } from '../providers/model-capabilities';
import {
  modelProducerLogoSvg,
  producerDisplayName,
  producerSlugFromModelId,
  resolveModelProducer,
} from '../providers/model-producer';
import { resolveModelState } from './model-state-dot';

/** Flat list when catalog is small; larger catalogs get collapsible producer headers. */
const BROWSE_ALL_LIMIT = 12;

const COLLAPSED_STORAGE_KEY = 'minnow-model-producer-collapsed';

let pickerBound = false;
let open = false;

function getElements() {
  const root = document.querySelector('.model-select-inner');
  const sel = document.getElementById('modelSelect') as HTMLSelectElement | null;
  const trigger = document.getElementById('modelSelectTrigger') as HTMLButtonElement | null;
  const triggerText = document.getElementById('modelSelectTriggerText');
  const menu = document.getElementById('modelSelectMenu') as HTMLUListElement | null;
  return { root, sel, trigger, triggerText, menu };
}

function loadCollapsedProducers(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveCollapsedProducers(slugs: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...slugs]));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Close the model list popover. */
export function closeModelSelectMenu(): void {
  const { root, trigger, menu } = getElements();
  open = false;
  root?.classList.remove('is-open');
  menu?.classList.add('hidden');
  trigger?.setAttribute('aria-expanded', 'false');
}

function openModelSelectMenu(): void {
  const { root, trigger, menu, sel } = getElements();
  if (!root || !trigger || !menu || !sel || trigger.disabled) return;
  open = true;
  root.classList.add('is-open');
  menu.classList.remove('hidden');
  trigger.setAttribute('aria-expanded', 'true');
}

function toggleModelSelectMenu(): void {
  if (open) closeModelSelectMenu();
  else openModelSelectMenu();
}

/** Select a model in the native picker and notify listeners (top bar or OS menubar). */
export function selectModelInPicker(modelId: string): void {
  const { sel } = getElements();
  if (!sel || !modelId) return;
  closeModelSelectMenu();
  if (sel.value === modelId) {
    syncModelSelectPicker();
    return;
  }
  sel.value = modelId;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

function pickModel(modelId: string): void {
  selectModelInPicker(modelId);
}

/** Canonical model id for capability tooltip lines (strip composite select encoding). */
function tooltipModelIdForOptionValue(value: string): string {
  return decodeModelSelectKey(value)?.modelId ?? value;
}

/** Build a small inline producer logo span when a pattern matches. */
function createProducerLogoSpan(modelId: string): HTMLSpanElement | null {
  const svg = modelProducerLogoSvg(modelId);
  if (!svg) return null;
  const logo = document.createElement('span');
  logo.className = 'model-producer-logo';
  logo.setAttribute('aria-hidden', 'true');
  logo.innerHTML = svg;
  return logo;
}

/** Append one selectable row for an <option> (shared by flat options and optgroup children). */
function appendModelOptionRow(
  menu: HTMLUListElement,
  opt: HTMLOptionElement,
  selectedValue: string,
  indented = false,
): void {
  const id = opt.value.trim();
  if (!id) return;

  const cached = modelCache.get(id);
  const loadState = cached ? resolveModelState(cached) : 'unknown';
  const canonicalModelId = tooltipModelIdForOptionValue(id);

  const li = document.createElement('li');
  li.className = 'model-select-option';
  if (indented) li.classList.add('model-select-option--grouped');
  if (id === selectedValue) {
    li.classList.add('model-select-option--selected');
    li.setAttribute('aria-selected', 'true');
  } else {
    li.setAttribute('aria-selected', 'false');
  }
  li.setAttribute('role', 'option');
  li.dataset.value = id;

  const caps = cached?.capabilities;
  const probedAt = getLastCapabilitiesProbedAt();
  const tipId = canonicalModelId;
  const rowTitle = caps
    ? formatCapabilityTooltip(tipId, caps, probedAt)
    : opt.title?.trim() || tipId;
  li.title = rowTitle;

  const logo = createProducerLogoSpan(canonicalModelId);

  const dot = document.createElement('span');
  dot.className = 'model-load-dot';
  dot.setAttribute('aria-hidden', 'true');
  dot.dataset.loadState = loadState;

  const label = document.createElement('span');
  label.className = 'model-select-option-label';
  label.textContent = opt.text;
  label.title = rowTitle;

  const badges = formatCapabilityBadges(caps);
  if (logo) li.appendChild(logo);
  if (badges.length > 0) {
    const badgeSpan = document.createElement('span');
    badgeSpan.className = 'model-cap-badges';
    badgeSpan.setAttribute('aria-hidden', 'true');
    for (const text of badges) {
      const chip = document.createElement('span');
      chip.className = 'model-cap-badge';
      chip.textContent = text;
      badgeSpan.appendChild(chip);
    }
    li.appendChild(dot);
    li.appendChild(label);
    li.appendChild(badgeSpan);
  } else {
    li.appendChild(dot);
    li.appendChild(label);
  }
  li.addEventListener('mousedown', (e) => {
    e.preventDefault();
    pickModel(id);
  });

  menu.appendChild(li);
}

/** Flatten all selectable options from the native select (including optgroup children). */
function collectSelectOptions(sel: HTMLSelectElement): HTMLOptionElement[] {
  const options: HTMLOptionElement[] = [];
  for (const child of [...sel.children]) {
    if (child instanceof HTMLOptGroupElement) {
      for (const el of [...child.children]) {
        if (el instanceof HTMLOptionElement && el.value.trim()) {
          options.push(el);
        }
      }
    } else if (child instanceof HTMLOptionElement && child.value.trim()) {
      options.push(child);
    }
  }
  return options;
}

/** Sort producer slugs alphabetically by display name; `other` always last. */
function sortProducerSlugs(slugs: string[]): string[] {
  return [...slugs].sort((a, b) => {
    if (a === 'other') return 1;
    if (b === 'other') return -1;
    return producerDisplayName(a).localeCompare(producerDisplayName(b));
  });
}

/** Append a collapsible producer group header. */
function appendProducerHeader(
  menu: HTMLUListElement,
  slug: string,
  count: number,
  sampleModelId: string,
  collapsed: Set<string>,
  onToggle: () => void,
): void {
  const isCollapsed = collapsed.has(slug);
  const producer = resolveModelProducer(sampleModelId);

  const header = document.createElement('li');
  header.className = 'model-select-producer-header';
  header.setAttribute('role', 'presentation');
  header.dataset.producerSlug = slug;

  const chevron = document.createElement('span');
  chevron.className = 'model-select-producer-chevron';
  if (isCollapsed) chevron.classList.add('model-select-producer-chevron--collapsed');
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML =
    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  if (producer.logoSvg) {
    const logo = document.createElement('span');
    logo.className = 'model-producer-logo';
    logo.setAttribute('aria-hidden', 'true');
    logo.innerHTML = producer.logoSvg;
    header.appendChild(chevron);
    header.appendChild(logo);
  } else {
    header.appendChild(chevron);
  }

  const name = document.createElement('span');
  name.className = 'model-select-producer-name';
  name.textContent = producer.displayName;

  const countEl = document.createElement('span');
  countEl.className = 'model-select-producer-count';
  countEl.textContent = String(count);

  header.appendChild(name);
  header.appendChild(countEl);

  header.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle();
  });

  menu.appendChild(header);
}

/** Rebuild model list rows into any menu element (shared by top bar and OS menubar). */
export function renderModelSelectMenuRows(
  menu: HTMLUListElement,
  sel: HTMLSelectElement,
): void {
  const selectedValue = sel.value;
  const scrollTop = menu.scrollTop;
  menu.innerHTML = '';

  const options = collectSelectOptions(sel);
  if (options.length === 0) return;

  const collapsed = loadCollapsedProducers();

  const toggleCollapse = (slug: string): void => {
    if (collapsed.has(slug)) collapsed.delete(slug);
    else collapsed.add(slug);
    saveCollapsedProducers(collapsed);
    renderModelSelectMenuRows(menu, sel);
    menu.scrollTop = scrollTop;
  };

  if (options.length <= BROWSE_ALL_LIMIT) {
    for (const opt of options) {
      appendModelOptionRow(menu, opt, selectedValue);
    }
    return;
  }

  const groups = new Map<string, HTMLOptionElement[]>();
  for (const opt of options) {
    const modelId = tooltipModelIdForOptionValue(opt.value);
    const slug = producerSlugFromModelId(modelId);
    const list = groups.get(slug);
    if (list) list.push(opt);
    else groups.set(slug, [opt]);
  }

  for (const slug of sortProducerSlugs([...groups.keys()])) {
    const groupOptions = groups.get(slug);
    if (!groupOptions?.length) continue;

    const sampleModelId = tooltipModelIdForOptionValue(groupOptions[0].value);
    appendProducerHeader(menu, slug, groupOptions.length, sampleModelId, collapsed, () =>
      toggleCollapse(slug),
    );

    if (!collapsed.has(slug)) {
      for (const opt of groupOptions) {
        appendModelOptionRow(menu, opt, selectedValue, true);
      }
    }
  }
}

/** Rebuild menu rows and trigger label from the native select + model cache. */
export function syncModelSelectPicker(): void {
  const { sel, trigger, triggerText, menu } = getElements();
  if (!sel || !trigger || !triggerText || !menu) return;

  const selectedValue = sel.value;
  const selectedOpt = sel.options[sel.selectedIndex];
  triggerText.textContent =
    selectedOpt?.text?.trim() || selectedOpt?.label?.trim() || 'Select model';

  const triggerTitle =
    selectedOpt?.title?.trim() || selectedValue.trim() || '';
  if (triggerTitle) triggerText.title = triggerTitle;
  else triggerText.removeAttribute('title');

  const hasSelectable =
    [...sel.options].some((o) => o.value.trim() !== '') && !sel.disabled;
  trigger.disabled = !hasSelectable;

  renderModelSelectMenuRows(menu, sel);
}

/** Bind trigger, outside click, and escape for the model combobox. */
export function initModelSelectPicker(): void {
  if (pickerBound) return;
  pickerBound = true;

  const { trigger } = getElements();
  if (!trigger) return;

  trigger.addEventListener('click', () => {
    toggleModelSelectMenu();
  });

  document.addEventListener('mousedown', (e) => {
    if (!open) return;
    const target = e.target as Node;
    const { root } = getElements();
    if (root && !root.contains(target)) closeModelSelectMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) closeModelSelectMenu();
  });
}
