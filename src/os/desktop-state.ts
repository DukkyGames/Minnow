/**
 * MinnowOS desktop state machine — idle hero, desktop chat, and desktop research.
 */

import { runComposerDockTransition } from './composer-motion';

/** Desktop surface mode: hero concierge vs docked chat vs research. */
export type DesktopState = 'idle' | 'chatActive' | 'researchIdle' | 'researchActive';

export interface DesktopChatActivateOptions {
  seed?: string;
  chatId?: string;
}

export interface DesktopResearchActivateOptions {
  seed?: string;
  autoRun?: boolean;
}

type DesktopStateListener = (state: DesktopState) => void;

let state: DesktopState = 'idle';
const listeners = new Set<DesktopStateListener>();

/** Pending chat activation consumed on the next desktop route apply. */
let pendingChatOptions: DesktopChatActivateOptions | undefined;
/** Pending research activation consumed on the next desktop route apply. */
let pendingResearchOptions: DesktopResearchActivateOptions | undefined;

const COMPOSER_PLACEHOLDER_IDLE = 'What would you like to do today?';
const COMPOSER_PLACEHOLDER_RESEARCH = 'What would you like to research?';

function getDesktopLayer(): HTMLElement | null {
  return document.getElementById('osDesktopLayer');
}

function getComposerInput(): HTMLTextAreaElement | null {
  return document.getElementById('desktopInput') as HTMLTextAreaElement | null;
}

function syncComposerPlaceholder(): void {
  const input = getComposerInput();
  if (!input) {
    return;
  }
  if (state === 'researchIdle' || state === 'researchActive') {
    input.placeholder = COMPOSER_PLACEHOLDER_RESEARCH;
  } else {
    input.placeholder = COMPOSER_PLACEHOLDER_IDLE;
  }
}

function emit(): void {
  for (const fn of listeners) {
    try {
      fn(state);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function applyLayerClasses(): void {
  const layer = getDesktopLayer();
  if (!layer) {
    return;
  }
  layer.classList.toggle('is-chat-active', state === 'chatActive');
  layer.classList.toggle('is-composer-docked', state === 'chatActive');
  layer.classList.toggle('is-research-idle', state === 'researchIdle');
  layer.classList.toggle('is-research-active', state === 'researchActive');
  layer.classList.toggle(
    'is-research-mode',
    state === 'researchIdle' || state === 'researchActive',
  );
  syncComposerPlaceholder();
}

/** Current desktop state. */
export function getDesktopState(): DesktopState {
  return state;
}

/** True when desktop chat transcript + rail are active. */
export function isDesktopChatActive(): boolean {
  return state === 'chatActive';
}

/** True when desktop research mode is active (idle or running). */
export function isDesktopResearchActive(): boolean {
  return state === 'researchIdle' || state === 'researchActive';
}

/** True when a research run is showing progress/result cards. */
export function isDesktopResearchRunActive(): boolean {
  return state === 'researchActive';
}

/** Subscribe to desktop state changes. */
export function subscribeDesktopState(listener: DesktopStateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setState(next: DesktopState): void {
  if (state === next) {
    return;
  }
  state = next;
  applyLayerClasses();
  emit();
}

/** Queue chat activation for the next desktop navigation (legacy #/app/chat). */
export function queueDesktopChatActivation(options?: DesktopChatActivateOptions): void {
  pendingChatOptions = options;
}

/** Queue research activation for the next desktop navigation. */
export function queueDesktopResearchActivation(options?: DesktopResearchActivateOptions): void {
  pendingResearchOptions = options;
}

/** Consume and return pending chat activation options, if any. */
export function takePendingDesktopChatOptions(): DesktopChatActivateOptions | undefined {
  const opts = pendingChatOptions;
  pendingChatOptions = undefined;
  return opts;
}

/** Consume and return pending research activation options, if any. */
export function takePendingDesktopResearchOptions(): DesktopResearchActivateOptions | undefined {
  const opts = pendingResearchOptions;
  pendingResearchOptions = undefined;
  return opts;
}

/**
 * Transition to desktop chat: dock composer, show rail + transcript, ensure session.
 * Does not launch the legacy Chat app layer.
 */
export async function activateDesktopChat(options?: DesktopChatActivateOptions): Promise<void> {
  if (isDesktopResearchActive()) {
    deactivateDesktopResearch();
  }
  const wasIdle = state === 'idle';
  setState('chatActive');

  if (wasIdle) {
    const composerRoot = document.getElementById('desktopComposerRoot');
    const heroMount = document.querySelector('.mn-os-desk-hero .mn-os-concierge-mount');
    const dock = document.querySelector('.mn-os-composer-dock');
    if (composerRoot && heroMount && dock) {
      await runComposerDockTransition(composerRoot, heroMount as HTMLElement, dock as HTMLElement);
    }
  }

  const { bootstrapDesktopChat } = await import('./desktop-chat');
  await bootstrapDesktopChat(options);
}

/** Return desktop to idle hero (does not clear chat history). */
export function deactivateDesktopChat(): void {
  if (state === 'chatActive') {
    setState('idle');
  }
}

/**
 * Enter desktop research mode — composer placeholder changes; optional seed / auto-run.
 */
export async function activateDesktopResearch(
  options?: DesktopResearchActivateOptions,
): Promise<void> {
  if (state === 'chatActive') {
    deactivateDesktopChat();
  }
  setState('researchIdle');

  const { bootstrapDesktopResearch } = await import('./research-desktop');
  await bootstrapDesktopResearch(options);
}

/** Mark research as actively running (progress/result cards visible). */
export function setDesktopResearchRunActive(active: boolean): void {
  if (!isDesktopResearchActive() && active) {
    setState('researchActive');
    return;
  }
  if (active) {
    setState('researchActive');
  } else if (state === 'researchActive') {
    setState('researchIdle');
  }
}

/** Leave desktop research mode. */
export function deactivateDesktopResearch(): void {
  if (!isDesktopResearchActive()) {
    return;
  }
  void import('./research-desktop').then((m) => m.teardownDesktopResearch());
  setState('idle');
}

/** Reset module state (tests). */
export function resetDesktopStateForTests(): void {
  state = 'idle';
  pendingChatOptions = undefined;
  pendingResearchOptions = undefined;
  listeners.clear();
  applyLayerClasses();
}
