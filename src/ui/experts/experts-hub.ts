/**
 * Experts hub — gallery, per-expert chats, create/edit, summon into chat shell.
 */

import '../../styles/experts-hub.css';
import '../../styles/experts-summon.css';

import { createExpertFromDescription } from '../../chat/experts/create-expert';
import { generateExpertGreeting } from '../../chat/experts/greet';
import { isUserOwnedExpert } from '../../chat/experts/expert-ownership';
import {
  deleteUserExpert,
  loadUserExpertForEdit,
  saveUserExpert,
} from '../../chat/experts/expert-user-ops';
import {
  getBuiltinExpertIds,
  getExpert,
  listExperts,
  syncExpertRegistryFromServer,
} from '../../chat/experts/registry';
import type { ExpertAccent, ExpertMeta } from '../../chat/experts/types';
import { EXPERT_ACCENT_VALUES } from '../../chat/experts/types';
import { isExpertsPageOpen, setExpertsPageOpen } from '../../app-state';
import { loadExpertsConfig } from '../../config/experts-config';
import {
  activateChatById,
  createExpertChat,
  getExpertChats,
  recordChatMessage,
  scheduleSaveSessions,
  sessionState,
} from '../../state/sessions';
import { closeBenchmark } from '../benchmark-page';
import { closeGlobalBugs } from '../global-bugs-page';
import { closeSettings } from '../settings-page';
import {
  isExpertScopeActive,
  openExpertChatInShell,
  teardownExpertScopeShell,
} from './experts-scope';
import { appendChatRow } from '../sidebar';
import { isOsAppHash, isOsShellEnabled } from '../../os/page-bridge';
import { navigateToDesktop } from '../../os/router';

export { openExpertChatInShell } from './experts-scope';

export type ExpertsHubStep = 'gallery' | 'chats' | 'create' | 'edit';

let currentStep: ExpertsHubStep = 'gallery';
let selectedExpertId: string | null = null;
let savedActiveChatId: string | null = null;
let createInFlight = false;
let editExpertId: string | null = null;
let editFullBody = '';
let editLiteBody = '';
let editLiteEdited = false;
let editDirty = false;
let editProfile: 'full' | 'lite' = 'full';
let summonAbort: AbortController | null = null;

function getRoot(): HTMLElement | null {
  return document.getElementById('expertsView');
}

function getChatShell(): HTMLElement | null {
  return document.getElementById('appBody');
}

function expertIcon(meta: ExpertMeta): string {
  const icon = meta.icon?.trim();
  return icon || meta.label.charAt(0).toUpperCase();
}

function expertAccent(meta: ExpertMeta): ExpertAccent {
  return meta.accent ?? 'sage';
}

function accentClassName(accent: ExpertAccent): string {
  return `expert-accent-${accent}`;
}

function applyAccentToElement(el: HTMLElement, accent: ExpertAccent): void {
  el.classList.remove(
    'expert-accent-sage',
    'expert-accent-amber',
    'expert-accent-cyan',
    'expert-accent-coral',
    'expert-accent-violet',
    'expert-accent-rose',
  );
  el.classList.add(accentClassName(accent));
}

function setStep(step: ExpertsHubStep): void {
  currentStep = step;
  const root = getRoot();
  if (root) root.dataset.step = step;
}

function setFormError(elementId: string, message: string | null): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (!message) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden');
}

function renderMakeExpertTile(grid: HTMLElement): void {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'experts-tile experts-tile--make expert-accent-violet';
  tile.setAttribute('aria-label', 'Make your own expert');

  const iconEl = document.createElement('span');
  iconEl.className = 'experts-tile-icon';
  iconEl.textContent = '+';
  iconEl.setAttribute('aria-hidden', 'true');

  const copy = document.createElement('div');
  copy.className = 'experts-tile-copy';

  const label = document.createElement('span');
  label.className = 'experts-tile-label';
  label.textContent = 'Make your own expert';

  const desc = document.createElement('p');
  desc.className = 'experts-tile-desc';
  desc.textContent = 'Describe a specialist and Minnow will draft a custom expert for you.';

  copy.appendChild(label);
  copy.appendChild(desc);
  tile.appendChild(iconEl);
  tile.appendChild(copy);
  tile.addEventListener('click', () => openCreateExpertStep());
  grid.appendChild(tile);
}

