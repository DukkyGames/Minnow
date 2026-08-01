/**
 * Shared phone/tablet layout signals.
 *
 * CSS media queries answer "how wide is the viewport"; several shell behaviours
 * (window geometry, drag affordances, drawer mode) need the same answer in JS so
 * the DOM and the stylesheet never disagree. This module is the single source:
 * it stamps `mn-phone` / `mn-tablet` / `mn-touch` on `<html>` and lets callers
 * subscribe to changes.
 */

/**
 * Phone layout: no room for window management.
 *
 * Width alone is not enough — a phone in landscape is 740–930px wide and under
 * 430px tall, which is plenty of columns but nowhere near enough rows to stack
 * a menubar, a floating window, and a dock. The second clause covers that (and
 * short split-screen windows) without hijacking wide desktops that happen to be
 * short.
 *
 * Keep in sync with the `html.mn-phone` rules in styles/mobile.css.
 */
export const PHONE_MQ = '(max-width: 640px), (max-width: 1024px) and (max-height: 540px)';
/** Tablets and split-screen desktop windows — denser than phone, no dual rails. */
export const TABLET_MQ =
  '(min-width: 641px) and (max-width: 1024px) and (min-height: 541px)';
/** Touch-first input; true on tablets and touchscreen laptops as well as phones. */
export const COARSE_POINTER_MQ = '(pointer: coarse)';

type Listener = (phone: boolean) => void;

const listeners = new Set<Listener>();
let phoneMq: MediaQueryList | null = null;
let tabletMq: MediaQueryList | null = null;
let coarseMq: MediaQueryList | null = null;
let installed = false;

function query(mq: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(mq);
}

/** True when the viewport is phone-sized. Safe to call before init. */
export function isPhoneLayout(): boolean {
  return (phoneMq ?? query(PHONE_MQ))?.matches ?? false;
}

/** True on tablet-width viewports (excludes phones). */
export function isTabletLayout(): boolean {
  return (tabletMq ?? query(TABLET_MQ))?.matches ?? false;
}

/** True when the primary pointer is touch — hover affordances are unavailable. */
export function isCoarsePointer(): boolean {
  return (coarseMq ?? query(COARSE_POINTER_MQ))?.matches ?? false;
}

/** Subscribe to phone-layout changes. Returns an unsubscribe function. */
export function onPhoneLayoutChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function syncFlags(): void {
  const root = document.documentElement;
  root.classList.toggle('mn-phone', isPhoneLayout());
  root.classList.toggle('mn-tablet', isTabletLayout());
  root.classList.toggle('mn-touch', isCoarsePointer());
}

/**
 * Stamp layout flags on `<html>` and keep them current. Idempotent — the shell
 * and tests may both call it.
 */
export function initMobileLayout(): void {
  if (installed) {
    syncFlags();
    return;
  }
  phoneMq = query(PHONE_MQ);
  tabletMq = query(TABLET_MQ);
  coarseMq = query(COARSE_POINTER_MQ);
  syncFlags();
  if (!phoneMq?.addEventListener) return;
  installed = true;

  const onChange = () => {
    const wasPhone = document.documentElement.classList.contains('mn-phone');
    syncFlags();
    const nowPhone = isPhoneLayout();
    if (wasPhone === nowPhone) return;
    for (const listener of listeners) listener(nowPhone);
  };

  phoneMq.addEventListener('change', onChange);
  tabletMq?.addEventListener?.('change', onChange);
  coarseMq?.addEventListener?.('change', onChange);
  // Backstop: a dropped media-query event would leave the shell stuck in phone
  // chrome on a desktop viewport, which is worse than the cost of this check.
  window.addEventListener('resize', onChange, { passive: true });
  window.addEventListener('orientationchange', onChange, { passive: true });
}
