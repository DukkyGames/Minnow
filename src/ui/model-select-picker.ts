/**
 * Custom model picker list: load-state dots in menu + trigger synced to #modelSelect.
 * Groups models by producer (Qwen, Google, Llama, …) with logos in the popover UI.
 */

import { modelCache } from '../app-state';
import { isServerStorageMode } from '../config/storage-mode';
import { decodeModelSelectKey, encodeModelSelectKey } from '../lib/model-select-key';
import {
  isKnownLocalProviderId,
} from '../providers/provider-host';
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
import { isModelLoaded, resolveModelState } from './model-state-dot';
import { isModelLoadUnloadBusy } from './model-load-unload-button';

/** Flat list when catalog is small; larger catalogs get collapsible producer headers. */
const BROWSE_ALL_LIMIT = 12;

const COLLAPSED_STORAGE_KEY = 'minnow-model-producer-collapsed';
const HOST_FILTER_STORAGE_KEY = 'minnow-model-host-filter';

/** Filter models by provider host: all, loopback/local, or remote/cloud APIs. */
export type ModelHostFilter = 'all' | 'local' | 'cloud';

const HOST_FILTER_CHOICES: { id: ModelHostFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'local', label: 'Local' },
  { id: 'cloud', label: 'Cloud' },
];

let pickerBound = false;
let open = false;
let hostFilter: ModelHostFilter = loadModelHostFilter();

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

function loadModelHostFilter(): ModelHostFilter {
  try {
    const raw = localStorage.getItem(HOST_FILTER_STORAGE_KEY);
    if (raw === 'all' || raw === 'local' || raw === 'cloud') return raw;
  } catch {
    /* ignore private mode */
  }
  return 'all';
}

/** Active local/cloud filter for model picker menus (persisted in localStorage). */
export function getModelHostFilter(): ModelHostFilter {
  return hostFilter;
}

export function setModelHostFilter(filter: ModelHostFilter): void {
  hostFilter = filter;
  try {
    localStorage.setItem(HOST_FILTER_STORAGE_KEY, filter);
  } catch {
    /* ignore quota / private mode */
  }
  syncAllModelHostFilterBars();
}

function syncAllModelHostFilterBars(): void {
  const current = getModelHostFilter();
  for (const bar of document.querySelectorAll('.model-select-host-filter')) {
    for (const btn of bar.querySelectorAll<HTMLButtonElement>('.model-host-filter-segment')) {
      const id = btn.dataset.filter as ModelHostFilter | undefined;
      btn.setAttribute('aria-checked', id === current ? 'true' : 'false');
    }
  }
}

function providerIdForOption(opt: HTMLOptionElement): string {
  const fromAttr = opt.getAttribute('data-provider-id')?.trim();
  if (fromAttr) return fromAttr;
  return decodeModelSelectKey(opt.value)?.providerId ?? '';
}

function isLocalProviderId(providerId: string, opt?: HTMLOptionElement): boolean {
  const hostAttr = opt?.getAttribute('data-provider-host');
  if (hostAttr === 'local') return true;
  if (hostAttr === 'cloud') return false;

  const id = providerId.trim();
  if (!id) return true;
  if (isKnownLocalProviderId(id)) return true;
  return false;
}

function optionMatchesHostFilter(opt: HTMLOptionElement, filter: ModelHostFilter): boolean {
  if (filter === 'all') return true;
  const isLocal = isLocalProviderId(providerIdForOption(opt), opt);
  return filter === 'local' ? isLocal : !isLocal;
}

function filterOptionsByHost(
  options: HTMLOptionElement[],
  filter: ModelHostFilter,
): HTMLOptionElement[] {
  if (filter === 'all') return options;
  return options.filter((opt) => optionMatchesHostFilter(opt, filter));
}

function emptyFilterMessage(filter: ModelHostFilter): string {
  if (filter === 'local') return 'No local models';
  if (filter === 'cloud') return 'No cloud models';
  return 'No models';
}

/** Mount All / Local / Cloud segments; returns the filter bar root. */
export function mountModelHostFilterBar(
  parent: HTMLElement,
  onChange: () => void,
  extraClass = '',
): HTMLDivElement {
  const bar = document.createElement('div');
  bar.className = ['model-select-host-filter', extraClass].filter(Boolean).join(' ');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Model host filter');

  const segments = document.createElement('div');
  segments.className = 'model-host-filter-segmented';

  for (const { id, label } of HOST_FILTER_CHOICES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'model-host-filter-segment';
    btn.textContent = label;
    btn.dataset.filter = id;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', getModelHostFilter() === id ? 'true' : 'false');
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setModelHostFilter(id);
      onChange();
    });
    segments.appendChild(btn);
  }

  bar.appendChild(segments);
  parent.appendChild(bar);
  return bar;
}

function getTopBarModelPopover(): HTMLElement | null {
  return document.querySelector('.model-select-inner .model-select-popover');
}

/** Close the model list popover. */
export function closeModelSelectMenu(): void {
  closeAuxiliaryModelSelectMenu();
  const { root, trigger, menu } = getElements();
  open = false;
  root?.classList.remove('is-open');
  getTopBarModelPopover()?.classList.add('hidden');
  menu?.classList.add('hidden');
  trigger?.setAttribute('aria-expanded', 'false');
}