function closeTileMenus(): void {
  document.querySelectorAll('.experts-tile-menu').forEach((menu) => {
    menu.classList.remove('is-open');
  });
}

function renderExpertTileMenu(tile: HTMLElement, expertId: string, label: string): void {
  const menuWrap = document.createElement('div');
  menuWrap.className = 'experts-tile-menu-wrap';

  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'experts-tile-menu-btn';
  menuBtn.setAttribute('aria-label', `Actions for ${label}`);
  menuBtn.textContent = '⋯';

  const menu = document.createElement('div');
  menu.className = 'experts-tile-menu';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTileMenus();
    void openEditExpertStep(expertId);
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTileMenus();
    void deleteExpertFromHub(expertId, label);
  });

  menu.appendChild(editBtn);
  menu.appendChild(deleteBtn);
  menuWrap.appendChild(menuBtn);
  menuWrap.appendChild(menu);

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = menu.classList.contains('is-open');
    closeTileMenus();
    if (!wasOpen) menu.classList.add('is-open');
  });

  tile.appendChild(menuWrap);
}

/** Gallery grid with per-expert chat count badges. */
export function renderGallery(): void {
  const grid = document.getElementById('expertsGrid');
  if (!grid) return;
  grid.replaceChildren();

  renderMakeExpertTile(grid);

  const builtinIds = getBuiltinExpertIds();
  for (const expert of listExperts()) {
    const accent = expertAccent(expert.meta);
    const chatCount = getExpertChats(expert.meta.id).length;
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `experts-tile ${accentClassName(accent)}`;
    tile.dataset.expertId = expert.meta.id;

    const iconEl = document.createElement('span');
    iconEl.className = 'experts-tile-icon';
    iconEl.textContent = expertIcon(expert.meta);
    iconEl.setAttribute('aria-hidden', 'true');

    const copy = document.createElement('div');
    copy.className = 'experts-tile-copy';

    const label = document.createElement('span');
    label.className = 'experts-tile-label';
    label.textContent = expert.meta.label;

    const desc = document.createElement('p');
    desc.className = 'experts-tile-desc';
    desc.textContent = expert.meta.description ?? '';

    copy.appendChild(label);
    copy.appendChild(desc);
    tile.appendChild(iconEl);
    tile.appendChild(copy);

    if (chatCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'experts-tile-badge';
      badge.textContent = String(chatCount);
      badge.setAttribute('aria-label', `${chatCount} chat${chatCount === 1 ? '' : 's'}`);
      tile.appendChild(badge);
    }

    if (isUserOwnedExpert(expert, builtinIds)) {
      renderExpertTileMenu(tile, expert.meta.id, expert.meta.label);
    }

    tile.addEventListener('click', () => openExpertDetail(expert.meta.id));
    grid.appendChild(tile);
  }
}

export function openExpertDetail(expertId: string): void {
  selectedExpertId = expertId;
  const expert = getExpert(expertId);
  if (!expert) return;

  const chip = document.getElementById('expertsDetailChip');
  if (chip) {
    chip.replaceChildren();
    applyAccentToElement(chip, expertAccent(expert.meta));
    const icon = document.createElement('span');
    icon.className = 'experts-chip-icon';
    icon.textContent = expertIcon(expert.meta);
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = expert.meta.label;
    chip.appendChild(icon);
    chip.appendChild(label);
  }

  renderExpertChatList(expertId);
  setStep('chats');
}

