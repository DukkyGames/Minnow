/**
 * In-app workspace folder browser (replaces native OS picker for "Open new workspace…").
 */

import {
  browseWorkspaceFolders,
  createWorkspaceSubfolder,
  type WorkspaceBrowseEntry,
} from '../config/workspace-api';

export interface WorkspaceFolderPickerResult {
  cancelled: boolean;
  path: string | null;
}

const OVERLAY_ID = 'workspaceFolderPickerOverlay';
const DIALOG_ID = 'workspaceFolderPicker';

let overlayEl: HTMLDivElement | null = null;
let dialogEl: HTMLDivElement | null = null;
let pathEl: HTMLElement | null = null;
let listEl: HTMLUListElement | null = null;
let upBtn: HTMLButtonElement | null = null;
let newFolderBtn: HTMLButtonElement | null = null;
let newFolderPanel: HTMLDivElement | null = null;
let newFolderInput: HTMLInputElement | null = null;
let newFolderCreateBtn: HTMLButtonElement | null = null;
let newFolderCancelBtn: HTMLButtonElement | null = null;
let errorEl: HTMLElement | null = null;
let openBtn: HTMLButtonElement | null = null;
let cancelBtn: HTMLButtonElement | null = null;
let emptyEl: HTMLElement | null = null;
let creatingFolder = false;

let currentPath = '';
let currentParent: string | null = null;
let selectedEntryPath: string | null = null;
let resolvePicker: ((result: WorkspaceFolderPickerResult) => void) | null = null;
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;
let previousFocus: HTMLElement | null = null;

/** Delay single-click selection so double-click can drill down first. */
const PICKER_CLICK_DELAY_MS = 220;

function folderDisplayName(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  if (last) {
    return last;
  }
  if (/^[A-Za-z]:$/.test(normalized)) {
    return `${normalized.toUpperCase()}\\`;
  }
  return absPath || 'Folder';
}

function clearRowSelection(): void {
  if (!listEl) {
    return;
  }
  for (const row of listEl.querySelectorAll('.workspace-picker__row')) {
    row.setAttribute('aria-selected', 'false');
  }
}

function selectRow(path: string, btn: HTMLButtonElement): void {
  selectedEntryPath = path;
  clearRowSelection();
  btn.setAttribute('aria-selected', 'true');
  updateToolbar();
}

/** Single click selects; double click drills without firing a late select. */
function wireRowActivation(
  btn: HTMLButtonElement,
  path: string,
  onDrill?: () => void,
): void {
  let clickTimer: ReturnType<typeof setTimeout> | null = null;

  btn.addEventListener('dblclick', (event) => {
    event.preventDefault();
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    if (onDrill) {
      onDrill();
    }
  });

  btn.addEventListener('click', () => {
    if (clickTimer) {
      clearTimeout(clickTimer);
    }
    clickTimer = setTimeout(() => {
      clickTimer = null;
      selectRow(path, btn);
    }, PICKER_CLICK_DELAY_MS);
  });
}

function createFolderIcon(): HTMLSpanElement {
  const icon = document.createElement('span');
  icon.className = 'workspace-picker__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '📁';
  return icon;
}

function createCurrentFolderRow(): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'workspace-picker__item workspace-picker__item--current';
  li.setAttribute('role', 'presentation');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'workspace-picker__row workspace-picker__row--current';
  btn.setAttribute('role', 'option');
  btn.title = currentPath;

  const icon = createFolderIcon();
  icon.classList.add('workspace-picker__icon--open');

  const labelWrap = document.createElement('span');
  labelWrap.className = 'workspace-picker__label-wrap';

  const name = document.createElement('span');
  name.className = 'workspace-picker__name';
  name.textContent = folderDisplayName(currentPath);

  const meta = document.createElement('span');
  meta.className = 'workspace-picker__meta';
  meta.textContent = 'This folder';

  labelWrap.appendChild(name);
  labelWrap.appendChild(meta);
  btn.appendChild(icon);
  btn.appendChild(labelWrap);
  wireRowActivation(btn, currentPath);
  li.appendChild(btn);
  return li;
}

function createChildFolderRow(entry: WorkspaceBrowseEntry): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'workspace-picker__item workspace-picker__item--child';
  li.style.setProperty('--picker-depth', '1');
  li.setAttribute('role', 'presentation');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'workspace-picker__row workspace-picker__row--child';
  btn.setAttribute('role', 'option');
  btn.title = entry.path;

  const icon = createFolderIcon();
  const name = document.createElement('span');
  name.className = 'workspace-picker__name';
  name.textContent = entry.name;

  const chevron = document.createElement('span');
  chevron.className = 'workspace-picker__chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '›';

  btn.appendChild(icon);
  btn.appendChild(name);
  btn.appendChild(chevron);
  wireRowActivation(btn, entry.path, () => {
    void loadListing(entry.path);
  });
  li.appendChild(btn);
  return li;
}

