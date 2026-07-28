/**
 * Compact active-model label on composer surfaces (desktop chat + Code).
 * Opens a fixed popover wired to the canonical #modelSelect catalog.
 */

import { decodeModelSelectKey, resolveModelSelectValueForChat } from '../lib/model-select-key';
import { getModelRowForSelectOrCanonicalId, updateModelLoadUnloadButtons } from '../api/models';
import { modelCache } from '../app-state';
import { modelProducerLogoSvg } from '../providers/model-producer';
import { isModelLoadUnloadBusy } from './model-load-unload-button';
import { resolveModelState } from './model-state-dot';
import { getActiveChat } from '../state/sessions';
import { onActiveChatModelChange } from './chat-model-ui';
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
import {
  registerChromePopover,
  unregisterChromePopover,
} from './preview-electron-visibility';

import { iconHtml } from './icon';

const CHEVRON_SVG = iconHtml('chevronDown', { size: 10 });

const MODEL_FALLBACK_ICON_SVG = iconHtml('appModels', { className: 'mn-os-mb-model-fallback-icon' });

type ComposerModelVariant = 'desktop' | 'code' | 'menubar';

/** How long the menubar hover label stays visible before collapsing. */
const MENUBAR_EXPAND_HOLD_MS = 3200;

interface ComposerModelTrigger {
  variant: ComposerModelVariant;
  root: HTMLDivElement;
  trigger: HTMLButtonElement;
  logoEl: HTMLSpanElement;
  labelEl: HTMLSpanElement;
  menu: HTMLUListElement;
  panel: HTMLDivElement;
  providerEl?: HTMLSpanElement;
  iconLogoEl?: HTMLSpanElement;
  dotEl?: HTMLElement;
  expandEl?: HTMLElement;
  collapseTimer?: number;
}

const triggers: ComposerModelTrigger[] = [];
let openTrigger: ComposerModelTrigger | null = null;
let chromePopoverRegistered = false;
let globalsBound = false;
let unregisterExternalCloser: (() => void) | null = null;

function getModelSelect(): HTMLSelectElement | null {
  return document.getElementById('modelSelect') as HTMLSelectElement | null;
}

function canonicalModelIdFromSelectValue(value: string): string {
  return decodeModelSelectKey(value)?.modelId ?? value.trim();
}

function selectedOptionForValue(
  sel: HTMLSelectElement,
  value: string,
): HTMLOptionElement | undefined {
  const trimmed = value.trim();
  if (trimmed) {
    const match = [...sel.options].find((o) => o.value === trimmed);
    if (match) return match;
  }
  return sel.options[sel.selectedIndex];
}

function resolveTriggerSelectValue(trigger: ComposerModelTrigger): string {
  const sel = getModelSelect();
  if (!sel) return '';
  if (trigger.variant === 'menubar') {
    return sel.value.trim();
  }
  const values = [...sel.options].map((o) => o.value);
  return resolveModelSelectValueForChat(getActiveChat(), values);
}

/** Split composite option text into model name and provider label. */
function parseModelOptionLabels(opt?: HTMLOptionElement): {
  model: string;
  provider: string;
} {
  const text = opt?.text?.trim() || opt?.label?.trim() || '';
  const sep = ' — ';
  const idx = text.lastIndexOf(sep);
  if (idx > 0) {
    return {
      model: text.slice(0, idx).trim(),
      provider: text.slice(idx + sep.length).trim(),
    };
  }
  return { model: text || 'Select model', provider: '' };
}

function applyLogoSvg(target: HTMLElement, modelId: string): void {
  const svg = modelId ? modelProducerLogoSvg(modelId) : '';
  if (svg) {
    target.innerHTML = svg;
    target.classList.remove('hidden');
  } else {
    target.innerHTML = '';
    target.classList.add('hidden');
  }
}

function syncMenubarLoadDot(trigger: ComposerModelTrigger, selectValue: string): void {
  if (!trigger.dotEl) return;
  let state = 'unknown';
  if (isModelLoadUnloadBusy()) {
    state = 'loading';
  } else if (selectValue) {
    const row = getModelRowForSelectOrCanonicalId(selectValue);
    state = row
      ? resolveModelState(row)
      : modelCache.get(selectValue)
        ? resolveModelState(modelCache.get(selectValue))
        : 'unknown';
  }
  trigger.dotEl.dataset.loadState = state;
}

