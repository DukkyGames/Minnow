/**
 * Minnow desktop state machine — idle hero, desktop chat, and desktop research.
 */

import { runComposerDockTransition } from './composer-motion';

/** Desktop surface mode: hero concierge vs docked chat vs research vs experts. */
export type DesktopState =
  | 'idle'
  | 'chatActive'
  | 'researchIdle'
  | 'researchActive'
  | 'expertsIdle'
  | 'expertsActive';

export interface DesktopChatActivateOptions {
  seed?: string;
  chatId?: string;
}

export interface DesktopResearchActivateOptions {
  seed?: string;
  autoRun?: boolean;
}

export interface DesktopExpertsActivateOptions {
  step?: 'browse' | 'create' | 'edit';
  expertId?: string;
  /** Open the full lab panel immediately (create/edit steps imply this). */
  openLab?: boolean;
}

type DesktopStateListener = (state: DesktopState) => void;

let state: DesktopState = 'idle';
const listeners = new Set<DesktopStateListener>();

/** Pending chat activation consumed on the next desktop route apply. */
let pendingChatOptions: DesktopChatActivateOptions | undefined;
/** Whether a chat activation was queued (options may still be undefined). */
let chatActivationQueued = false;
/** Pending research activation consumed on the next desktop route apply. */
let pendingResearchOptions: DesktopResearchActivateOptions | undefined;
/** Whether a research activation was queued (options may still be undefined). */
let researchActivationQueued = false;
/** Pending experts activation consumed on the next desktop route apply. */
let pendingExpertsOptions: DesktopExpertsActivateOptions | undefined;
/** Whether an experts activation was queued (options may still be undefined). */
let expertsActivationQueued = false;

const COMPOSER_PLACEHOLDER_IDLE = 'What would you like to do today?';
const COMPOSER_PLACEHOLDER_RESEARCH = 'What would you like to research?';
const COMPOSER_PLACEHOLDER_EXPERTS = 'Message an expert…';

const HERO_SUB_IDLE =
  "What should we get into today?";
const HERO_GREET_RESEARCH = 'Deep research.';
const HERO_SUB_RESEARCH =
  "What would you like to research? I'll gather sources and synthesize a report.";
const HERO_GREET_EXPERTS = "Experts' Lab.";
const HERO_SUB_EXPERTS =
  'Choose a specialist below, or open the lab to compose and tune experts.';

/** Time-of-day greeting for the desktop hero (idle / chat). */
function greetingForTime(d: Date): string {
  const h = d.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Working late';
}

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
  } else if (state === 'expertsIdle' || state === 'expertsActive') {
    input.placeholder = COMPOSER_PLACEHOLDER_EXPERTS;
  } else {
    input.placeholder = COMPOSER_PLACEHOLDER_IDLE;
  }
}