function createQuickLocationRow(entry: WorkspaceBrowseEntry): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'workspace-picker__item workspace-picker__item--location';
  li.setAttribute('role', 'presentation');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'workspace-picker__row workspace-picker__row--location';
  btn.setAttribute('role', 'option');
  btn.title = entry.path;

  const icon = createFolderIcon();
  const name = document.createElement('span');
  name.className = 'workspace-picker__name';
  name.textContent = entry.name;

  const chevron = document.createElement('span');
  chevron.className = 'workspace-picker__chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '›';

  btn.appendChild(icon);
  btn.appendChild(name);
  btn.appendChild(chevron);
  wireRowActivation(btn, entry.path, () => {
    void loadListing(entry.path);
  });
  li.appendChild(btn);
  return li;
}

function ensureShell(): void {
  if (overlayEl && dialogEl) {
    return;
  }

  const existing = document.getElementById(OVERLAY_ID);
  if (existing instanceof HTMLDivElement) {
    overlayEl = existing;
    dialogEl = existing.querySelector(`#${DIALOG_ID}`) as HTMLDivElement | null;
    pathEl = existing.querySelector('[data-ws-picker-path]');
    listEl = existing.querySelector('[data-ws-picker-list]');
    upBtn = existing.querySelector('[data-ws-picker-up]');
    newFolderBtn = existing.querySelector('[data-ws-picker-new-folder]');
    newFolderPanel = existing.querySelector('[data-ws-picker-new-folder-panel]');
    newFolderInput = existing.querySelector('[data-ws-picker-new-folder-input]');
    newFolderCreateBtn = existing.querySelector('[data-ws-picker-new-folder-create]');
    newFolderCancelBtn = existing.querySelector('[data-ws-picker-new-folder-cancel]');
    errorEl = existing.querySelector('[data-ws-picker-error]');
    openBtn = existing.querySelector('[data-ws-picker-open]');
    cancelBtn = existing.querySelector('[data-ws-picker-cancel]');
    emptyEl = existing.querySelector('[data-ws-picker-empty]');
    return;
  }

  overlayEl = document.createElement('div');
  overlayEl.id = OVERLAY_ID;
  overlayEl.className = 'workspace-picker-overlay hidden';
  overlayEl.hidden = true;
  overlayEl.innerHTML = `
    <div
      id="${DIALOG_ID}"
      class="workspace-picker"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspaceFolderPickerTitle"
      tabindex="-1"
    >
      <div class="workspace-picker__header">
        <h2 id="workspaceFolderPickerTitle" class="workspace-picker__title">Choose workspace folder</h2>
      </div>
      <p class="workspace-picker__path" data-ws-picker-path></p>
      <div class="workspace-picker__toolbar">
        <button type="button" class="workspace-picker__up" data-ws-picker-up>Up</button>
        <button type="button" class="workspace-picker__new-folder" data-ws-picker-new-folder>
          New folder
        </button>
      </div>
      <div class="workspace-picker__new-folder-panel hidden" data-ws-picker-new-folder-panel hidden>
        <label class="workspace-picker__new-folder-label" for="workspacePickerNewFolderInput">
          Folder name
        </label>
        <div class="workspace-picker__new-folder-row">
          <input
            id="workspacePickerNewFolderInput"
            type="text"
            class="workspace-picker__new-folder-input"
            data-ws-picker-new-folder-input
            autocomplete="off"
            spellcheck="false"
            maxlength="255"
          />
          <button
            type="button"
            class="workspace-picker__btn workspace-picker__btn--primary workspace-picker__new-folder-create"
            data-ws-picker-new-folder-create
          >
            Create
          </button>
          <button
            type="button"
            class="workspace-picker__btn"
            data-ws-picker-new-folder-cancel
          >
            Cancel
          </button>
        </div>
      </div>
      <p class="workspace-picker__error hidden" data-ws-picker-error role="alert" hidden></p>
      <ul class="workspace-picker__list" data-ws-picker-list role="listbox" aria-label="Folders"></ul>
      <p class="workspace-picker__empty hidden" data-ws-picker-empty hidden>No subfolders</p>
      <div class="workspace-picker__footer">
        <button type="button" class="workspace-picker__btn" data-ws-picker-cancel>Cancel</button>
        <button type="button" class="workspace-picker__btn workspace-picker__btn--primary" data-ws-picker-open>
          Open folder
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlayEl);
  dialogEl = overlayEl.querySelector(`#${DIALOG_ID}`) as HTMLDivElement;
  pathEl = overlayEl.querySelector('[data-ws-picker-path]');
  listEl = overlayEl.querySelector('[data-ws-picker-list]');
  upBtn = overlayEl.querySelector('[data-ws-picker-up]');
  newFolderBtn = overlayEl.querySelector('[data-ws-picker-new-folder]');
  newFolderPanel = overlayEl.querySelector('[data-ws-picker-new-folder-panel]');
  newFolderInput = overlayEl.querySelector('[data-ws-picker-new-folder-input]');
  newFolderCreateBtn = overlayEl.querySelector('[data-ws-picker-new-folder-create]');
  newFolderCancelBtn = overlayEl.querySelector('[data-ws-picker-new-folder-cancel]');
  errorEl = overlayEl.querySelector('[data-ws-picker-error]');
  openBtn = overlayEl.querySelector('[data-ws-picker-open]');
  cancelBtn = overlayEl.querySelector('[data-ws-picker-cancel]');
  emptyEl = overlayEl.querySelector('[data-ws-picker-empty]');

  overlayEl.addEventListener('click', (event) => {
    if (event.target === overlayEl) {
      finishPicker({ cancelled: true, path: null });
    }
  });

  cancelBtn?.addEventListener('click', () => {
    finishPicker({ cancelled: true, path: null });
  });

  openBtn?.addEventListener('click', () => {
    const chosen = selectedEntryPath ?? (currentPath.trim() || null);
    if (!chosen) {
      return;
    }
    finishPicker({ cancelled: false, path: chosen });
  });

  upBtn?.addEventListener('click', () => {
    hideNewFolderPanel();
    if (!currentParent) {
      void loadListing('');
      return;
    }
    void loadListing(currentParent);
  });

  newFolderBtn?.addEventListener('click', () => {
    showNewFolderPanel();
  });

  newFolderCancelBtn?.addEventListener('click', () => {
    hideNewFolderPanel();
  });

  newFolderCreateBtn?.addEventListener('click', () => {
    void submitNewFolder();
  });

  newFolderInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitNewFolder();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      hideNewFolderPanel();
    }
  });
}

