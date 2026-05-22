/**
 * Custom model picker list: load-state dots in menu + trigger synced to #modelSelect.
 */

import { modelCache } from '../app-state';
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

function pickModel(modelId: string): void {
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

  menu.innerHTML = '';
  for (const opt of sel.options) {
    const id = opt.value.trim();
    if (!id) continue;

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

    const optionTitle = opt.title?.trim() || id;
    li.title = optionTitle;

    const dot = document.createElement('span');
    dot.className = 'model-load-dot';
    dot.setAttribute('aria-hidden', 'true');
    dot.dataset.loadState = loadState;

    const label = document.createElement('span');
    label.className = 'model-select-option-label';
    label.textContent = opt.text;
    label.title = optionTitle;

    li.appendChild(dot);
    li.appendChild(label);
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      pickModel(id);
    });

    menu.appendChild(li);
  }
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