/** Sync logo + label on one composer model trigger. */
function syncTrigger(trigger: ComposerModelTrigger): void {
  const sel = getModelSelect();
  const selectValue = resolveTriggerSelectValue(trigger);
  const selectedOpt = sel ? selectedOptionForValue(sel, selectValue) : undefined;
  const { model, provider } = parseModelOptionLabels(selectedOpt);

  if (trigger.variant === 'menubar') {
    trigger.labelEl.textContent = model;
    if (trigger.providerEl) {
      trigger.providerEl.textContent = provider;
      trigger.providerEl.hidden = !provider;
    }
  } else {
    const label =
      selectedOpt?.text?.trim() || selectedOpt?.label?.trim() || 'Select model';
    trigger.labelEl.textContent = label;
  }

  const title = selectedOpt?.title?.trim() || selectValue || '';
  if (title) trigger.labelEl.title = title;
  else trigger.labelEl.removeAttribute('title');

  const modelId = selectValue ? canonicalModelIdFromSelectValue(selectValue) : '';
  if (trigger.variant === 'menubar') {
    if (trigger.iconLogoEl) {
      applyLogoSvg(trigger.iconLogoEl, modelId);
      const hasProducerLogo = Boolean(modelId && modelProducerLogoSvg(modelId));
      trigger.trigger.classList.toggle('has-producer-logo', hasProducerLogo);
    }
    syncMenubarLoadDot(trigger, selectValue);
    const summary = provider ? `${model} · ${provider}` : model;
    trigger.trigger.setAttribute('aria-label', `Default model: ${summary}`);
    trigger.trigger.title = summary;
  } else {
    applyLogoSvg(trigger.logoEl, modelId);
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

function handleComposerModelPick(trigger: ComposerModelTrigger, modelId: string): void {
  if (trigger.variant === 'menubar') {
    selectModelInPicker(modelId);
    return;
  }
  onActiveChatModelChange(modelId);
}

function rebuildOpenMenu(): void {
  if (!openTrigger) return;
  const sel = getModelSelect();
  if (!sel) return;
  const selectedValue = resolveTriggerSelectValue(openTrigger);
  renderModelSelectMenuRows(
    openTrigger.menu,
    sel,
    (modelId) => {
      handleComposerModelPick(openTrigger!, modelId);
      if (!shouldKeepModelMenuOpenAfterSelect(modelId)) {
        closeComposerModelMenu();
      } else {
        rebuildOpenMenu();
      }
    },
    selectedValue,
  );
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

  const panelHeight = panel.offsetHeight || panel.getBoundingClientRect().height;

  if (trigger.variant === 'menubar') {
    let top = rect.bottom + gap;
    top = Math.max(margin, Math.min(top, window.innerHeight - panelHeight - margin));
    panel.style.top = `${top}px`;
    return;
  }

  // Prefer above the trigger — composer sits at the bottom of the viewport.
  let top = rect.top - panelHeight - gap;
  if (top < margin) {
    top = rect.bottom + gap;
  }
  top = Math.max(margin, Math.min(top, window.innerHeight - panelHeight - margin));
  panel.style.top = `${top}px`;
}

function clearMenubarCollapseTimer(trigger: ComposerModelTrigger): void {
  if (trigger.collapseTimer === undefined) return;
  window.clearTimeout(trigger.collapseTimer);
  trigger.collapseTimer = undefined;
}

function positionMenubarExpandLabel(trigger: ComposerModelTrigger): void {
  const expand = trigger.expandEl;
  if (!expand) return;
  const rect = trigger.trigger.getBoundingClientRect();
  // Anchor to the left of the icon — label grows leftward, icon stays fixed.
  expand.style.left = `${rect.left - 6}px`;
  expand.style.top = `${rect.top + rect.height / 2}px`;
  expand.style.right = 'auto';
}

function isPointerOverMenubarChip(
  trigger: ComposerModelTrigger,
  target: Node | null,
): boolean {
  if (!target) return false;
  return trigger.root.contains(target) || Boolean(trigger.expandEl?.contains(target));
}

function collapseMenubarExpand(trigger: ComposerModelTrigger): void {
  if (openTrigger === trigger) return;
  clearMenubarCollapseTimer(trigger);
  trigger.root.classList.remove('is-expanded');
  trigger.expandEl?.classList.remove('is-expanded', 'is-open');
  trigger.expandEl?.setAttribute('aria-hidden', 'true');
}

function expandMenubarChip(trigger: ComposerModelTrigger): void {
  positionMenubarExpandLabel(trigger);
  trigger.root.classList.add('is-expanded');
  trigger.expandEl?.classList.add('is-expanded');
  trigger.expandEl?.setAttribute('aria-hidden', 'false');
  clearMenubarCollapseTimer(trigger);
  trigger.collapseTimer = window.setTimeout(() => {
    trigger.collapseTimer = undefined;
    collapseMenubarExpand(trigger);
  }, MENUBAR_EXPAND_HOLD_MS);
}

function wireMenubarHover(trigger: ComposerModelTrigger): void {
  let leaveTimer: number | undefined;

  const show = () => {
    if (leaveTimer !== undefined) {
      window.clearTimeout(leaveTimer);
      leaveTimer = undefined;
    }
    expandMenubarChip(trigger);
  };

  const scheduleCollapse = () => {
    if (leaveTimer !== undefined) window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => {
      leaveTimer = undefined;
      collapseMenubarExpand(trigger);
    }, 180);
  };

  const onPointerOut = (e: PointerEvent) => {
    const related = e.relatedTarget as Node | null;
    if (isPointerOverMenubarChip(trigger, related)) return;
    scheduleCollapse();
  };

  trigger.root.addEventListener('pointerenter', show);
  trigger.root.addEventListener('pointerout', onPointerOut);
  trigger.expandEl?.addEventListener('pointerenter', show);
  trigger.expandEl?.addEventListener('pointerout', onPointerOut);
  window.addEventListener('resize', () => {
    if (trigger.root.classList.contains('is-expanded') || openTrigger === trigger) {
      positionMenubarExpandLabel(trigger);
    }
  });
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
  if (current.variant === 'menubar') {
    collapseMenubarExpand(current);
  }
  if (chromePopoverRegistered) {
    unregisterChromePopover();
    chromePopoverRegistered = false;
  }
  detachGlobalListeners();
}

function openMenu(trigger: ComposerModelTrigger): void {
  const sel = getModelSelect();
  if (!sel || trigger.trigger.disabled) return;
  closeModelSelectMenu();
  closeComposerModelMenu();
  openTrigger = trigger;
  if (trigger.variant === 'menubar') {
    expandMenubarChip(trigger);
  }
  rebuildOpenMenu();
  updateModelLoadUnloadButtons();
  trigger.panel.classList.remove('hidden');
  trigger.root.classList.add('is-open');
  if (trigger.variant === 'menubar') {
    trigger.expandEl?.classList.add('is-open');
    positionMenubarExpandLabel(trigger);
  }
  trigger.trigger.setAttribute('aria-expanded', 'true');
  positionPanel(trigger);
  attachGlobalListeners();
  if (!chromePopoverRegistered) {
    registerChromePopover();
    chromePopoverRegistered = true;
  }
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

function createModelMenuPanel(): { panel: HTMLDivElement; menu: HTMLUListElement } {
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
  return { panel, menu };
}

function buildMenubarTrigger(): ComposerModelTrigger {
  const root = document.createElement('div');
  root.className =
    'mn-os-mb-model-chip composer-model-trigger-wrap composer-model-trigger-wrap--menubar';

  const expandEl = document.createElement('div');
  expandEl.className = 'mn-os-mb-model-expand';
  expandEl.setAttribute('aria-hidden', 'true');

  const expandInner = document.createElement('div');
  expandInner.className = 'mn-os-mb-model-expand-inner';

  const labelEl = document.createElement('span');
  labelEl.className = 'mn-os-mb-model-label';
  labelEl.textContent = 'Select model';

  const providerEl = document.createElement('span');
  providerEl.className = 'mn-os-mb-model-provider';
  providerEl.hidden = true;

  expandInner.append(labelEl, providerEl);
  expandEl.appendChild(expandInner);

  const triggerBtn = document.createElement('button');
  triggerBtn.type = 'button';
  triggerBtn.className = 'mn-os-mb-model-icon mn-os-mb-icon';
  triggerBtn.setAttribute('aria-haspopup', 'listbox');
  triggerBtn.setAttribute('aria-expanded', 'false');
  triggerBtn.setAttribute('aria-label', 'Default model');

  const dotEl = document.createElement('span');
  dotEl.className = 'model-load-dot mn-os-mb-model-dot';
  dotEl.setAttribute('aria-hidden', 'true');

  const iconLogoEl = document.createElement('span');
  iconLogoEl.className = 'mn-os-mb-model-icon-logo hidden';
  iconLogoEl.setAttribute('aria-hidden', 'true');

  const fallbackWrap = document.createElement('span');
  fallbackWrap.className = 'mn-os-mb-model-fallback-wrap';
  fallbackWrap.innerHTML = MODEL_FALLBACK_ICON_SVG;
  fallbackWrap.setAttribute('aria-hidden', 'true');

  triggerBtn.append(dotEl, iconLogoEl, fallbackWrap);
  // Icon stays in the menubar flow; label is portaled to body as a fixed overlay.
  root.appendChild(triggerBtn);
  document.body.appendChild(expandEl);

  const { panel, menu } = createModelMenuPanel();

  const entry: ComposerModelTrigger = {
    variant: 'menubar',
    root,
    trigger: triggerBtn,
    logoEl: iconLogoEl,
    labelEl,
    providerEl,
    iconLogoEl,
    dotEl,
    expandEl,
    menu,
    panel,
  };

  wireMenubarHover(entry);
  triggerBtn.addEventListener('click', () => toggleMenu(entry));
  triggers.push(entry);
  syncTrigger(entry);
  return entry;
}

function buildTrigger(variant: ComposerModelVariant): ComposerModelTrigger {
  if (variant === 'menubar') {
    return buildMenubarTrigger();
  }

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

  const { panel, menu } = createModelMenuPanel();

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
  variant: Exclude<ComposerModelVariant, 'menubar'>,
): void {
  ensureGlobals();
  if (anchor.querySelector('.composer-model-trigger-wrap')) return;
  const entry = buildTrigger(variant);
  anchor.appendChild(entry.root);
}

/** Mount the menubar default-model icon chip (shared composer model menu). */
export function mountMenubarModelChipTrigger(anchor: HTMLElement): void {
  ensureGlobals();
  if (anchor.querySelector('.composer-model-trigger-wrap--menubar')) return;
  const entry = buildMenubarTrigger();
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
    codeTrail.insertBefore(codeAnchor, codeTrail.firstChild);
    mountComposerModelTrigger(codeAnchor, 'code');
  }
}