function openModelSelectMenu(): void {
  const { root, trigger, menu, sel } = getElements();
  if (!root || !trigger || !menu || !sel || trigger.disabled) return;
  closeAuxiliaryModelSelectMenu();
  open = true;
  root.classList.add('is-open');
  getTopBarModelPopover()?.classList.remove('hidden');
  menu.classList.remove('hidden');
  trigger.setAttribute('aria-expanded', 'true');
}

function toggleModelSelectMenu(): void {
  if (open) closeModelSelectMenu();
  else openModelSelectMenu();
}

function resolveSelectOption(
  sel: HTMLSelectElement,
  modelIdOrKey: string,
): HTMLOptionElement | undefined {
  const key = modelIdOrKey.trim();
  if (!key) return sel.options[sel.selectedIndex];
  return [...sel.options].find((o) => o.value === key) ?? sel.options[sel.selectedIndex];
}

/**
 * Keep the model popover open after pick when the provider supports load/unload
 * and the model is not loaded yet (Load is the expected next action).
 */
export function shouldKeepModelMenuOpenAfterSelect(modelIdOrKey: string): boolean {
  if (!isServerStorageMode()) return false;
  const sel = document.getElementById('modelSelect') as HTMLSelectElement | null;
  if (!sel) return false;

  const key = modelIdOrKey.trim();
  if (!key) return false;

  const opt = resolveSelectOption(sel, key);
  if (opt?.getAttribute('data-supports-load-unload') !== '1') return false;

  const direct = modelCache.get(key);
  if (direct) return !isModelLoaded(direct);

  const decoded = decodeModelSelectKey(key);
  if (decoded) {
    const compositeKey = encodeModelSelectKey(decoded.providerId, decoded.modelId);
    const row = modelCache.get(compositeKey);
    if (row) return !isModelLoaded(row);
  }

  return true;
}

/** Select a model in the native picker and notify listeners (top bar or OS menubar). */
export function selectModelInPicker(modelId: string): void {
  const { sel } = getElements();
  if (!sel || !modelId) return;
  const keepOpen = shouldKeepModelMenuOpenAfterSelect(modelId);
  if (!keepOpen) closeModelSelectMenu();
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

type ModelSelectPickHandler = (modelId: string) => void;

interface AuxiliaryModelSelectPicker {
  root: HTMLDivElement;
  trigger: HTMLButtonElement;
  triggerText: HTMLSpanElement;
  menu: HTMLUListElement;
}

const auxiliaryPickers = new WeakMap<HTMLSelectElement, AuxiliaryModelSelectPicker>();
let openAuxiliaryPicker: AuxiliaryModelSelectPicker | null = null;
let auxiliaryPickerGlobalsBound = false;

function closeAuxiliaryModelSelectMenu(): void {
  if (!openAuxiliaryPicker) return;
  openAuxiliaryPicker.root.classList.remove('is-open');
  openAuxiliaryPicker.menu.classList.add('hidden');
  openAuxiliaryPicker.trigger.setAttribute('aria-expanded', 'false');
  openAuxiliaryPicker = null;
}

function ensureAuxiliaryPickerGlobals(): void {
  if (auxiliaryPickerGlobalsBound) return;
  auxiliaryPickerGlobalsBound = true;

  document.addEventListener('mousedown', (e) => {
    if (!openAuxiliaryPicker) return;
    const target = e.target as Node;
    if (!openAuxiliaryPicker.root.contains(target)) closeAuxiliaryModelSelectMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openAuxiliaryPicker) closeAuxiliaryModelSelectMenu();
  });
}

/** Resolve the active option for a native model select (value is authoritative). */
function selectedOptionForSelect(select: HTMLSelectElement): HTMLOptionElement | undefined {
  const value = select.value.trim();
  if (value) {
    const match = [...select.options].find((o) => o.value === value);
    if (match) return match;
  }
  return select.options[select.selectedIndex];
}