function clearPickerError(): void {
  if (!errorEl) {
    return;
  }
  errorEl.textContent = '';
  errorEl.hidden = true;
  errorEl.classList.add('hidden');
}

function showPickerError(message: string): void {
  if (!errorEl) {
    return;
  }
  errorEl.textContent = message;
  errorEl.hidden = false;
  errorEl.classList.remove('hidden');
}

function showNewFolderPanel(): void {
  if (!newFolderPanel || !newFolderInput || !currentPath.trim()) {
    return;
  }
  clearPickerError();
  newFolderPanel.hidden = false;
  newFolderPanel.classList.remove('hidden');
  newFolderInput.value = 'New folder';
  newFolderInput.focus();
  newFolderInput.select();
}

function hideNewFolderPanel(): void {
  if (!newFolderPanel || !newFolderInput) {
    return;
  }
  newFolderPanel.hidden = true;
  newFolderPanel.classList.add('hidden');
  newFolderInput.value = '';
  clearPickerError();
}

async function submitNewFolder(): Promise<void> {
  if (creatingFolder || !newFolderInput || !currentPath.trim()) {
    return;
  }
  const name = newFolderInput.value.trim();
  if (!name) {
    showPickerError('Enter a folder name');
    newFolderInput.focus();
    return;
  }

  creatingFolder = true;
  if (newFolderCreateBtn) {
    newFolderCreateBtn.disabled = true;
  }
  clearPickerError();

  try {
    const created = await createWorkspaceSubfolder(currentPath, name);
    hideNewFolderPanel();
    await loadListing(currentPath);
    selectedEntryPath = created.path;
    if (listEl) {
      clearRowSelection();
      for (const row of listEl.querySelectorAll('.workspace-picker__row')) {
        if (row instanceof HTMLButtonElement && row.title === created.path) {
          row.setAttribute('aria-selected', 'true');
          break;
        }
      }
    }
    updateToolbar();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showPickerError(message);
    newFolderInput.focus();
  } finally {
    creatingFolder = false;
    if (newFolderCreateBtn) {
      newFolderCreateBtn.disabled = false;
    }
  }
}

