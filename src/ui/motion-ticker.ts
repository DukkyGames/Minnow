import { isRenderIdle } from '../boot/render-idle';

/** Set on `<html>` while stepping. Carries no CSS — it is a state flag for diagnostics. */
const MOTION_ATTR = 'data-mn-motion';
const MOTION_TICKED = 'ticked';

/** How often parked animations advance — the frame rate the UI actually runs at during a local generation, and the dial for the whole trade. */
const STEP_HZ = 20;
const STEP_INTERVAL_MS = Math.round(1000 / STEP_HZ);

/** Ceiling on a single advance. */
const MAX_STEP_MS = 250;

/** The slice of the Web Animations API this module needs, structurally typed so tests can drive it without a DOM that implements animations. */
export interface SteppableAnimation {
  readonly playState: string;
  currentTime: number | null;
  readonly effect: { getTiming(): { iterations?: number } } | null;
  pause(): void;
  play(): void;
}

const NOOP = (): void => {};

let leases = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let lastStepAt = 0;
let observer: MutationObserver | null = null;
const parked = new Set<SteppableAnimation>();
/** Coalesce mutation-driven getAnimations into one rAF (MIN-584). */
let discoveryRaf: number | null = null;

/** Only looping animations are worth parking; a finite one ends on its own. */
function isInfinite(anim: SteppableAnimation): boolean {
  return anim.effect?.getTiming().iterations === Infinity;
}

/** Pause every running infinite animation and take ownership of stepping it. */
export function parkRunningInfinite(
  animations: Iterable<SteppableAnimation>,
  into: Set<SteppableAnimation> = parked,
): void {
  for (const anim of animations) {
    if (anim.playState !== 'running' || into.has(anim)) continue;
    if (!isInfinite(anim)) continue;
    anim.pause();
    into.add(anim);
  }
}

/** Advance every parked animation by one tick, dropping any that has since been cancelled. */
export function stepParked(deltaMs: number, from: Set<SteppableAnimation> = parked): void {
  for (const anim of [...from]) {
    if (anim.playState === 'idle') {
      from.delete(anim);
      continue;
    }
    const at = anim.currentTime;
    if (typeof at !== 'number') continue;
    anim.currentTime = at + deltaMs;
  }
}

/** Hand the animations back to the compositor at full rate. */
export function resumeParked(from: Set<SteppableAnimation> = parked): void {
  for (const anim of from) {
    if (anim.playState !== 'paused') continue;
    anim.play();
  }
  from.clear();
}

type AnimationsHost = {
  getAnimations?: (opts?: { subtree?: boolean }) => Iterable<unknown> | unknown[];
};

/** Read WAAPI animations from a node without assuming a real CSSAnimation type. */
function readAnimations(target: AnimationsHost, subtree: boolean): SteppableAnimation[] {
  if (typeof target.getAnimations !== 'function') return [];
  try {
    const raw = subtree ? target.getAnimations({ subtree: true }) : target.getAnimations();
    if (!raw || typeof (raw as Iterable<unknown>)[Symbol.iterator] !== 'function') return [];
    return [...(raw as Iterable<SteppableAnimation>)];
  } catch {
    return [];
  }
}

function currentAnimations(): SteppableAnimation[] {
  if (typeof document === 'undefined') return [];
  return readAnimations(document as unknown as AnimationsHost, false);
}

function parkTarget(target: AnimationsHost, subtree: boolean): void {
  parkRunningInfinite(readAnimations(target, subtree));
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function mutationObserverCtor(): typeof MutationObserver | null {
  if (typeof MutationObserver === 'function') return MutationObserver;
  const w = typeof window !== 'undefined' ? window : undefined;
  if (w && typeof w.MutationObserver === 'function') return w.MutationObserver;
  return null;
}

/** A newly inserted element (thinking caret, tool spinner) may already be running at vsync. */
function onMutations(records: MutationRecord[]): void {
  let added = false;
  for (const rec of records) {
    if (rec.type !== 'childList') continue;
    for (const node of rec.addedNodes) {
      if (node.nodeType === 1) {
        added = true;
        break;
      }
    }
    if (added) break;
  }
  if (!added) return;
  const host =
    (document.documentElement as unknown as AnimationsHost) ??
    (document as unknown as AnimationsHost);
  if (typeof requestAnimationFrame !== 'function') {
    parkTarget(host, true);
    return;
  }
  if (discoveryRaf != null) return;
  discoveryRaf = requestAnimationFrame(() => {
    discoveryRaf = null;
    parkTarget(host, true);
  });
}

/** Class-toggled loops on already-mounted chrome (sidebar dots) never appear as childList mutations. */
function onAnimationStarted(ev: Event): void {
  const target = ev.target;
  if (!target || typeof (target as AnimationsHost).getAnimations !== 'function') return;
  parkTarget(target as AnimationsHost, false);
}

function startDiscovery(): void {
  const Ctor = mutationObserverCtor();
  const root = document.documentElement;
  if (Ctor && root) {
    observer = new Ctor(onMutations);
    observer.observe(root, { childList: true, subtree: true });
  }
  document.addEventListener('animationstart', onAnimationStarted, true);
}

function stopDiscovery(): void {
  if (discoveryRaf != null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(discoveryRaf);
  }
  discoveryRaf = null;
  observer?.disconnect();
  observer = null;
  if (typeof document !== 'undefined') {
    document.removeEventListener('animationstart', onAnimationStarted, true);
  }
}

function tick(): void {
  const at = now();
  if (isRenderIdle()) {
    lastStepAt = at;
    return;
  }

  stepParked(Math.min(at - lastStepAt, MAX_STEP_MS));
  lastStepAt = at;
}

function start(): void {
  document.documentElement?.setAttribute(MOTION_ATTR, MOTION_TICKED);
  lastStepAt = now();
  parkRunningInfinite(currentAnimations());
  startDiscovery();
  timer = setInterval(tick, STEP_INTERVAL_MS);
}

function stop(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  stopDiscovery();
  document.documentElement?.removeAttribute(MOTION_ATTR);
  resumeParked();
}

/** True while looping animations are being stepped rather than run at the refresh rate. */
export function isTickedMotionActive(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement?.getAttribute(MOTION_ATTR) === MOTION_TICKED;
}

/** Step looping animations at STEP_HZ (20 Hz) until the returned function is called. */
export function acquireTickedMotion(): () => void {
  if (typeof document === 'undefined') return NOOP;
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return NOOP;
  }

  leases += 1;
  if (leases === 1) start();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    leases = Math.max(0, leases - 1);
    if (leases === 0) stop();
  };
}
