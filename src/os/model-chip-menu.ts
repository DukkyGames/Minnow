/**
 * OS menubar model chip — picker popover with load/unload actions.
 * Anchored to the menubar chip when the legacy topbar is hidden.
 */

import {
  fetchModels,
  getModelRowForSelectOrCanonicalId,
  toggleSelectedModelLoad,
  updateModelLoadUnloadButtons,
} from '../api/models';
import { isServerStorageMode } from '../config/storage-mode';
import { isModelLoaded, resolveModelState } from '../ui/model-state-dot';
import { modelCache } from '../app-state';
import {
  closeModelSelectMenu,
  mountModelHostFilterBar,
  renderModelSelectMenuRows,
  syncModelSelectPicker,
} from '../ui/model-select-picker';
import { closeOsNotificationsMenu } from './notifications-menu';
import {
  registerChromePopover,
  unregisterChromePopover,
} from '../ui/preview-electron-visibility';

let panelEl: HTMLDivElement | null = null;
let listEl: HTMLUListElement | null = null;
let loadBtn: HTMLButtonElement | null = null;
let refreshBtn: HTMLButtonElement | null = null;
let anchorChip: HTMLButtonElement | null = null;
let chipDot: HTMLElement | null = null;
let chipText: HTMLElement | null = null;
let menuOpen = false;
let outsideHandler: ((e: PointerEvent) => void) | null = null;
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;
let modelSelectListener: (() => void) | null = null;

function getModelSelect(): HTMLSelectElement | null {
  return document.getElementById('modelSelect') as HTMLSelectElement | null;
}

/** Sync menubar chip label from the canonical top-bar trigger text. */
export function syncOsModelChipText(textEl: HTMLElement): void {
  const source = document.getElementById('modelSelectTriggerText');
  if (source) {
    textEl.textContent = source.textContent?.trim() || 'No model';
    const title = source.getAttribute('title');
    if (title) textEl.title = title;
    else textEl.removeAttribute('title');
    return;
  }
  const sel = getModelSelect();
  const opt = sel?.options[sel.selectedIndex];
  textEl.textContent = opt?.text?.trim() || 'No model';
}

/** Sync menubar chip load-state dot from the active model selection. */
export function syncOsModelChipDot(dotEl: HTMLElement): void {
  const sel = getModelSelect();
  const id = sel?.value.trim() ?? '';
  let state = 'unknown';
  if (id) {
    const row = getModelRowForSelectOrCanonicalId(id);
    state = row ? resolveModelState(row) : modelCache.get(id) ? resolveModelState(modelCache.get(id)) : 'unknown';
  }
  dotEl.className = 'model-load-dot';
  dotEl.dataset.loadState = state;
  dotEl.setAttribute('aria-hidden', 'true');
}

function syncLoadUnloadButton(): void {
  if (!loadBtn) return;
  updateModelLoadUnloadButtons();
  const topBtn = document.getElementById('btnModelLoadUnload') as HTMLButtonElement | null;
  const sel = getModelSelect();
  const opt = sel?.options[sel.selectedIndex];
  const supportsUnload =
    isServerStorageMode() && opt?.getAttribute('data-supports-load-unload') === '1';

  loadBtn.hidden = !supportsUnload;
  if (!supportsUnload) {
    loadBtn.disabled = true;
    loadBtn.textContent = 'Load';
    loadBtn.title = isServerStorageMode()
      ? 'Model load/unload is not supported for this provider'
      : 'Start with npm start to load or unload models';
    return;
  }

  const raw = sel?.value.trim() ?? '';
  const row = raw ? getModelRowForSelectOrCanonicalId(raw) : undefined;
  const loaded = row ? isModelLoaded(row) : false;

  loadBtn.textContent = topBtn?.textContent?.trim() || (loaded ? 'Unload' : 'Load');
  loadBtn.disabled = topBtn?.disabled ?? !raw;
  loadBtn.title = topBtn?.title ?? (loaded ? 'Unload model' : 'Load model');
}

function rebuildMenuList(): void {
  const sel = getModelSelect();
  if (!listEl || !sel) return;
  renderModelSelectMenuRows(listEl, sel);
  syncLoadUnloadButton();
}

function positionPanel(chip: HTMLButtonElement, panel: HTMLElement): void {
  const rect = chip.getBoundingClientRect();
  const margin = 8;
  panel.style.top = `${rect.bottom + 4}px`;
  panel.style.right = 'auto';

  const panelWidth = panel.offsetWidth || panel.getBoundingClientRect().width;
  let left = rect.right - panelWidth;
  left = Math.max(margin, Math.min(left, window.innerWidth - panelWidth - margin));
  panel.style.left = `${left}px`;
}

function detachGlobalListeners(): void {
  if (outsideHandler) {
    document.removeEventListener('pointerdown', outsideHandler, true);
    outsideHandler = null;
  }
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler, true);
    escapeHandler = null;
  }
}