export function renderExpertChatList(expertId: string): void {
  const list = document.getElementById('expertsChatList');
  if (!list) return;
  list.replaceChildren();

  const chats = getExpertChats(expertId);
  if (chats.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'experts-chat-empty';
    empty.textContent = 'No chats yet. Start one below.';
    list.appendChild(empty);
    return;
  }

  for (const chat of chats) {
    appendChatRow(list, chat, null, {
      draggable: false,
      onActivate: (c) => {
        selectedExpertId = expertId;
        void openExpertChatInShell(c);
      },
    });
  }
}

function showExpertsSummon(expertId: string): void {
  const overlay = document.getElementById('expertsSummon');
  const expert = getExpert(expertId);
  if (!overlay || !expert) return;

  const iconEl = document.getElementById('expertsSummonIcon');
  const labelEl = document.getElementById('expertsSummonLabel');
  if (iconEl) {
    iconEl.textContent = expertIcon(expert.meta);
    applyAccentToElement(iconEl, expertAccent(expert.meta));
  }
  if (labelEl) labelEl.textContent = expert.meta.label;

  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => overlay.classList.add('is-visible'));
}

function hideExpertsSummon(): void {
  const overlay = document.getElementById('expertsSummon');
  if (!overlay) return;
  overlay.classList.remove('is-visible');
  overlay.setAttribute('aria-hidden', 'true');
  window.setTimeout(() => {
    overlay.classList.add('hidden');
  }, 280);
}

/** Create expert chat, seed greeting, open scoped chat shell. */
export async function startExpertChat(expertId: string): Promise<void> {
  summonAbort?.abort();
  summonAbort = new AbortController();
  const signal = summonAbort.signal;

  showExpertsSummon(expertId);
  const chat = createExpertChat(expertId);
  activateChatById(chat.id);

  try {
    const greeting = await generateExpertGreeting(expertId, chat, signal);
    if (signal.aborted) return;
    chat.history.push({ role: 'assistant', content: greeting });
    recordChatMessage(chat);
    scheduleSaveSessions();
    hideExpertsSummon();
    await openExpertChatInShell(chat);
  } catch (err) {
    if (signal.aborted) return;
    hideExpertsSummon();
    const message = err instanceof Error ? err.message : String(err);
    alert(message || 'Could not start expert chat.');
  }
}

/** Leave expert-scoped shell and return to the hub (expert chat list or gallery). */
export function returnToExpertsHub(): void {
  const expertId = selectedExpertId;
  teardownExpertScopeShell();
  if (expertId) {
    openExperts({ step: 'chats', expertId });
  } else {
    openExperts();
  }
}

function openCreateExpertStep(): void {
  setFormError('expertsCreateError', null);
  const input = document.getElementById('expertsCreateInput') as HTMLTextAreaElement | null;
  if (input) {
    input.value = '';
    input.disabled = false;
  }
  setStep('create');
  input?.focus();
}

