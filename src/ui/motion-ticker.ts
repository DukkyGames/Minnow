/**
 * Step every looping animation at a low fixed rate instead of once per vsync.
 *
 * A running CSS animation makes Chromium's compositor emit a frame every vsync for as
 * long as it runs, whether or not the animation visibly changes between frames. On a
 * machine hosting a local model that is not free: the renderer and llama.cpp share one
 * GPU, and decode is a long chain of tiny serialized kernels — exactly the workload that
 * loses to time-slicing.
 *
 * The cost is *not* additive. The compositor produces a frame per vsync if **any**
 * animation is running, so one spinner costs what five cost, and silencing four of five
 * buys nothing at all. That is the trap this module exists to avoid: the win only appears
 * at zero running animations, which means the fix has to be exhaustive rather than a list
 * of selectors someone has to remember to extend.
 *
 * So: pause every infinite animation and advance its `currentTime` by the real time that
 * has passed. A paused animation drives no frames; assigning `currentTime` produces exactly
 * one. Motion stays legible — a stepped spinner is an ordinary look, and a frozen one
 * reads as a hung app — while frame production drops from the refresh rate to STEP_HZ.
 *
 * Stepping the real animations rather than reimplementing them means each one keeps its
 * own keyframes, easing, `animation-delay` and per-child stagger, and animations added
 * later are covered without touching this file.
 *
 * Finite animations are deliberately left alone: a panel reveal is a fifth of a second of
 * frames, and freezing one mid-flight would look broken.
 *
 * Two things here are load-bearing for how the result *feels*, both learned the hard way:
 *
 * - Steps advance by measured elapsed time, never by a fixed amount. `setInterval` drifts
 *   badly while the main thread is parsing SSE and re-rendering markdown, so a fixed
 *   advance desynchronises the animation clock from the wall clock — motion runs slow,
 *   stalls, then jumps. Irregular stepping reads as broken far more than slow stepping
 *   does; film is 24 fps and looks fine because it is metronomic.
 *
 * - Discovery is decoupled from stepping. `document.getAnimations()` forces a style
 *   recalc, so a periodic sweep on a long, actively streaming transcript adds real input
 *   and scroll latency. Stepping animations we already hold costs nothing. New looping
 *   animations (thinking caret, tool spinner) are parked by MutationObserver on `<html>`
 *   plus capture-phase `animationstart` — both event-driven, not a 250 ms timer.
 */

import { isRenderIdle } from '../boot/render-idle';

/** Set on `<html>` while stepping. Carries no CSS — it is a state flag for diagnostics. */
const MOTION_ATTR = 'data-mn-motion';
const MOTION_TICKED = 'ticked';

/**
 * How often parked animations advance — the frame rate the UI actually runs at during a
 * local generation, and the dial for the whole trade.
 *
 * Cost is close to linear in frames per second: the full-rate penalty measured ~6 tok/s at
 * 144 Hz, so each step/second is worth very roughly 0.04 tok/s. 8 Hz was cheap but visibly
 * choppy; 20 Hz costs a few tenths of a tok/s and reads as motion rather than as a series
 * of poses. Raise it if smoothness matters more than the last tenth.
 */
const STEP_HZ = 20;
const STEP_INTERVAL_MS = Math.round(1000 / STEP_HZ);

/**
 * Ceiling on a single advance. After a long main-thread stall (a big tool result landing,
 * a tab regaining focus) the true elapsed time can be seconds; replaying all of it would
 * spin a spinner wildly. Cap it and let the animation land wherever it lands.
 */
const MAX_STEP_MS = 250;

/**
 * The slice of the Web Animations API this module needs, structurally typed so tests can
 * drive it without a DOM that implements animations.
 */
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

/** Only looping animations are worth parking; a finite one ends on its own. */
function isInfinite(anim: SteppableAnimation): boolean {
  return anim.effect?.getTiming().iterations === Infinity;
}

/**
 * Pause every running infinite animation and take ownership of stepping it.
 *
 * Called on acquire (document-wide once) and whenever discovery sees a new node or a
 * CSS animation start. A spinner that appears mid-turn (tool-call, thinking caret)
 * would otherwise run at full vsync for the rest of the turn and cancel the tok/s win
 * on its own. Exhaustive parking is load-bearing; do not replace this with a selector
 * allow-list.
 */
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
    // `idle` means the animation was cancelled — its element left the DOM, or the rule
    // stopped matching. Nothing to step, and resuming it later would resurrect it.
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

/**
 * A newly inserted element (thinking caret, tool spinner) may already be running at
 * vsync. Park its subtree only — not `document.getAnimations()` — so token-grain DOM
 * writes do not force a document-wide style recalc.
 */
function onMutations(records: MutationRecord[]): void {
  for (const rec of records) {
    if (rec.type !== 'childList') continue;
    for (const node of rec.addedNodes) {
      if (node.nodeType !== 1) continue;
      parkTarget(node as unknown as AnimationsHost, true);
    }
  }
}

/**
 * Class-toggled loops on already-mounted chrome (sidebar dots) never appear as
 * childList mutations. `animationstart` is the cheap signal; park that element only.
 */
function onAnimationStarted(ev: Event): void {
  const target = ev.target;
  if (!target || typeof (target as AnimationsHost).getAnimations !== 'function') return;
  parkTarget(target as AnimationsHost, false);
}

function startDiscovery(): void {
  const Ctor = mutationObserverCtor();
  const root = document.documentElement;
  // Observe `<html>` rather than sweeping getAnimations on a timer: childList
  // (not characterData) so streamed text nodes do not re-enter style recalc.
  if (Ctor && root) {
    observer = new Ctor(onMutations);
    observer.observe(root, { childList: true, subtree: true });
  }
  document.addEventListener('animationstart', onAnimationStarted, true);
}

function stopDiscovery(): void {
  observer?.disconnect();
  observer = null;
  if (typeof document !== 'undefined') {
    document.removeEventListener('animationstart', onAnimationStarted, true);
  }
}

function tick(): void {
  const at = now();
  // A hidden window already parks animation wholesale (`render-idle.ts`). Reset the clock
  // rather than banking the elapsed time, so coming back does not replay the whole gap.
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
  // Once on acquire is OK — existing spinners (sidebar, status) are already running.
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

/**
 * Step looping animations at STEP_HZ (20 Hz) until the returned function is called.
 *
 * Refcounted, so overlapping generations (a background chat streaming under a visible
 * one) nest without either release ending the other's stepping. Releasing twice is safe.
 *
 * No-ops where there is nothing to gain: outside a document (this module is reachable
 * from the server-side engine bundle), and under `prefers-reduced-motion`, where these
 * animations are already off.
 */
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
