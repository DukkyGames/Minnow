/**
 * Compact active-model label on composer surfaces (desktop chat + Code).
 * Opens a fixed popover wired to the canonical #modelSelect catalog.
 */

import { decodeModelSelectKey } from '../lib/model-select-key';
import { updateModelLoadUnloadButtons } from '../api/models';
import { modelProducerLogoSvg } from '../providers/model-producer';
import {
  clearModelSearchQuery,
  closeModelSelectMenu,
  focusModelHostFilterSearch,
  mountModelHostFilterBar,
  registerModelSelectExternalCloser,
  renderModelSelectMenuRows,
  selectModelInPicker,
  shouldKeepModelMenuOpenAfterSelect,
} from './model-select-picker';

const CHEVRON_SVG =
  '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

type ComposerModelVariant = 'desktop' | 'code';

interface ComposerModelTrigger {
  variant: ComposerModelVariant;
  root: HTMLDivElement;
  trigger: HTMLButtonElement;
  logoEl: HTMLSpanElement;
  labelEl: HTMLSpanElement;
  menu: HTMLUListElement;
  panel: HTMLDivElement;
}

const triggers: ComposerModelTrigger[] = [];
let openTrigger: ComposerModelTrigger | null = null;
let globalsBound = false;
let unregisterExternalCloser: (() => void) | null = null;

function getModelSelect(): HTMLSelectElement | null {
  return document.getElementById('modelSelect') as HTMLSelectElement | null;
}

function canonicalModelIdFromSelectValue(value: string): string {
  return decodeModelSelectKey(value)?.modelId ?? value.trim();
}

function selectedOption(sel: HTMLSelectElement): HTMLOptionElement | undefined {
  const value = sel.value.trim();
  if (value) {
    const match = [...sel.options].find((o) => o.value === value);
    if (match) return match;
  }
  return sel.options[sel.selectedIndex];
}

/** Sync logo + label on one composer model trigger from #modelSelect. */
function syncTrigger(trigger: ComposerModelTrigger): void {
  const sel = getModelSelect();
  const selectedOpt = sel ? selectedOption(sel) : undefined;
  const label =
    selectedOpt?.text?.trim() || selectedOpt?.label?.trim() || 'Select model';
  trigger.labelEl.textContent = label;

  const title = selectedOpt?.title?.trim() || sel?.value.trim() || '';
  if (title) trigger.labelEl.title = title;
  else trigger.labelEl.removeAttribute('title');

  const modelId = sel?.value.trim()
    ? canonicalModelIdFromSelectValue(sel.value)
    : '';
  const svg = modelId ? modelProducerLogoSvg(modelId) : '';
  if (svg) {
    trigger.logoEl.innerHTML = svg;
    trigger.logoEl.classList.remove('hidden');
  } else {
    trigger.logoEl.innerHTML = '';
    trigger.logoEl.classList.add('hidden');
  }

  const hasSelectable =
    Boolean(sel) &&
    [...sel!.options].some((o) => o.value.trim() !== '') &&
    !sel!.disabled;
  trigger.trigger.disabled = !hasSelectable;
}

/** Sync every mounted composer model trigger. */
export function syncComposerModelTriggers(): void {
  for (const trigger of triggers) syncTrigger(trigger);
  if (openTrigger) rebuildOpenMenu();
}

function rebuildOpenMenu(): void {
  if (!openTrigger) return;
  const sel = getModelSelect();
  if (!sel) return;
  renderModelSelectMenuRows(openTrigger.menu, sel, (modelId) => {
    selectModelInPicker(modelId);
    if (!shouldKeepModelMenuOpenAfterSelect(modelId)) {
      closeComposerModelMenu();
    } else {
      rebuildOpenMenu();
    }
  });
}

function positionPanel(trigger: ComposerModelTrigger): void {
  const rect = trigger.trigger.getBoundingClientRect();
  const margin = 8;
  const gap = 4;
  const panel = trigger.panel;

  const panelWidth = panel.offsetWidth || panel.getBoundingClientRect().width;
  let left = rect.right - panelWidth;
  left = Math.max(margin, Math.min(left, window.innerWidth - panelWidth - margin));
  panel.style.left = `${left}px`;
  panel.style.right = 'auto';

  // Prefer above the trigger — composer sits at the bottom of the viewport.
  const panelHeight = panel.offsetHeight || panel.getBoundingClientRect().height;
  let top = rect.top - panelHeight - gap;
  if (top < margin) {
    top = rect.bottom + gap;
  }
  top = Math.max(margin, Math.min(top, window.innerHeight - panelHeight - margin));
  panel.style.top = `${top}px`;
}

function detachGlobalListeners(): void {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  document.removeEventListener('keydown', onDocumentKeyDown, true);
  window.removeEventListener('resize', onWindowResize);
}

function onDocumentPointerDown(e: PointerEvent): void {
  if (!openTrigger) return;
  const target = e.target as Node | null;
  if (!target) return;
  if (
    openTrigger.root.contains(target) ||
    openTrigger.panel.contains(target)
  ) {
    return;
  }
  closeComposerModelMenu();
}

function onDocumentKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && openTrigger) {
    e.preventDefault();
    closeComposerModelMenu();
  }
}

