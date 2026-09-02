export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** CSS transition duration for bar fills. */
export function barTransitionMs(): number {
  return prefersReducedMotion() ? 0 : 800;
}

/** Animate a horizontal bar width from 0 to target percent. */
export function animateBarWidth(
  el: HTMLElement,
  percent: number,
  durationMs = barTransitionMs(),
): void {
  if (durationMs <= 0) {
    el.style.width = `${percent}%`;
    return;
  }
  el.style.width = '0%';
  requestAnimationFrame(() => {
    el.style.transition = `width ${durationMs}ms cubic-bezier(0.16, 1, 0.3, 1)`;
    el.style.width = `${percent}%`;
  });
}
