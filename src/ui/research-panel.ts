/**
 * Deep Research overlay inside the Code app main column (#chatArea).
 *
 * Reparents static `#researchView` from index.html (Run + Library tabs) and
 * reuses `src/research/panel.ts` for run/stream logic.
 */

import '../styles/research-panel.css';

import { notifyAskQuestionDisplayContextChanged } from '../chat/ask-question-display';
import { resolveResearchModelBinding } from '../research/resolve-binding';
import { getForegroundAppId, getOsView } from '../os/instances';
import { isOsShellEnabled } from '../os/page-bridge';
import { sessionState } from '../state/sessions';
import { iconHtml } from './icon';
import { stripMainColumnOverlayClasses } from './main-column-overlay';

const CHAT_AREA_CLASS = 'chat-area--research';
const MAIN_COLUMN_CLASS = 'main-column--research';
const EMBEDDED_CLASS = 'research-page--embedded';
const EMBED_BACK_BTN_ID = 'btnResearchEmbedBack';
const BANNER_ID = 'researchPanelBanner';
const IDLE_COPY_ID = 'researchPanelIdleCopy';
const CONFIG_ERROR_ID = 'researchPanelConfigError';

const IDLE_COPY =
  'Research runs a multi-step search and writes a report to your library.';
const CONFIG_ERROR_COPY = 'Deep Research is not configured. Set an engine in Settings.';

export interface ResearchPanelOpenOptions {
  seed?: string;
  autoRun?: boolean;
}

type ResearchPanelListener = () => void;

let researchViewHome: { parent: HTMLElement; nextSibling: ChildNode | null } | null = null;
let returnChatId: string | null = null;
let embedEscapeBound = false;
let controlsReady = false;

/** Queued launch options consumed when Code foregrounds (router / legacy hash). */
let pendingOpen: ResearchPanelOpenOptions | undefined;
let pendingOpenQueued = false;

const listeners = new Set<ResearchPanelListener>();

function emit(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

function getRoot(): HTMLElement | null {
  return document.getElementById('researchView');
}

/** Subscribe to open/close for rail chrome sync. */
export function subscribeResearchPanel(listener: ResearchPanelListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether Research is mounted in the Code main column. */
export function isResearchPanelOpen(): boolean {
  const area = document.getElementById('chatArea');
  const root = getRoot();
  if (!area || !root) return false;
  return area.contains(root) && area.classList.contains(CHAT_AREA_CLASS);
}

/** Whether a research embed open is queued (Code foreground handler). */
export function hasPendingResearchPanelOpen(): boolean {
  return pendingOpenQueued;
}

/** Queue panel open for the next Code route apply (launchApp research / legacy hash). */
export function queueResearchPanelOpen(options?: ResearchPanelOpenOptions): void {
  pendingOpenQueued = true;
  pendingOpen = options;
}

/** Consume queued open; null when nothing was queued. */
export function consumePendingResearchPanelOpen(): ResearchPanelOpenOptions | undefined | null {
  if (!pendingOpenQueued) return null;
  pendingOpenQueued = false;
  const opts = pendingOpen;
  pendingOpen = undefined;
  return opts;
}

function rememberResearchViewHome(root: HTMLElement): void {
  const area = document.getElementById('chatArea');
  if (area?.contains(root)) return;
  const parent = root.parentElement;
  if (!parent) return;
  researchViewHome = { parent, nextSibling: root.nextSibling };
}

function restoreResearchViewHome(): void {
  const root = getRoot();
  if (!root || !researchViewHome) return;
  const { parent, nextSibling } = researchViewHome;
  if (nextSibling && nextSibling.parentElement === parent) {
    parent.insertBefore(root, nextSibling);
  } else {
    parent.appendChild(root);
  }
  root.classList.remove(EMBEDDED_CLASS);
  researchViewHome = null;
}

function removeEmbeddedBackButton(): void {
  document.getElementById(EMBED_BACK_BTN_ID)?.remove();
}

function ensureEmbeddedBackButton(): void {
  if (document.getElementById(EMBED_BACK_BTN_ID)) return;
  const railHead = getRoot()?.querySelector('.rs-rail__head');
  if (!railHead) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = EMBED_BACK_BTN_ID;
  btn.className = 'icon-btn research-panel-embed-back';
  btn.setAttribute('aria-label', 'Back to chat');
  btn.title = 'Back to chat';
  btn.innerHTML = iconHtml('back');
  btn.addEventListener('click', () => {
    closeResearchPanel();
  });
  railHead.insertBefore(btn, railHead.firstChild);
}

function ensureStatusBanner(): void {
  const ask = getRoot()?.querySelector('.rs-ask');
  const composer = ask?.querySelector('.rs-composer');
  if (!ask || !composer || document.getElementById(BANNER_ID)) return;

  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.className = 'research-panel-banner';
  banner.hidden = true;

  const idle = document.createElement('p');
  idle.id = IDLE_COPY_ID;
  idle.textContent = IDLE_COPY;

  const err = document.createElement('p');
  err.id = CONFIG_ERROR_ID;
  err.className = 'research-panel-banner--error';
  err.textContent = CONFIG_ERROR_COPY;
  err.hidden = true;

  banner.append(idle, err);
  ask.insertBefore(banner, composer);
}

/** Refresh idle / engine-config banner (call after run UI changes). */
export async function syncResearchPanelStatus(): Promise<void> {
  ensureStatusBanner();
  const banner = document.getElementById(BANNER_ID);
  const idle = document.getElementById(IDLE_COPY_ID);
  const err = document.getElementById(CONFIG_ERROR_ID);
  if (!banner || !idle || !err) return;

  // The banner belongs to the composer, so it only shows while the composer is up.
  const askVisible = document.getElementById('researchAskPane')?.hidden === false;
  const root = getRoot();
  const running = root?.classList.contains('is-running') ?? false;

  if (!askVisible || running) {
    banner.hidden = true;
    return;
  }

  let configured = false;
  try {
    const binding = await resolveResearchModelBinding();
    configured = Boolean(binding.providerId?.trim() && binding.model?.trim());
  } catch {
    configured = false;
  }

  banner.hidden = false;
  idle.hidden = !configured;
  err.hidden = configured;
}

async function ensureResearchControls(): Promise<void> {
  if (controlsReady) return;
  const { initResearchPage } = await import('../research/panel');
  initResearchPage();
  controlsReady = true;
}

async function closeCompetingMainColumnViews(): Promise<void> {
  const { closeOtherCodeStageViews } = await import('./main-column-overlay');
  await closeOtherCodeStageViews('research');
}

function bindEmbedEscape(): void {
  if (embedEscapeBound) return;
  embedEscapeBound = true;
  window.addEventListener('keydown', onEmbedEscape);
}

function unbindEmbedEscape(): void {
  if (!embedEscapeBound) return;
  embedEscapeBound = false;
  window.removeEventListener('keydown', onEmbedEscape);
}

function onEmbedEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !isResearchPanelOpen()) return;
  event.preventDefault();
  closeResearchPanel();
}