/** Sync trigger label and custom menu rows for a mounted auxiliary model combobox. */
export function syncAuxiliaryModelSelectCombobox(select: HTMLSelectElement): void {
  const picker = auxiliaryPickers.get(select);
  if (!picker) return;

  const selectedOpt = selectedOptionForSelect(select);
  picker.triggerText.textContent =
    selectedOpt?.text?.trim() || selectedOpt?.label?.trim() || 'Select model';

  const triggerTitle = selectedOpt?.title?.trim() || select.value.trim() || '';
  if (triggerTitle) picker.triggerText.title = triggerTitle;
  else picker.triggerText.removeAttribute('title');

  const hasSelectable =
    [...select.options].some((o) => o.value.trim() !== '') && !select.disabled;
  picker.trigger.disabled = !hasSelectable;

  renderModelSelectMenuRows(picker.menu, select, (modelId) => {
    closeAuxiliaryModelSelectMenu();
    closeModelSelectMenu();
    if (select.value === modelId) {
      syncAuxiliaryModelSelectCombobox(select);
      return;
    }
    select.value = modelId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/**
 * Wrap a native model &lt;select&gt; with the same custom list UI as the top-bar picker.
 * Safe to call once per element; subsequent calls are no-ops.
 */
export function mountAuxiliaryModelSelectCombobox(select: HTMLSelectElement): void {
  if (auxiliaryPickers.has(select)) return;
  ensureAuxiliaryPickerGlobals();

  const root = document.createElement('div');
  root.className = 'model-select-inner';

  const parent = select.parentElement;
  if (!parent) return;
  parent.insertBefore(root, select);
  root.appendChild(select);

  select.classList.add('model-select-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'model-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const triggerText = document.createElement('span');
  triggerText.className = 'model-select-trigger-text';
  triggerText.textContent = 'Select model';
  trigger.appendChild(triggerText);

  const menu = document.createElement('ul');
  menu.className = 'model-select-menu hidden';
  menu.setAttribute('role', 'listbox');

  const labelledBy = select.getAttribute('aria-label')?.trim();
  if (labelledBy) menu.setAttribute('aria-label', labelledBy);

  root.appendChild(trigger);
  root.appendChild(menu);

  const picker: AuxiliaryModelSelectPicker = { root, trigger, triggerText, menu };
  auxiliaryPickers.set(select, picker);

  select.addEventListener('change', () => {
    syncAuxiliaryModelSelectCombobox(select);
  });

  trigger.addEventListener('click', () => {
    if (trigger.disabled) return;
    if (openAuxiliaryPicker === picker) {
      closeAuxiliaryModelSelectMenu();
      return;
    }
    closeModelSelectMenu();
    closeAuxiliaryModelSelectMenu();
    openAuxiliaryPicker = picker;
    picker.root.classList.add('is-open');
    picker.menu.classList.remove('hidden');
    picker.trigger.setAttribute('aria-expanded', 'true');
    syncAuxiliaryModelSelectCombobox(select);
  });

  syncAuxiliaryModelSelectCombobox(select);
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
  onSelect?: ModelSelectPickHandler,
): void {
  const id = opt.value.trim();
  if (!id) return;

  const cached = modelCache.get(id);
  let loadState = cached ? resolveModelState(cached) : 'unknown';
  if (isModelLoadUnloadBusy() && id === selectedValue) {
    loadState = 'loading';
  }
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
    if (onSelect) onSelect(id);
    else pickModel(id);
  });

  menu.appendChild(li);
}

/** Flatten all selectable options from the native select (including optgroup children). */
function collectSelectOptions(sel: HTMLSelectElement): HTMLOptionElement[] {
  const options: HTMLOptionElement[] = [];
  for (const child of [...sel.children]) {
    const tag = child.tagName;
    if (tag === 'OPTGROUP') {
      for (const el of [...child.children]) {
        if (el.tagName === 'OPTION' && (el as HTMLOptionElement).value.trim()) {
          options.push(el as HTMLOptionElement);
        }
      }
    } else if (tag === 'OPTION' && (child as HTMLOptionElement).value.trim()) {
      options.push(child as HTMLOptionElement);
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
  onSelect?: ModelSelectPickHandler,
): void {
  const selectedValue = sel.value;
  const scrollTop = menu.scrollTop;
  menu.innerHTML = '';

  const allOptions = collectSelectOptions(sel);
  if (allOptions.length === 0) return;

  const hostFilter = getModelHostFilter();
  const options = filterOptionsByHost(allOptions, hostFilter);
  if (options.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'model-select-empty-filter';
    empty.setAttribute('role', 'presentation');
    empty.textContent = emptyFilterMessage(hostFilter);
    menu.appendChild(empty);
    return;
  }

  const collapsed = loadCollapsedProducers();

  const toggleCollapse = (slug: string): void => {
    if (collapsed.has(slug)) collapsed.delete(slug);
    else collapsed.add(slug);
    saveCollapsedProducers(collapsed);
    renderModelSelectMenuRows(menu, sel, onSelect);
    menu.scrollTop = scrollTop;
  };

  if (options.length <= BROWSE_ALL_LIMIT) {
    for (const opt of options) {
      appendModelOptionRow(menu, opt, selectedValue, false, onSelect);
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
        appendModelOptionRow(menu, opt, selectedValue, true, onSelect);
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
function ensureTopBarHostFilterBar(): void {
  const root = document.querySelector('.model-select-inner');
  const menu = document.getElementById('modelSelectMenu');
  if (!root || !menu || root.querySelector('.model-select-popover')) return;

  const shell = document.createElement('div');
  shell.className = 'model-select-popover hidden';
  menu.parentNode?.insertBefore(shell, menu);
  shell.appendChild(menu);

  mountModelHostFilterBar(shell, () => {
    const { sel, menu: menuEl } = getElements();
    if (sel && menuEl) renderModelSelectMenuRows(menuEl, sel);
  });
}

export function initModelSelectPicker(): void {
  if (pickerBound) return;
  pickerBound = true;

  const { trigger } = getElements();
  if (!trigger) return;

  ensureTopBarHostFilterBar();

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