/** Close the OS model popover. */
export function closeOsModelChipMenu(): void {
  if (!menuOpen) return;
  menuOpen = false;
  unregisterChromePopover();
  detachGlobalListeners();
  panelEl?.classList.add('hidden');
  anchorChip?.setAttribute('aria-expanded', 'false');
  anchorChip?.classList.remove('is-open');
}

function attachGlobalListeners(): void {
  outsideHandler = (e: PointerEvent) => {
    const target = e.target as Node | null;
    if (!panelEl || !anchorChip) return;
    if (panelEl.contains(target) || anchorChip.contains(target)) return;
    closeOsModelChipMenu();
  };
  document.addEventListener('pointerdown', outsideHandler, true);

  escapeHandler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    closeOsModelChipMenu();
  };
  document.addEventListener('keydown', escapeHandler, true);
}

function ensurePanel(): HTMLDivElement {
  if (panelEl) return panelEl;

  panelEl = document.createElement('div');
  panelEl.id = 'osModelChipMenu';
  panelEl.className = 'mn-os-model-menu hidden';
  panelEl.setAttribute('role', 'dialog');
  panelEl.setAttribute('aria-label', 'Model picker');

  mountModelHostFilterBar(panelEl, () => rebuildMenuList(), 'mn-os-model-menu__filter');

  listEl = document.createElement('ul');
  listEl.className = 'mn-os-model-menu__list';
  listEl.setAttribute('role', 'listbox');

  const footer = document.createElement('div');
  footer.className = 'mn-os-model-menu__footer';

  loadBtn = document.createElement('button');
  loadBtn.type = 'button';
  loadBtn.className = 'mn-os-model-menu__action mn-os-model-menu__action--primary';
  loadBtn.textContent = 'Load';
  loadBtn.addEventListener('click', async () => {
    await toggleSelectedModelLoad();
    rebuildMenuList();
    if (chipDot) syncOsModelChipDot(chipDot);
    if (chipText) syncOsModelChipText(chipText);
    syncModelSelectPicker();
  });

  refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'mn-os-model-menu__action';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.title = 'Refresh model list';
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    try {
      await fetchModels();
      rebuildMenuList();
      if (chipDot) syncOsModelChipDot(chipDot);
      if (chipText) syncOsModelChipText(chipText);
    } finally {
      refreshBtn.disabled = false;
    }
  });

  footer.append(loadBtn, refreshBtn);
  panelEl.append(listEl, footer);
  document.body.appendChild(panelEl);
  return panelEl;
}

function openMenu(): void {
  const chip = anchorChip;
  if (!chip) return;
  closeOsNotificationsMenu();
  closeModelSelectMenu();
  const panel = ensurePanel();
  rebuildMenuList();
  menuOpen = true;
  registerChromePopover();
  panel.classList.remove('hidden');
  chip.setAttribute('aria-expanded', 'true');
  chip.classList.add('is-open');
  positionPanel(chip, panel);
  attachGlobalListeners();
}

function toggleMenu(): void {
  if (menuOpen) closeOsModelChipMenu();
  else openMenu();
}

/** Wire the menubar model chip to open the picker popover. Returns cleanup. */
export function initOsModelChipMenu(
  chip: HTMLButtonElement,
  dotEl: HTMLElement,
  textEl: HTMLElement,
): () => void {
  anchorChip = chip;
  chipDot = dotEl;
  chipText = textEl;

  chip.setAttribute('aria-haspopup', 'dialog');
  chip.setAttribute('aria-expanded', 'false');
  chip.setAttribute('aria-controls', 'osModelChipMenu');

  syncOsModelChipText(textEl);
  syncOsModelChipDot(dotEl);

  const onChipClick = () => toggleMenu();
  chip.addEventListener('click', onChipClick);

  const sel = getModelSelect();
  modelSelectListener = () => {
    syncOsModelChipText(textEl);
    syncOsModelChipDot(dotEl);
    if (menuOpen) {
      rebuildMenuList();
      closeOsModelChipMenu();
    }
  };
  sel?.addEventListener('change', modelSelectListener);

  const modelSource = document.getElementById('modelSelectTriggerText');
  let modelObserver: MutationObserver | null = null;
  let modelPoll: number | undefined;
  if (modelSource) {
    modelObserver = new MutationObserver(() => {
      syncOsModelChipText(textEl);
      syncOsModelChipDot(dotEl);
    });
    modelObserver.observe(modelSource, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['title'],
    });
  } else {
    modelPoll = window.setInterval(() => {
      syncOsModelChipText(textEl);
      syncOsModelChipDot(dotEl);
    }, 2000);
  }

  return () => {
    chip.removeEventListener('click', onChipClick);
    if (modelSelectListener) sel?.removeEventListener('change', modelSelectListener);
    modelObserver?.disconnect();
    if (modelPoll !== undefined) clearInterval(modelPoll);
    closeOsModelChipMenu();
    panelEl?.remove();
    panelEl = null;
    listEl = null;
    loadBtn = null;
    refreshBtn = null;
    anchorChip = null;
    chipDot = null;
    chipText = null;
  };
}
