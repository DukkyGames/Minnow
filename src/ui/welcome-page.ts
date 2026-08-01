/**
 * Workspace welcome screen — shown when the active workspace is still the app default.
 */

import '../styles/workspace-welcome-page.css';

import {
  createWorkspaceSubfolder,
  fetchWorkspace,
  removeRecentWorkspace,
  type WorkspaceRecentItem,
} from '../config/workspace-api';
import { isDefaultWorkspace } from '../state/workspace';
import { detectLocalServer, getLocalServerAvailable } from '../tools/client';
import { isOsShellEnabled } from '../os/page-bridge';
import { executeWorkspaceSwitch } from './workspace-switch-guard';
import { openWorkspaceFolderPicker } from './workspace-folder-picker';
import { setStatus } from './status';

/** Session-only parent for the create-project wizard (Change location). */
let wizardParentPath = '';

/** User chose "Continue in Minnow folder" — skip welcome until reload. */
let welcomeDismissedForSession = false;

let staticBindingsDone = false;
let createPanelOpen = false;

function getWelcomeRoot(): HTMLElement | null {
  return document.getElementById('welcomeView');
}

function getChatShell(): HTMLElement | null {
  return document.getElementById('appBody');
}

function getTopbar(): HTMLElement | null {
  return document.querySelector('header.topbar');
}

/** True for full-page routes that should not auto-open welcome on boot. */
export function isOtherFullPageHash(hash: string): boolean {
  return (
    hash.startsWith('#/settings') ||
    hash.startsWith('#/bugs') ||
    hash.startsWith('#/app/issues') ||
    hash.startsWith('#/benchmark') ||
    hash.startsWith('#/expert-lab') ||
    hash.startsWith('#/experts') ||
    hash.startsWith('#/app/') ||
    hash.startsWith('#/desktop')
  );
}

/** Whether the user dismissed welcome for this session. */
export function isWelcomeDismissedForSession(): boolean {
  return welcomeDismissedForSession;
}

/** Whether welcome should open after init when workspace sync completes. */
export function shouldShowWelcomeOnBoot(): boolean {
  if (isOsShellEnabled()) return false;
  const hash = window.location.hash;
  if (hash.startsWith('#/welcome')) {
    return isDefaultWorkspace();
  }
  if (isOtherFullPageHash(hash)) {
    return false;
  }
  if (welcomeDismissedForSession) {
    return false;
  }
  return isDefaultWorkspace() && (hash === '' || hash === '#/' || hash === '#');
}

/** Whether the welcome page is visible. */
export function isWelcomePageOpen(): boolean {
  return getWelcomeRoot()?.classList.contains('is-open') ?? false;
}

function setWelcomePending(pending: boolean): void {
  document.documentElement.classList.toggle('welcome-pending', pending);
}

/** Sync banner + disabled state for open/create controls (call after detectLocalServer). */
function syncServerAvailabilityUi(): void {
  const available = getLocalServerAvailable();
  const banner = document.getElementById('welcomeServerBanner');
  const openBtn = document.getElementById('btnWelcomeOpenProject') as HTMLButtonElement | null;
  const createBtn = document.getElementById('btnWelcomeCreateProject') as HTMLButtonElement | null;
  const submitBtn = document.getElementById('btnWelcomeCreateSubmit') as HTMLButtonElement | null;
  const changeParentBtn = document.getElementById(
    'btnWelcomeChangeParent',
  ) as HTMLButtonElement | null;

  if (banner) {
    banner.classList.toggle('hidden', available);
  }
  for (const btn of [openBtn, createBtn, submitBtn, changeParentBtn]) {
    if (btn) {
      btn.disabled = !available;
    }
  }
}

/** Refresh welcome server banner/buttons when tool-server ping result changes. */
export function onWelcomeServerAvailabilityChanged(): void {
  if (!isWelcomePageOpen()) {
    return;
  }
  syncServerAvailabilityUi();
}

function updateParentPathLabel(): void {
  const el = document.getElementById('welcomeParentPath');
  if (el) {
    el.textContent = wizardParentPath.trim() || '…';
    el.title = wizardParentPath;
  }
}

