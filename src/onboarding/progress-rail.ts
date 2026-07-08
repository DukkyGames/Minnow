/**
 * Bottom progress rail with minnow fish marker (reduced-motion safe).
 */

import type { OnboardingStep, OnboardingStepId } from './types';

const GLYPH_URL = '/logos/minnow-glyph-white.svg';

function prefersReducedMotion(): boolean {
  return (
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export interface ProgressRailHandle {
  setActiveIndex: (index: number) => void;
  destroy: () => void;
}

/** Mount step dots and swimming fish marker along the bottom rail. */
export function mountProgressRail(
  container: HTMLElement,
  steps: OnboardingStep[],
  activeId: OnboardingStepId,
): ProgressRailHandle {
  container.innerHTML = '';
  container.className = 'mn-onboarding-rail';
  container.setAttribute('role', 'navigation');
  container.setAttribute('aria-label', 'Setup progress');

  const track = document.createElement('div');
  track.className = 'mn-onboarding-rail__track';

  const dots: HTMLButtonElement[] = [];
  const applicable = steps.filter((s) => s.id !== 'welcome');

  applicable.forEach((step, index) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'mn-onboarding-rail__dot';
    dot.dataset.stepId = step.id;
    dot.setAttribute('aria-label', step.title);
    dot.title = step.title;
    if (step.id === activeId) dot.classList.add('is-active');
    const doneIdx = applicable.findIndex((s) => s.id === activeId);
    if (index < doneIdx) dot.classList.add('is-done');
    track.appendChild(dot);
    dots.push(dot);
  });

  const fish = document.createElement('div');
  fish.className = 'mn-onboarding-rail__fish';
  fish.setAttribute('aria-hidden', 'true');

  const fishImg = document.createElement('img');
  fishImg.src = GLYPH_URL;
  fishImg.alt = '';
  fishImg.width = 20;
  fishImg.height = 20;
  fishImg.className = 'mn-onboarding-rail__fish-glyph';
  fish.appendChild(fishImg);

  container.appendChild(track);
  container.appendChild(fish);

  const reduced = prefersReducedMotion();
  if (reduced) fish.classList.add('is-static');

  function positionFish(index: number): void {
    const dot = dots[index];
    if (!dot) return;
    const trackRect = track.getBoundingClientRect();
    const dotRect = dot.getBoundingClientRect();
    const x = dotRect.left + dotRect.width / 2 - trackRect.left;
    fish.style.setProperty('--fish-x', `${x}px`);
  }

  const activeIndex = Math.max(
    0,
    applicable.findIndex((s) => s.id === activeId),
  );
  positionFish(activeIndex);

  const onResize = () => positionFish(activeIndex);
  window.addEventListener('resize', onResize);

  return {
    setActiveIndex(index: number) {
      dots.forEach((dot, i) => {
        dot.classList.toggle('is-active', i === index);
        dot.classList.toggle('is-done', i < index);
      });
      positionFish(index);
      if (!reduced) {
        fish.classList.remove('is-swimming');
        void fish.offsetWidth;
        fish.classList.add('is-swimming');
      }
    },
    destroy() {
      window.removeEventListener('resize', onResize);
      container.innerHTML = '';
    },
  };
}