/** Swap hero headline + subcopy between concierge idle and research mode. */
function syncHeroCopy(): void {
  const greet = document.querySelector('.mn-os-desk-hero .mn-os-greet');
  const greetSub = document.querySelector('.mn-os-desk-hero .mn-os-greet-sub');
  if (!greet || !greetSub) {
    return;
  }
  if (state === 'researchIdle' || state === 'researchActive') {
    greet.textContent = `${HERO_GREET_RESEARCH}`;
    greetSub.textContent = HERO_SUB_RESEARCH;
    return;
  }
  if (state === 'expertsIdle' || state === 'expertsActive') {
    greet.textContent = `${HERO_GREET_EXPERTS}`;
    greetSub.textContent = HERO_SUB_EXPERTS;
    return;
  }
  greet.textContent = `${greetingForTime(new Date())}.`;
  greetSub.textContent = HERO_SUB_IDLE;
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

function getComposerDockTargets(): {
  composerRoot: HTMLElement;
  heroMount: HTMLElement;
  dock: HTMLElement;
} | null {
  const composerRoot = document.getElementById('desktopComposerRoot');
  const heroMount = document.querySelector('.mn-os-desk-hero .mn-os-concierge-mount');
  const dock = document.querySelector('.mn-os-composer-dock');
  if (!composerRoot || !heroMount || !dock) {
    return null;
  }
  return { composerRoot, heroMount: heroMount as HTMLElement, dock: dock as HTMLElement };
}

/** Move the desktop composer into the dock when it still lives in the hero. */
async function ensureDesktopComposerDocked(): Promise<void> {
  const targets = getComposerDockTargets();
  if (!targets || !targets.heroMount.contains(targets.composerRoot)) {
    return;
  }
  await runComposerDockTransition(
    targets.composerRoot,
    targets.heroMount,
    targets.dock,
  );
}

/** Return the desktop composer to the hero mount (e.g. leaving research mode). */
function returnDesktopComposerToHero(): void {
  const targets = getComposerDockTargets();
  if (!targets || targets.heroMount.contains(targets.composerRoot)) {
    return;
  }
  targets.heroMount.appendChild(targets.composerRoot);
}

function applyLayerClasses(): void {
  const layer = getDesktopLayer();
  if (!layer) {
    return;
  }
  layer.classList.toggle('is-chat-active', state === 'chatActive');
  layer.classList.toggle(
    'is-composer-docked',
    state === 'chatActive' || isDesktopResearchActive() || isDesktopExpertsActive(),
  );
  layer.classList.toggle('is-research-idle', state === 'researchIdle');
  layer.classList.toggle('is-research-active', state === 'researchActive');
  layer.classList.toggle(
    'is-research-mode',
    state === 'researchIdle' || state === 'researchActive',
  );
  layer.classList.toggle('is-experts-idle', state === 'expertsIdle');
  layer.classList.toggle('is-experts-active', state === 'expertsActive');
  layer.classList.toggle(
    'is-experts-mode',
    state === 'expertsIdle' || state === 'expertsActive',
  );
  syncComposerPlaceholder();
  syncHeroCopy();
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

/** True when desktop experts mode is active (idle or hub visible). */
export function isDesktopExpertsActive(): boolean {
  return state === 'expertsIdle' || state === 'expertsActive';
}

/** True when the experts hub fills the desktop stage. */
export function isDesktopExpertsHubActive(): boolean {
  return state === 'expertsActive';
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

/** Queue experts activation for the next desktop navigation. */
export function queueDesktopExpertsActivation(options?: DesktopExpertsActivateOptions): void {
  expertsActivationQueued = true;
  pendingExpertsOptions = options;
}

/** Consume queued experts activation; returns null when nothing was queued. */
export function consumePendingDesktopExpertsActivation():
  | DesktopExpertsActivateOptions
  | undefined
  | null {
  if (!expertsActivationQueued) {
    return null;
  }
  expertsActivationQueued = false;
  const opts = pendingExpertsOptions;
  pendingExpertsOptions = undefined;
  return opts;
}

/** @deprecated Use consumePendingDesktopExpertsActivation — kept for tests. */
export function takePendingDesktopExpertsOptions(): DesktopExpertsActivateOptions | undefined {
  const pending = consumePendingDesktopExpertsActivation();
  return pending === null ? undefined : pending;
}

/** Queue chat activation for the next desktop navigation (legacy #/app/chat). */
export function queueDesktopChatActivation(options?: DesktopChatActivateOptions): void {
  chatActivationQueued = true;
  pendingChatOptions = options;
}

/** Queue research activation for the next desktop navigation. */
export function queueDesktopResearchActivation(options?: DesktopResearchActivateOptions): void {
  researchActivationQueued = true;
  pendingResearchOptions = options;
}

/** Consume queued chat activation; returns null when nothing was queued. */
export function consumePendingDesktopChatActivation(): DesktopChatActivateOptions | undefined | null {
  if (!chatActivationQueued) {
    return null;
  }
  chatActivationQueued = false;
  const opts = pendingChatOptions;
  pendingChatOptions = undefined;
  return opts;
}

/** Consume queued research activation; returns null when nothing was queued. */
export function consumePendingDesktopResearchActivation():
  | DesktopResearchActivateOptions
  | undefined
  | null {
  if (!researchActivationQueued) {
    return null;
  }
  researchActivationQueued = false;
  const opts = pendingResearchOptions;
  pendingResearchOptions = undefined;
  return opts;
}

/** @deprecated Use consumePendingDesktopChatActivation — kept for tests. */
export function takePendingDesktopChatOptions(): DesktopChatActivateOptions | undefined {
  const pending = consumePendingDesktopChatActivation();
  return pending === null ? undefined : pending;
}

/** @deprecated Use consumePendingDesktopResearchActivation — kept for tests. */
export function takePendingDesktopResearchOptions(): DesktopResearchActivateOptions | undefined {
  const pending = consumePendingDesktopResearchActivation();
  return pending === null ? undefined : pending;
}

/**
 * Synchronously show desktop chat chrome before `showDesktop()` emits.
 * Avoids a one-frame idle-desktop flash when leaving a fullscreen app (e.g. Code).
 */
export function prepareDesktopChatSurface(): void {
  if (isDesktopResearchActive()) {
    deactivateDesktopResearch();
  }
  if (isDesktopExpertsActive()) {
    deactivateDesktopExperts();
  }
  setState('chatActive');
}

/** Synchronously show desktop research chrome before `showDesktop()` emits. */
export function prepareDesktopResearchSurface(): void {
  if (state === 'chatActive') {
    deactivateDesktopChat();
  }
  if (isDesktopExpertsActive()) {
    deactivateDesktopExperts();
  }
  setState('researchIdle');
}

/** Synchronously show desktop experts chrome before `showDesktop()` emits. */
export function prepareDesktopExpertsSurface(): void {
  if (state === 'chatActive') {
    deactivateDesktopChat();
  }
  if (isDesktopResearchActive()) {
    deactivateDesktopResearch();
  }
  setState('expertsIdle');
}

/**
 * Transition to desktop chat: dock composer, show rail + transcript, ensure session.
 * Does not launch the legacy Chat app layer.
 */
export async function activateDesktopChat(options?: DesktopChatActivateOptions): Promise<void> {
  if (isDesktopResearchActive()) {
    deactivateDesktopResearch();
  }
  if (isDesktopExpertsActive()) {
    deactivateDesktopExperts();
  }
  setState('chatActive');
  await ensureDesktopComposerDocked();

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
  if (isDesktopExpertsActive()) {
    deactivateDesktopExperts();
  }
  setState('researchIdle');
  await ensureDesktopComposerDocked();

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
  returnDesktopComposerToHero();
}

/**
 * Enter desktop experts mode — composer placeholder changes; hub mounts on desktop overlay.
 */
export async function activateDesktopExperts(
  options?: DesktopExpertsActivateOptions,
): Promise<void> {
  if (state === 'chatActive') {
    deactivateDesktopChat();
  }
  if (isDesktopResearchActive()) {
    deactivateDesktopResearch();
  }
  setState('expertsIdle');
  await ensureDesktopComposerDocked();

  const { bootstrapDesktopExperts } = await import('./experts-desktop');
  await bootstrapDesktopExperts(options);
}

/** Promote experts to hub-active layout (hero hidden, hub fills stage). */
export function setDesktopExpertsHubActive(active: boolean): void {
  if (!isDesktopExpertsActive() && active) {
    setState('expertsActive');
    return;
  }
  if (active) {
    setState('expertsActive');
  } else if (state === 'expertsActive') {
    setState('expertsIdle');
  }
}

/** Leave desktop experts mode. */
export function deactivateDesktopExperts(): void {
  if (!isDesktopExpertsActive()) {
    return;
  }
  void import('./experts-desktop').then((m) => m.teardownDesktopExperts());
  setState('idle');
  returnDesktopComposerToHero();
}

/** Reset module state (tests). */
export function resetDesktopStateForTests(): void {
  state = 'idle';
  pendingChatOptions = undefined;
  pendingResearchOptions = undefined;
  pendingExpertsOptions = undefined;
  chatActivationQueued = false;
  researchActivationQueued = false;
  expertsActivationQueued = false;
  listeners.clear();
  applyLayerClasses();
}

/** Force desktop state without bootstrapping UI (tests). */
export function setDesktopStateForTests(next: DesktopState): void {
  state = next;
  applyLayerClasses();
}

