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
 * So: pause every infinite animation and advance its `currentTime` by one tick's worth on
 * each tick. A paused animation drives no frames; assigning `currentTime` produces exactly
 * one. Motion stays legible — a stepped spinner is an ordinary look, and a frozen one
 * reads as a hung app — while frame production drops from the refresh rate to 8 Hz.
 *
 * Stepping the real animations rather than reimplementing them means each one keeps its
 * own keyframes, easing, `animation-delay` and per-child stagger, and animations added
 * later are covered without touching this file.
 *
 * Finite animations are deliberately left alone: a panel reveal is a fifth of a second of
 * frames, and freezing one mid-flight would look broken.
 */

import { isRenderIdle } from '../boot/render-idle';

/** Set on `<html>` while stepping. Carries no CSS — it is a state flag for diagnostics. */
const MOTION_ATTR = 'data-mn-motion';
const MOTION_TICKED = 'ticked';

/**
 * 8 Hz. Below ~6 Hz a spinner reads as stuttering rather than stepped; above ~12 Hz the
 * frames saved stop being worth the main-thread work.
 */
const TICK_INTERVAL_MS = 125;

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

function tick(): void {
  // A hidden window already parks animation wholesale (`render-idle.ts`); holding where
  // we are costs nothing and resumes mid-cycle when the window comes back.
  if (isRenderIdle()) return;
  parkRunningInfinite(currentAnimations());
  stepParked(TICK_INTERVAL_MS);
}

function start(): void {
  document.documentElement?.setAttribute(MOTION_ATTR, MOTION_TICKED);
  parkRunningInfinite(currentAnimations());
  timer = setInterval(tick, TICK_INTERVAL_MS);
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