function showCreateError(message: string | null): void {
  const el = document.getElementById('welcomeCreateError');
  if (!el) {
    return;
  }
  if (!message) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden');
}

function showCreatePanel(show: boolean): void {
  createPanelOpen = show;
  const panel = document.getElementById('welcomeCreatePanel');
  const tiles = document.querySelector('.welcome-page__tiles');
  if (panel) {
    panel.classList.toggle('hidden', !show);
  }
  if (tiles instanceof HTMLElement) {
    tiles.classList.toggle('hidden', show);
  }
  if (show) {
    const input = document.getElementById('welcomeProjectName') as HTMLInputElement | null;
    showCreateError(null);
    if (input) {
      input.value = '';
      input.focus();
    }
  }
}

/** Validate a single-segment folder name (mirrors server/workspace/browse.js). */
export function validateProjectFolderName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return 'Enter a project name';
  }
  if (trimmed === '.' || trimmed === '..') {
    return 'Invalid project name';
  }
  if (/[\\/:*?"<>|]/.test(trimmed)) {
    return 'Name contains invalid characters';
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(trimmed)) {
    return 'Invalid project name';
  }
  return null;
}

async function loadWizardParentFromServer(): Promise<void> {
  const info = await fetchWorkspace();
  if (info?.newProjectParent?.trim()) {
    wizardParentPath = info.newProjectParent.trim();
  }
  updateParentPathLabel();
}

function createRecentRow(item: WorkspaceRecentItem): HTMLLIElement {
  const li = document.createElement('li');
  li.setAttribute('role', 'listitem');

  if (!item.exists) {
    const row = document.createElement('div');
    row.className = 'welcome-page__recents-row welcome-page__recents-row--missing';

    const label = document.createElement('span');
    label.className = 'welcome-page__recents-label';
    label.textContent = item.label;

    const pathLine = document.createElement('span');
    pathLine.className = 'welcome-page__recents-path';
    pathLine.textContent = item.path;
    pathLine.title = item.path;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'welcome-page__recents-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.setAttribute('aria-label', `Remove ${item.label} from recent workspaces`);
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void (async () => {
        try {
          await removeRecentWorkspace(item.path);
          await renderRecentsList();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setStatus('err', message);
        }
      })();
    });

    row.append(label, pathLine, removeBtn);
    li.appendChild(row);
    return li;
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'welcome-page__recents-row';
  btn.title = item.path;

  const label = document.createElement('span');
  label.className = 'welcome-page__recents-label';
  label.textContent = item.label;

  const pathLine = document.createElement('span');
  pathLine.className = 'welcome-page__recents-path';
  pathLine.textContent = item.path;

  btn.append(label, pathLine);
  btn.addEventListener('click', () => {
    void activateRecentWorkspace(item.path);
  });

  li.appendChild(btn);
  return li;
}

async function renderRecentsList(): Promise<void> {
  const list = document.getElementById('welcomeRecentsList');
  const empty = document.getElementById('welcomeRecentsEmpty');
  const countEl = document.getElementById('welcomeRecentsCount');
  if (!list) {
    return;
  }

  const info = await fetchWorkspace();
  const recent = info?.recent ?? [];
  const nonCurrent = recent.filter((r) => !r.isCurrent);

  list.innerHTML = '';
  for (const item of recent) {
    list.appendChild(createRecentRow(item));
  }

  if (empty) {
    empty.classList.toggle('hidden', recent.length > 0);
  }
  if (countEl) {
    const n = nonCurrent.length;
    if (n > 0) {
      countEl.textContent = `View all (${n})`;
      countEl.hidden = false;
    } else {
      countEl.textContent = '';
      countEl.hidden = true;
    }
  }
}

