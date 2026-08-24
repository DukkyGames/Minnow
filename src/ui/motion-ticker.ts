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
 * - Rescanning is decoupled from stepping. `document.getAnimations()` forces a style
 *   recalc, so calling it at the step rate on a long, actively streaming transcript adds
 *   real input and scroll latency. Stepping animations we already hold costs nothing.
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
 * How often to look for animations that have started since the last sweep. Deliberately
 * much slower than the step rate — this is the call that forces a style recalc. A spinner
 * that appears mid-turn runs at full rate for at most this long before being parked.
 */
const RESCAN_INTERVAL_MS = 250;

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
let lastRescanAt = 0;
const parked = new Set<SteppableAnimation>();

/** Only looping animations are worth parking; a finite one ends on its own. */
function isInfinite(anim: SteppableAnimation): boolean {
  return anim.effect?.getTiming().iterations === Infinity;
}

/**
 * Pause every running infinite animation and take ownership of stepping it.
 *
 * Re-run on each tick, not just on acquire: an animation that starts mid-generation (a
 * tool-call spinner appearing, a thinking caret) would otherwise run at full rate for the
 * rest of the turn and cost the whole saving on its own.
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

function currentAnimations(): SteppableAnimation[] {
  if (typeof document === 'undefined') return [];
  const doc = document as Document;
  if (typeof doc.getAnimations !== 'function') return [];
  return doc.getAnimations() as unknown as SteppableAnimation[];
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function tick(): void {
  const at = now();
  // A hidden window already parks animation wholesale (`render-idle.ts`). Reset the clock
  // rather than banking the elapsed time, so coming back does not replay the whole gap.
  if (isRenderIdle()) {
    lastStepAt = at;
    return;
  }

  if (at - lastRescanAt >= RESCAN_INTERVAL_MS) {
    lastRescanAt = at;
    parkRunningInfinite(currentAnimations());
  }

  stepParked(Math.min(at - lastStepAt, MAX_STEP_MS));
  lastStepAt = at;
}

function start(): void {
  document.documentElement?.setAttribute(MOTION_ATTR, MOTION_TICKED);
  lastStepAt = now();
  lastRescanAt = lastStepAt;
  parkRunningInfinite(currentAnimations());
  timer = setInterval(tick, STEP_INTERVAL_MS);
}

function stop(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  document.documentElement?.removeAttribute(MOTION_ATTR);
  resumeParked();
}

/** True while looping animations are being stepped rather than run at the refresh rate. */
export function isTickedMotionActive(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement?.getAttribute(MOTION_ATTR) === MOTION_TICKED;
}

/**
 * Step looping animations at 8 Hz until the returned function is called.
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
