/**
 * Custom model picker list: load-state dots in menu + trigger synced to #modelSelect.
 * Supports <optgroup> rows from the multi-provider model catalog.
 */

import { modelCache } from '../app-state';
import { decodeModelSelectKey } from '../lib/model-select-key';
import {
  formatCapabilityBadges,
  formatCapabilityTooltip,
} from '../providers/capability-badges';
import { getLastCapabilitiesProbedAt } from '../providers/model-capabilities';
import { resolveModelState } from './model-state-dot';

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

/** Append one selectable row for an <option> (shared by flat options and optgroup children). */
function appendModelOptionRow(
  menu: HTMLUListElement,
  opt: HTMLOptionElement,
  selectedValue: string,
): void {
  const id = opt.value.trim();
  if (!id) return;

  const cached = modelCache.get(id);
  const loadState = cached ? resolveModelState(cached) : 'unknown';

  const li = document.createElement('li');
  li.className = 'model-select-option';
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
  const tipId = tooltipModelIdForOptionValue(id);
  const rowTitle = caps
    ? formatCapabilityTooltip(tipId, caps, probedAt)
    : opt.title?.trim() || tipId;
  li.title = rowTitle;

  const dot = document.createElement('span');
  dot.className = 'model-load-dot';
  dot.setAttribute('aria-hidden', 'true');
  dot.dataset.loadState = loadState;

  const label = document.createElement('span');
  label.className = 'model-select-option-label';
  label.textContent = opt.text;
  label.title = rowTitle;

  const badges = formatCapabilityBadges(caps);
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

/** Rebuild model list rows into any menu element (shared by top bar and OS menubar). */
export function renderModelSelectMenuRows(
  menu: HTMLUListElement,
  sel: HTMLSelectElement,
): void {
  const selectedValue = sel.value;
  menu.innerHTML = '';
  for (const child of [...sel.children]) {
    if (child instanceof HTMLOptGroupElement) {
      const header = document.createElement('li');
      header.className = 'model-select-optgroup-label';
      header.textContent = child.label || '';
      header.setAttribute('role', 'presentation');
      menu.appendChild(header);
      for (const el of [...child.children]) {
        if (el instanceof HTMLOptionElement) {
          appendModelOptionRow(menu, el, selectedValue);
        }
      }
    } else if (child instanceof HTMLOptionElement) {
      appendModelOptionRow(menu, child, selectedValue);
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
