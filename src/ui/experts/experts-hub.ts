/**
 * Experts' Lab — split-pane roster + detail (MinnowOS layout).
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
import { isOsAppHash, isOsEmbedded } from '../../os/page-bridge';
import { requestCloseWindowApp, registerWindowTeardown } from '../../os/window-mounted-apps';
import { launchApp, navigateToDesktop } from '../../os/router';

export { openExpertChatInShell } from './experts-scope';

export type ExpertsHubStep = 'browse' | 'create' | 'edit';

/** @deprecated Use browse */
export type LegacyExpertsHubStep = 'gallery' | 'chats';

let currentStep: ExpertsHubStep = 'browse';
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

function hueClassForIndex(index: number): string {
  return `hue-${(index % 4) + 1}`;
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

function normalizeOpenStep(
  step?: ExpertsHubStep | LegacyExpertsHubStep | 'gallery' | 'chats',
): ExpertsHubStep {
  if (step === 'gallery' || step === 'chats') return 'browse';
  return step ?? 'browse';
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

function promptPreviewForExpert(expertId: string): string {
  const expert = getExpert(expertId);
  if (!expert) return '';
  const body = expert.liteBody?.trim() || expert.fullBody?.trim() || '';
  if (body.length <= 1200) return body;
  return `${body.slice(0, 1200).trimEnd()}…`;
}

function modelLabelForExpert(meta: ExpertMeta): string {
  if (meta.tagline?.trim()) return meta.tagline.trim();
  return 'Uses the active chat model at send time';
}

/** Left roster column — selectable expert cards. */
function renderExpertList(): void {
  const list = document.getElementById('expertsList');
  if (!list) return;
  list.replaceChildren();

  const experts = listExperts();
  if (experts.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'experts-chat-empty';
    empty.textContent = 'No experts yet. Use New expert to create one.';
    list.appendChild(empty);
    return;
  }

  experts.forEach((expert, index) => {
    const accent = expertAccent(expert.meta);
    const chatCount = getExpertChats(expert.meta.id).length;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `experts-card ${accentClassName(accent)}`;
    card.classList.toggle('on', expert.meta.id === selectedExpertId);
    card.dataset.expertId = expert.meta.id;
    card.setAttribute('role', 'listitem');

    const ava = document.createElement('span');
    ava.className = `experts-card-ava ${hueClassForIndex(index)}`;
    ava.textContent = expertIcon(expert.meta);
    ava.setAttribute('aria-hidden', 'true');
    applyAccentToElement(ava, accent);

    const meta = document.createElement('div');
    meta.className = 'experts-card-meta';

    const label = document.createElement('b');
    label.textContent = expert.meta.label;

    const role = document.createElement('i');
    role.textContent = expert.meta.description ?? expert.meta.tagline ?? 'Expert persona';

    meta.appendChild(label);
    meta.appendChild(role);
    card.appendChild(ava);
    card.appendChild(meta);

    if (chatCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'experts-card-badge';
      badge.textContent = String(chatCount);
      badge.setAttribute('aria-label', `${chatCount} chat${chatCount === 1 ? '' : 's'}`);
      card.appendChild(badge);
    }

    card.addEventListener('click', () => selectExpert(expert.meta.id));
    list.appendChild(card);
  });

  if (!selectedExpertId && experts[0]) {
    selectExpert(experts[0].meta.id, { skipListRender: true });
    renderExpertList();
  }
}

/** Right detail column for the selected expert. */
function renderExpertDetail(): void {
  const mount = document.getElementById('expertsDetailMount');
  if (!mount) return;
  mount.replaceChildren();

  if (!selectedExpertId) return;

  const expert = getExpert(selectedExpertId);
  if (!expert) return;

  const builtinIds = getBuiltinExpertIds();
  const accent = expertAccent(expert.meta);
  const experts = listExperts();
  const index = experts.findIndex((e) => e.meta.id === selectedExpertId);

  const head = document.createElement('div');
  head.className = 'experts-detail-head';

  const ava = document.createElement('span');
  ava.className = `experts-card-ava lg ${hueClassForIndex(Math.max(index, 0))} ${accentClassName(accent)}`;
  ava.textContent = expertIcon(expert.meta);
  ava.setAttribute('aria-hidden', 'true');
  applyAccentToElement(ava, accent);

  const headCopy = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = expert.meta.label;
  const subtitle = document.createElement('p');
  subtitle.textContent = expert.meta.description ?? expert.meta.tagline ?? 'Focused specialist persona';
  headCopy.appendChild(title);
  headCopy.appendChild(subtitle);
  head.appendChild(ava);
  head.appendChild(headCopy);
  mount.appendChild(head);

  mount.appendChild(
    buildReadonlyField('MODEL', modelLabelForExpert(expert.meta)),
  );

  const promptText = promptPreviewForExpert(selectedExpertId);
  if (promptText) {
    mount.appendChild(buildPromptField('SYSTEM PROMPT', promptText));
  }

  const chatsSection = document.createElement('div');
  chatsSection.className = 'experts-chats-section';

  const chatsLabel = document.createElement('div');
  chatsLabel.className = 'experts-field-label experts-mono';
  chatsLabel.textContent = 'CHATS';
  chatsSection.appendChild(chatsLabel);

  const chatList = document.createElement('div');
  chatList.id = 'expertsChatList';
  chatList.className = 'experts-chat-list chat-list';
  chatList.setAttribute('role', 'list');

  const chats = getExpertChats(selectedExpertId);
  if (chats.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'experts-chat-empty';
    empty.textContent = 'No chats yet. Test this expert in the sandbox below.';
    chatList.appendChild(empty);
  } else {
    for (const chat of chats) {
      appendChatRow(chatList, chat, null, {
        draggable: false,
        onActivate: (c) => {
          void openExpertChatInShell(c);
        },
      });
    }
  }

  chatsSection.appendChild(chatList);
  mount.appendChild(chatsSection);

  const actions = document.createElement('div');
  actions.className = 'experts-detail-actions';

  const testBtn = document.createElement('button');
  testBtn.type = 'button';
  testBtn.className = 'experts-btn-primary';
  testBtn.innerHTML =
    '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/></svg> Test in sandbox';
  testBtn.addEventListener('click', () => {
    void startExpertChat(selectedExpertId!);
  });

  actions.appendChild(testBtn);

  if (isUserOwnedExpert(expert, builtinIds)) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'experts-btn-ghost';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      void openEditExpertStep(selectedExpertId!);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'experts-btn-ghost is-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      void deleteExpertFromHub(selectedExpertId!, expert.meta.label);
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
  }

  mount.appendChild(actions);
}

function buildReadonlyField(label: string, value: string): HTMLElement {
  const field = document.createElement('div');
  field.className = 'experts-field';

  const fieldLabel = document.createElement('div');
  fieldLabel.className = 'experts-field-label experts-mono';
  fieldLabel.textContent = label;

  const fieldVal = document.createElement('div');
  fieldVal.className = 'experts-field-val';
  fieldVal.textContent = value;

  field.appendChild(fieldLabel);
  field.appendChild(fieldVal);
  return field;
}

function buildPromptField(label: string, value: string): HTMLElement {
  const field = document.createElement('div');
  field.className = 'experts-field';

  const fieldLabel = document.createElement('div');
  fieldLabel.className = 'experts-field-label experts-mono';
  fieldLabel.textContent = label;

  const area = document.createElement('div');
  area.className = 'experts-field-area';
  area.textContent = value;

  field.appendChild(fieldLabel);
  field.appendChild(area);
  return field;
}

function selectExpert(expertId: string, options?: { skipListRender?: boolean }): void {
  selectedExpertId = expertId;
  if (!options?.skipListRender) {
    document.querySelectorAll('.experts-card').forEach((card) => {
      const el = card as HTMLElement;
      el.classList.toggle('on', el.dataset.expertId === expertId);
    });
  }
  if (currentStep === 'browse') {
    renderExpertDetail();
  }
}

/** Refresh roster + detail (exported for settings toggle). */
export function renderGallery(): void {
  renderExpertList();
  renderExpertDetail();
}

export function openExpertDetail(expertId: string): void {
  selectedExpertId = expertId;
  setStep('browse');
  renderGallery();
}

export function renderExpertChatList(expertId: string): void {
  selectedExpertId = expertId;
  renderExpertDetail();
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

/** Leave expert-scoped shell and return to the hub detail pane. */
export function returnToExpertsHub(): void {
  const expertId = selectedExpertId;
  teardownExpertScopeShell();
  if (isOsEmbedded()) {
    launchApp('experts');
  }
  if (expertId) {
    openExperts({ step: 'browse', expertId });
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
    selectedExpertId = result.expertId;
    setStep('browse');
    renderGallery();
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
    const savedId = editExpertId;
    editExpertId = null;
    editDirty = false;
    selectedExpertId = savedId;
    setStep('browse');
    renderGallery();
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
  setStep('browse');
}

async function deleteExpertFromHub(expertId: string, label: string): Promise<void> {
  if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
  try {
    await deleteUserExpert(expertId);
    if (selectedExpertId === expertId) selectedExpertId = null;
    renderGallery();
    setStep('browse');
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
  if (!isOsEmbedded()) {
    shell.classList.remove('hidden');
    document.querySelector('header.topbar')?.classList.remove('hidden');
    if (!options?.skipNavigate && window.location.hash.startsWith('#/experts')) {
      window.location.hash = '#/';
    }
  } else if (!options?.skipNavigate) {
    if (!requestCloseWindowApp('experts')) {
      navigateToDesktop();
    }
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

  setStep('browse');
  selectedExpertId = null;
  editExpertId = null;
  editDirty = false;
}

export interface OpenExpertsOptions {
  step?: ExpertsHubStep | LegacyExpertsHubStep;
  expertId?: string;
}

/** Open Experts' Lab (`#/experts` / `#/app/experts`). */
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
  if (!isOsEmbedded()) {
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

  const step = normalizeOpenStep(options?.step);
  if (options?.expertId) {
    selectedExpertId = options.expertId;
  }
  setStep(step);
  if (step === 'browse') {
    renderGallery();
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

  document.getElementById('btnExpertsNew')?.addEventListener('click', () => {
    openCreateExpertStep();
  });

  document.getElementById('btnExpertsCreateCancel')?.addEventListener('click', () => {
    setStep('browse');
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
  if (isOsEmbedded() && isOsAppHash(hash)) return;
  if (isExpertsPageOpen()) {
    closeExpertsHub();
  }
}

export function initExpertsHub(): void {
  registerWindowTeardown('experts', () => closeExpertsHub({ skipNavigate: true }));
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
