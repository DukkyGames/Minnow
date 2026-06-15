/**
 * Desktop composer FLIP transition — hero center to bottom dock.
 */

const HERO_EXIT_MS = 450;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Move the composer root from the hero mount into the dock with a FLIP animation.
 * Falls back to an instant reparent when reduced motion is preferred.
 */
export async function runComposerDockTransition(
  composerEl: HTMLElement,
  fromMount: HTMLElement,
  toDock: HTMLElement,
): Promise<void> {
  if (prefersReducedMotion()) {
    toDock.appendChild(composerEl);
    return;
  }

  const first = composerEl.getBoundingClientRect();
  toDock.appendChild(composerEl);
  const last = composerEl.getBoundingClientRect();

  const dx = first.left - last.left;
  const dy = first.top - last.top;
  const sx = first.width / Math.max(last.width, 1);
  const sy = first.height / Math.max(last.height, 1);

  composerEl.style.transformOrigin = 'top left';
  composerEl.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
  composerEl.style.transition = 'none';

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      composerEl.style.transition = `transform ${HERO_EXIT_MS}ms var(--os-ease-out, ease-out)`;
      composerEl.style.transform = '';
      const onEnd = (): void => {
        composerEl.removeEventListener('transitionend', onEnd);
        composerEl.style.transition = '';
        composerEl.style.transformOrigin = '';
        resolve();
      };
      composerEl.addEventListener('transitionend', onEnd);
      window.setTimeout(onEnd, HERO_EXIT_MS + 50);
    });
  });

  void wait(HERO_EXIT_MS);
}