async function activateRecentWorkspace(absPath: string): Promise<void> {
  if (!getLocalServerAvailable()) {
    setStatus('err', 'Workspace requires Minnow running locally');
    return;
  }
  setStatus('spin', 'Switching workspace…');
  try {
    const info = await executeWorkspaceSwitch(absPath);
    if (!info) {
      setStatus('ok', 'Workspace unchanged');
      return;
    }
    closeWelcome();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus('err', message);
  }
}

async function onOpenProject(): Promise<void> {
  if (!getLocalServerAvailable()) {
    setStatus('err', 'Workspace requires Minnow running locally');
    return;
  }

  setStatus('spin', 'Choose workspace folder…');
  try {
    const result = await openWorkspaceFolderPicker();
    if (result.cancelled) {
      setStatus('ok', 'Workspace unchanged');
      return;
    }
    if (!result.path) {
      setStatus('err', 'No folder selected');
      return;
    }
    const info = await executeWorkspaceSwitch(result.path);
    if (!info) {
      setStatus('ok', 'Workspace unchanged');
      return;
    }
    closeWelcome();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus('err', message);
  }
}

async function onChangeWizardParent(): Promise<void> {
  if (!getLocalServerAvailable()) {
    return;
  }
  const result = await openWorkspaceFolderPicker({
    initialPath: wizardParentPath || undefined,
  });
  if (!result.cancelled && result.path) {
    wizardParentPath = result.path;
    updateParentPathLabel();
  }
}

async function onCreateProjectSubmit(): Promise<void> {
  if (!getLocalServerAvailable()) {
    setStatus('err', 'Workspace requires Minnow running locally');
    return;
  }

  const input = document.getElementById('welcomeProjectName') as HTMLInputElement | null;
  const name = input?.value ?? '';
  const validationError = validateProjectFolderName(name);
  if (validationError) {
    showCreateError(validationError);
    input?.focus();
    return;
  }

  const parent = wizardParentPath.trim();
  if (!parent) {
    showCreateError('Choose a parent folder first');
    return;
  }

  const submitBtn = document.getElementById('btnWelcomeCreateSubmit') as HTMLButtonElement | null;
  if (submitBtn) {
    submitBtn.disabled = true;
  }
  showCreateError(null);
  setStatus('spin', 'Creating project…');

  try {
    const created = await createWorkspaceSubfolder(parent, name.trim());
    const info = await executeWorkspaceSwitch(created.path);
    if (!info) {
      setStatus('ok', 'Workspace unchanged');
      return;
    }
    showCreatePanel(false);
    closeWelcome();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showCreateError(message);
    setStatus('err', message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = !getLocalServerAvailable();
    }
  }
}

function closePeerFullPageViews(): void {
  void import('./settings-page').then((m) => {
    if (document.getElementById('settingsView')?.classList.contains('is-open')) {
      m.closeSettings();
    }
  });
  void import('./benchmark-page').then((m) => {
    const benchmarkRoot = document.getElementById('benchmarkView');
    if (benchmarkRoot?.classList.contains('is-open')) {
      m.closeBenchmark();
    }
  });
  void import('./experts/experts-hub').then((m) => {
    if (m.isExpertsPageOpen()) {
      m.closeExpertLab();
    }
  });
}