async function applyOpenOptions(options?: ResearchPanelOpenOptions): Promise<void> {
  const panel = await import('../research/panel');
  if (options?.seed?.trim()) {
    const query = document.getElementById('researchQuery') as HTMLTextAreaElement | null;
    if (query) query.value = options.seed.trim();
  }
  if (options?.autoRun) {
    await panel.startResearchRunFromShell();
  }
  void syncResearchPanelStatus();
}

/** Mount Research as a fullscreen app (legacy embed API → launch Research app). */
export async function openResearchPanel(options?: ResearchPanelOpenOptions): Promise<void> {
  const { launchApp } = await import('../os/router');
  launchApp('research', {
    seed: options?.seed,
    autoRun: options?.autoRun,
  });
}

/** Tear down the embed and restore chat in the main column. */
export function closeResearchPanel(options?: { restoreChat?: boolean }): void {
  if (!isResearchPanelOpen() && !researchViewHome) return;

  void import('../research/panel').then((panel) => {
    panel.closeResearchEmbeddedRun();
  });

  const savedReturnChatId = returnChatId;
  teardownResearchPanelBeforeChatPaint();

  if (options?.restoreChat === false) {
    notifyAskQuestionDisplayContextChanged();
    emit();
    return;
  }

  const targetId =
    savedReturnChatId && sessionState?.chats.some((c) => c.id === savedReturnChatId)
      ? savedReturnChatId
      : sessionState?.activeId;
  const chat = targetId ? sessionState?.chats.find((c) => c.id === targetId) : undefined;
  const area = document.getElementById('chatArea');
  if (chat) {
    void import('./messages').then((m) => m.renderChatFromHistory(chat));
  } else if (area) {
    area.replaceChildren();
  }
  notifyAskQuestionDisplayContextChanged();
  emit();
}

/**
 * Restore Research out of #chatArea before the transcript repaints.
 * @returns true when an active embed was torn down.
 */
export function teardownResearchPanelBeforeChatPaint(): boolean {
  const area = document.getElementById('chatArea');
  const root = getRoot();
  const inChat = Boolean(area && root && area.contains(root));
  const hadEmbed = isResearchPanelOpen() || inChat || Boolean(researchViewHome);

  if (inChat) {
    restoreResearchViewHome();
  } else {
    researchViewHome = null;
    root?.classList.remove(EMBEDDED_CLASS);
  }

  area?.classList.remove(CHAT_AREA_CLASS);
  document.getElementById('mainColumn')?.classList.remove(MAIN_COLUMN_CLASS);
  stripMainColumnOverlayClasses();

  removeEmbeddedBackButton();
  returnChatId = null;
  unbindEmbedEscape();

  document.getElementById(BANNER_ID)?.remove();

  emit();
  return hadEmbed;
}

/** Toggle Research embed (rail / deep link). */
export function toggleResearchPanel(options?: ResearchPanelOpenOptions): void {
  if (isResearchPanelOpen()) {
    closeResearchPanel();
    return;
  }
  void openResearchPanel(options);
}

/** Reset module state (tests). */
export function resetResearchPanelForTests(): void {
  teardownResearchPanelBeforeChatPaint();
  pendingOpen = undefined;
  pendingOpenQueued = false;
  controlsReady = false;
  listeners.clear();
}