function updatePathLabel(): void {
  if (!pathEl) {
    return;
  }
  if (!currentPath.trim()) {
    pathEl.textContent = 'Quick locations';
    pathEl.classList.add('workspace-picker__path--roots');
    return;
  }
  pathEl.textContent = currentPath;
  pathEl.classList.remove('workspace-picker__path--roots');
}

function updateToolbar(): void {
  if (!upBtn || !openBtn) {
    return;
  }
  const atRoots = !currentPath.trim();
  upBtn.disabled = atRoots && currentParent === null;
  if (newFolderBtn) {
    newFolderBtn.disabled = atRoots || creatingFolder;
  }
  const canOpen = Boolean(currentPath.trim() || selectedEntryPath);
  openBtn.disabled = !canOpen;
}

function renderEntries(entries: WorkspaceBrowseEntry[]): void {
  if (!listEl || !emptyEl) {
    return;
  }
  listEl.innerHTML = '';
  selectedEntryPath = null;

  const inDirectory = Boolean(currentPath.trim());
  const hasCurrent = inDirectory;
  const hasChildren = entries.length > 0;

  if (hasCurrent) {
    const currentRow = createCurrentFolderRow();
    listEl.appendChild(currentRow);
    selectedEntryPath = currentPath;
    const currentBtn = currentRow.querySelector('.workspace-picker__row');
    if (currentBtn instanceof HTMLButtonElement) {
      currentBtn.setAttribute('aria-selected', 'true');
    }
  }

  if (hasChildren) {
    if (hasCurrent) {
      const section = document.createElement('li');
      section.className = 'workspace-picker__section';
      section.setAttribute('role', 'presentation');
      section.textContent = 'Folders';
      listEl.appendChild(section);
    }

    for (const entry of entries) {
      listEl.appendChild(
        inDirectory ? createChildFolderRow(entry) : createQuickLocationRow(entry),
      );
    }
  }

  if (!hasCurrent && !hasChildren) {
    emptyEl.textContent = 'No locations available';
    emptyEl.hidden = false;
    emptyEl.classList.remove('hidden');
    updateToolbar();
    return;
  }

  if (hasCurrent && !hasChildren) {
    emptyEl.textContent = 'No subfolders in this directory';
    emptyEl.hidden = false;
    emptyEl.classList.remove('hidden');
  } else {
    emptyEl.hidden = true;
    emptyEl.classList.add('hidden');
  }

  updateToolbar();
}

async function loadListing(browsePath: string): Promise<void> {
  hideNewFolderPanel();
  const listing = await browseWorkspaceFolders(browsePath);
  currentPath = listing.path ?? '';
  currentParent = listing.parent ?? null;
  selectedEntryPath = null;
  updatePathLabel();
  renderEntries(listing.entries ?? []);
}

function detachEscape(): void {
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler, true);
    escapeHandler = null;
  }
}

function showOverlay(): void {
  if (!overlayEl || !dialogEl) {
    return;
  }
  overlayEl.hidden = false;
  overlayEl.classList.remove('hidden');
  dialogEl.focus();
}

function hideOverlay(): void {
  if (!overlayEl) {
    return;
  }
  overlayEl.hidden = true;
  overlayEl.classList.add('hidden');
}

function finishPicker(result: WorkspaceFolderPickerResult): void {
  detachEscape();
  hideNewFolderPanel();
  hideOverlay();
  const resolve = resolvePicker;
  resolvePicker = null;
  previousFocus?.focus();
  previousFocus = null;
  resolve?.(result);
}

/**
 * Open the in-app folder browser. Resolves when the user picks a folder or cancels.
 */
export function openWorkspaceFolderPicker(options?: {
  initialPath?: string;
}): Promise<WorkspaceFolderPickerResult> {
  ensureShell();
  if (resolvePicker) {
    return Promise.resolve({ cancelled: true, path: null });
  }

  previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  return new Promise((resolve) => {
    resolvePicker = resolve;
    const startPath = options?.initialPath?.trim() ?? '';
    void loadListing(startPath)
      .catch(() => loadListing(''))
      .then(() => {
        showOverlay();
      });

    escapeHandler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      finishPicker({ cancelled: true, path: null });
    };
    document.addEventListener('keydown', escapeHandler, true);
  });
}

/** Test helper — reset module singletons. */
export function resetWorkspaceFolderPickerForTests(): void {
  finishPicker({ cancelled: true, path: null });
  overlayEl = null;
  dialogEl = null;
}