/** Show welcome and hide the main chat shell. */
export function openWelcome(options?: { skipHash?: boolean }): void {
  if (!isDefaultWorkspace()) {
    closeWelcome({ skipHash: true });
    return;
  }

  const root = getWelcomeRoot();
  const shell = getChatShell();
  if (!root || !shell) {
    return;
  }

  closePeerFullPageViews();

  root.hidden = false;
  root.classList.add('is-open');
  // Hide sidebar/chat shell so welcome fills the Code app (not only the main column).
  shell.classList.add('hidden');
  const topbar = getTopbar();
  if (isOsShellEnabled()) {
    root.classList.add('welcome-page--os-overlay');
  } else {
    topbar?.classList.add('topbar--welcome');
  }
  setWelcomePending(false);

  // Re-probe in case welcome opened before initApp finished detectLocalServer (Minnow Code app).
  syncServerAvailabilityUi();
  void detectLocalServer().then(() => {
    syncServerAvailabilityUi();
    void loadWizardParentFromServer().then(() => renderRecentsList());
  });
  showCreatePanel(false);

  const nextHash = '#/welcome';
  if (!options?.skipHash && !isOsShellEnabled() && window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
}

/** Hide welcome and show the chat shell. */
export function closeWelcome(options?: { skipHash?: boolean }): void {
  const root = getWelcomeRoot();
  const shell = getChatShell();
  if (!root || !shell) {
    return;
  }

  root.classList.remove('is-open');
  root.hidden = true;
  root.classList.remove('welcome-page--os-overlay');
  shell.classList.remove('hidden');
  const topbar = getTopbar();
  topbar?.classList.remove('topbar--welcome');
  if (!isOsShellEnabled()) {
    topbar?.classList.remove('hidden');
  }
  setWelcomePending(false);
  showCreatePanel(false);

  if (!options?.skipHash && !isOsShellEnabled() && window.location.hash.startsWith('#/welcome')) {
    window.location.hash = '#/';
  }

  void import('./preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );
}

function onHashChange(): void {
  const hash = window.location.hash;

  if (hash.startsWith('#/welcome')) {
    if (!isDefaultWorkspace()) {
      closeWelcome({ skipHash: true });
      if (hash.startsWith('#/welcome')) {
        window.location.hash = '#/';
      }
      return;
    }
    openWelcome({ skipHash: true });
    return;
  }

  if (isWelcomePageOpen() && !isOtherFullPageHash(hash)) {
    closeWelcome({ skipHash: true });
    return;
  }

  const isHomeHash = hash === '' || hash === '#/' || hash === '#';
  if (
    isHomeHash &&
    isDefaultWorkspace() &&
    !welcomeDismissedForSession &&
    !isWelcomePageOpen()
  ) {
    openWelcome({ skipHash: true });
  }
}

function bindStaticControls(): void {
  if (staticBindingsDone) {
    return;
  }
  staticBindingsDone = true;

  document
    .getElementById('btnWelcomeOpenProject')
    ?.addEventListener('click', () => void onOpenProject());

  document.getElementById('btnWelcomeCreateProject')?.addEventListener('click', () => {
    void loadWizardParentFromServer().then(() => showCreatePanel(true));
  });

  document.getElementById('btnWelcomeCreateCancel')?.addEventListener('click', () => {
    showCreatePanel(false);
  });

  document
    .getElementById('btnWelcomeCreateSubmit')
    ?.addEventListener('click', () => void onCreateProjectSubmit());

  document
    .getElementById('btnWelcomeChangeParent')
    ?.addEventListener('click', () => void onChangeWizardParent());

  document.getElementById('btnWelcomeContinueMinnow')?.addEventListener('click', () => {
    welcomeDismissedForSession = true;
    closeWelcome();
    setStatus('ok', 'Working in Minnow folder');
  });

  const projectInput = document.getElementById('welcomeProjectName');
  projectInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && createPanelOpen) {
      e.preventDefault();
      void onCreateProjectSubmit();
    }
  });
}

/** Wire welcome UI, hash routing, and boot gate helpers. */
export function initWelcomePage(): void {
  bindStaticControls();
  window.addEventListener('hashchange', onHashChange);

  if (window.location.hash.startsWith('#/welcome')) {
    if (isDefaultWorkspace()) {
      openWelcome({ skipHash: true });
    } else {
      closeWelcome({ skipHash: true });
      window.location.hash = '#/';
    }
  }
}

/** Call before workspace sync on boot to avoid flashing the chat shell. */
export function markWelcomePendingIfNeeded(): void {
  const hash = window.location.hash;
  if (isOtherFullPageHash(hash)) {
    return;
  }
  if (hash === '' || hash === '#/' || hash === '#' || hash.startsWith('#/welcome')) {
    setWelcomePending(true);
  }
}

/** Test helper — reset session dismiss and wizard parent. */
export function resetWelcomeStateForTests(): void {
  welcomeDismissedForSession = false;
  wizardParentPath = '';
  createPanelOpen = false;
}