function onWindowResize(): void {
  if (openTrigger) positionPanel(openTrigger);
}

function attachGlobalListeners(): void {
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('keydown', onDocumentKeyDown, true);
  window.addEventListener('resize', onWindowResize);
}

/** Close any open composer model menu popover. */
export function closeComposerModelMenu(): void {
  if (!openTrigger) return;
  clearModelSearchQuery();
  const current = openTrigger;
  openTrigger = null;
  current.panel.classList.add('hidden');
  current.root.classList.remove('is-open');
  current.trigger.setAttribute('aria-expanded', 'false');
  detachGlobalListeners();
}

function openMenu(trigger: ComposerModelTrigger): void {
  const sel = getModelSelect();
  if (!sel || trigger.trigger.disabled) return;
  closeModelSelectMenu();
  closeComposerModelMenu();
  openTrigger = trigger;
  rebuildOpenMenu();
  updateModelLoadUnloadButtons();
  trigger.panel.classList.remove('hidden');
  trigger.root.classList.add('is-open');
  trigger.trigger.setAttribute('aria-expanded', 'true');
  positionPanel(trigger);
  attachGlobalListeners();
  focusModelHostFilterSearch();
}

function toggleMenu(trigger: ComposerModelTrigger): void {
  if (openTrigger === trigger) closeComposerModelMenu();
  else openMenu(trigger);
}

function ensureGlobals(): void {
  if (globalsBound) return;
  globalsBound = true;

  unregisterExternalCloser = registerModelSelectExternalCloser(() => {
    closeComposerModelMenu();
  });

  const sel = getModelSelect();
  sel?.addEventListener('change', () => syncComposerModelTriggers());
  document.addEventListener('minnow:model-select-synced', () => syncComposerModelTriggers());

  const source = document.getElementById('modelSelectTriggerText');
  if (source && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(() => syncComposerModelTriggers());
    observer.observe(source, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['title'],
    });
  }
}

function buildTrigger(variant: ComposerModelVariant): ComposerModelTrigger {
  const root = document.createElement('div');
  root.className = `composer-model-trigger-wrap composer-model-trigger-wrap--${variant}`;

  const triggerBtn = document.createElement('button');
  triggerBtn.type = 'button';
  triggerBtn.className = 'composer-model-trigger';
  triggerBtn.setAttribute('aria-haspopup', 'listbox');
  triggerBtn.setAttribute('aria-expanded', 'false');
  triggerBtn.setAttribute('aria-label', 'Active model');

  const logoEl = document.createElement('span');
  logoEl.className = 'composer-model-trigger__logo hidden';
  logoEl.setAttribute('aria-hidden', 'true');

  const labelEl = document.createElement('span');
  labelEl.className = 'composer-model-trigger__label';
  labelEl.textContent = 'Select model';

  const chevronEl = document.createElement('span');
  chevronEl.className = 'composer-model-trigger__chevron';
  chevronEl.setAttribute('aria-hidden', 'true');
  chevronEl.innerHTML = CHEVRON_SVG;

  triggerBtn.append(logoEl, labelEl, chevronEl);
  root.appendChild(triggerBtn);

  const panel = document.createElement('div');
  panel.className = 'composer-model-menu hidden';
  panel.setAttribute('role', 'presentation');

  mountModelHostFilterBar(
    panel,
    {
      onFilterChange: () => rebuildOpenMenu(),
      onAfterRefresh: () => rebuildOpenMenu(),
      onAfterLoadUnload: () => {
        rebuildOpenMenu();
        syncComposerModelTriggers();
      },
    },
    'composer-model-menu__filter',
  );

  const menu = document.createElement('ul');
  menu.className = 'composer-model-menu__list model-select-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Model');
  panel.appendChild(menu);

  document.body.appendChild(panel);

  const entry: ComposerModelTrigger = {
    variant,
    root,
    trigger: triggerBtn,
    logoEl,
    labelEl,
    menu,
    panel,
  };

  triggerBtn.addEventListener('click', () => toggleMenu(entry));
  triggers.push(entry);
  syncTrigger(entry);
  return entry;
}

/** Mount a compact model trigger into an anchor element. */
export function mountComposerModelTrigger(
  anchor: HTMLElement,
  variant: ComposerModelVariant,
): void {
  ensureGlobals();
  if (anchor.querySelector('.composer-model-trigger-wrap')) return;
  const entry = buildTrigger(variant);
  anchor.appendChild(entry.root);
}

/** Wire desktop + Code composer model triggers (idempotent). */
export function initComposerModelTriggers(): void {
  ensureGlobals();

  const desktopAnchor = document.getElementById('desktopComposerModelAnchor');
  if (desktopAnchor) {
    mountComposerModelTrigger(desktopAnchor, 'desktop');
  }

  const codeTrail = document.querySelector('.composer-controls__trail');
  const toolsAnchor = codeTrail?.querySelector('.composer-tools-anchor');
  if (codeTrail && toolsAnchor) {
    const codeAnchor = document.createElement('div');
    codeAnchor.id = 'codeComposerModelAnchor';
    codeAnchor.className = 'composer-model-trigger-anchor';
    codeTrail.insertBefore(codeAnchor, toolsAnchor);
    mountComposerModelTrigger(codeAnchor, 'code');
  }
}