async function submitCreateExpert(): Promise<void> {
  if (createInFlight) return;
  const input = document.getElementById('expertsCreateInput') as HTMLTextAreaElement | null;
  const description = input?.value.trim() ?? '';
  if (!description) {
    setFormError('expertsCreateError', 'Describe the expert you want to create.');
    return;
  }

  createInFlight = true;
  setFormError('expertsCreateError', null);
  const createBtn = document.getElementById('btnExpertsCreate');
  if (createBtn instanceof HTMLButtonElement) createBtn.disabled = true;
  if (input) input.disabled = true;

  try {
    const result = await createExpertFromDescription({ description });
    renderGallery();
    openExpertDetail(result.expertId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setFormError('expertsCreateError', message);
  } finally {
    createInFlight = false;
    if (createBtn instanceof HTMLButtonElement) createBtn.disabled = false;
    if (input) input.disabled = false;
  }
}

function syncEditBodyField(): void {
  const bodyInput = document.getElementById('expertsEditBody') as HTMLTextAreaElement | null;
  if (!bodyInput) return;
  bodyInput.value = editProfile === 'full' ? editFullBody : editLiteBody;
}

function markEditDirty(): void {
  editDirty = true;
}

async function openEditExpertStep(expertId: string): Promise<void> {
  const loaded = await loadUserExpertForEdit(expertId);
  if (!loaded) {
    setFormError('expertsEditError', 'Could not load this expert.');
    return;
  }

  editExpertId = expertId;
  editFullBody = loaded.fullBody;
  editLiteBody = loaded.liteBody;
  editLiteEdited = false;
  editDirty = false;
  editProfile = 'full';

  const labelInput = document.getElementById('expertsEditLabel') as HTMLInputElement | null;
  const descInput = document.getElementById('expertsEditDescription') as HTMLInputElement | null;
  const iconInput = document.getElementById('expertsEditIcon') as HTMLInputElement | null;
  const accentSelect = document.getElementById('expertsEditAccent') as HTMLSelectElement | null;

  const taglineInput = document.getElementById('expertsEditTagline') as HTMLInputElement | null;
  const greetingInput = document.getElementById('expertsEditGreeting') as HTMLInputElement | null;

  if (labelInput) labelInput.value = loaded.meta.label;
  if (descInput) descInput.value = loaded.meta.description ?? '';
  if (iconInput) iconInput.value = loaded.meta.icon ?? '';
  if (taglineInput) taglineInput.value = loaded.meta.tagline ?? '';
  if (greetingInput) greetingInput.value = loaded.meta.greeting ?? '';
  if (accentSelect) {
    accentSelect.replaceChildren();
    for (const accent of EXPERT_ACCENT_VALUES) {
      const opt = document.createElement('option');
      opt.value = accent;
      opt.textContent = accent.charAt(0).toUpperCase() + accent.slice(1);
      if (accent === (loaded.meta.accent ?? 'sage')) opt.selected = true;
      accentSelect.appendChild(opt);
    }
  }

  document.querySelectorAll('.experts-profile-tab').forEach((tab) => {
    const el = tab as HTMLElement;
    const isFull = el.dataset.profile === 'full';
    el.classList.toggle('is-active', isFull);
    el.setAttribute('aria-selected', isFull ? 'true' : 'false');
  });

  setFormError('expertsEditError', null);
  syncEditBodyField();
  setStep('edit');
  labelInput?.focus();
}

async function submitEditExpert(event?: Event): Promise<void> {
  event?.preventDefault();
  if (!editExpertId) return;

  const labelInput = document.getElementById('expertsEditLabel') as HTMLInputElement | null;
  const descInput = document.getElementById('expertsEditDescription') as HTMLInputElement | null;
  const iconInput = document.getElementById('expertsEditIcon') as HTMLInputElement | null;
  const accentSelect = document.getElementById('expertsEditAccent') as HTMLSelectElement | null;
  const taglineInput = document.getElementById('expertsEditTagline') as HTMLInputElement | null;
  const greetingInput = document.getElementById('expertsEditGreeting') as HTMLInputElement | null;
  const bodyInput = document.getElementById('expertsEditBody') as HTMLTextAreaElement | null;

  if (editProfile === 'full') {
    editFullBody = bodyInput?.value ?? editFullBody;
  } else {
    editLiteBody = bodyInput?.value ?? editLiteBody;
  }

  const saveBtn = document.getElementById('btnExpertsEditSave');
  if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = true;
  setFormError('expertsEditError', null);

  try {
    await saveUserExpert({
      id: editExpertId,
      label: labelInput?.value.trim() || editExpertId,
      description: descInput?.value.trim(),
      icon: iconInput?.value.trim(),
      accent: (accentSelect?.value as ExpertAccent) || 'sage',
      tagline: taglineInput?.value.trim(),
      greeting: greetingInput?.value.trim(),
      fullBody: editFullBody,
      liteBody: editLiteBody,
      liteEdited: editLiteEdited,
    });
    editExpertId = null;
    editDirty = false;
    renderGallery();
    setStep('gallery');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setFormError('expertsEditError', message);
  } finally {
    if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = false;
  }
}

function cancelEditExpert(): void {
  if (editDirty && !confirm('Discard unsaved changes?')) return;
  editExpertId = null;
  editDirty = false;
  setFormError('expertsEditError', null);
  setStep('gallery');
}

async function deleteExpertFromHub(expertId: string, label: string): Promise<void> {
  if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
  try {
    await deleteUserExpert(expertId);
    if (selectedExpertId === expertId) selectedExpertId = null;
    renderGallery();
    setStep('gallery');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    alert(message);
  }
}

export async function refreshExpertsEnabledState(): Promise<void> {
  const { refreshExpertsEnabledState: refresh } = await import('../experts-settings');
  await refresh();
}

export { isExpertsPageOpen };

export function closeExpertsHub(options?: { skipNavigate?: boolean }): void {
  const root = getRoot();
  const shell = getChatShell();
  if (!root || !shell) return;

  summonAbort?.abort();
  summonAbort = null;
  hideExpertsSummon();

  setExpertsPageOpen(false);
  root.classList.remove('is-open');
  if (!isOsShellEnabled()) {
    shell.classList.remove('hidden');
    document.querySelector('header.topbar')?.classList.remove('hidden');
    if (!options?.skipNavigate && window.location.hash.startsWith('#/experts')) {
      window.location.hash = '#/';
    }
  } else if (!options?.skipNavigate) {
    navigateToDesktop();
  }
  void import('../preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );

  if (isExpertScopeActive()) {
    teardownExpertScopeShell();
  }

  if (savedActiveChatId && sessionState) {
    const prev = savedActiveChatId;
    savedActiveChatId = null;
    if (sessionState.chats.some((c) => c.id === prev)) {
      activateChatById(prev);
      void import('../sidebar').then((m) => m.renderSidebar());
      const chat = sessionState.chats.find((c) => c.id === prev);
      if (chat) {
        void import('../messages').then((mod) => {
          mod.renderChatFromHistory(chat);
          mod.renderStatsForChat(chat);
        });
      }
    }
  }

  setStep('gallery');
  selectedExpertId = null;
  editExpertId = null;
  editDirty = false;
  closeTileMenus();
}

export interface OpenExpertsOptions {
  step?: ExpertsHubStep;
  expertId?: string;
}

/** Open Experts hub (`#/experts`). */
export function openExperts(options?: OpenExpertsOptions): void {
  const root = getRoot();
  const shell = getChatShell();
  if (!root || !shell) return;

  closeSettings({ skipNavigate: true });
  closeGlobalBugs();
  closeBenchmark({ skipNavigate: true });
  void import('../welcome-page').then((m) => {
    if (m.isWelcomePageOpen()) m.closeWelcome({ skipHash: true });
  });

  if (isExpertScopeActive()) {
    teardownExpertScopeShell();
  }

  if (!savedActiveChatId && sessionState?.activeId) {
    savedActiveChatId = sessionState.activeId;
  }

  setExpertsPageOpen(true);
  root.classList.add('is-open');
  if (!isOsShellEnabled()) {
    shell.classList.add('hidden');
    document.querySelector('header.topbar')?.classList.add('hidden');
    document.getElementById('drawer')?.setAttribute('aria-hidden', 'true');
    const nextHash = '#/experts';
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }
  void import('../preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );

  void refreshExpertsEnabledState();

  const step = options?.step ?? 'gallery';
  if (options?.expertId) {
    openExpertDetail(options.expertId);
  } else {
    setStep(step);
    if (step === 'gallery') renderGallery();
  }
}

export function openExpertLabFromTopbar(): void {
  openExperts();
}

/** @deprecated Use openExperts */
export function openExpertLab(): void {
  openExperts();
}

/** @deprecated Use closeExpertsHub */
export function closeExpertLab(): void {
  closeExpertsHub();
}

/** @deprecated Use refreshExpertsEnabledState */
export async function refreshExpertLabEnabledState(): Promise<void> {
  return refreshExpertsEnabledState();
}

let staticBindingsDone = false;

function bindStaticControls(): void {
  if (staticBindingsDone) return;
  staticBindingsDone = true;

  document.getElementById('btnExpertsPageBack')?.addEventListener('click', () => {
    if (currentStep === 'chats') {
      setStep('gallery');
      renderGallery();
      return;
    }
    if (currentStep === 'create' || currentStep === 'edit') {
      if (currentStep === 'edit') {
        cancelEditExpert();
        return;
      }
      setStep('gallery');
      return;
    }
    if (isOsShellEnabled()) navigateToDesktop();
    else closeExpertsHub();
  });

  document.getElementById('btnExpertsDetailBack')?.addEventListener('click', () => {
    setStep('gallery');
    renderGallery();
  });

  document.getElementById('btnExpertsCreateCancel')?.addEventListener('click', () => {
    setStep('gallery');
  });

  document.getElementById('btnExpertsCreate')?.addEventListener('click', () => {
    void submitCreateExpert();
  });

  document.getElementById('btnExpertsEditCancel')?.addEventListener('click', () => {
    cancelEditExpert();
  });

  document.getElementById('expertsEditForm')?.addEventListener('submit', (e) => {
    void submitEditExpert(e);
  });

  document.getElementById('expertsEditLabel')?.addEventListener('input', markEditDirty);
  document.getElementById('expertsEditDescription')?.addEventListener('input', markEditDirty);
  document.getElementById('expertsEditIcon')?.addEventListener('input', markEditDirty);
  document.getElementById('expertsEditAccent')?.addEventListener('change', markEditDirty);

  const editBody = document.getElementById('expertsEditBody');
  editBody?.addEventListener('input', () => {
    markEditDirty();
    if (editProfile === 'lite') editLiteEdited = true;
    const ta = editBody as HTMLTextAreaElement;
    if (editProfile === 'full') editFullBody = ta.value;
    else editLiteBody = ta.value;
  });

  document.querySelectorAll('.experts-profile-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const el = tab as HTMLElement;
      const profile = el.dataset.profile === 'lite' ? 'lite' : 'full';
      const bodyInput = document.getElementById('expertsEditBody') as HTMLTextAreaElement | null;
      if (bodyInput) {
        if (editProfile === 'full') editFullBody = bodyInput.value;
        else editLiteBody = bodyInput.value;
      }
      editProfile = profile;
      document.querySelectorAll('.experts-profile-tab').forEach((t) => {
        const node = t as HTMLElement;
        const active = node.dataset.profile === profile;
        node.classList.toggle('is-active', active);
        node.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      syncEditBodyField();
    });
  });

  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.experts-tile-menu-wrap')) {
      closeTileMenus();
    }
  });

  document.getElementById('btnExpertsNewChat')?.addEventListener('click', () => {
    if (selectedExpertId) void startExpertChat(selectedExpertId);
  });

  document.getElementById('btnExpertScopeBack')?.addEventListener('click', () => {
    returnToExpertsHub();
  });

  document.getElementById('btnExpertScopeNewChat')?.addEventListener('click', () => {
    const scopeId = selectedExpertId;
    if (scopeId) void startExpertChat(scopeId);
  });
}

function onHashChange(): void {
  const hash = window.location.hash;
  if (hash.startsWith('#/experts')) {
    openExperts();
    return;
  }
  if (isOsShellEnabled() && isOsAppHash(hash)) return;
  if (isExpertsPageOpen()) {
    closeExpertsHub();
  }
}

export function initExpertsHub(): void {
  bindStaticControls();
  window.addEventListener('hashchange', onHashChange);
  if (window.location.hash.startsWith('#/experts')) {
    openExperts();
  }
}

if (typeof window !== 'undefined') {
  window.openExpertLab = openExpertLab;
  window.openExperts = openExperts;
  window.openExpertLabFromTopbar = openExpertLabFromTopbar;
}
